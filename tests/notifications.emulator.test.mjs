// FR-09 against the Firestore emulator (no Functions emulator needed): the real confirmBooking, cancelBooking
// and reschedule create, cancel and recalculate tasks; the sender sends each task once; the sweep expires
// holds. Uses its own project id, so seeded data is untouched. The clock for the sender and the sweep is
// passed in; the booking functions use the real clock, so start times are relative to now.
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const PROJECT = 'fresher-notif-test'
process.env.GCLOUD_PROJECT = PROJECT
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: set FIRESTORE_EMULATOR_HOST (use `npm run test:rules`).')
  process.exit(1)
}
// Use the copy of firebase-admin that the functions use, so Timestamps and sentinels match.
const fromFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = fromFunctions('firebase-admin/app')
const { Timestamp, getFirestore } = fromFunctions('firebase-admin/firestore')
const req = createRequire(import.meta.url)
const booking = req('../functions/booking.js')
const sweep = req('../functions/sweep.js')
const { mockProvider } = req('../functions/messaging.js')

const app = initializeApp({ projectId: PROJECT }) // the default app, which booking.js uses
const db = getFirestore(app)
after(() => deleteApp(app))

const MIN = 60e3
const HOUR = 60 * MIN
const SG_OFFSET = 8 * HOUR
const SHOP = 'shop1'
const PHONE = '+6591230001'
const ALL_DAY = { start: '00:00', end: '23:59' }
const week = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [ALL_DAY]]))
const clear = () => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })

/** 10:00 Singapore, `days` days from now (always the same barber-day for the same `days`). */
function tenAm(days, extraHours = 0) {
  const k = booking.sgDateKey(Date.now() + days * 24 * HOUR)
  return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 10 + extraHours) - SG_OFFSET
}

/** `hours` from now on the 15-minute grid, nudged later if a 30-minute visit would run past 23:59 Singapore. */
function startIn(hours) {
  let t = Math.ceil((Date.now() + hours * HOUR) / (15 * MIN)) * 15 * MIN
  const minuteOfDay = (ms) => Math.floor(((ms + SG_OFFSET) % (24 * HOUR)) / MIN)
  while (minuteOfDay(t) + 30 > 23 * 60 + 59 || minuteOfDay(t) < 1) t += 15 * MIN
  return t
}

const customerAuth = (uid = 'cust1') => ({ uid, token: { phone_number: PHONE, auth_time: Math.floor(Date.now() / 1000) } })
const staffAuth = { uid: 'owner1', token: { role: 'owner', shopId: SHOP } }
const data = async (path) => (await db.doc(path).get()).data()
const task = (id, type) => data(`notifications/${id}_${type}`)

beforeEach(async () => {
  await clear()
  await db.doc(`shops/${SHOP}`).set({ name: 'Test shop', status: 'verified', openingHours: week, noticeMins: 120, latePolicy: 'block' })
  await db.doc(`shops/${SHOP}/barbers/b1`).set({ displayName: 'Ali', active: true, serviceIds: ['cut'], workingHours: week })
  await db.doc(`customers/cust1`).set({ phoneE164: PHONE, displayName: 'Sam' })
})

let counter = 0
/** A HELD appointment with a live hold, as holdSlot leaves it. */
async function hold(start, over = {}) {
  const id = `bk-${String(++counter).padStart(4, '0')}-notification-test`
  const apt = {
    requestId: id, shopId: SHOP, barberId: 'b1', serviceId: 'cut', customerId: null, status: 'HELD',
    start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN),
    holdExpiresAt: Timestamp.fromMillis(Date.now() + 10 * MIN), priceCents: 2500, durationMin: 30, ...over,
  }
  await db.doc(`appointments/${id}`).set(apt)
  const schedRef = db.doc(`shops/${SHOP}/schedules/${booking.scheduleId('b1', start)}`)
  const before = ((await schedRef.get()).data() || {}).intervals || []
  await schedRef.set({
    barberId: 'b1', date: booking.sgDateKey(start), version: 1,
    intervals: [...before, { start: apt.start, end: apt.end, kind: 'hold', holdExpiresAt: apt.holdExpiresAt }],
  })
  return id
}
const confirm = (id) => booking.confirmBooking({ auth: customerAuth(), data: { requestId: id, displayName: 'Sam' } })
async function confirmed(hoursAhead) {
  const start = startIn(hoursAhead)
  const id = await hold(start)
  await confirm(id)
  return { id, start }
}
const taskTypes = async (id) => (await db.collection('notifications').where('bookingId', '==', id).get()).docs.map((d) => d.data().type).sort()

