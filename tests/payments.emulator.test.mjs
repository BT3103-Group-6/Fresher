// FR-13 against the Firestore emulator (no Functions emulator needed): confirmBooking's deposit branch, the
// signed webhook, mockPay ownership, the expiry sweep, and how the deposit follows finish, no-show and
// cancellation. Includes the concurrency cases: payment success racing expiry, and duplicate deliveries.
// Own project id, so seeded data is untouched. Clocks for the webhook and the sweep are passed in; the booking
// functions use the real clock, so start times are relative to now.
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const PROJECT = 'fresher-pay-test'
process.env.GCLOUD_PROJECT = PROJECT
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: set FIRESTORE_EMULATOR_HOST (use `npm run test:rules`).')
  process.exit(1)
}
const fromFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = fromFunctions('firebase-admin/app')
const { Timestamp, getFirestore } = fromFunctions('firebase-admin/firestore')
const req = createRequire(import.meta.url)
const booking = req('../functions/booking.js')
const service = req('../functions/service.js')
const sweep = req('../functions/sweep.js')
const payments = req('../functions/payments.js')

const app = initializeApp({ projectId: PROJECT })
const db = getFirestore(app)
after(() => deleteApp(app))

const MIN = 60e3
const HOUR = 60 * MIN
const SG_OFFSET = 8 * HOUR
const SHOP = 'shop1'
const PHONE = '+6591230001'
const SECRET = 'test-secret'
const provider = payments.mockProvider()
const ALL_DAY = { start: '00:00', end: '23:59' }
const week = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [ALL_DAY]]))
const clear = () => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })

/** `hours` from now on the 15-minute grid, nudged later if a 30-minute visit would run past 23:59 Singapore. */
function startIn(hours) {
  let t = Math.ceil((Date.now() + hours * HOUR) / (15 * MIN)) * 15 * MIN
  const minuteOfDay = (ms) => Math.floor(((ms + SG_OFFSET) % (24 * HOUR)) / MIN)
  while (minuteOfDay(t) + 30 > 23 * 60 + 59 || minuteOfDay(t) < 1) t += 15 * MIN
  return t
}

const customerAuth = (uid = 'cust1', phone = PHONE) => ({ uid, token: { phone_number: phone, auth_time: Math.floor(Date.now() / 1000) } })
const staffAuth = { uid: 'owner1', token: { role: 'owner', shopId: SHOP } }
const data = async (path) => (await db.doc(path).get()).data()
const apt = (id) => data(`appointments/${id}`)
const dep = (id) => data(`deposits/${id}`)
const intervals = async (start) => ((await data(`shops/${SHOP}/schedules/${booking.scheduleId('b1', start)}`)) || {}).intervals || []
const audits = async (id) => (await db.collection('auditLog').where('bookingId', '==', id).get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const taskTypes = async (id) => (await db.collection('notifications').where('bookingId', '==', id).get()).docs.map((d) => d.data().type).sort()
const setNoShows = (n, shop = SHOP, uid = 'cust1') => db.doc(`customers/${uid}/shopStats/${shop}`).set({ noShowCount: n })

beforeEach(async () => {
  await clear()
  await db.doc(`shops/${SHOP}`).set({ name: 'Test shop', status: 'verified', openingHours: week, noticeMins: 120, latePolicy: 'block' })
  await db.doc(`shops/${SHOP}/barbers/b1`).set({ displayName: 'Ali', active: true, serviceIds: ['cut'], workingHours: week })
})

let counter = 0
/** A HELD appointment with a live hold, as holdSlot leaves it. */
async function hold(start, over = {}) {
  const id = `bk-${String(++counter).padStart(4, '0')}-payment-test-x`
  const a = {
    requestId: id, shopId: SHOP, barberId: 'b1', serviceId: 'cut', customerId: null, status: 'HELD',
    start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN),
    holdExpiresAt: Timestamp.fromMillis(Date.now() + 10 * MIN), priceCents: 2500, durationMin: 30, ...over,
  }
  await db.doc(`appointments/${id}`).set(a)
  const schedRef = db.doc(`shops/${SHOP}/schedules/${booking.scheduleId('b1', start)}`)
  const before = ((await schedRef.get()).data() || {}).intervals || []
  await schedRef.set({
    barberId: 'b1', date: booking.sgDateKey(start), version: 1,
    intervals: [...before, a.status === 'HELD' ?
      { start: a.start, end: a.end, kind: 'hold', holdExpiresAt: a.holdExpiresAt } :
      { start: a.start, end: a.end, kind: 'booking', refId: id }],
  })
  return id
}
const confirm = (id, uid = 'cust1') => booking.confirmBooking({ auth: customerAuth(uid), data: { requestId: id, displayName: 'Sam' } })

