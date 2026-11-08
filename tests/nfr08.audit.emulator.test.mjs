// NFR-08 coverage test (docs/evidence/NFR-08/audit-trail.md, open points 5 and 7). Runs every booking
// state change on main through the real function code against the Firestore emulator (no Functions
// emulator needed) and checks that each one writes exactly one audit record with the booking ID, actor,
// role, timestamp, previous and resulting state, and an expireAt 12 months after the change. Also checks
// that idempotent replays and refused transitions write no record, so fixed record IDs are never
// overwritten. Uses its own project ID, so seeded data is untouched.
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/nfr08.audit.emulator.test.mjs
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const PROJECT = 'fresher-nfr08-audit-test'
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
const sweep = req('../functions/sweep.js')
const payments = req('../functions/payments.js')
const waitlist = req('../functions/waitlist.js')

const app = initializeApp({ projectId: PROJECT }) // the default app, which the functions use
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

const customerAuth = (uid = 'cust1') => ({ uid, token: { phone_number: PHONE, auth_time: Math.floor(Date.now() / 1000) } })
const ownerAuth = { uid: 'owner1', token: { role: 'owner', shopId: SHOP } }
const barberAuth = { uid: 'barber1', token: { role: 'barber', shopId: SHOP, barberId: 'b1' } }

/** 10:00 Singapore, `days` days from now, plus `extraHours`. */
function tenAm(days, extraHours = 0) {
  const k = booking.sgDateKey(Date.now() + days * 24 * HOUR)
  return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 10 + extraHours) - SG_OFFSET
}
/** `minutes` from now on the 15-minute grid, nudged later if a 30-minute visit would cross midnight Singapore. */
function startIn(minutes) {
  let t = Math.ceil((Date.now() + minutes * MIN) / (15 * MIN)) * 15 * MIN
  const minuteOfDay = (ms) => Math.floor(((ms + SG_OFFSET) % (24 * HOUR)) / MIN)
  while (minuteOfDay(t) + 30 > 23 * 60 + 59 || minuteOfDay(t) < 1) t += 15 * MIN
  return t
}

beforeEach(async () => {
  await clear()
  await db.doc(`shops/${SHOP}`).set({ name: 'Test shop', status: 'verified', openingHours: week, noticeMins: 120, latePolicy: 'block' })
  await db.doc(`shops/${SHOP}/services/cut`).set({ name: 'Cut', category: 'haircut', durationMin: 30, priceCents: 2500, active: true })
  await db.doc(`shops/${SHOP}/barbers/b1`).set({ displayName: 'Ali', active: true, serviceIds: ['cut'], workingHours: week })
  await db.doc('customers/cust1').set({ phoneE164: PHONE, displayName: 'Sam' })
})

let counter = 0
const newId = () => `nfr08-${String(++counter).padStart(4, '0')}-${Date.now()}`

// ---- audit helpers ----------------------------------------------------------