/** A provider that records what it is asked to send. */
function recordingProvider(inner = mockProvider(() => {})) {
  const sent = []
  return { sent, send: async (msg) => { sent.push(msg); return inner.send(msg) } }
}

describe('task creation on confirmation', () => {
  it('a booking more than 24 h ahead gets a confirmation and both reminders, with deterministic IDs', async () => {
    const { id, start } = await confirmed(30)
    assert.deepEqual(await taskTypes(id), ['confirmation', 'reminder24h', 'reminder2h'])
    const r24 = await task(id, 'reminder24h')
    assert.equal(r24.dueAt.toMillis(), start - 24 * HOUR)
    assert.equal(r24.nextAttemptAt.toMillis(), start - 24 * HOUR)
    assert.deepEqual([r24.status, r24.channel, r24.barberId, r24.shopId, r24.bookingId, r24.rev], ['pending', 'sms', 'b1', SHOP, id, 1])
    assert.equal(r24.apptStart.toMillis(), start)
    assert.doesNotMatch(JSON.stringify(await task(id, 'confirmation')), /\+65/)
  })
  it('skips reminders that would already be past: under 24 h drops the 24 h one, under 2 h drops both', async () => {
    assert.deepEqual(await taskTypes((await confirmed(5)).id), ['confirmation', 'reminder2h'])
    assert.deepEqual(await taskTypes((await confirmed(1)).id), ['confirmation'])
  })
  it('a repeated confirm call does not reset tasks that already moved on', async () => {
    const { id } = await confirmed(30)
    await db.doc(`notifications/${id}_confirmation`).update({ status: 'sent', attempts: [{ outcome: 'sent' }] })
    await confirm(id)
    const c = await task(id, 'confirmation')
    assert.equal(c.status, 'sent')
    assert.equal(c.attempts.length, 1)
  })
})

describe('cancellation and rescheduling', () => {
  it('cancelBooking cancels pending tasks and keeps the log of a task that was already sent', async () => {
    const { id } = await confirmed(30)
    await db.doc(`notifications/${id}_confirmation`).update({ status: 'sent', nextAttemptAt: null, attempts: [{ outcome: 'sent' }] })
    await booking.cancelBooking({ auth: staffAuth, data: { requestId: id } })
    assert.equal((await task(id, 'confirmation')).status, 'sent')
    assert.equal((await task(id, 'confirmation')).attempts.length, 1)
    for (const type of ['reminder24h', 'reminder2h']) {
      const t = await task(id, type)
      assert.equal(t.status, 'cancelled')
      assert.equal(t.cancelReason, 'booking_cancelled')
      assert.equal('nextAttemptAt' in t, false)
    }
  })
  it('a cancelled booking sends nothing', async () => {
    const { id } = await confirmed(30)
    await db.doc(`notifications/${id}_confirmation`).delete()
    await booking.cancelBooking({ auth: staffAuth, data: { requestId: id } })
    const p = recordingProvider()
    const result = await sweep.sendDueTasks(db, p, Date.now() + 60 * HOUR)
    assert.equal(p.sent.length, 0)
    assert.equal(result.due, 0)
  })
  it('a customer cancel refused as late (block policy) leaves the tasks alone', async () => {
    const { id } = await confirmed(1) // inside the 120-minute notice window
    await assert.rejects(booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } }), { details: { reason: 'LATE_CANCEL_BLOCKED' } })
    assert.equal((await task(id, 'confirmation')).status, 'pending')
  })
  it('reschedule moves both reminders to the new start, resets a sent one and keeps its attempts', async () => {
    const { id } = await confirmed(30)
    await db.doc(`notifications/${id}_reminder24h`).update({ status: 'sent', nextAttemptAt: null, attempts: [{ outcome: 'sent', rev: 1 }] })
    const newStart = startIn(60)
    await booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart } })
    const r24 = await task(id, 'reminder24h')
    assert.equal(r24.status, 'pending')
    assert.equal(r24.rev, 2)
    assert.equal(r24.dueAt.toMillis(), newStart - 24 * HOUR)
    assert.equal(r24.apptStart.toMillis(), newStart)
    assert.equal(r24.attempts.length, 1)
    assert.equal((await task(id, 'reminder2h')).dueAt.toMillis(), newStart - 2 * HOUR)
    assert.equal((await task(id, 'confirmation')).apptStart.toMillis(), newStart)
  })
  it('reschedule to a nearer time cancels the reminder that would now be past; to a later time creates a skipped one', async () => {
    const near = await confirmed(30)
    await booking.reschedule({ auth: customerAuth(), data: { requestId: near.id, newStart: startIn(10) } })
    const past = await task(near.id, 'reminder24h')
    assert.deepEqual([past.status, past.cancelReason], ['cancelled', 'past_due'])
    assert.equal((await task(near.id, 'reminder2h')).status, 'pending')

    const short = await confirmed(5)
    assert.deepEqual(await taskTypes(short.id), ['confirmation', 'reminder2h'])
    const later = startIn(40)
    await booking.reschedule({ auth: customerAuth(), data: { requestId: short.id, newStart: later } })
    const created = await task(short.id, 'reminder24h')
    assert.equal(created.status, 'pending')
    assert.equal(created.dueAt.toMillis(), later - 24 * HOUR)
  })
})

