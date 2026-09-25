// FR-10 against the Firestore emulator (no Functions emulator needed): the real queue callables,
// startService/finishService, the recalculation, the sender and the sweep. A delay warning must be sent
// once, and must not be repeated by later recalculations or sweeps. Uses its own project id, so seeded
// data is untouched. Recalculation and the sweep take an explicit clock; the callables use the real
// clock, so times in those tests are relative to now.
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'

const PROJECT = 'fresher-queue-test'
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
const service = req('../functions/service.js')
const queue = req('../functions/queue.js')
const sweep = req('../functions/sweep.js')
const { mockProvider } = req('../functions/messaging.js')

const app = initializeApp({ projectId: PROJECT })
const db = getFirestore(app)
after(() => deleteApp(app))

const MIN = 60e3
const SHOP = 'shop1'
const OTHER_SHOP = 'shop2'
const PHONE = '+6591230010'
const ALL_DAY = { start: '00:00', end: '23:59' }
const week = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [ALL_DAY]]))
const clear = () => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })

const owner = { uid: 'owner1', token: { role: 'owner', shopId: SHOP } }
const barberB1 = { uid: 'barber1', token: { role: 'barber', shopId: SHOP, barberId: 'b1' } }
const barberB2 = { uid: 'barber2', token: { role: 'barber', shopId: SHOP, barberId: 'b2' } }
const otherOwner = { uid: 'owner2', token: { role: 'owner', shopId: OTHER_SHOP } }
const customerAuth = { uid: 'cust1', token: { phone_number: PHONE } }

const data = async (path) => (await db.doc(path).get()).data()
const ms = (t) => (t ? t.toMillis() : null)
const rid = () => randomUUID()
const delayTask = (bookingId) => data(`notifications/${bookingId}_delay`)
const delayTasks = async () => (await db.collection('notifications').where('type', '==', 'delay').get()).docs
const rejects = (promise, code, reason) => assert.rejects(promise, (e) => {
  assert.equal(e.code, code, `code: ${e.code} ${e.message}`)
  if (reason) assert.equal(e.details && e.details.reason, reason)
  return true
})

beforeEach(async () => {
  await clear()
  for (const shop of [SHOP, OTHER_SHOP]) {
    await db.doc(`shops/${shop}`).set({ name: shop, status: 'verified', openingHours: week, noticeMins: 120, latePolicy: 'block' })
    await db.doc(`shops/${shop}/services/cut`).set({ name: 'Cut', category: 'haircut', durationMin: 30, priceCents: 2500, active: true })
    await db.doc(`shops/${shop}/services/long`).set({ name: 'Colour', category: 'colour', durationMin: 60, priceCents: 9000, active: true })
    await db.doc(`shops/${shop}/services/off`).set({ name: 'Retired', category: 'other', durationMin: 30, priceCents: 1000, active: false })
    await db.doc(`shops/${shop}/barbers/b1`).set({ displayName: 'Ali', active: true, serviceIds: ['cut', 'long', 'off'], workingHours: week })
    await db.doc(`shops/${shop}/barbers/b2`).set({ displayName: 'Ben', active: true, serviceIds: ['cut'], workingHours: week })
    await db.doc(`shops/${shop}/barbers/b3`).set({ displayName: 'Cal', active: false, serviceIds: ['cut'], workingHours: week })
  }
  await db.doc('customers/cust1').set({ phoneE164: PHONE, displayName: 'Sam' })
})