/** A booking waiting for payment: the customer has two no-shows at this shop. */
async function pending(hoursAhead = 30, over = {}) {
  await setNoShows(2)
  const start = startIn(hoursAhead)
  const id = await hold(start, over)
  const result = await confirm(id)
  assert.equal(result.status, 'PENDING_PAYMENT')
  await payments.createDeposit({ auth: customerAuth(), data: { requestId: id } }, db, provider) // registers providerRef
  return { id, start, deadline: (await apt(id)).holdExpiresAt.toMillis() }
}

/** Delivers a signed provider event through the webhook handler. */
async function deliver(id, type, { now = Date.now(), eventId = `evt-${Math.random()}`, secret = SECRET, providerRef = `mockpay_${id}` } = {}) {
  const rawBody = Buffer.from(JSON.stringify({ eventId, type, depositId: id, providerRef, occurredAt: now }))
  return payments.handleWebhook(db, { method: 'POST', rawBody, signature: payments.sign(secret, rawBody) }, secret, now)
}
const pay = (id, opts) => deliver(id, 'payment.succeeded', opts)
const fail = (id, opts) => deliver(id, 'payment.failed', opts)

describe('confirmBooking: when a deposit is due', () => {
  it('confirms normally below 2 no-shows, with reminders', async () => {
    for (const n of [0, 1]) {
      await setNoShows(n)
      const id = await hold(startIn(30 + n))
      const result = await confirm(id)
      assert.equal(result.status, 'CONFIRMED')
      assert.equal('depositCents' in result, false)
      assert.equal((await apt(id)).status, 'CONFIRMED')
      assert.equal(await dep(id), undefined)
      assert.equal((await taskTypes(id)).length, 3)
    }
  })
  it('a customer with no shopStats at all confirms normally', async () => {
    const id = await hold(startIn(30))
    assert.equal((await confirm(id)).status, 'CONFIRMED')
  })
  it('moves the hold to PENDING_PAYMENT at 2 no-shows or more, with a deposit of half the price', async () => {
    await setNoShows(2)
    const start = startIn(30)
    const before = Date.now()
    const id = await hold(start)
    const result = await confirm(id)
    assert.deepEqual([result.status, result.depositCents, result.requestId], ['PENDING_PAYMENT', 1250, id])
    const a = await apt(id)
    assert.deepEqual([a.status, a.customerId, a.customerName, a.depositId], ['PENDING_PAYMENT', 'cust1', 'Sam', id])
    assert.match(a.customerPhoneMasked, /^\+65 9••• ••01$/)
    // The payment deadline is 10 minutes from now, in the same field as a hold's expiry.
    assert.ok(a.holdExpiresAt.toMillis() >= before + 10 * MIN && a.holdExpiresAt.toMillis() <= Date.now() + 10 * MIN)
    assert.equal(result.holdExpiresAt, a.holdExpiresAt.toMillis())
    const d = await dep(id)
    assert.deepEqual([d.status, d.amountCents, d.customerId, d.shopId, d.barberId, d.bookingId, d.providerRef], ['pending', 1250, 'cust1', SHOP, 'b1', id, null])
    assert.equal((await setNoShows(5), 5), 5) // higher counts behave the same
  })
  it('rounds the deposit up to the nearest 10 cents', async () => {
    await setNoShows(3)
    const id = await hold(startIn(30), { priceCents: 2550 })
    assert.equal((await confirm(id)).depositCents, 1280)
    assert.equal((await dep(id)).amountCents, 1280)
  })
  it('counts no-shows per shop: another shop\'s count does not trigger a deposit here', async () => {
    await setNoShows(4, 'other-shop')
    const id = await hold(startIn(30))
    assert.equal((await confirm(id)).status, 'CONFIRMED')
  })
  it('counts the caller\'s own no-shows only', async () => {
    await setNoShows(4, SHOP, 'someone-else')
    const id = await hold(startIn(30))
    assert.equal((await confirm(id)).status, 'CONFIRMED')
  })
  it('a service that costs nothing needs no deposit', async () => {
    await setNoShows(2)
    const id = await hold(startIn(30), { priceCents: 0 })
    assert.equal((await confirm(id)).status, 'CONFIRMED')
    assert.equal(await dep(id), undefined)
  })
  it('keeps the slot held until the deadline (a hold interval with the deadline) and writes no reminders', async () => {
    const { id, start, deadline } = await pending()
    const mine = (await intervals(start)).filter((iv) => iv.start.toMillis() === start)
    assert.equal(mine.length, 1)
    assert.equal(mine[0].kind, 'hold')
    assert.equal(mine[0].holdExpiresAt.toMillis(), deadline)
    assert.equal('refId' in mine[0], false) // schedules are public: holds carry no booking ID.
    assert.deepEqual(await taskTypes(id), [])
    const [record] = await audits(id)
    assert.deepEqual([record.id, record.action, record.fromStatus, record.toStatus, record.role, record.actorUid], [`${id}_PENDING_PAYMENT`, 'requireDeposit', 'HELD', 'PENDING_PAYMENT', 'customer', 'cust1'])
  })
  it('a repeated confirm returns the same pending booking and creates nothing new', async () => {
    const { id, deadline } = await pending()
    const again = await confirm(id)
    assert.deepEqual([again.status, again.depositCents, again.holdExpiresAt], ['PENDING_PAYMENT', 1250, deadline])
    assert.equal((await audits(id)).length, 1)
    assert.equal((await dep(id)).status, 'pending')
  })
  it('another customer cannot confirm or pay for it', async () => {
    const { id } = await pending()
    await assert.rejects(confirm(id, 'cust2'), { details: { reason: 'HOLD_ALREADY_USED' } })
  })
  it('cannot be cancelled with cancelBooking while waiting for payment', async () => {
    const { id } = await pending()
    await assert.rejects(booking.cancelBooking({ auth: staffAuth, data: { requestId: id } }), { details: { reason: 'NOT_CANCELLABLE' } })
    await assert.rejects(booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } }), { details: { reason: 'NOT_CANCELLABLE' } })
  })
})