describe('sending', () => {
  it('sends the confirmation to the customer through the provider and logs the attempt', async () => {
    const { id } = await confirmed(30)
    const p = recordingProvider()
    const now = Date.now() + 1000
    const result = await sweep.sendDueTasks(db, p, now)
    assert.equal(result.sent, 1) // the reminders are not due yet.
    assert.equal(p.sent.length, 1)
    assert.equal(p.sent[0].to, PHONE)
    assert.equal(p.sent[0].key, `${id}_confirmation:1:1`)
    assert.match(p.sent[0].body, /confirmed/)
    const c = await task(id, 'confirmation')
    assert.equal(c.status, 'sent')
    assert.equal('nextAttemptAt' in c, false)
    assert.equal(c.attempts.length, 1)
    assert.deepEqual([c.attempts[0].channel, c.attempts[0].outcome, c.attempts[0].attempt, c.attempts[0].rev], ['sms', 'sent', 1, 1])
    assert.equal(c.attempts[0].at.toMillis(), now)
    assert.equal((await task(id, 'reminder24h')).status, 'pending')
  })
  it('sends a reminder only once its due time has come', async () => {
    const { id, start } = await confirmed(30)
    await sweep.sendDueTasks(db, recordingProvider(), Date.now() + 1000)
    const p = recordingProvider()
    await sweep.sendDueTasks(db, p, start - 24 * HOUR - 1)
    assert.equal(p.sent.length, 0)
    await sweep.sendDueTasks(db, p, start - 24 * HOUR)
    assert.deepEqual(p.sent.map((m) => m.key), [`${id}_reminder24h:1:1`])
    assert.match(p.sent[0].body, /24 hours/)
  })
  it('is idempotent: repeated and concurrent runs send each task exactly once', async () => {
    const { id } = await confirmed(30)
    const p = recordingProvider()
    const now = Date.now() + 1000
    await Promise.all(Array.from({ length: 5 }, () => sweep.sendDueTasks(db, p, now)))
    await sweep.sendDueTasks(db, p, now + MIN)
    await sweep.sendDueTasks(db, p, now + 5 * MIN)
    assert.equal(p.sent.length, 1)
    assert.equal((await task(id, 'confirmation')).attempts.length, 1)
  })
  it('retries a failed send 1 minute later, twice at most: 3 attempts, then failed', async () => {
    const { id } = await confirmed(30)
    // confirmBooking writes the phone from the token, so change it afterwards. The mock always fails for 0000.
    await db.doc('customers/cust1').update({ phoneE164: '+6591230000' })
    const p = recordingProvider()
    const t0 = Date.now() + 1000
    assert.equal((await sweep.sendDueTasks(db, p, t0)).retry, 1)
    assert.equal((await task(id, 'confirmation')).nextAttemptAt.toMillis(), t0 + MIN)
    await sweep.sendDueTasks(db, p, t0 + 30e3) // too soon.
    assert.equal(p.sent.length, 1)
    assert.equal((await sweep.sendDueTasks(db, p, t0 + MIN)).retry, 1)
    assert.equal((await sweep.sendDueTasks(db, p, t0 + 2 * MIN)).failed, 1)
    await sweep.sendDueTasks(db, p, t0 + 10 * MIN) // finished: nothing more.
    assert.equal(p.sent.length, 3)
    const c = await task(id, 'confirmation')
    assert.equal(c.status, 'failed')
    assert.equal('nextAttemptAt' in c, false)
    assert.deepEqual(c.attempts.map((a) => [a.attempt, a.outcome, a.error]), [
      [1, 'failed', 'MOCK_DELIVERY_FAILED'], [2, 'failed', 'MOCK_DELIVERY_FAILED'], [3, 'failed', 'MOCK_DELIVERY_FAILED']])
    assert.deepEqual(p.sent.map((m) => m.key.split(':')[2]), ['1', '2', '3'])
  })
  it('a retry that succeeds ends as sent, with both attempts logged', async () => {
    const { id } = await confirmed(30)
    let calls = 0
    const flaky = { send: async () => (++calls === 1 ? { ok: false, error: 'TEMP' } : { ok: true, providerRef: 'x' }) }
    const t0 = Date.now() + 1000
    await sweep.sendDueTasks(db, flaky, t0)
    await sweep.sendDueTasks(db, flaky, t0 + MIN)
    const c = await task(id, 'confirmation')
    assert.equal(c.status, 'sent')
    assert.deepEqual(c.attempts.map((a) => a.outcome), ['failed', 'sent'])
  })
  it('a provider that throws counts as a failed attempt', async () => {
    const { id } = await confirmed(30)
    await sweep.sendDueTasks(db, { send: async () => { throw new Error('boom') } }, Date.now() + 1000)
    const c = await task(id, 'confirmation')
    assert.equal(c.status, 'pending')
    assert.equal(c.attempts[0].error, 'PROVIDER_ERROR')
  })
  it('a claimed task is not sent again until its 2-minute lease runs out (crash recovery)', async () => {
    const { id } = await confirmed(30)
    const t0 = Date.now() + 1000
    // What a run that crashed after claiming leaves behind.
    await db.doc(`notifications/${id}_confirmation`).update({ nextAttemptAt: Timestamp.fromMillis(t0 + sweep.LEASE_MS) })
    const p = recordingProvider()
    await sweep.sendDueTasks(db, p, t0 + MIN)
    assert.equal(p.sent.length, 0)
    await sweep.sendDueTasks(db, p, t0 + sweep.LEASE_MS)
    assert.equal(p.sent.length, 1)
  })
  it('cancels instead of sending when the appointment moved or was cancelled without the tasks following', async () => {
    const moved = await confirmed(30)
    await db.doc(`appointments/${moved.id}`).update({ start: Timestamp.fromMillis(moved.start + 3 * HOUR) })
    const gone = await confirmed(30)
    await db.doc(`appointments/${gone.id}`).update({ status: 'CANCELLED' })
    const p = recordingProvider()
    const result = await sweep.sendDueTasks(db, p, Date.now() + 1000)
    assert.equal(p.sent.length, 0)
    assert.equal(result.skipped, 2)
    for (const { id } of [moved, gone]) {
      const c = await task(id, 'confirmation')
      assert.deepEqual([c.status, c.cancelReason], ['cancelled', 'stale'])
    }
  })
  it('does not send after the appointment has started', async () => {
    const { id, start } = await confirmed(30)
    const p = recordingProvider()
    await sweep.sendDueTasks(db, p, start)
    assert.equal(p.sent.length, 0)
    assert.equal((await task(id, 'confirmation')).status, 'cancelled')
  })
  it('a task cancelled while its message was going out stays cancelled; the attempt is still logged', async () => {
    const { id } = await confirmed(30)
    const slow = { send: async () => {
      await db.doc(`notifications/${id}_confirmation`).update({ status: 'cancelled', nextAttemptAt: null })
      return { ok: true, providerRef: 'x' }
    } }
    const result = await sweep.sendDueTasks(db, slow, Date.now() + 1000)
    assert.equal(result.superseded, 1)
    const c = await task(id, 'confirmation')
    assert.equal(c.status, 'cancelled')
    assert.equal(c.attempts.length, 1)
  })
  it('fails the task, without calling the provider, when the customer has no number on file', async () => {
    const { id } = await confirmed(30)
    await db.doc('customers/cust1').delete()
    const p = recordingProvider()
    await sweep.sendDueTasks(db, p, Date.now() + 1000)
    assert.equal(p.sent.length, 0)
    assert.equal((await task(id, 'confirmation')).attempts[0].error, 'NO_PHONE_NUMBER')
  })
})