let counter = 0
/** An appointment written directly, in any state. Times are epoch ms. */
async function apt(start, over = {}) {
  const { durationMin = 30, ...rest } = over
  const id = `bk-${String(++counter).padStart(4, '0')}-queue-test-${rid().slice(0, 8)}`
  const doc = {
    requestId: id, shopId: SHOP, barberId: 'b1', serviceId: 'cut', customerId: 'cust1', customerName: 'Sam', customerPhoneMasked: '+65 9••• ••10',
    status: 'CONFIRMED', start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + durationMin * MIN),
    holdExpiresAt: null, priceCents: 2500, durationMin, ...rest,
  }
  if (typeof doc.actualStart === 'number') doc.actualStart = Timestamp.fromMillis(doc.actualStart)
  await db.doc(`appointments/${id}`).set(doc)
  return id
}
/** A booking that is in service since `startedAgo` minutes, with the given duration. */
const inService = (now, startedAgoMin, durationMin, over = {}) =>
  apt(now - startedAgoMin * MIN - 5 * MIN, { status: 'IN_SERVICE', durationMin, actualStart: now - startedAgoMin * MIN, ...over })

const addWalkIn = (auth, over = {}) => queue.addWalkIn({ auth, data: { requestId: rid(), barberId: 'b1', walkInName: 'Walk-in Wei', serviceId: 'cut', ...over } })
const entry = (id) => data(`shops/${SHOP}/queue/${id}`)

function recordingProvider(inner = mockProvider(() => {})) {
  const sent = []
  return { sent, send: async (msg) => { sent.push(msg); return inner.send(msg) } }
}

describe('addWalkIn', () => {
  it('adds a waiting entry with the shop from the token, a duration snapshot and no phone number', async () => {
    const requestId = rid()
    const before = Date.now()
    const out = await addWalkIn(owner, { requestId, serviceId: 'long' })
    assert.equal(out.requestId, requestId)
    const e = await entry(requestId)
    assert.deepEqual(
      [e.shopId, e.barberId, e.walkInName, e.serviceId, e.durationMin, e.status, e.createdBy],
      [SHOP, 'b1', 'Walk-in Wei', 'long', 60, 'waiting', 'owner1'])
    assert.ok(ms(e.joinedAt) >= before - 1000)
    assert.equal(e.actualStart, undefined)
    assert.doesNotMatch(JSON.stringify(e), /\+65/)
  })
  it('lets a barber add to their own queue (barberId taken from the token)', async () => {
    const requestId = rid()
    await queue.addWalkIn({ auth: barberB1, data: { requestId, walkInName: 'Ravi', serviceId: 'cut' } })
    assert.equal((await entry(requestId)).barberId, 'b1')
  })
  it('a barber cannot add to another barber\'s queue', async () => {
    await rejects(addWalkIn(barberB2, { barberId: 'b1' }), 'permission-denied')
  })
  it('is idempotent on requestId: the same call returns the same entry, and nothing is duplicated', async () => {
    const requestId = rid()
    await addWalkIn(owner, { requestId })
    const first = await entry(requestId)
    await addWalkIn(owner, { requestId })
    assert.deepEqual(await entry(requestId), first)
    assert.equal((await db.collection(`shops/${SHOP}/queue`).get()).size, 1)
  })
  it('the same requestId with different parameters is invalid-argument', async () => {
    const requestId = rid()
    await addWalkIn(owner, { requestId })
    await rejects(addWalkIn(owner, { requestId, walkInName: 'Someone else' }), 'invalid-argument')
    await rejects(addWalkIn(owner, { requestId, serviceId: 'long' }), 'invalid-argument')
  })
  it('validates the name (1 to 60 characters after trimming) and the request ID', async () => {
    await rejects(addWalkIn(owner, { walkInName: '   ' }), 'invalid-argument')
    await rejects(addWalkIn(owner, { walkInName: 'x'.repeat(61) }), 'invalid-argument')
    await rejects(addWalkIn(owner, { walkInName: undefined }), 'invalid-argument')
    await rejects(addWalkIn(owner, { requestId: 'short' }), 'invalid-argument')
    const ok = rid()
    await addWalkIn(owner, { requestId: ok, walkInName: `  ${'x'.repeat(60)}  ` })
    assert.equal((await entry(ok)).walkInName, 'x'.repeat(60))
  })
  it('needs an active service that the barber offers, and an active barber in the shop', async () => {
    await rejects(addWalkIn(owner, { serviceId: 'off' }), 'failed-precondition', 'SERVICE_UNAVAILABLE')
    await rejects(addWalkIn(owner, { serviceId: 'nope' }), 'failed-precondition', 'SERVICE_UNAVAILABLE')
    await rejects(addWalkIn(owner, { barberId: 'b2', serviceId: 'long' }), 'failed-precondition', 'SERVICE_UNAVAILABLE')
    await rejects(addWalkIn(owner, { barberId: 'b3' }), 'failed-precondition', 'BARBER_UNAVAILABLE')
    await rejects(addWalkIn(owner, { barberId: 'ghost' }), 'not-found', 'BARBER_NOT_FOUND')
  })
  it('an owner cannot reach another shop\'s barber, and customers and anonymous callers are refused', async () => {
    await addWalkIn(otherOwner) // its own shop2/b1 exists
    assert.equal((await db.collection(`shops/${SHOP}/queue`).get()).size, 0)
    await rejects(addWalkIn(customerAuth), 'permission-denied')
    await rejects(addWalkIn(null), 'unauthenticated')
  })
})