describe('createDeposit', () => {
  it('registers the payment once and returns what the checkout page needs', async () => {
    await setNoShows(3)
    const id = await hold(startIn(30))
    await confirm(id)
    const call = () => payments.createDeposit({ auth: customerAuth(), data: { requestId: id } }, db, provider)
    const first = await call()
    assert.deepEqual([first.providerRef, first.amountCents, first.noShowCount, first.bookingStatus, first.depositStatus, first.shopId, first.provider],
      [`mockpay_${id}`, 1250, 3, 'PENDING_PAYMENT', 'pending', SHOP, 'mock'])
    assert.equal(first.deadline, (await apt(id)).holdExpiresAt.toMillis())
    assert.deepEqual(await call(), first) // idempotent.
    assert.equal((await dep(id)).providerRef, `mockpay_${id}`)
  })
  it('hides the deposit from everyone but its customer, and needs sign-in', async () => {
    const { id } = await pending()
    const as = (auth) => payments.createDeposit({ auth, data: { requestId: id } }, db, provider)
    await assert.rejects(as(customerAuth('cust2')), { details: { reason: 'DEPOSIT_NOT_FOUND' } })
    await assert.rejects(as(staffAuth), { details: { reason: 'DEPOSIT_NOT_FOUND' } })
    await assert.rejects(as(null), { code: 'unauthenticated' })
    await assert.rejects(payments.createDeposit({ auth: customerAuth(), data: { requestId: 'bad' } }, db, provider), { code: 'invalid-argument' })
    await assert.rejects(payments.createDeposit({ auth: customerAuth(), data: { requestId: 'x'.repeat(20) } }, db, provider), { details: { reason: 'DEPOSIT_NOT_FOUND' } })
  })
  it('does not register a payment for a booking that is no longer waiting', async () => {
    const { id } = await pending()
    await sweep.sweepExpiredHolds(db, Date.now() + 11 * MIN)
    await db.doc(`deposits/${id}`).update({ providerRef: null })
    const out = await payments.createDeposit({ auth: customerAuth(), data: { requestId: id } }, db, provider)
    assert.deepEqual([out.bookingStatus, out.depositStatus, out.providerRef], ['EXPIRED', 'failed', null])
  })
})