/** All audit records for a booking, as {id, ...data}. */
async function recordsOf(bookingId) {
  const snap = await db.collection('auditLog').where('bookingId', '==', bookingId).get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
const expectedExpiry = (atMs) => {
  const d = new Date(atMs)
  d.setUTCMonth(d.getUTCMonth() + 12)
  return d.getTime()
}

/**
 * Runs `change`, then checks that exactly one new audit record appeared for the booking and that it
 * carries every NFR-08 field. `atRange` is [earliest, latest] for `at`; pass a single number for an
 * exact time (the sweep passes its own clock).
 */
async function expectOneRecord(bookingId, change, want) {
  const before = new Set((await recordsOf(bookingId)).map((r) => r.id))
  const t0 = Date.now()
  await change()
  const t1 = Date.now()
  const added = (await recordsOf(bookingId)).filter((r) => !before.has(r.id))
  assert.equal(added.length, 1, `expected one new audit record for ${want.action}, got ${added.length}`)
  const r = added[0]
  if (want.id) assert.equal(r.id, want.id, 'record ID')
  assert.equal(r.bookingId, bookingId)
  assert.equal(r.shopId, SHOP)
  assert.equal(r.action, want.action)
  assert.equal(r.actorUid, want.actorUid)
  assert.equal(r.role, want.role)
  assert.equal(r.fromStatus, want.from)
  assert.equal(r.toStatus, want.to)
  assert.ok(r.at instanceof Timestamp, 'at is a Timestamp')
  assert.ok(r.expireAt instanceof Timestamp, 'expireAt is a Timestamp')
  const at = r.at.toMillis()
  if (typeof want.at === 'number') assert.equal(at, want.at)
  else assert.ok(at >= t0 && at <= t1, `at ${at} outside the call [${t0}, ${t1}]`)
  assert.equal(r.expireAt.toMillis(), expectedExpiry(at), 'expireAt is 12 months after at')
  // The record must describe the booking's state after the change.
  const apt = (await db.doc(`appointments/${bookingId}`).get()).data()
  assert.equal(apt.status, want.to, 'appointment status matches toStatus')
  return r
}

/** Runs `attempt` (which may throw) and checks that no audit record was added or changed. */
async function expectNoRecord(bookingId, attempt) {
  const before = JSON.stringify(await recordsOf(bookingId))
  await attempt().catch(() => {})
  assert.equal(JSON.stringify(await recordsOf(bookingId)), before)
}

// ---- booking helpers (the real functions) -----------------------------------

const hold = (requestId, start) =>
  booking.holdSlot({ shopId: SHOP, serviceId: 'cut', barberId: 'b1', start, requestId })
const confirm = (requestId, uid = 'cust1') =>
  booking.confirmBooking({ auth: customerAuth(uid), data: { requestId, displayName: 'Sam' } })
async function confirmedAt(start) {
  const id = newId()
  await hold(id, start)
  await confirm(id)
  return id
}
const reasonOf = async (p) => {
  try { await p; return null } catch (e) { return e.details && e.details.reason }
}

// ---- section 2 of audit-trail.md: transitions on main -------------------------

describe('NFR-08 1. hold: none -> HELD', () => {
  it('holdSlot writes {id}_HELD with no actor yet (hold comes before OTP)', async () => {
    const id = newId()
    await expectOneRecord(id, () => hold(id, tenAm(2)),
      { id: `${id}_HELD`, action: 'hold', actorUid: null, role: 'customer', from: null, to: 'HELD' })
  })
  it('a replayed holdSlot (same requestId) writes nothing', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    await expectNoRecord(id, () => hold(id, tenAm(2)))
  })
  it('a refused hold (SLOT_TAKEN) writes nothing for the losing request', async () => {
    await hold(newId(), tenAm(2))
    const loser = newId()
    assert.equal(await reasonOf(hold(loser, tenAm(2))), 'SLOT_TAKEN')
    assert.deepEqual(await recordsOf(loser), [])
  })
})

describe('NFR-08 2. release: HELD -> EXPIRED', () => {
  it('releaseHold writes {id}_EXPIRED as the customer', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    await expectOneRecord(id, () => booking.releaseHold({ requestId: id }),
      { id: `${id}_EXPIRED`, action: 'release', actorUid: null, role: 'customer', from: 'HELD', to: 'EXPIRED' })
  })
  it('a second releaseHold is a no-op and does not overwrite the record', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    await booking.releaseHold({ requestId: id })
    await expectNoRecord(id, () => booking.releaseHold({ requestId: id }))
  })
  it('confirming a lapsed hold expires it, recorded against the customer who tried', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    await db.doc(`appointments/${id}`).update({ holdExpiresAt: Timestamp.fromMillis(Date.now() - MIN) })
    await expectOneRecord(id, async () => assert.equal(await reasonOf(confirm(id)), 'HOLD_EXPIRED'),
      { id: `${id}_EXPIRED`, action: 'release', actorUid: 'cust1', role: 'customer', from: 'HELD', to: 'EXPIRED' })
  })
})