describe('startWalkIn and finishWalkIn', () => {
  it('start: waiting to in_service with actualStart from the server clock', async () => {
    const { requestId } = await addWalkIn(owner)
    const before = Date.now()
    await queue.startWalkIn({ auth: owner, data: { requestId } })
    const e = await entry(requestId)
    assert.equal(e.status, 'in_service')
    assert.ok(ms(e.actualStart) >= before && ms(e.actualStart) <= Date.now())
  })
  it('start has no time guard: a walk-in can start at once', async () => {
    const { requestId } = await addWalkIn(barberB1)
    await queue.startWalkIn({ auth: barberB1, data: { requestId } })
    assert.equal((await entry(requestId)).status, 'in_service')
  })
  it('start is idempotent: a replay changes nothing', async () => {
    const { requestId } = await addWalkIn(owner)
    await queue.startWalkIn({ auth: owner, data: { requestId } })
    const first = await entry(requestId)
    await queue.startWalkIn({ auth: owner, data: { requestId } })
    assert.deepEqual(await entry(requestId), first)
  })
  it('start is refused with BARBER_BUSY while the barber has a walk-in in service, or a booking in service', async () => {
    const a = (await addWalkIn(owner)).requestId
    const b = (await addWalkIn(owner)).requestId
    await queue.startWalkIn({ auth: owner, data: { requestId: a } })
    await rejects(queue.startWalkIn({ auth: owner, data: { requestId: b } }), 'failed-precondition', 'BARBER_BUSY')
    assert.equal((await entry(b)).status, 'waiting')
    await queue.finishWalkIn({ auth: owner, data: { requestId: a } })
    await inService(Date.now(), 5, 30)
    await rejects(queue.startWalkIn({ auth: owner, data: { requestId: b } }), 'failed-precondition', 'BARBER_BUSY')
  })
  it('another barber being busy does not matter', async () => {
    await inService(Date.now(), 5, 30, { barberId: 'b2' })
    const { requestId } = await addWalkIn(owner)
    await queue.startWalkIn({ auth: owner, data: { requestId } })
    assert.equal((await entry(requestId)).status, 'in_service')
  })
  it('finish: in_service to done with actualEnd; a replay changes nothing', async () => {
    const { requestId } = await addWalkIn(owner)
    await queue.startWalkIn({ auth: owner, data: { requestId } })
    await queue.finishWalkIn({ auth: owner, data: { requestId } })
    const e = await entry(requestId)
    assert.equal(e.status, 'done')
    assert.ok(ms(e.actualEnd) >= ms(e.actualStart))
    await queue.finishWalkIn({ auth: owner, data: { requestId } })
    assert.deepEqual(await entry(requestId), e)
  })
  it('wrong states give INVALID_STATE: finish a waiting walk-in, start a finished one', async () => {
    const { requestId } = await addWalkIn(owner)
    await rejects(queue.finishWalkIn({ auth: owner, data: { requestId } }), 'failed-precondition', 'INVALID_STATE')
    await queue.startWalkIn({ auth: owner, data: { requestId } })
    await queue.finishWalkIn({ auth: owner, data: { requestId } })
    await rejects(queue.startWalkIn({ auth: owner, data: { requestId } }), 'failed-precondition', 'INVALID_STATE')
  })
  it('only the owner or the queue\'s own barber can act; anyone else sees WALKIN_NOT_FOUND', async () => {
    const { requestId } = await addWalkIn(owner)
    for (const auth of [barberB2, otherOwner]) {
      for (const fn of ['startWalkIn', 'finishWalkIn', 'removeWalkIn']) {
        await rejects(queue[fn]({ auth, data: { requestId } }), 'not-found', 'WALKIN_NOT_FOUND')
      }
    }
    await rejects(queue.startWalkIn({ auth: customerAuth, data: { requestId } }), 'permission-denied')
    await rejects(queue.startWalkIn({ auth: null, data: { requestId } }), 'unauthenticated')
    await rejects(queue.startWalkIn({ auth: owner, data: { requestId: rid() } }), 'not-found', 'WALKIN_NOT_FOUND')
    assert.equal((await entry(requestId)).status, 'waiting')
    await queue.startWalkIn({ auth: barberB1, data: { requestId } })
  })
})