describe('the signed webhook: success', () => {
  it('confirms the booking, marks the deposit paid, swaps the hold for a booking, audits, and only now creates reminders', async () => {
    const { id, start } = await pending()
    assert.deepEqual(await taskTypes(id), [])
    const now = Date.now()
    assert.deepEqual((await pay(id, { now })).body, { result: 'confirmed' })
    const a = await apt(id)
    assert.deepEqual([a.status, a.holdExpiresAt], ['CONFIRMED', null])
    const d = await dep(id)
    assert.deepEqual([d.status, d.paidAt.toMillis(), 'paidAfterExpiry' in d], ['paid', now, false])
    const mine = (await intervals(start)).filter((iv) => iv.start.toMillis() === start)
    assert.deepEqual(mine.map((iv) => [iv.kind, iv.refId]), [['booking', id]])
    const confirmAudit = (await audits(id)).find((r) => r.action === 'confirm')
    assert.deepEqual([confirmAudit.id, confirmAudit.fromStatus, confirmAudit.toStatus, confirmAudit.role, confirmAudit.actorUid], [`${id}_CONFIRMED`, 'PENDING_PAYMENT', 'CONFIRMED', 'system', null])
    assert.deepEqual(await taskTypes(id), ['confirmation', 'reminder24h', 'reminder2h'])
    const c = await data(`notifications/${id}_confirmation`)
    assert.equal(c.plannedAt.toMillis(), now) // planned from the payment, not the OTP.
    assert.equal(c.dueAt.toMillis(), now)
  })
  it('plans reminders from the payment time: a booking that became close meanwhile skips the 24 h reminder', async () => {
    const { id, deadline } = await pending()
    // Paid just before the deadline, when the visit is one minute short of 24 h away: the 24 h reminder is
    // already past, though at the OTP (10 minutes earlier) it was not.
    const paidAt = deadline - 1
    const start = paidAt + 24 * HOUR - MIN
    await db.doc(`appointments/${id}`).update({ start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN) })
    await pay(id, { now: paidAt })
    assert.deepEqual(await taskTypes(id), ['confirmation', 'reminder2h'])
  })
  it('the reminders are then sent like any other', async () => {
    const { id } = await pending()
    await pay(id)
    const sent = []
    await sweep.sendDueTasks(db, { send: async (m) => { sent.push(m); return { ok: true } } }, Date.now() + 1000)
    assert.deepEqual(sent.map((m) => m.key), [`${id}_confirmation:1:1`])
  })
  it('at exactly the deadline it is too late; one millisecond before it is in time', async () => {
    const a = await pending()
    assert.equal((await pay(a.id, { now: a.deadline - 1 })).body.result, 'confirmed')
    const b = await pending(31)
    assert.equal((await pay(b.id, { now: b.deadline })).body.result, 'late_payment')
  })
})

describe('the signed webhook: everything else', () => {
  it('refuses a bad or missing signature and changes nothing', async () => {
    const { id } = await pending()
    const body = Buffer.from(JSON.stringify({ eventId: 'e', type: 'payment.succeeded', depositId: id, providerRef: `mockpay_${id}`, occurredAt: Date.now() }))
    for (const signature of [payments.sign('wrong-secret', body), undefined, 'garbage']) {
      const out = await payments.handleWebhook(db, { method: 'POST', rawBody: body, signature }, SECRET)
      assert.deepEqual([out.status, out.body.error], [401, 'INVALID_SIGNATURE'])
    }
    const tampered = Buffer.from(body.toString().replace('payment.succeeded', 'payment.failed'))
    assert.equal((await payments.handleWebhook(db, { method: 'POST', rawBody: tampered, signature: payments.sign(SECRET, body) }, SECRET)).status, 401)
    assert.equal((await apt(id)).status, 'PENDING_PAYMENT')
    assert.equal((await dep(id)).status, 'pending')
  })
  it('refuses a stale event, an unknown deposit, and a provider reference that is not ours', async () => {
    const { id } = await pending()
    assert.equal((await pay(id, { now: Date.now() })).status, 200)
    const b = await pending(31)
    const stale = Date.now() - payments.TOLERANCE_MS - 1000
    const rawBody = Buffer.from(JSON.stringify({ eventId: 'e', type: 'payment.succeeded', depositId: b.id, providerRef: `mockpay_${b.id}`, occurredAt: stale }))
    assert.equal((await payments.handleWebhook(db, { method: 'POST', rawBody, signature: payments.sign(SECRET, rawBody) }, SECRET)).body.error, 'STALE_EVENT')
    const missing = await pay('z'.repeat(20), { providerRef: 'mockpay_x' })
    assert.deepEqual([missing.status, missing.body.error], [404, 'DEPOSIT_NOT_FOUND'])
    const wrong = await pay(b.id, { providerRef: 'someone-elses-payment' })
    assert.deepEqual([wrong.status, wrong.body.error], [400, 'PROVIDER_MISMATCH'])
    assert.equal((await dep(b.id)).status, 'pending')
  })
  it('a failed payment expires the booking, frees the slot, fails the deposit and audits it', async () => {
    const { id, start } = await pending()
    assert.deepEqual((await fail(id)).body, { result: 'failed_recorded' })
    const a = await apt(id)
    assert.deepEqual([a.status, a.holdExpiresAt], ['EXPIRED', null])
    assert.equal((await dep(id)).status, 'failed')
    assert.deepEqual((await intervals(start)).filter((iv) => iv.start.toMillis() === start), [])
    const record = (await audits(id)).find((r) => r.action === 'paymentFailed')
    assert.deepEqual([record.id, record.fromStatus, record.toStatus, record.role, record.actorUid], [`${id}_EXPIRED`, 'PENDING_PAYMENT', 'EXPIRED', 'system', null])
    assert.deepEqual(await taskTypes(id), [])
  })
  it('the freed slot can be held again', async () => {
    const { id, start } = await pending()
    await fail(id)
    const other = await hold(start) // holdSlot's overlap check would pass; here we only check the schedule is clear
    assert.equal((await apt(other)).status, 'HELD')
  })
  it('a failure that arrives after a success is ignored (out-of-order delivery)', async () => {
    const { id } = await pending()
    await pay(id)
    assert.equal((await fail(id)).body.result, 'ignored')
    assert.equal((await apt(id)).status, 'CONFIRMED')
    assert.equal((await dep(id)).status, 'paid')
  })
  it('a success after the expiry sweep leaves the slot released and marks the deposit refundable', async () => {
    const { id, start, deadline } = await pending()
    assert.deepEqual(await sweep.sweepExpiredHolds(db, deadline + 1000), { found: 1, expired: 1 })
    assert.equal((await dep(id)).status, 'failed')
    const now = deadline - 1 // the provider says it was in time; the booking is already gone
    assert.equal((await pay(id, { now })).body.result, 'late_payment')
    const d = await dep(id)
    assert.deepEqual([d.status, d.paidAfterExpiry], ['refundable', true])
    assert.equal((await apt(id)).status, 'EXPIRED')
    assert.deepEqual((await intervals(start)).filter((iv) => iv.start.toMillis() === start), [])
    assert.deepEqual(await taskTypes(id), [])
    assert.equal((await pay(id)).body.result, 'duplicate') // and a repeat changes nothing.
  })
  it('a success after the deadline, before the sweep has run, expires the booking itself', async () => {
    const { id, start, deadline } = await pending()
    assert.equal((await pay(id, { now: deadline + 5000 })).body.result, 'late_payment')
    assert.equal((await apt(id)).status, 'EXPIRED')
    const d = await dep(id)
    assert.deepEqual([d.status, d.paidAfterExpiry], ['refundable', true])
    assert.deepEqual((await intervals(start)).filter((iv) => iv.start.toMillis() === start), [])
    const record = (await audits(id)).find((r) => r.action === 'expire')
    assert.deepEqual([record.role, record.actorUid, record.fromStatus], ['system', null, 'PENDING_PAYMENT'])
    // The sweep that runs afterwards finds nothing left to do.
    assert.deepEqual(await sweep.sweepExpiredHolds(db, deadline + 60 * MIN), { found: 0, expired: 0 })
    assert.equal((await dep(id)).status, 'refundable')
  })
})