describe('NFR-08 3. expire: HELD or unpaid PENDING_PAYMENT -> EXPIRED (scheduled sweep)', () => {
  it('the sweep expires a lapsed hold as the system', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    const now = Date.now() + 11 * MIN
    await expectOneRecord(id, () => sweep.sweepExpiredHolds(db, now),
      { id: `${id}_EXPIRED`, action: 'expire', actorUid: null, role: 'system', from: 'HELD', to: 'EXPIRED', at: now })
  })
  it('the sweep expires an unpaid PENDING_PAYMENT booking as the system', async () => {
    await db.doc(`customers/cust1/shopStats/${SHOP}`).set({ noShowCount: 2 })
    const id = newId()
    await hold(id, tenAm(2))
    await confirm(id)
    const now = Date.now() + 11 * MIN
    await expectOneRecord(id, () => sweep.sweepExpiredHolds(db, now),
      { id: `${id}_EXPIRED`, action: 'expire', actorUid: null, role: 'system', from: 'PENDING_PAYMENT', to: 'EXPIRED', at: now })
  })
  it('a second sweep writes nothing', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    await sweep.sweepExpiredHolds(db, Date.now() + 11 * MIN)
    await expectNoRecord(id, () => sweep.sweepExpiredHolds(db, Date.now() + 20 * MIN))
  })
})

describe('NFR-08 4. requireDeposit: HELD -> PENDING_PAYMENT', () => {
  it('confirmBooking for a customer with 2 no-shows writes {id}_PENDING_PAYMENT', async () => {
    await db.doc(`customers/cust1/shopStats/${SHOP}`).set({ noShowCount: 2 })
    const id = newId()
    await hold(id, tenAm(2))
    await expectOneRecord(id, () => confirm(id),
      { id: `${id}_PENDING_PAYMENT`, action: 'requireDeposit', actorUid: 'cust1', role: 'customer', from: 'HELD', to: 'PENDING_PAYMENT' })
  })
})

describe('NFR-08 5. confirm: HELD -> CONFIRMED', () => {
  it('confirmBooking writes {id}_CONFIRMED as the verified customer', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    await expectOneRecord(id, () => confirm(id),
      { id: `${id}_CONFIRMED`, action: 'confirm', actorUid: 'cust1', role: 'customer', from: 'HELD', to: 'CONFIRMED' })
  })
  it('a replayed confirm writes nothing', async () => {
    const id = await confirmedAt(tenAm(2))
    await expectNoRecord(id, () => confirm(id))
  })
  it('another customer confirming a used hold writes nothing', async () => {
    const id = await confirmedAt(tenAm(2))
    await expectNoRecord(id, () => confirm(id, 'cust2'))
  })
})

describe('NFR-08 6. cancel: CONFIRMED -> CANCELLED', () => {
  it('a customer cancel (outside the notice window) writes {id}_CANCELLED as the customer', async () => {
    const id = await confirmedAt(tenAm(2))
    await expectOneRecord(id, () => booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } }),
      { id: `${id}_CANCELLED`, action: 'cancel', actorUid: 'cust1', role: 'customer', from: 'CONFIRMED', to: 'CANCELLED' })
  })
  it('a staff cancel writes {id}_CANCELLED with the staff uid and role', async () => {
    const id = await confirmedAt(tenAm(2))
    await expectOneRecord(id, () => booking.cancelBooking({ auth: ownerAuth, data: { requestId: id } }),
      { id: `${id}_CANCELLED`, action: 'cancel', actorUid: 'owner1', role: 'owner', from: 'CONFIRMED', to: 'CANCELLED' })
  })
  it('a replayed cancel writes nothing', async () => {
    const id = await confirmedAt(tenAm(2))
    await booking.cancelBooking({ auth: ownerAuth, data: { requestId: id } })
    await expectNoRecord(id, () => booking.cancelBooking({ auth: ownerAuth, data: { requestId: id } }))
  })
  it('cancelling a booking that is not CONFIRMED is refused and writes nothing', async () => {
    const id = newId()
    await hold(id, tenAm(2))
    await expectNoRecord(id, () => booking.cancelBooking({ auth: ownerAuth, data: { requestId: id } }))
  })
})