describe('removeWalkIn', () => {
  it('waiting to removed; a replay is fine; a started walk-in cannot be removed', async () => {
    const a = (await addWalkIn(owner)).requestId
    await queue.removeWalkIn({ auth: owner, data: { requestId: a } })
    assert.equal((await entry(a)).status, 'removed')
    await queue.removeWalkIn({ auth: owner, data: { requestId: a } })
    const b = (await addWalkIn(owner)).requestId
    await queue.startWalkIn({ auth: owner, data: { requestId: b } })
    await rejects(queue.removeWalkIn({ auth: owner, data: { requestId: b } }), 'failed-precondition', 'INVALID_STATE')
  })
})

describe('recalculation and the delay warning', () => {
  const NOW = () => Math.floor(Date.now() / MIN) * MIN
  /** Barber b1 has been serving for `startedAgo` min a job of `durationMin`; a booking is at `startIn` min. */
  async function late(now, { startedAgo = 20, durationMin = 75, startIn = 30 } = {}) {
    await inService(now, startedAgo, durationMin)
    return apt(now + startIn * MIN)
  }

  it('writes one delay task when the delay is over 10 minutes, with the booking fields and no phone number', async () => {
    const now = NOW()
    const id = await late(now) // service ends at +55, booking at +30: 25 minutes late
    const r = await queue.recalcBarber(db, SHOP, 'b1', now)
    assert.deepEqual(r.warned, [id])
    const t = await delayTask(id)
    assert.deepEqual(
      [t.type, t.status, t.bookingId, t.shopId, t.barberId, t.delayMin, t.channel, t.rev, t.attempts.length],
      ['delay', 'pending', id, SHOP, 'b1', 25, 'sms', 1, 0])
    assert.equal(ms(t.apptStart), now + 30 * MIN)
    assert.equal(ms(t.dueAt), now)
    assert.equal(ms(t.nextAttemptAt), now)
    assert.doesNotMatch(JSON.stringify(t), /\+65/)
  })
  it('returns the projection: booking delay and the walk-ins\' estimated waits', async () => {
    const now = NOW()
    const id = await late(now)
    const w = (await addWalkIn(owner, { serviceId: 'cut' })).requestId
    const r = await queue.recalcBarber(db, SHOP, 'b1', now)
    assert.equal(r.bookings.find((b) => b.id === id).delayMin, 25)
    const wait = r.walkIns.find((x) => x.id === w)
    assert.equal(wait.estimatedStart, now + 85 * MIN, 'after the delayed booking [55, 85) since it does not fit before it')
  })

  it('exactly 10 minutes late sends nothing; one millisecond more does', async () => {
    const now = NOW()
    // The service in progress ends at now + 40 min; the booking starts at now + 30 min: exactly 10 minutes late.
    const running = await apt(now - 25 * MIN, { status: 'IN_SERVICE', durationMin: 60, actualStart: now - 20 * MIN })
    const b = await apt(now + 30 * MIN)
    assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now)).warned, [])
    assert.equal(await delayTask(b), undefined)
    await db.doc(`appointments/${running}`).update({ actualStart: Timestamp.fromMillis(now - 20 * MIN + 1) })
    assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now)).warned, [b])
    assert.equal((await delayTask(b)).delayMin, 11)
  })
  it('a warning is written exactly 15 minutes before the start, not one millisecond later', async () => {
    const now = NOW()
    await inService(now, 10, 120)
    const ok = await apt(now + 15 * MIN)
    const tooLate = await apt(now + 15 * MIN - 1, { barberId: 'b1', durationMin: 5 })
    const r = await queue.recalcBarber(db, SHOP, 'b1', now)
    assert.deepEqual(r.warned, [ok])
    assert.equal(await delayTask(tooLate), undefined)
  })
  it('a booking too close to its start is never warned later either', async () => {
    const now = NOW()
    await inService(now, 10, 120)
    const id = await apt(now + 14 * MIN)
    assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now)).warned, [])
    assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now + MIN)).warned, [])
    assert.equal(await delayTask(id), undefined)
  })
  it('waiting walk-ins never cause a warning (bookings first)', async () => {
    const now = NOW()
    const id = await apt(now + 20 * MIN)
    for (let i = 0; i < 4; i++) await addWalkIn(owner, { serviceId: 'long' })
    const r = await queue.recalcBarber(db, SHOP, 'b1', now)
    assert.deepEqual(r.warned, [])
    assert.equal(r.bookings.find((b) => b.id === id).delayMin, 0)
    assert.equal(await delayTask(id), undefined)
  })
  it('one barber\'s delay never affects another barber\'s bookings', async () => {
    const now = NOW()
    await late(now)
    const other = await apt(now + 30 * MIN, { barberId: 'b2' })
    const r = await queue.recalcBarber(db, SHOP, 'b2', now)
    assert.deepEqual(r.warned, [])
    assert.equal(await delayTask(other), undefined)
  })
  it('appointments of another shop with the same barber ID are not considered', async () => {
    const now = NOW()
    await inService(now, 20, 75, { shopId: OTHER_SHOP })
    const id = await apt(now + 30 * MIN)
    assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now)).warned, [])
    assert.equal(await delayTask(id), undefined)
  })
  it('a missed booking (its slot is over, never started) is ignored', async () => {
    const now = NOW()
    await inService(now, 5, 60)
    const missed = await apt(now - 40 * MIN)
    const next = await apt(now + 20 * MIN)
    const r = await queue.recalcBarber(db, SHOP, 'b1', now)
    assert.equal(r.bookings.find((b) => b.id === missed), undefined)
    assert.deepEqual(r.warned, [next])
  })
  it('only unstarted CONFIRMED bookings are projected: cancelled, completed and no-show ones are not', async () => {
    const now = NOW()
    await inService(now, 20, 75)
    for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED', 'HELD']) await apt(now + 30 * MIN, { status })
    const r = await queue.recalcBarber(db, SHOP, 'b1', now)
    assert.deepEqual(r.bookings, [])
    assert.equal((await delayTasks()).length, 0)
  })

  describe('sent once, and not repeated', () => {
    it('repeated recalculations write no second task and change nothing', async () => {
      const now = NOW()
      const id = await late(now)
      await queue.recalcBarber(db, SHOP, 'b1', now)
      const first = await delayTask(id)
      for (let i = 1; i <= 3; i++) assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now + i * MIN)).warned, [])
      assert.deepEqual(await delayTask(id), first)
      assert.equal((await delayTasks()).length, 1)
    })
    it('the sender sends it once; more sweeps and recalculations send nothing more', async () => {
      const now = NOW()
      const id = await late(now)
      const provider = recordingProvider()
      const first = await sweep.runAll(db, provider, now)
      assert.equal(first.queue.warned, 1)
      const delays = provider.sent.filter((m) => /behind|late/i.test(m.body))
      assert.equal(delays.length, 1)
      assert.equal(delays[0].to, PHONE)
      assert.match(delays[0].body, /25 minutes/)
      assert.match(delays[0].key, new RegExp(`^${id}_delay:1:1$`))
      for (let i = 1; i <= 3; i++) {
        const again = await sweep.runAll(db, provider, now + i * MIN)
        assert.equal(again.queue.warned, 0)
        await queue.recalcBarber(db, SHOP, 'b1', now + i * MIN)
      }
      assert.equal(provider.sent.filter((m) => /behind|late/i.test(m.body)).length, 1)
      const t = await delayTask(id)
      assert.deepEqual([t.status, t.attempts.length], ['sent', 1])
    })
    it('a larger or smaller delay later does not send a second warning', async () => {
      const now = NOW()
      const id = await late(now)
      const provider = recordingProvider()
      await sweep.runAll(db, provider, now)
      const inSvc = (await db.collection('appointments').where('status', '==', 'IN_SERVICE').get()).docs[0]
      await inSvc.ref.update({ actualStart: Timestamp.fromMillis(now) }) // worse: ends later
      await queue.recalcBarber(db, SHOP, 'b1', now)
      await sweep.runAll(db, provider, now + MIN)
      await inSvc.ref.update({ status: 'COMPLETED', actualEnd: Timestamp.fromMillis(now + 2 * MIN) }) // finished
      await queue.recalcBarber(db, SHOP, 'b1', now + 2 * MIN)
      await sweep.runAll(db, provider, now + 3 * MIN)
      assert.equal((await delayTasks()).length, 1)
      assert.equal(provider.sent.length, 1)
      assert.equal((await delayTask(id)).status, 'sent')
    })
    it('a delay that clears and comes back, or a failed send, is not warned again', async () => {
      const now = NOW()
      const id = await late(now)
      await db.doc(`notifications/${id}_delay`).set({
        bookingId: id, shopId: SHOP, barberId: 'b1', type: 'delay', status: 'failed', attempts: [{}, {}, {}], rev: 1,
      })
      assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now)).warned, [])
      assert.equal((await delayTask(id)).status, 'failed')
      assert.equal((await delayTasks()).length, 1)
    })
    it('cancelled tasks are not recreated either', async () => {
      const now = NOW()
      const id = await late(now)
      await queue.recalcBarber(db, SHOP, 'b1', now)
      await db.doc(`notifications/${id}_delay`).update({ status: 'cancelled' })
      assert.deepEqual((await queue.recalcBarber(db, SHOP, 'b1', now + MIN)).warned, [])
      assert.equal((await delayTask(id)).status, 'cancelled')
    })
    it('a warning that fails is retried by the sender like any task, still counted once', async () => {
      const now = NOW()
      const id = await late(now)
      await db.doc('customers/cust1').update({ phoneE164: '+6591230000' }) // the mock provider always fails this one
      const provider = recordingProvider()
      await sweep.runAll(db, provider, now)
      await sweep.runAll(db, provider, now + MIN)
      await sweep.runAll(db, provider, now + 2 * MIN)
      const t = await delayTask(id)
      assert.deepEqual([t.status, t.attempts.length], ['failed', 3])
      assert.equal((await delayTasks()).length, 1)
    })
  })

  describe('the booking is left alone', () => {
    it('a warning never changes the booking\'s time, status or schedule', async () => {
      const now = NOW()
      const id = await late(now)
      const before = await data(`appointments/${id}`)
      await sweep.runAll(db, recordingProvider(), now)
      assert.deepEqual(await data(`appointments/${id}`), before)
    })
    it('cancelBooking cancels a pending delay task', async () => {
      const now = NOW()
      const id = await late(now, { startIn: 300 })
      await queue.recalcBarber(db, SHOP, 'b1', now)
      // start is 300 min ahead, so the delay is 0: force a task as an earlier recalculation would have.
      await db.doc(`notifications/${id}_delay`).set({
        bookingId: id, shopId: SHOP, barberId: 'b1', apptStart: (await data(`appointments/${id}`)).start, type: 'delay',
        channel: 'sms', dueAt: Timestamp.fromMillis(now), status: 'pending', nextAttemptAt: Timestamp.fromMillis(now), rev: 1, attempts: [],
      })
      await booking.cancelBooking({ auth: owner, data: { requestId: id } })
      const t = await delayTask(id)
      assert.equal(t.status, 'cancelled')
      assert.equal(t.nextAttemptAt, undefined)
    })
    it('the sender drops a delay task whose booking has moved, started or gone', async () => {
      const now = NOW()
      const moved = await late(now)
      await queue.recalcBarber(db, SHOP, 'b1', now)
      await db.doc(`appointments/${moved}`).update({ start: Timestamp.fromMillis(now + 90 * MIN) }) // rescheduled
      const provider = recordingProvider()
      await sweep.runAll(db, provider, now)
      assert.equal((await delayTask(moved)).status, 'cancelled')
      assert.equal(provider.sent.length, 0)
    })
  })

  describe('recalculated by the real callables, in the same transaction as the change', () => {
    it('startService on an overrunning booking warns the next booking in the same call', async () => {
      const now = Date.now()
      const first = await apt(now - 40 * MIN, { durationMin: 60 }) // slot [-40, +20): still counts
      const next = await apt(now + 30 * MIN)
      assert.equal(await delayTask(next), undefined)
      await service.startService({ auth: owner, data: { requestId: first } }) // actual start now, ends at +60
      const t = await delayTask(next)
      assert.equal(t.type, 'delay')
      assert.ok(t.delayMin >= 30 && t.delayMin <= 31, `delayMin ${t.delayMin}`)
      assert.equal((await data(`appointments/${first}`)).status, 'IN_SERVICE')
    })
    it('finishService recalculates from the actual end and writes no warning when nobody is late', async () => {
      const now = Date.now()
      const first = await apt(now - 5 * MIN, { status: 'IN_SERVICE', actualStart: now - 5 * MIN })
      const next = await apt(now + 40 * MIN)
      await service.finishService({ auth: owner, data: { requestId: first } })
      assert.equal(await delayTask(next), undefined)
      assert.ok((await data(`appointments/${first}`)).actualEnd)
    })
    it('startWalkIn on a long walk-in warns a booking it will run into, and addWalkIn alone does not', async () => {
      const now = Date.now()
      const b = await apt(now + 30 * MIN)
      const { requestId } = await addWalkIn(owner, { serviceId: 'long' })
      assert.equal(await delayTask(b), undefined, 'a waiting walk-in never delays a booking')
      await queue.startWalkIn({ auth: owner, data: { requestId } }) // 60 minutes from now
      const t = await delayTask(b)
      assert.ok(t.delayMin >= 30 && t.delayMin <= 31, `delayMin ${t.delayMin}`)
    })
    it('finishWalkIn and removeWalkIn recalculate too, without repeating the warning', async () => {
      const now = Date.now()
      const b = await apt(now + 30 * MIN)
      const { requestId } = await addWalkIn(owner, { serviceId: 'long' })
      await queue.startWalkIn({ auth: owner, data: { requestId } })
      const first = await delayTask(b)
      await queue.finishWalkIn({ auth: owner, data: { requestId } })
      const w2 = (await addWalkIn(owner)).requestId
      await queue.removeWalkIn({ auth: owner, data: { requestId: w2 } })
      assert.deepEqual(await delayTask(b), first)
      assert.equal((await delayTasks()).length, 1)
    })
    it('a failed call writes no warning (start refused as BARBER_BUSY leaves no task)', async () => {
      const now = Date.now()
      const { requestId } = await addWalkIn(owner, { serviceId: 'long' }) // queued before anything is late
      await inService(now, 5, 120)
      const b = await apt(now + 30 * MIN)
      await rejects(queue.startWalkIn({ auth: owner, data: { requestId } }), 'failed-precondition', 'BARBER_BUSY')
      assert.equal(await delayTask(b), undefined)
    })
  })
})