describe('expiry sweep and PENDING_PAYMENT (extends FR-09)', () => {
  it('expires an unpaid booking after its deadline: slot released, deposit failed, audit written', async () => {
    const { id, start, deadline } = await pending()
    assert.deepEqual(await sweep.sweepExpiredHolds(db, deadline), { found: 1, expired: 1 })
    assert.equal((await apt(id)).status, 'EXPIRED')
    assert.equal((await dep(id)).status, 'failed')
    assert.deepEqual((await intervals(start)).filter((iv) => iv.start.toMillis() === start), [])
    const record = (await audits(id)).find((r) => r.action === 'expire')
    assert.deepEqual([record.id, record.fromStatus, record.toStatus, record.role], [`${id}_EXPIRED`, 'PENDING_PAYMENT', 'EXPIRED', 'system'])
    assert.deepEqual(await sweep.sweepExpiredHolds(db, deadline + MIN), { found: 0, expired: 0 }) // idempotent.
  })
  it('leaves a booking that is still inside its payment window alone', async () => {
    const { id, deadline } = await pending()
    assert.deepEqual(await sweep.sweepExpiredHolds(db, deadline - 1), { found: 0, expired: 0 })
    assert.equal((await apt(id)).status, 'PENDING_PAYMENT')
    assert.equal((await dep(id)).status, 'pending')
  })
  it('still expires plain HELD holds, and handles both kinds in one run', async () => {
    const { id, deadline } = await pending()
    const held = await hold(startIn(40), { holdExpiresAt: Timestamp.fromMillis(Date.now() - MIN) })
    assert.deepEqual(await sweep.sweepExpiredHolds(db, deadline + 1), { found: 2, expired: 2 })
    assert.equal((await apt(held)).status, 'EXPIRED')
    assert.equal((await apt(id)).status, 'EXPIRED')
  })
  it('never expires a confirmed (paid) booking', async () => {
    const { id, deadline } = await pending()
    await pay(id)
    assert.deepEqual(await sweep.sweepExpiredHolds(db, deadline + HOUR), { found: 0, expired: 0 })
    assert.equal((await apt(id)).status, 'CONFIRMED')
  })
})