describe('NFR-08 7. lateCancelRefused: CONFIRMED -> CONFIRMED ("block" policy)', () => {
  it('a refused late cancel is still audited (auto ID), and the booking stays CONFIRMED', async () => {
    const id = await confirmedAt(startIn(60)) // inside the 120-minute notice window
    await expectOneRecord(id, async () => assert.equal(
      await reasonOf(booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } })), 'LATE_CANCEL_BLOCKED'),
    { action: 'lateCancelRefused', actorUid: 'cust1', role: 'customer', from: 'CONFIRMED', to: 'CONFIRMED' })
  })
})

describe('NFR-08 8. reschedule: CONFIRMED -> CONFIRMED (new time)', () => {
  it('reschedule writes one record (auto ID) as the customer', async () => {
    const id = await confirmedAt(tenAm(2))
    await expectOneRecord(id, () => booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart: tenAm(2, 2) } }),
      { action: 'reschedule', actorUid: 'cust1', role: 'customer', from: 'CONFIRMED', to: 'CONFIRMED' })
  })
  it('a replayed reschedule to the same time writes nothing', async () => {
    const id = await confirmedAt(tenAm(2))
    await booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart: tenAm(2, 2) } })
    await expectNoRecord(id, () => booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart: tenAm(2, 2) } }))
  })
  it('a reschedule refused with SLOT_TAKEN writes nothing', async () => {
    const id = await confirmedAt(tenAm(2))
    await confirmedAt(tenAm(2, 2))
    await expectNoRecord(id, () => booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart: tenAm(2, 2) } }))
  })
})

describe('NFR-08 9-10. start and finish: CONFIRMED -> IN_SERVICE -> COMPLETED', () => {
  it('startService writes {id}_IN_SERVICE and finishService writes {id}_COMPLETED, as the staff member', async () => {
    const id = await confirmedAt(startIn(30)) // start is allowed from 60 minutes before
    await expectOneRecord(id, () => service.startService({ auth: barberAuth, data: { requestId: id } }),
      { id: `${id}_IN_SERVICE`, action: 'start', actorUid: 'barber1', role: 'barber', from: 'CONFIRMED', to: 'IN_SERVICE' })
    await expectOneRecord(id, () => service.finishService({ auth: ownerAuth, data: { requestId: id } }),
      { id: `${id}_COMPLETED`, action: 'finish', actorUid: 'owner1', role: 'owner', from: 'IN_SERVICE', to: 'COMPLETED' })
  })
  it('replayed start and finish write nothing', async () => {
    const id = await confirmedAt(startIn(30))
    await service.startService({ auth: ownerAuth, data: { requestId: id } })
    await expectNoRecord(id, () => service.startService({ auth: ownerAuth, data: { requestId: id } }))
    await service.finishService({ auth: ownerAuth, data: { requestId: id } })
    await expectNoRecord(id, () => service.finishService({ auth: ownerAuth, data: { requestId: id } }))
  })
  it('starting too early is refused and writes nothing', async () => {
    const id = await confirmedAt(tenAm(2))
    await expectNoRecord(id, () => service.startService({ auth: ownerAuth, data: { requestId: id } }))
  })
})