describe('the sweep', () => {
  const NOW = () => Math.floor(Date.now() / MIN) * MIN

  it('recalculates every barber that has bookings today, across shops, and reports what it did', async () => {
    const now = NOW()
    await inService(now, 20, 75)
    const a = await apt(now + 30 * MIN)
    await inService(now, 20, 75, { shopId: OTHER_SHOP })
    const b = await apt(now + 30 * MIN, { shopId: OTHER_SHOP })
    await inService(now, 20, 75, { barberId: 'b2' })
    const c = await apt(now + 30 * MIN, { barberId: 'b2' })
    const idle = await apt(now + 30 * MIN, { barberId: 'b3' })
    const res = await sweep.runAll(db, recordingProvider(), now)
    assert.deepEqual(res.queue, { barbers: 4, warned: 3 })
    for (const id of [a, b, c]) assert.equal((await delayTask(id)).status, 'sent')
    assert.equal(await delayTask(idle), undefined)
  })
  it('catches a booking made after the last queue change, which fired no event', async () => {
    const now = NOW()
    await inService(now, 20, 75) // busy until now + 55
    const provider = recordingProvider()
    assert.equal((await sweep.runAll(db, provider, now)).queue.warned, 0, 'nothing to warn yet')
    const late = await apt(now + 30 * MIN) // booked online afterwards
    const res = await sweep.runAll(db, provider, now + MIN)
    assert.equal(res.queue.warned, 1)
    assert.equal((await delayTask(late)).status, 'sent')
    assert.equal((await sweep.runAll(db, provider, now + 2 * MIN)).queue.warned, 0)
    assert.equal(provider.sent.length, 1)
  })
  it('an overrun raises the delay only for bookings whose slot has begun, which are too late to warn', async () => {
    const now = NOW()
    await inService(now, 40, 30) // should have ended 10 minutes ago
    const begun = await apt(now - 5 * MIN, { durationMin: 30 })
    const provider = recordingProvider()
    const res = await sweep.runAll(db, provider, now)
    assert.equal(res.queue.warned, 0)
    assert.equal(await delayTask(begun), undefined)
    assert.equal(provider.sent.length, 0)
  })
  it('running the sweep twice at the same time-of-day sends one message', async () => {
    const now = NOW()
    await inService(now, 20, 75)
    await apt(now + 30 * MIN)
    const provider = recordingProvider()
    await Promise.all([sweep.runAll(db, provider, now), sweep.runAll(db, provider, now)])
    assert.equal((await delayTasks()).length, 1)
    assert.equal(provider.sent.length, 1)
  })
  it('does nothing for shops with no bookings today', async () => {
    const res = await sweep.runAll(db, recordingProvider(), NOW())
    assert.deepEqual(res.queue, { barbers: 0, warned: 0 })
  })
})