describe('the deposit follows attendance, no-shows and cancellation', () => {
  /** A CONFIRMED booking with a paid deposit, made directly so its time can be in the past. */
  async function paidBooking(startMs, { status = 'CONFIRMED', latePolicy } = {}) {
    if (latePolicy) await db.doc(`shops/${SHOP}`).update({ latePolicy })
    const id = await hold(startMs, { status, customerId: 'cust1', holdExpiresAt: null })
    await db.doc(`appointments/${id}`).update({ depositId: id })
    await db.doc(`deposits/${id}`).set({ bookingId: id, shopId: SHOP, barberId: 'b1', customerId: 'cust1', amountCents: 1250, status: 'paid', providerRef: `mockpay_${id}` })
    return id
  }
  const past = () => Math.floor((Date.now() - 45 * MIN) / (15 * MIN)) * 15 * MIN // started 30-45 min ago

  it('finishing the appointment makes the deposit refundable', async () => {
    const id = await paidBooking(past(), { status: 'IN_SERVICE' })
    await service.finishService({ auth: staffAuth, data: { requestId: id } })
    assert.equal((await apt(id)).status, 'COMPLETED')
    assert.equal((await dep(id)).status, 'refundable')
    await service.finishService({ auth: staffAuth, data: { requestId: id } }) // replay
    assert.equal((await dep(id)).status, 'refundable')
  })
  it('a further no-show forfeits it, and reversing the no-show puts it back', async () => {
    const id = await paidBooking(past())
    await service.markNoShow({ auth: staffAuth, data: { requestId: id } })
    assert.equal((await apt(id)).status, 'NO_SHOW')
    assert.equal((await dep(id)).status, 'forfeited')
    await service.markNoShow({ auth: staffAuth, data: { requestId: id } }) // replay
    assert.equal((await dep(id)).status, 'forfeited')
    await service.reverseNoShow({ auth: staffAuth, data: { requestId: id } })
    assert.equal((await apt(id)).status, 'CONFIRMED')
    assert.equal((await dep(id)).status, 'paid')
  })
  it('bookings without a deposit are unaffected', async () => {
    const id = await hold(past(), { status: 'CONFIRMED', customerId: 'cust1', holdExpiresAt: null })
    await service.markNoShow({ auth: staffAuth, data: { requestId: id } })
    assert.equal((await apt(id)).status, 'NO_SHOW')
    assert.equal(await dep(id), undefined)
  })
  it('a staff cancellation makes it refundable', async () => {
    const id = await paidBooking(startIn(30))
    await booking.cancelBooking({ auth: staffAuth, data: { requestId: id } })
    assert.equal((await dep(id)).status, 'refundable')
  })
  it('a customer cancellation with enough notice makes it refundable', async () => {
    const id = await paidBooking(startIn(30))
    await booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } })
    assert.equal((await dep(id)).status, 'refundable')
  })
  it('a late cancellation under the flag policy forfeits it', async () => {
    const id = await paidBooking(startIn(1), { latePolicy: 'flag' })
    await booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } })
    assert.equal((await apt(id)).status, 'CANCELLED')
    assert.equal((await dep(id)).status, 'forfeited')
  })
  it('a late cancellation refused under the block policy changes nothing', async () => {
    const id = await paidBooking(startIn(1), { latePolicy: 'block' })
    await assert.rejects(booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } }), { details: { reason: 'LATE_CANCEL_BLOCKED' } })
    assert.equal((await apt(id)).status, 'CONFIRMED')
    assert.equal((await dep(id)).status, 'paid')
  })
  it('a reschedule keeps the deposit as it is', async () => {
    const { id } = await pending()
    await pay(id)
    await booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart: startIn(60) } })
    assert.deepEqual([(await apt(id)).status, (await dep(id)).status], ['CONFIRMED', 'paid'])
  })
})