describe('expiry sweep (resolves L2)', () => {
  const now = () => Date.now()
  const audit = async (id) => (await db.collection('auditLog').where('bookingId', '==', id).get()).docs.map((d) => ({ id: d.id, ...d.data() }))
  const intervals = async (start) => (await data(`shops/${SHOP}/schedules/${booking.scheduleId('b1', start)}`)).intervals

  it('moves an expired HELD appointment to EXPIRED, frees its interval and audits it as the system', async () => {
    const start = startIn(30)
    const id = await hold(start, { holdExpiresAt: Timestamp.fromMillis(now() - MIN) })
    const result = await sweep.sweepExpiredHolds(db, now())
    assert.deepEqual(result, { found: 1, expired: 1 })
    const apt = await data(`appointments/${id}`)
    assert.equal(apt.status, 'EXPIRED')
    assert.equal(apt.holdExpiresAt, null)
    assert.deepEqual(await intervals(start), [])
    const records = await audit(id)
    assert.equal(records.length, 1)
    assert.equal(records[0].id, `${id}_EXPIRED`)
    assert.deepEqual([records[0].action, records[0].role, records[0].actorUid, records[0].fromStatus, records[0].toStatus, records[0].shopId],
      ['expire', 'system', null, 'HELD', 'EXPIRED', SHOP])
    assert.ok(records[0].expireAt.toMillis() > records[0].at.toMillis())
  })
  it('leaves a live hold and other statuses alone', async () => {
    const liveStart = startIn(30)
    const live = await hold(liveStart)
    const done = await hold(startIn(31), { status: 'CONFIRMED', customerId: 'cust1', holdExpiresAt: null })
    assert.deepEqual(await sweep.sweepExpiredHolds(db, now()), { found: 0, expired: 0 })
    assert.equal((await data(`appointments/${live}`)).status, 'HELD')
    assert.equal((await data(`appointments/${done}`)).status, 'CONFIRMED')
    assert.ok((await intervals(liveStart)).some((iv) => iv.start.toMillis() === liveStart))
    assert.deepEqual(await audit(live), [])
  })
  it('an expiring hold does not disturb a booking or another live hold on the same barber-day', async () => {
    const start = tenAm(3)
    const expiring = await hold(start, { holdExpiresAt: Timestamp.fromMillis(now() - MIN) })
    const other = await hold(tenAm(3, 2))
    await sweep.sweepExpiredHolds(db, now())
    assert.equal((await data(`appointments/${expiring}`)).status, 'EXPIRED')
    assert.equal((await data(`appointments/${other}`)).status, 'HELD')
    const left = await intervals(start)
    assert.equal(left.length, 1)
    assert.equal(left[0].start.toMillis(), tenAm(3, 2))
  })
  it('is idempotent: running it again, or concurrently, changes nothing and writes one audit record', async () => {
    const id = await hold(startIn(30), { holdExpiresAt: Timestamp.fromMillis(now() - MIN) })
    const runs = await Promise.all(Array.from({ length: 4 }, () => sweep.sweepExpiredHolds(db, now())))
    assert.equal(runs.reduce((sum, r) => sum + r.expired, 0), 1)
    assert.deepEqual(await sweep.sweepExpiredHolds(db, now()), { found: 0, expired: 0 })
    assert.equal((await audit(id)).length, 1)
  })
  it('never expires a hold that was confirmed after the sweep listed it', async () => {
    const start = startIn(30)
    const id = await hold(start, { holdExpiresAt: Timestamp.fromMillis(now() + 5 * MIN) })
    // Listed as expired only because the sweep's clock is 10 minutes ahead; the real hold is still live and
    // the customer confirms first. The sweep's own transaction then sees CONFIRMED and does nothing.
    await confirm(id)
    assert.deepEqual(await sweep.sweepExpiredHolds(db, now() + 10 * MIN), { found: 0, expired: 0 })
    assert.equal((await data(`appointments/${id}`)).status, 'CONFIRMED')
    assert.equal((await audit(id)).filter((a) => a.action === 'expire').length, 0)
  })
  it('releaseHold still expires an unexpired hold, audited as the customer (shared code path)', async () => {
    const id = await hold(startIn(30))
    assert.deepEqual(await booking.releaseHold({ requestId: id }), { released: true })
    const [record] = await audit(id)
    assert.deepEqual([record.action, record.role], ['release', 'customer'])
  })
})