describe('NFR-08 11-12. noShow and noShowReversed: CONFIRMED <-> NO_SHOW', () => {
  /** A CONFIRMED booking that started an hour ago (holdSlot cannot create one in the past). */
  async function pastConfirmed() {
    const id = newId()
    const start = Math.floor((Date.now() - HOUR) / (15 * MIN)) * 15 * MIN
    await db.doc(`appointments/${id}`).set({
      requestId: id, shopId: SHOP, barberId: 'b1', serviceId: 'cut', customerId: 'cust1', status: 'CONFIRMED',
      start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN), holdExpiresAt: null,
      priceCents: 2500, durationMin: 30, customerName: 'Sam',
    })
    return id
  }
  it('markNoShow and reverseNoShow each write one record (auto ID) as the staff member', async () => {
    const id = await pastConfirmed()
    await expectOneRecord(id, () => service.markNoShow({ auth: ownerAuth, data: { requestId: id } }),
      { action: 'noShow', actorUid: 'owner1', role: 'owner', from: 'CONFIRMED', to: 'NO_SHOW' })
    await expectOneRecord(id, () => service.reverseNoShow({ auth: barberAuth, data: { requestId: id } }),
      { action: 'noShowReversed', actorUid: 'barber1', role: 'barber', from: 'NO_SHOW', to: 'CONFIRMED' })
  })
  it('replayed markNoShow and reverseNoShow write nothing', async () => {
    const id = await pastConfirmed()
    await service.markNoShow({ auth: ownerAuth, data: { requestId: id } })
    await expectNoRecord(id, () => service.markNoShow({ auth: ownerAuth, data: { requestId: id } }))
    await service.reverseNoShow({ auth: ownerAuth, data: { requestId: id } })
    await expectNoRecord(id, () => service.reverseNoShow({ auth: ownerAuth, data: { requestId: id } }))
  })
  it('staff of another shop cannot change the booking and write nothing', async () => {
    const id = await pastConfirmed()
    const otherShop = { uid: 'intruder', token: { role: 'owner', shopId: 'shop2' } }
    await expectNoRecord(id, () => service.markNoShow({ auth: otherShop, data: { requestId: id } }))
  })
})

// ---- section 3 of audit-trail.md: transitions from the merged chain PRs -------

describe('NFR-08 PR-15 deposits: PENDING_PAYMENT -> CONFIRMED or EXPIRED (payment events)', () => {
  /** A PENDING_PAYMENT booking whose deposit is registered with the mock provider. */
  async function pending() {
    await db.doc(`customers/cust1/shopStats/${SHOP}`).set({ noShowCount: 2 })
    const id = newId()
    await hold(id, tenAm(2))
    await confirm(id)
    await db.doc(`deposits/${id}`).update({ providerRef: `mockpay_${id}` })
    return id
  }
  const event = (id, type) => ({ type, depositId: id, providerRef: `mockpay_${id}` })

  it('payment.succeeded in time writes {id}_CONFIRMED as the system', async () => {
    const id = await pending()
    const now = Date.now()
    await expectOneRecord(id, () => payments.applyEvent(db, event(id, 'payment.succeeded'), now),
      { id: `${id}_CONFIRMED`, action: 'confirm', actorUid: null, role: 'system', from: 'PENDING_PAYMENT', to: 'CONFIRMED', at: now })
  })
  it('a duplicate payment.succeeded writes nothing', async () => {
    const id = await pending()
    await payments.applyEvent(db, event(id, 'payment.succeeded'), Date.now())
    await expectNoRecord(id, () => payments.applyEvent(db, event(id, 'payment.succeeded'), Date.now()))
  })
  it('payment.failed writes {id}_EXPIRED as the system', async () => {
    const id = await pending()
    const now = Date.now()
    await expectOneRecord(id, () => payments.applyEvent(db, event(id, 'payment.failed'), now),
      { id: `${id}_EXPIRED`, action: 'paymentFailed', actorUid: null, role: 'system', from: 'PENDING_PAYMENT', to: 'EXPIRED', at: now })
  })
  it('a payment after the deadline expires the booking as the system', async () => {
    const id = await pending()
    const now = Date.now() + 11 * MIN
    await expectOneRecord(id, () => payments.applyEvent(db, event(id, 'payment.succeeded'), now),
      { id: `${id}_EXPIRED`, action: 'expire', actorUid: null, role: 'system', from: 'PENDING_PAYMENT', to: 'EXPIRED', at: now })
  })
})