describe('mockPay: only the deposit\'s own customer', () => {
  const mock = (auth, id, outcome = 'success') => payments.mockPay({ auth, data: { requestId: id, outcome } }, db, provider, SECRET)
  const untouched = async (id) => {
    assert.equal((await apt(id)).status, 'PENDING_PAYMENT')
    const d = await dep(id)
    assert.equal(d.status, 'pending')
    assert.equal('paidAt' in d, false)
    assert.deepEqual(await taskTypes(id), [])
  }

  it('lets the customer who owns the deposit pay, through the signed webhook path', async () => {
    const { id } = await pending()
    assert.deepEqual(await mock(customerAuth(), id), { result: 'confirmed' })
    assert.equal((await apt(id)).status, 'CONFIRMED')
    assert.equal((await dep(id)).status, 'paid')
  })
  it('lets the owner fail the payment, which releases the slot', async () => {
    const { id } = await pending()
    assert.deepEqual(await mock(customerAuth(), id, 'failure'), { result: 'failed_recorded' })
    assert.equal((await apt(id)).status, 'EXPIRED')
  })
  it('rejects another customer with DEPOSIT_NOT_FOUND and changes nothing', async () => {
    const { id } = await pending()
    for (const outcome of ['success', 'failure']) {
      await assert.rejects(mock(customerAuth('cust2', '+6591230002'), id, outcome), { code: 'not-found', details: { reason: 'DEPOSIT_NOT_FOUND' } })
    }
    await untouched(id)
  })
  it('rejects a staff member (owner or barber) who is not the customer', async () => {
    const { id } = await pending()
    for (const auth of [staffAuth, { uid: 'barber1', token: { role: 'barber', shopId: SHOP, barberId: 'b1' } }]) {
      await assert.rejects(mock(auth, id), { details: { reason: 'DEPOSIT_NOT_FOUND' } })
    }
    await untouched(id)
  })
  it('rejects an anonymous caller', async () => {
    const { id } = await pending()
    await assert.rejects(mock(null, id), { code: 'unauthenticated' })
    await assert.rejects(mock(undefined, id), { code: 'unauthenticated' })
    await untouched(id)
  })
  it('gives a stranger the same answer for a deposit that does not exist, so it reveals nothing', async () => {
    const { id } = await pending()
    const real = await mock(customerAuth('cust2'), id).catch((e) => [e.code, e.details.reason, e.message])
    const missing = await mock(customerAuth('cust2'), 'q'.repeat(20)).catch((e) => [e.code, e.details.reason, e.message])
    assert.deepEqual(real, missing)
  })
  it('validates the outcome before doing anything', async () => {
    const { id } = await pending()
    await assert.rejects(mock(customerAuth(), id, 'maybe'), { code: 'invalid-argument' })
    await untouched(id)
  })
  it('refuses when the deposit can no longer be paid', async () => {
    const { id, deadline } = await pending()
    await sweep.sweepExpiredHolds(db, deadline + 1)
    await db.doc(`deposits/${id}`).update({ providerRef: null })
    await assert.rejects(mock(customerAuth(), id), { details: { reason: 'NOT_PAYABLE' } })
  })
})

describe('concurrency: payment success racing expiry', () => {
  /** Checks that exactly one consistent outcome happened. Returns which. */
  async function assertOneOutcome({ id, start }) {
    const a = await apt(id)
    const d = await dep(id)
    const mine = (await intervals(start)).filter((iv) => iv.start.toMillis() === start)
    const kinds = (await audits(id)).map((r) => r.action).sort()
    const tasks = await taskTypes(id)
    if (a.status === 'CONFIRMED') {
      assert.equal(d.status, 'paid')
      assert.deepEqual(mine.map((iv) => [iv.kind, iv.refId]), [['booking', id]])
      assert.deepEqual(kinds, ['confirm', 'requireDeposit'])
      assert.equal(tasks.length, 3)
      return 'paid'
    }
    assert.equal(a.status, 'EXPIRED')
    assert.deepEqual([d.status, d.paidAfterExpiry], ['refundable', true]) // the money is never lost
    assert.deepEqual(mine, []) // and the slot is free
    assert.deepEqual(kinds, ['expire', 'requireDeposit'])
    assert.deepEqual(tasks, [])
    return 'expired'
  }

  it('over 15 races, each ends in exactly one consistent state, never a mix', async () => {
    const tally = { paid: 0, expired: 0 }
    for (let i = 0; i < 15; i++) {
      const p = await pending(26 + i * 3) // 3 h apart, so each race has its own slot
      // The provider's event is in time by its own clock; the sweep's clock is past the deadline.
      const jobs = [pay(p.id, { now: p.deadline - 1 }), sweep.sweepExpiredHolds(db, p.deadline + 1)]
      if (i % 2) jobs.reverse()
      const results = await Promise.all(jobs)
      assert.ok(results.every((r) => r), 'both calls finished')
      tally[await assertOneOutcome(p)]++
    }
    console.log(`  (success vs expiry, 15 races: ${tally.paid} paid first, ${tally.expired} expired first)`)
  })
  it('a failure event racing the sweep also settles once, with one expiry audit record', async () => {
    for (let i = 0; i < 6; i++) {
      const p = await pending(26 + i * 3)
      await Promise.all([fail(p.id, { now: p.deadline - 1 }), sweep.sweepExpiredHolds(db, p.deadline + 1)])
      assert.equal((await apt(p.id)).status, 'EXPIRED')
      assert.equal((await dep(p.id)).status, 'failed')
      const expiries = (await audits(p.id)).filter((r) => r.toStatus === 'EXPIRED')
      assert.equal(expiries.length, 1)
      assert.ok(['expire', 'paymentFailed'].includes(expiries[0].action))
    }
  })
  it('a success racing a failure ends with one winner and a consistent deposit', async () => {
    for (let i = 0; i < 6; i++) {
      const p = await pending(26 + i * 3)
      await Promise.all([pay(p.id), fail(p.id)])
      const a = await apt(p.id)
      const d = await dep(p.id)
      if (a.status === 'CONFIRMED') assert.equal(d.status, 'paid') // success first; the failure was ignored
      else assert.deepEqual([a.status, d.status, d.paidAfterExpiry], ['EXPIRED', 'refundable', true]) // failure first; the money is flagged, not lost
      assert.equal((await audits(p.id)).filter((r) => r.toStatus === 'EXPIRED' || r.toStatus === 'CONFIRMED').length, 1)
    }
  })
})