describe('backfill for bookings made before FR-09', () => {
  /** A CONFIRMED appointment with no tasks, as an older booking looks. */
  async function legacy(hoursAhead, over = {}) {
    const start = startIn(hoursAhead)
    const id = await hold(start, { status: 'CONFIRMED', customerId: 'cust1', holdExpiresAt: null, ...over })
    return { id, start }
  }

  it('confirmBooking records when the reminders were planned, and reschedule refreshes it', async () => {
    const before = Date.now()
    const { id } = await confirmed(30)
    const planned = (await task(id, 'confirmation')).plannedAt.toMillis()
    assert.ok(planned >= before && planned <= Date.now())
    await new Promise((r) => setTimeout(r, 20))
    await booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart: startIn(60) } })
    assert.ok((await task(id, 'confirmation')).plannedAt.toMillis() > planned)
  })
  it('creates both reminders for a future CONFIRMED booking that has none, and no confirmation', async () => {
    const { id, start } = await legacy(30)
    assert.deepEqual(await req('../functions/notifications.js').backfillTasks(db), { appointments: 1, tasks: 2 })
    assert.deepEqual(await taskTypes(id), ['reminder24h', 'reminder2h'])
    const r24 = await task(id, 'reminder24h')
    assert.deepEqual([r24.status, r24.rev, r24.barberId, r24.shopId], ['pending', 1, 'b1', SHOP])
    assert.equal(r24.dueAt.toMillis(), start - 24 * HOUR)
    assert.equal(r24.nextAttemptAt.toMillis(), start - 24 * HOUR)
  })
  it('skips reminders that would already be past, and bookings that are not future CONFIRMED', async () => {
    const short = await legacy(5)
    const held = await hold(startIn(30)) // HELD
    const past = await legacy(30)
    await db.doc(`appointments/${past.id}`).update({ start: Timestamp.fromMillis(Date.now() - HOUR), end: Timestamp.fromMillis(Date.now() - 30 * MIN) })
    const cancelled = await legacy(30, { status: 'CANCELLED' })
    const { backfillTasks } = req('../functions/notifications.js')
    assert.deepEqual(await backfillTasks(db), { appointments: 1, tasks: 1 })
    assert.deepEqual(await taskTypes(short.id), ['reminder2h'])
    for (const id of [held, past.id, cancelled.id]) assert.deepEqual(await taskTypes(id), [])
  })
  it('is safe to rerun and never touches existing tasks', async () => {
    const { id } = await legacy(30)
    const { backfillTasks } = req('../functions/notifications.js')
    await backfillTasks(db)
    await db.doc(`notifications/${id}_reminder24h`).update({ status: 'sent', nextAttemptAt: null, attempts: [{ outcome: 'sent' }] })
    assert.deepEqual(await backfillTasks(db), { appointments: 1, tasks: 0 })
    const t = await task(id, 'reminder24h')
    assert.equal(t.status, 'sent')
    assert.equal(t.attempts.length, 1)
  })
  it('does not add tasks to a booking that already went through FR-09, and can be limited to one shop', async () => {
    const { id } = await confirmed(5) // no 24 h reminder, correctly
    const { backfillTasks } = req('../functions/notifications.js')
    assert.deepEqual(await backfillTasks(db, { shopId: SHOP }), { appointments: 1, tasks: 0 })
    assert.deepEqual(await taskTypes(id), ['confirmation', 'reminder2h'])
    assert.deepEqual(await backfillTasks(db, { shopId: 'other-shop' }), { appointments: 0, tasks: 0 })
  })
  it('the backfilled reminders are sent when due', async () => {
    const { id, start } = await legacy(30)
    await req('../functions/notifications.js').backfillTasks(db)
    const p = recordingProvider()
    await sweep.sendDueTasks(db, p, start - 24 * HOUR)
    assert.deepEqual(p.sent.map((m) => m.key), [`${id}_reminder24h:1:1`])
  })
})

describe('runAll', () => {
  it('sends due tasks and expires holds in one run', async () => {
    const { id } = await confirmed(30)
    const expired = await hold(startIn(31), { holdExpiresAt: Timestamp.fromMillis(Date.now() - MIN) })
    const p = recordingProvider()
    const result = await sweep.runAll(db, p, Date.now() + 1000)
    assert.equal(result.notifications.sent, 1)
    assert.equal(result.holds.expired, 1)
    assert.equal((await task(id, 'confirmation')).status, 'sent')
    assert.equal((await data(`appointments/${expired}`)).status, 'EXPIRED')
  })
})