describe('NFR-08 PR-16 waitlist: none -> HELD (offer) -> CONFIRMED (claim)', () => {
  /** A waiting entry for cust1, and an offer of tenAm(2) made to it. Returns the offer's booking ID. */
  async function offered() {
    const date = booking.sgDateKey(tenAm(2))
    const entryId = waitlist.entryId('cust1', SHOP, 'cut', date, null)
    await db.doc(`waitlist/${entryId}`).set({
      shopId: SHOP, serviceId: 'cut', barberId: null, date, customerId: 'cust1', customerName: 'Sam',
      joinedAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(waitlist.dateEndMs(date)), status: 'waiting',
    })
    const svc = (await db.doc(`shops/${SHOP}/services/cut`).get()).data()
    const t0 = Date.now()
    const outcome = await waitlist.tryOffer(db, {
      shopId: SHOP, barberId: 'b1', entryRef: db.doc(`waitlist/${entryId}`), svc,
      start: tenAm(2), end: tenAm(2) + 30 * MIN, clock: Date.now,
    })
    assert.equal(outcome, 'offered')
    const id = (await db.doc(`waitlist/${entryId}`).get()).data().offerRequestId
    return { id, entryId, t0, t1: Date.now() }
  }

  it('an offer writes {id}_HELD as the system, and only one record', async () => {
    const { id, t0, t1 } = await offered()
    const rs = await recordsOf(id)
    assert.equal(rs.length, 1)
    const [r] = rs
    assert.deepEqual([r.id, r.action, r.actorUid, r.role, r.fromStatus, r.toStatus],
      [`${id}_HELD`, 'offer', null, 'system', null, 'HELD'])
    assert.ok(r.at.toMillis() >= t0 && r.at.toMillis() <= t1)
    assert.equal(r.expireAt.toMillis(), expectedExpiry(r.at.toMillis()))
  })
  it('claiming the offer writes {id}_CONFIRMED as the customer', async () => {
    const { id, entryId } = await offered()
    await expectOneRecord(id, () => waitlist.claimOffer({ auth: customerAuth(), data: { entryId } }, db),
      { id: `${id}_CONFIRMED`, action: 'confirm', actorUid: 'cust1', role: 'customer', from: 'HELD', to: 'CONFIRMED' })
  })
  it('a lapsed offer is expired by the sweep as the system', async () => {
    const { id } = await offered()
    const now = Date.now() + 16 * MIN
    await expectOneRecord(id, () => sweep.sweepExpiredHolds(db, now),
      { id: `${id}_EXPIRED`, action: 'expire', actorUid: null, role: 'system', from: 'HELD', to: 'EXPIRED', at: now })
  })
})

describe('NFR-08 a full booking life cycle', () => {
  it('hold -> confirm -> reschedule -> cancel leaves one record per change, in order', async () => {
    const id = newId()
    await hold(id, tenAm(3))
    await confirm(id)
    await booking.reschedule({ auth: customerAuth(), data: { requestId: id, newStart: tenAm(3, 1) } })
    await booking.cancelBooking({ auth: customerAuth(), data: { requestId: id } })
    const rs = (await recordsOf(id)).sort((a, b) => a.at.toMillis() - b.at.toMillis())
    assert.deepEqual(rs.map((r) => [r.action, r.fromStatus, r.toStatus]), [
      ['hold', null, 'HELD'],
      ['confirm', 'HELD', 'CONFIRMED'],
      ['reschedule', 'CONFIRMED', 'CONFIRMED'],
      ['cancel', 'CONFIRMED', 'CANCELLED'],
    ])
  })
})