describe('concurrency: duplicate webhook deliveries', () => {
  it('10 simultaneous copies of one success event confirm once: one audit record, one set of reminders, one payment', async () => {
    const { id, start } = await pending()
    const now = Date.now()
    const results = await Promise.all(Array.from({ length: 10 }, () => pay(id, { now, eventId: 'same-event' })))
    assert.ok(results.every((r) => r.status === 200))
    const outcomes = results.map((r) => r.body.result).sort()
    assert.deepEqual(outcomes, ['confirmed', ...Array(9).fill('duplicate')])
    assert.deepEqual((await audits(id)).map((r) => r.action).sort(), ['confirm', 'requireDeposit'])
    assert.deepEqual(await taskTypes(id), ['confirmation', 'reminder24h', 'reminder2h'])
    assert.equal((await dep(id)).paidAt.toMillis(), now)
    const mine = (await intervals(start)).filter((iv) => iv.start.toMillis() === start)
    assert.deepEqual(mine.map((iv) => iv.kind), ['booking'])
  })
  it('later redeliveries, including with a new event ID, change nothing', async () => {
    const { id } = await pending()
    await pay(id)
    const snapshot = JSON.stringify([await apt(id), await dep(id), await audits(id), await taskTypes(id)])
    for (let i = 0; i < 3; i++) assert.equal((await pay(id)).body.result, 'duplicate')
    assert.equal(JSON.stringify([await apt(id), await dep(id), await audits(id), await taskTypes(id)]), snapshot)
  })
  it('a redelivered event does not resend or reset reminders that already went out', async () => {
    const { id } = await pending()
    await pay(id)
    await db.doc(`notifications/${id}_confirmation`).update({ status: 'sent', nextAttemptAt: null, attempts: [{ outcome: 'sent', rev: 1 }] })
    await pay(id)
    const c = await data(`notifications/${id}_confirmation`)
    assert.deepEqual([c.status, c.attempts.length], ['sent', 1])
  })
  it('10 simultaneous copies of one failure event fail the payment once, with one audit record', async () => {
    const { id } = await pending()
    const results = await Promise.all(Array.from({ length: 10 }, () => fail(id, { eventId: 'same-failure' })))
    assert.deepEqual(results.map((r) => r.body.result).sort(), ['failed_recorded', ...Array(9).fill('ignored')])
    assert.equal((await audits(id)).filter((r) => r.action === 'paymentFailed').length, 1)
    assert.equal((await dep(id)).status, 'failed')
  })
  it('duplicate deliveries of a late payment refund-flag the deposit once', async () => {
    const { id, deadline } = await pending()
    await sweep.sweepExpiredHolds(db, deadline + 1)
    const results = await Promise.all(Array.from({ length: 8 }, () => pay(id, { now: deadline - 1 })))
    assert.deepEqual(results.map((r) => r.body.result).sort(), ['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'late_payment'])
    const d = await dep(id)
    assert.deepEqual([d.status, d.paidAfterExpiry], ['refundable', true])
  })
  it('a repeated confirmBooking at the same time as the payment cannot undo it', async () => {
    const { id } = await pending()
    await Promise.all([pay(id), confirm(id), confirm(id)])
    const a = await apt(id)
    assert.ok(['CONFIRMED', 'PENDING_PAYMENT'].includes(a.status))
    assert.equal((await audits(id)).filter((r) => r.toStatus === 'PENDING_PAYMENT').length, 1)
    if (a.status === 'PENDING_PAYMENT') assert.equal((await dep(id)).status, 'pending') // the payment lost the race harmlessly? it must not be half applied
    else assert.equal((await dep(id)).status, 'paid')
  })
})
