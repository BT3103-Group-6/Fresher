// FR-15 against the Firestore emulator (no Functions emulator needed): joining, offers made from freed time,
// the 15-minute lead rule, notification, claimOffer (through the confirmBooking code, including the FR-13
// deposit), lapsed offers passing on, entries expiring at the end of their date, and the concurrency cases:
// two slots freed at once, a claim racing its expiry, and a normal customer racing the offered slot.
// The trigger handler is called directly with real before/after schedule snapshots. Own project id.
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const PROJECT = 'fresher-wl-test'
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
const sweep = req('../functions/sweep.js')
const payments = req('../functions/payments.js')
const wl = req('../functions/waitlist.js')

const app = initializeApp({ projectId: PROJECT })
const db = getFirestore(app)
after(() => deleteApp(app))

const MIN = 60e3
const HOUR = 60 * MIN
const SG_OFFSET = 8 * HOUR
const SHOP = 'shop1'
const SECRET = 'test-secret'
const ALL_DAY = { start: '00:00', end: '23:59' }
const week = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [ALL_DAY]]))
const clear = () => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })

/** 10:00 Singapore `days` days from now, plus `hours`: always the same barber-day for the same `days`. */
function slotAt(days, hours = 0, minutes = 0) {
  const k = booking.sgDateKey(Date.now() + days * 24 * HOUR)
  return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 10 + hours, minutes) - SG_OFFSET
}
const dateOf = (ms) => booking.sgDateKey(ms)

let nUser = 0
const newUser = () => {
  const i = ++nUser
  return { uid: `user${i}`, phone: `+6591${String(i).padStart(6, '0')}` }
}
const authOf = (u) => ({ uid: u.uid, token: { phone_number: u.phone, auth_time: Math.floor(Date.now() / 1000) } })
const staffAuth = { uid: 'owner1', token: { role: 'owner', shopId: SHOP } }
const data = async (path) => (await db.doc(path).get()).data()
const audits = async (id) => (await db.collection('auditLog').where('bookingId', '==', id).get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const taskTypes = async (id) => (await db.collection('notifications').where('bookingId', '==', id).get()).docs.map((d) => d.data().type).sort()
const schedRef = (barber, start) => db.doc(`shops/${SHOP}/schedules/${booking.scheduleId(barber, start)}`)
const intervalsAt = async (barber, start) => ((await schedRef(barber, start).get()).data() || {}).intervals || []
const holdsAt = async (barber, start) => (await intervalsAt(barber, start)).filter((iv) => iv.start.toMillis() === start && iv.kind === 'hold')
const wlAppointments = async () => (await db.collection('appointments').where('waitlistEntryId', '>', '').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const event = (before, after) => ({ params: { shopId: SHOP }, data: { before, after } })

beforeEach(async () => {
  await clear()
  await db.doc(`shops/${SHOP}`).set({ name: 'Test shop', status: 'verified', openingHours: week, noticeMins: 120, latePolicy: 'block' })
  for (const b of ['b1', 'b2']) await db.doc(`shops/${SHOP}/barbers/${b}`).set({ displayName: b, active: true, serviceIds: ['cut', 'long'], workingHours: week })
  await db.doc(`shops/${SHOP}/services/cut`).set({ name: 'Cut', durationMin: 30, priceCents: 2500, active: true })
  await db.doc(`shops/${SHOP}/services/long`).set({ name: 'Long cut', durationMin: 45, priceCents: 4000, active: true })
})

let nApt = 0
/** A CONFIRMED 30-minute booking (with its booking interval) that a test can cancel. */
async function booked(start, barber = 'b1', over = {}) {
  const id = `bk-${String(++nApt).padStart(4, '0')}-waitlist-test-x`
  const a = {
    requestId: id, shopId: SHOP, barberId: barber, serviceId: 'cut', customerId: 'booker', customerName: 'Booker',
    status: 'CONFIRMED', start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN),
    holdExpiresAt: null, priceCents: 2500, durationMin: 30, ...over,
  }
  await db.doc(`appointments/${id}`).set(a)
  const ref = schedRef(barber, start)
  const before = ((await ref.get()).data() || {}).intervals || []
  await ref.set({ barberId: barber, date: dateOf(start), version: 1, intervals: [...before, { start: a.start, end: a.end, kind: 'booking', refId: id }] })
  return id
}

let joinedOrder = 0
/** A waiting entry, written directly so its joinedAt order is exact. */
async function entry(user, over = {}) {
  const date = over.date ?? dateOf(slotAt(2))
  const id = wl.entryId(user.uid, SHOP, over.serviceId ?? 'cut', date, over.barberId ?? null)
  await db.doc(`customers/${user.uid}`).set({ phoneE164: user.phone, displayName: `Name ${user.uid}` })
  await db.doc(`waitlist/${id}`).set({
    shopId: SHOP, serviceId: 'cut', barberId: null, date, customerId: user.uid, customerName: `Name ${user.uid}`,
    joinedAt: Timestamp.fromMillis(1_700_000_000_000 + (++joinedOrder) * 1000), expiresAt: Timestamp.fromMillis(wl.dateEndMs(date)),
    status: 'waiting', ...over,
  })
  return id
}

/** Cancels a booking and returns the trigger event for that schedule write (real before/after snapshots). */
async function cancelEvent(id, start, barber = 'b1') {
  const before = await schedRef(barber, start).get()
  await booking.cancelBooking({ auth: staffAuth, data: { requestId: id } })
  return event(before, await schedRef(barber, start).get())
}

/** A freed slot with a waiting entry, offered: returns what a race test needs. */
async function makeOffer() {
  const i = nApt + 1
  const start = slotAt(2 + (i % 8), Math.floor(i / 8))
  const user = newUser()
  const id = await booked(start)
  const entryId = await entry(user, { date: dateOf(start) })
  const result = await wl.onScheduleWritten(await cancelEvent(id, start), db)
  assert.equal(result.offers, 1)
  const e = await data(`waitlist/${entryId}`)
  return { user, entryId, start, requestId: e.offerRequestId, expiresAt: e.offerExpiresAt.toMillis() }
}

const claim = (user, entryId) => wl.claimOffer({ auth: authOf(user), data: { entryId } }, db)
const join = (user, over = {}, now) => wl.joinWaitlist({
  auth: authOf(user), data: { shopId: SHOP, serviceId: 'cut', barberId: null, date: dateOf(slotAt(2)), displayName: 'Sam', ...over },
}, db, now)

describe('joinWaitlist', () => {
  it('adds a waiting entry with a deterministic ID, the customer\'s name and no phone number', async () => {
    const u = newUser()
    const date = dateOf(slotAt(2))
    const out = await join(u, { barberId: 'b1', date })
    const id = wl.entryId(u.uid, SHOP, 'cut', date, 'b1')
    assert.deepEqual([out.entryId, out.status, out.alreadyJoined, out.barberId, out.date], [id, 'waiting', false, 'b1', date])
    const e = await data(`waitlist/${id}`)
    assert.deepEqual([e.shopId, e.serviceId, e.barberId, e.customerId, e.customerName, e.status], [SHOP, 'cut', 'b1', u.uid, 'Sam', 'waiting'])
    assert.equal(e.expiresAt.toMillis(), wl.dateEndMs(date))
    assert.doesNotMatch(JSON.stringify(e), /\+65|phone/i)
  })
  it('barber is optional: none, null, an empty string and "any" all mean any barber', async () => {
    for (const [i, barberId] of [undefined, null, '', 'any'].entries()) {
      const u = newUser()
      const out = await join(u, { barberId, date: dateOf(slotAt(2 + i)) })
      assert.equal(out.barberId, null)
      assert.ok(out.entryId.endsWith('_any'))
    }
  })
  it('is idempotent: joining again returns the same waiting entry and does not move it back in the queue', async () => {
    const u = newUser()
    const first = await join(u)
    const before = await data(`waitlist/${first.entryId}`)
    const again = await join(u, {}, Date.now() + 5000)
    assert.deepEqual([again.entryId, again.alreadyJoined], [first.entryId, true])
    assert.equal((await data(`waitlist/${first.entryId}`)).joinedAt.toMillis(), before.joinedAt.toMillis())
    assert.equal((await db.collection('waitlist').get()).size, 1)
  })
  it('different service, barber or date makes a separate entry', async () => {
    const u = newUser()
    await join(u)
    await join(u, { serviceId: 'long' })
    await join(u, { barberId: 'b2' })
    await join(u, { date: dateOf(slotAt(3)) })
    assert.equal((await db.collection('waitlist').get()).size, 4)
  })
  it('a finished entry can be joined again from the back of the queue', async () => {
    const u = newUser()
    const first = await join(u)
    await db.doc(`waitlist/${first.entryId}`).update({ status: 'expired', expireReason: 'offer_lapsed' })
    const again = await join(u, {}, Date.now() + 5000)
    assert.equal(again.alreadyJoined, false)
    const e = await data(`waitlist/${first.entryId}`)
    assert.deepEqual([e.status, 'expireReason' in e], ['waiting', false])
  })
  it('needs a signed-in customer with a Singapore mobile', async () => {
    const call = (auth) => wl.joinWaitlist({ auth, data: { shopId: SHOP, serviceId: 'cut', date: dateOf(slotAt(2)), displayName: 'Sam' } }, db)
    await assert.rejects(call(null), { code: 'unauthenticated' })
    await assert.rejects(call({ uid: 'x', token: { phone_number: '+14155550101' } }), { code: 'permission-denied' })
    await assert.rejects(call({ uid: 'x', token: {} }), { code: 'permission-denied' })
    assert.equal((await db.collection('waitlist').get()).size, 0)
  })
  it('validates every field, naming it', async () => {
    const u = newUser()
    const bad = async (over, field) => assert.rejects(join(u, over), (e) => e.code === 'invalid-argument' && e.details.field === field, field)
    await bad({ serviceId: '' }, 'serviceId')
    await bad({ serviceId: 'a/b' }, 'serviceId')
    await bad({ shopId: undefined }, 'shopId')
    await bad({ displayName: '  ' }, 'displayName')
    await bad({ displayName: 'x'.repeat(81) }, 'displayName')
    await bad({ barberId: 'a/b' }, 'barberId')
    await bad({ barberId: 42 }, 'barberId')
    for (const date of [undefined, '2030-01-01', dateOf(Date.now() - 2 * 24 * HOUR), dateOf(Date.now() + 14 * 24 * HOUR), '20300230']) await bad({ date }, 'date')
    assert.equal((await db.collection('waitlist').get()).size, 0)
  })
  it('accepts today and the last bookable day', async () => {
    const u = newUser()
    await join(u, { date: dateOf(Date.now()) })
    await join(u, { date: dateOf(Date.now() + 13 * 24 * HOUR) })
    assert.equal((await db.collection('waitlist').get()).size, 2)
  })
  it('refuses an inactive service, an unavailable barber and an unknown or unverified shop', async () => {
    const u = newUser()
    await db.doc(`shops/${SHOP}/services/cut`).update({ active: false })
    await assert.rejects(join(u), { code: 'invalid-argument', details: { field: 'serviceId' } })
    await db.doc(`shops/${SHOP}/services/cut`).update({ active: true })
    await db.doc(`shops/${SHOP}/barbers/b1`).update({ active: false })
    await assert.rejects(join(u, { barberId: 'b1' }), { details: { field: 'barberId' } })
    await db.doc(`shops/${SHOP}/barbers/b1`).update({ active: true, serviceIds: ['long'] })
    await assert.rejects(join(u, { barberId: 'b1' }), { details: { field: 'barberId' } }) // does not offer this service
    await assert.rejects(join(u, { barberId: 'ghost' }), { details: { field: 'barberId' } })
    await assert.rejects(join(u, { shopId: 'nope' }), { code: 'not-found', details: { reason: 'SHOP_NOT_FOUND' } })
    await db.doc(`shops/${SHOP}`).update({ status: 'pending' })
    await assert.rejects(join(u), { details: { reason: 'SHOP_NOT_FOUND' } })
    assert.equal((await db.collection('waitlist').get()).size, 0)
  })
})

describe('offers from freed time', () => {
  it('a cancellation is offered to the earliest-joined compatible entry, holding the slot for 15 minutes exclusively', async () => {
    const start = slotAt(2)
    const id = await booked(start)
    const [u1, u2] = [newUser(), newUser()]
    const first = await entry(u1)
    const second = await entry(u2)
    const before = Date.now()
    assert.deepEqual(await wl.onScheduleWritten(await cancelEvent(id, start), db), { offers: 1, skipped: 0 })
    const e = await data(`waitlist/${first}`)
    assert.equal(e.status, 'offered')
    assert.deepEqual([e.offerSlot.barberId, e.offerSlot.start.toMillis(), e.offerSlot.end.toMillis()], ['b1', start, start + 30 * MIN])
    assert.ok(e.offerExpiresAt.toMillis() >= before + 15 * MIN && e.offerExpiresAt.toMillis() <= Date.now() + 15 * MIN)
    assert.equal((await data(`waitlist/${second}`)).status, 'waiting')
    // The slot is an exclusive HELD appointment plus a live hold interval, with no booking ID on the public schedule.
    const [apt] = await wlAppointments()
    assert.deepEqual([apt.id, apt.status, apt.customerId, apt.waitlistEntryId, apt.barberId, apt.priceCents, apt.durationMin], [e.offerRequestId, 'HELD', null, first, 'b1', 2500, 30])
    assert.equal(apt.holdExpiresAt.toMillis(), e.offerExpiresAt.toMillis())
    const holds = await holdsAt('b1', start)
    assert.equal(holds.length, 1)
    assert.equal('refId' in holds[0], false)
    assert.equal(holds[0].holdExpiresAt.toMillis(), e.offerExpiresAt.toMillis())
    const [record] = (await audits(e.offerRequestId))
    assert.deepEqual([record.id, record.action, record.role, record.actorUid, record.toStatus], [`${e.offerRequestId}_HELD`, 'offer', 'system', null, 'HELD'])
  })
  it('skips entries that are not compatible: other service, date, barber or a service too long for the freed time', async () => {
    const start = slotAt(2)
    const id = await booked(start, 'b1') // frees exactly 30 minutes
    const [wrongDate, wrongBarber, tooLong, wrongShop, compatible] = [1, 2, 3, 4, 5].map(newUser)
    await entry(wrongDate, { date: dateOf(slotAt(3)) })
    await entry(wrongBarber, { barberId: 'b2' })
    await entry(tooLong, { serviceId: 'long' }) // 45 minutes does not fit a freed 30-minute interval (L27)
    await entry(wrongShop, { shopId: 'other-shop' })
    const good = await entry(compatible, { barberId: 'b1' })
    await wl.onScheduleWritten(await cancelEvent(id, start), db)
    const states = Object.fromEntries((await db.collection('waitlist').get()).docs.map((d) => [d.data().customerId, d.data().status]))
    assert.deepEqual(states, { [wrongDate.uid]: 'waiting', [wrongBarber.uid]: 'waiting', [tooLong.uid]: 'waiting', [wrongShop.uid]: 'waiting', [compatible.uid]: 'offered' })
    assert.equal((await data(`waitlist/${good}`)).status, 'offered')
  })
  it('an entry for a specific barber matches only that barber; an entry for any barber matches either', async () => {
    const start = slotAt(2)
    const [wantsB2, anyone] = [newUser(), newUser()]
    const b2Entry = await entry(wantsB2, { barberId: 'b2' }) // joined first
    const anyEntry = await entry(anyone)
    const id1 = await booked(start, 'b1')
    await wl.onScheduleWritten(await cancelEvent(id1, start, 'b1'), db)
    assert.deepEqual([(await data(`waitlist/${b2Entry}`)).status, (await data(`waitlist/${anyEntry}`)).status], ['waiting', 'offered'])
  })
  it('an entry needs the barber to offer its service', async () => {
    await db.doc(`shops/${SHOP}/barbers/b1`).update({ serviceIds: ['long'] })
    const start = slotAt(2)
    const id = await booked(start)
    const u = newUser()
    await entry(u)
    assert.deepEqual(await wl.onScheduleWritten(await cancelEvent(id, start), db), { offers: 0, skipped: 0 })
  })
  it('only one offer is made per freed interval, even when several entries fit', async () => {
    const start = slotAt(2)
    const id = await booked(start)
    for (let i = 0; i < 4; i++) await entry(newUser())
    assert.equal((await wl.onScheduleWritten(await cancelEvent(id, start), db)).offers, 1)
    assert.equal((await db.collection('waitlist').where('status', '==', 'offered').get()).size, 1)
    assert.equal((await wlAppointments()).length, 1)
  })
  it('an entry that already has an offer, or is finished, is not offered anything else', async () => {
    const start = slotAt(2)
    const [u1, u2, u3] = [newUser(), newUser(), newUser()]
    const busy = await entry(u1, { status: 'offered', offerExpiresAt: Timestamp.fromMillis(Date.now() + 10 * MIN) })
    await entry(u2, { status: 'claimed' })
    const next = await entry(u3)
    await wl.onScheduleWritten(await cancelEvent(await booked(start), start), db)
    assert.equal((await data(`waitlist/${busy}`)).status, 'offered')
    assert.equal((await data(`waitlist/${next}`)).status, 'offered')
    assert.equal((await wlAppointments()).length, 1) // one, for `next`
  })
  it('offers nothing outside the barber\'s working hours or the shop\'s opening hours', async () => {
    const start = slotAt(2, 5) // 15:00
    const id = await booked(start)
    await db.doc(`shops/${SHOP}/barbers/b1`).update({ workingHours: Object.fromEntries(Object.keys(week).map((d) => [d, [{ start: '09:00', end: '12:00' }]])) })
    await entry(newUser())
    assert.equal((await wl.onScheduleWritten(await cancelEvent(id, start), db)).offers, 0)
    await db.doc(`shops/${SHOP}/barbers/b1`).update({ workingHours: week })
    await db.doc(`shops/${SHOP}`).update({ openingHours: Object.fromEntries(Object.keys(week).map((d) => [d, [{ start: '09:00', end: '12:00' }]])) })
    assert.equal((await wl.onScheduleWritten({ params: { shopId: SHOP }, data: { before: await schedRef('b1', start).get(), after: await schedRef('b1', start).get() } }, db)).offers, 0)
  })
  it('offers nothing when the barber or the shop is not available', async () => {
    const start = slotAt(2)
    const id = await booked(start)
    await entry(newUser())
    const ev = await cancelEvent(id, start)
    await db.doc(`shops/${SHOP}/barbers/b1`).update({ active: false })
    assert.equal((await wl.onScheduleWritten(ev, db)).offers, 0)
    await db.doc(`shops/${SHOP}/barbers/b1`).update({ active: true })
    await db.doc(`shops/${SHOP}`).update({ status: 'suspended' })
    assert.equal((await wl.onScheduleWritten(ev, db)).offers, 0)
    await db.doc(`shops/${SHOP}`).update({ status: 'verified' })
    assert.equal((await wl.onScheduleWritten(ev, db)).offers, 1) // and it works once everything is available again
  })
  it('an inactive service is never offered', async () => {
    const start = slotAt(2)
    const id = await booked(start)
    await entry(newUser())
    await db.doc(`shops/${SHOP}/services/cut`).update({ active: false })
    assert.equal((await wl.onScheduleWritten(await cancelEvent(id, start), db)).offers, 0)
  })

  describe('every way of freeing time', () => {
    it('an expired hold released by the sweep', async () => {
      const start = slotAt(2)
      const held = `bk-held-${++nApt}-waitlist-test-x`.padEnd(20, 'x')
      await db.doc(`appointments/${held}`).set({
        requestId: held, shopId: SHOP, barberId: 'b1', serviceId: 'cut', customerId: null, status: 'HELD',
        start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN),
        holdExpiresAt: Timestamp.fromMillis(Date.now() - MIN), priceCents: 2500, durationMin: 30,
      })
      await schedRef('b1', start).set({ barberId: 'b1', date: dateOf(start), version: 1, intervals: [
        { start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN), kind: 'hold', holdExpiresAt: Timestamp.fromMillis(Date.now() - MIN) }] })
      const entryId = await entry(newUser())
      const before = await schedRef('b1', start).get()
      assert.equal((await sweep.sweepExpiredHolds(db, Date.now())).expired, 1)
      assert.equal((await wl.onScheduleWritten(event(before, await schedRef('b1', start).get()), db)).offers, 1)
      assert.equal((await data(`waitlist/${entryId}`)).status, 'offered')
    })
    it('a removed personal block', async () => {
      const start = slotAt(2, 3)
      const block = { start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 60 * MIN), kind: 'block', refId: 'blk1' }
      await schedRef('b1', start).set({ barberId: 'b1', date: dateOf(start), version: 1, intervals: [block] })
      const entryId = await entry(newUser())
      const before = await schedRef('b1', start).get()
      await schedRef('b1', start).update({ intervals: [] }) // what removeBlock does
      assert.equal((await wl.onScheduleWritten(event(before, await schedRef('b1', start).get()), db)).offers, 1)
      const e = await data(`waitlist/${entryId}`)
      assert.equal(e.offerSlot.start.toMillis(), start) // the offer starts where the freed time starts
      assert.equal(e.offerSlot.end.toMillis(), start + 30 * MIN)
    })
    it('the old slot of a rescheduled booking', async () => {
      const oldStart = slotAt(3)
      const id = await booked(oldStart)
      const entryId = await entry(newUser(), { date: dateOf(oldStart) })
      const before = await schedRef('b1', oldStart).get()
      await booking.reschedule({ auth: { uid: 'booker', token: { phone_number: '+6591999999', auth_time: Math.floor(Date.now() / 1000) } }, data: { requestId: id, newStart: slotAt(5) } })
      assert.equal((await wl.onScheduleWritten(event(before, await schedRef('b1', oldStart).get()), db)).offers, 1)
      assert.equal((await data(`waitlist/${entryId}`)).status, 'offered')
    })
    it('a booking turning from a hold into a confirmed booking frees nothing', async () => {
      const start = slotAt(2)
      const id = `bk-hold-${++nApt}-waitlist-test-x`.padEnd(20, 'x')
      const iv = { start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * MIN) }
      await db.doc(`appointments/${id}`).set({ requestId: id, shopId: SHOP, barberId: 'b1', serviceId: 'cut', customerId: null, status: 'HELD', ...iv, holdExpiresAt: Timestamp.fromMillis(Date.now() + 10 * MIN), priceCents: 2500, durationMin: 30 })
      await schedRef('b1', start).set({ barberId: 'b1', date: dateOf(start), version: 1, intervals: [{ ...iv, kind: 'hold', holdExpiresAt: Timestamp.fromMillis(Date.now() + 10 * MIN) }] })
      const entryId = await entry(newUser())
      const before = await schedRef('b1', start).get()
      await booking.confirmBooking({ auth: authOf(newUser()), data: { requestId: id, displayName: 'Sam' } })
      assert.deepEqual(await wl.onScheduleWritten(event(before, await schedRef('b1', start).get()), db), { offers: 0, skipped: 0 })
      assert.equal((await data(`waitlist/${entryId}`)).status, 'waiting')
    })
  })
})

describe('the 15-minute lead rule (the offered slot must start at least 15 minutes after the offer)', () => {
  /** A freed slot at `start` with one waiting entry; returns the ranges an offer would be made for. */
  async function freed(start) {
    const id = await booked(start)
    const entryId = await entry(newUser(), { date: dateOf(start) })
    await booking.cancelBooking({ auth: staffAuth, data: { requestId: id } })
    return { entryId, ranges: [{ start, end: start + 30 * MIN }] }
  }
  const offerAt = (start, now) => wl.offerFreed(db, { shopId: SHOP, barberId: 'b1', dateKey: dateOf(start), ranges: [{ start, end: start + 30 * MIN }], now })

  it('exactly 15 minutes ahead is offered, and the hold then ends exactly when the appointment starts', async () => {
    const start = slotAt(2)
    const { entryId } = await freed(start)
    assert.deepEqual(await offerAt(start, start - 15 * MIN), { offers: 1, skipped: 0 })
    const e = await data(`waitlist/${entryId}`)
    assert.equal(e.status, 'offered')
    assert.equal(e.offerExpiresAt.toMillis(), start) // the claim window closes as the appointment begins, never after
  })
  it('one millisecond less than 15 minutes is skipped: no offer, no hold, the entry keeps waiting', async () => {
    const start = slotAt(2)
    const { entryId } = await freed(start)
    assert.deepEqual(await offerAt(start, start - 15 * MIN + 1), { offers: 0, skipped: 1 })
    assert.equal((await data(`waitlist/${entryId}`)).status, 'waiting')
    assert.deepEqual(await holdsAt('b1', start), [])
    assert.deepEqual(await wlAppointments(), [])
    assert.deepEqual(await taskTypes('anything'), [])
    assert.equal((await db.collection('notifications').get()).size, 0)
  })
  it('one millisecond more than 15 minutes is offered', async () => {
    const start = slotAt(2)
    const { entryId } = await freed(start)
    assert.equal((await offerAt(start, start - 15 * MIN - 1)).offers, 1)
    assert.equal((await data(`waitlist/${entryId}`)).status, 'offered')
  })
  it('a slot that is about to start, has started, or is long past is skipped', async () => {
    const start = slotAt(2)
    const { entryId } = await freed(start)
    for (const now of [start - 14 * MIN, start - 1, start, start + HOUR]) assert.deepEqual(await offerAt(start, now), { offers: 0, skipped: 1 }, String(now - start))
    assert.equal((await data(`waitlist/${entryId}`)).status, 'waiting')
  })
  it('a skipped range does not stop a later range in the same event from being offered', async () => {
    const soon = slotAt(2)
    const later = slotAt(2, 4)
    const entryId = await entry(newUser(), { date: dateOf(soon) })
    const now = soon - 10 * MIN // the first range is too close; the second is hours away
    const out = await wl.offerFreed(db, { shopId: SHOP, barberId: 'b1', dateKey: dateOf(soon), now, ranges: [
      { start: soon, end: soon + 30 * MIN }, { start: later, end: later + 30 * MIN }] })
    assert.deepEqual(out, { offers: 1, skipped: 1 })
    assert.equal((await data(`waitlist/${entryId}`)).offerSlot.start.toMillis(), later)
  })
  it('the rule is checked again inside the offer transaction, against that transaction\'s own clock', async () => {
    const start = slotAt(2)
    const { entryId } = await freed(start)
    const entryRef = db.doc(`waitlist/${entryId}`)
    const svc = { priceCents: 2500, durationMin: 30 }
    const args = { shopId: SHOP, barberId: 'b1', entryRef, svc, start, end: start + 30 * MIN }
    // The clock has moved past the boundary since the caller looked.
    assert.equal(await wl.tryOffer(db, { ...args, clock: () => start - 15 * MIN + 1 }), 'too_late')
    assert.equal((await data(`waitlist/${entryId}`)).status, 'waiting')
    assert.equal(await wl.tryOffer(db, { ...args, clock: () => start - 15 * MIN }), 'offered')
  })
  it('a freed interval that began before the lead time is never offered, even with the rest of it ahead', async () => {
    const start = slotAt(2)
    const entryId = await entry(newUser(), { date: dateOf(start) })
    // Freed 10:00-11:00; it is now 10:10, so an offer starting at 10:00 would already have begun.
    const out = await wl.offerFreed(db, { shopId: SHOP, barberId: 'b1', dateKey: dateOf(start), now: start + 10 * MIN, ranges: [{ start, end: start + HOUR }] })
    assert.deepEqual(out, { offers: 0, skipped: 1 })
    assert.equal((await data(`waitlist/${entryId}`)).status, 'waiting')
  })
})

describe('notification of an offer (mock messaging)', () => {
  const recording = () => {
    const sent = []
    return { sent, send: async (m) => { sent.push(m); return { ok: true, providerRef: 'x' } } }
  }
  it('is sent to the entry\'s customer, read from their customer record, and only once', async () => {
    const o = await makeOffer()
    const p = recording()
    await sweep.sendDueTasks(db, p, Date.now() + 1000)
    await sweep.sendDueTasks(db, p, Date.now() + 2000)
    assert.equal(p.sent.length, 1)
    assert.equal(p.sent[0].to, o.user.phone)
    assert.equal(p.sent[0].key, `${o.requestId}_waitlistOffer:1:1`)
    assert.match(p.sent[0].body, /waitlist/)
    const task = await data(`notifications/${o.requestId}_waitlistOffer`)
    assert.deepEqual([task.status, task.attempts.length, task.entryId], ['sent', 1, o.entryId])
  })
  it('is not sent once the offer was claimed or has lapsed', async () => {
    const claimed = await makeOffer()
    await claim(claimed.user, claimed.entryId)
    const lapsed = await makeOffer()
    await db.doc(`waitlist/${lapsed.entryId}`).update({ status: 'expired', expireReason: 'offer_lapsed' })
    const p = recording()
    const result = await sweep.sendDueTasks(db, p, Date.now() + 1000)
    // The claimed booking's own confirmation is due, but neither offer message is sent.
    assert.equal(p.sent.filter((m) => /waitlist/.test(m.body)).length, 0)
    for (const o of [claimed, lapsed]) {
      const t = await data(`notifications/${o.requestId}_waitlistOffer`)
      assert.deepEqual([t.status, t.cancelReason], ['cancelled', 'stale'])
    }
    assert.ok(result.skipped >= 2)
  })
})

describe('claimOffer', () => {
  it('confirms the held slot through the normal booking path: booking, reminders, audit and claimed entry', async () => {
    const o = await makeOffer()
    const out = await claim(o.user, o.entryId)
    assert.deepEqual([out.status, out.requestId, out.barberId, out.start], ['CONFIRMED', o.requestId, 'b1', o.start])
    const a = await data(`appointments/${o.requestId}`)
    assert.deepEqual([a.status, a.customerId, a.customerName, a.holdExpiresAt], ['CONFIRMED', o.user.uid, `Name ${o.user.uid}`, null])
    assert.match(a.customerPhoneMasked, /^\+65 9••• ••\d\d$/)
    const e = await data(`waitlist/${o.entryId}`)
    assert.deepEqual([e.status, e.claimedBookingId], ['claimed', o.requestId])
    const mine = (await intervalsAt('b1', o.start)).filter((iv) => iv.start.toMillis() === o.start)
    assert.deepEqual(mine.map((iv) => [iv.kind, iv.refId]), [['booking', o.requestId]])
    assert.deepEqual(await taskTypes(o.requestId), ['confirmation', 'reminder24h', 'reminder2h', 'waitlistOffer'])
    const records = (await audits(o.requestId)).map((r) => r.action).sort()
    assert.deepEqual(records, ['confirm', 'offer'])
  })
  it('is idempotent: a repeated claim returns the booking and changes nothing', async () => {
    const o = await makeOffer()
    const first = await claim(o.user, o.entryId)
    const again = await claim(o.user, o.entryId)
    assert.deepEqual([again.status, again.requestId], [first.status, first.requestId])
    assert.equal((await audits(o.requestId)).filter((r) => r.action === 'confirm').length, 1)
  })
  it('applies the FR-13 deposit rule: two no-shows at the shop gives PENDING_PAYMENT and a deposit, then payment confirms it', async () => {
    const o = await makeOffer()
    await db.doc(`customers/${o.user.uid}/shopStats/${SHOP}`).set({ noShowCount: 2 })
    const out = await claim(o.user, o.entryId)
    assert.deepEqual([out.status, out.depositCents], ['PENDING_PAYMENT', 1250])
    const a = await data(`appointments/${o.requestId}`)
    assert.equal(a.status, 'PENDING_PAYMENT')
    assert.ok(a.holdExpiresAt.toMillis() > Date.now() + 9 * MIN) // a fresh 10-minute payment deadline
    assert.equal((await data(`waitlist/${o.entryId}`)).status, 'claimed') // the entry is used up either way
    assert.deepEqual((await data(`deposits/${o.requestId}`)).status, 'pending')
    assert.equal((await claim(o.user, o.entryId)).status, 'PENDING_PAYMENT') // replay
    // Pay it: the same webhook path as any deposit.
    await payments.createDeposit({ auth: authOf(o.user), data: { requestId: o.requestId } }, db, payments.mockProvider())
    const rawBody = Buffer.from(JSON.stringify({ eventId: 'e1', type: 'payment.succeeded', depositId: o.requestId, providerRef: `mockpay_${o.requestId}`, occurredAt: Date.now() }))
    assert.equal((await payments.handleWebhook(db, { method: 'POST', rawBody, signature: payments.sign(SECRET, rawBody) }, SECRET)).body.result, 'confirmed')
    assert.equal((await data(`appointments/${o.requestId}`)).status, 'CONFIRMED')
  })
  it('is only for the entry\'s customer: anyone else gets OFFER_NOT_FOUND and nothing changes', async () => {
    const o = await makeOffer()
    const stranger = newUser()
    await assert.rejects(claim(stranger, o.entryId), { code: 'not-found', details: { reason: 'OFFER_NOT_FOUND' } })
    await assert.rejects(wl.claimOffer({ auth: staffAuth, data: { entryId: o.entryId } }, db), { code: 'permission-denied' }) // a staff token has no verified mobile
    await assert.rejects(wl.claimOffer({ auth: null, data: { entryId: o.entryId } }, db), { code: 'unauthenticated' })
    await assert.rejects(claim(stranger, 'no-such-entry'), { details: { reason: 'OFFER_NOT_FOUND' } })
    await assert.rejects(wl.claimOffer({ auth: authOf(o.user), data: { entryId: 'a/b' } }, db), { code: 'invalid-argument' })
    assert.equal((await data(`waitlist/${o.entryId}`)).status, 'offered')
    assert.equal((await data(`appointments/${o.requestId}`)).status, 'HELD')
  })
  it('a stranger gets the same answer for an entry that exists and one that does not', async () => {
    const o = await makeOffer()
    const stranger = newUser()
    const real = await claim(stranger, o.entryId).catch((e) => [e.code, e.details.reason, e.message])
    const none = await claim(stranger, 'nothing-here').catch((e) => [e.code, e.details.reason, e.message])
    assert.deepEqual(real, none)
  })
  it('there is nothing to claim while the entry is only waiting', async () => {
    const u = newUser()
    const id = await entry(u)
    await assert.rejects(claim(u, id), { details: { reason: 'OFFER_NOT_FOUND' } })
  })
  it('a claim after the offer lapsed gets OFFER_EXPIRED and books nothing', async () => {
    const o = await makeOffer()
    await db.doc(`waitlist/${o.entryId}`).update({ offerExpiresAt: Timestamp.fromMillis(Date.now() - 1) })
    await assert.rejects(claim(o.user, o.entryId), { details: { reason: 'OFFER_EXPIRED' } })
    assert.equal((await data(`appointments/${o.requestId}`)).status, 'HELD')
    // An entry the sweep already expired says the same.
    await db.doc(`waitlist/${o.entryId}`).update({ status: 'expired' })
    await assert.rejects(claim(o.user, o.entryId), { details: { reason: 'OFFER_EXPIRED' } })
  })
  it('a claim when the hold was already released by the sweep gets OFFER_EXPIRED', async () => {
    const o = await makeOffer()
    await sweep.sweepExpiredHolds(db, o.expiresAt + 1000)
    assert.equal((await data(`appointments/${o.requestId}`)).status, 'EXPIRED')
    await assert.rejects(claim(o.user, o.entryId), { details: { reason: 'OFFER_EXPIRED' } })
  })
  it('the normal booking path cannot bypass the entry: confirmBooking refuses the offered hold, releaseHold leaves it', async () => {
    const o = await makeOffer()
    const other = newUser()
    for (const u of [o.user, other]) {
      await assert.rejects(booking.confirmBooking({ auth: authOf(u), data: { requestId: o.requestId, displayName: 'Sam' } }), { details: { reason: 'OFFER_ONLY' } })
    }
    assert.deepEqual(await booking.releaseHold({ requestId: o.requestId }), { released: false })
    const a = await data(`appointments/${o.requestId}`)
    assert.deepEqual([a.status, a.customerId], ['HELD', null])
    assert.equal((await holdsAt('b1', o.start)).length, 1)
  })
  it('other customers cannot book the offered slot: holdSlot says it is taken', async () => {
    const o = await makeOffer()
    await assert.rejects(booking.holdSlot({ shopId: SHOP, serviceId: 'cut', barberId: 'b1', start: o.start, requestId: `plain-${'a'.repeat(20)}` }), { details: { reason: 'SLOT_TAKEN' } })
    // Even a partly overlapping booking is refused.
    await assert.rejects(booking.holdSlot({ shopId: SHOP, serviceId: 'cut', barberId: 'b1', start: o.start + 15 * MIN, requestId: `plain-${'b'.repeat(20)}` }), { details: { reason: 'SLOT_TAKEN' } })
  })
})

describe('an unclaimed offer passes to the next entry', () => {
  it('after 15 minutes the sweep frees the slot, marks the entry expired, and the next entry is offered it', async () => {
    const start = slotAt(2)
    const id = await booked(start)
    const [u1, u2, u3] = [newUser(), newUser(), newUser()]
    const e1 = await entry(u1)
    const e2 = await entry(u2)
    const e3 = await entry(u3)
    await wl.onScheduleWritten(await cancelEvent(id, start), db)
    const first = await data(`waitlist/${e1}`)
    assert.equal(first.status, 'offered')

    // 15 minutes later nobody claimed: the sweep releases the hold and expires the entry.
    const later = first.offerExpiresAt.toMillis() + 1000
    let before = await schedRef('b1', start).get()
    const swept = await sweep.runAll(db, { send: async () => ({ ok: true }) }, later)
    assert.deepEqual([swept.holds.expired, swept.waitlist.lapsed], [1, 1])
    const lapsed = await data(`waitlist/${e1}`)
    assert.deepEqual([lapsed.status, lapsed.expireReason], ['expired', 'offer_lapsed'])
    assert.equal((await data(`appointments/${first.offerRequestId}`)).status, 'EXPIRED')
    const expiry = (await audits(first.offerRequestId)).find((r) => r.action === 'expire')
    assert.deepEqual([expiry.role, expiry.actorUid, expiry.fromStatus, expiry.toStatus], ['system', null, 'HELD', 'EXPIRED'])
    assert.deepEqual(await holdsAt('b1', start), [])

    // The freed hold is what the trigger sees; the second entry (not the lapsed first) gets it.
    assert.deepEqual(await wl.onScheduleWritten(event(before, await schedRef('b1', start).get()), db, later), { offers: 1, skipped: 0 })
    assert.equal((await data(`waitlist/${e2}`)).status, 'offered')
    assert.equal((await data(`waitlist/${e3}`)).status, 'waiting')
    assert.equal((await data(`waitlist/${e1}`)).status, 'expired')

    // ...and the third after that, then nobody: the slot simply becomes open again.
    const second = await data(`waitlist/${e2}`)
    const later2 = second.offerExpiresAt.toMillis() + 1000
    before = await schedRef('b1', start).get()
    await sweep.runAll(db, { send: async () => ({ ok: true }) }, later2)
    assert.equal((await wl.onScheduleWritten(event(before, await schedRef('b1', start).get()), db, later2)).offers, 1)
    assert.equal((await data(`waitlist/${e3}`)).status, 'offered')
    const third = await data(`waitlist/${e3}`)
    const later3 = third.offerExpiresAt.toMillis() + 1000
    before = await schedRef('b1', start).get()
    await sweep.runAll(db, { send: async () => ({ ok: true }) }, later3)
    assert.deepEqual(await wl.onScheduleWritten(event(before, await schedRef('b1', start).get()), db, later3), { offers: 0, skipped: 0 })
    assert.deepEqual(await holdsAt('b1', start), [])
  })
  it('the unsent offer message for a lapsed offer is cancelled, never sent late', async () => {
    const o = await makeOffer()
    await sweep.runAll(db, { send: async () => { throw new Error('should not send') } }, o.expiresAt + 1000)
    const t = await data(`notifications/${o.requestId}_waitlistOffer`)
    assert.deepEqual([t.status, t.cancelReason], ['cancelled', 'stale'])
  })
  it('a lapsed entry is not offered the same slot again', async () => {
    const o = await makeOffer()
    const before = await schedRef('b1', o.start).get()
    await sweep.runAll(db, { send: async () => ({ ok: true }) }, o.expiresAt + 1000)
    const out = await wl.onScheduleWritten(event(before, await schedRef('b1', o.start).get()), db, o.expiresAt + 1000)
    assert.equal(out.offers, 0) // the only entry lapsed
    assert.equal((await data(`waitlist/${o.entryId}`)).status, 'expired')
  })
  it('a claimed offer is left alone by the sweep', async () => {
    const o = await makeOffer()
    await claim(o.user, o.entryId)
    const swept = await sweep.runAll(db, { send: async () => ({ ok: true }) }, o.expiresAt + HOUR)
    assert.deepEqual([swept.holds.expired, swept.waitlist.lapsed], [0, 0])
    assert.equal((await data(`appointments/${o.requestId}`)).status, 'CONFIRMED')
    assert.equal((await data(`waitlist/${o.entryId}`)).status, 'claimed')
  })
})

describe('entries expire at the end of the requested date (Singapore)', () => {
  it('waiting and offered entries expire exactly when the date ends, and not a millisecond before', async () => {
    const date = dateOf(slotAt(2))
    const end = wl.dateEndMs(date)
    const waiting = await entry(newUser(), { date })
    const offered = await entry(newUser(), { date, serviceId: 'long', status: 'offered', offerExpiresAt: Timestamp.fromMillis(end + HOUR) })
    assert.deepEqual(await sweep.sweepWaitlist(db, end - 1), { lapsed: 0, ended: 0 })
    assert.equal((await data(`waitlist/${waiting}`)).status, 'waiting')
    assert.deepEqual(await sweep.sweepWaitlist(db, end), { lapsed: 0, ended: 2 })
    for (const id of [waiting, offered]) {
      const e = await data(`waitlist/${id}`)
      assert.deepEqual([e.status, e.expireReason], ['expired', 'date_passed'])
    }
  })
  it('leaves other dates, claimed entries and already expired entries alone, and is idempotent', async () => {
    const date = dateOf(slotAt(2))
    const end = wl.dateEndMs(date)
    const tomorrow = await entry(newUser(), { date: dateOf(slotAt(3)) })
    const claimed = await entry(newUser(), { date, status: 'claimed' })
    const done = await entry(newUser(), { date, serviceId: 'long', status: 'expired', expireReason: 'offer_lapsed' })
    const due = await entry(newUser(), { date, barberId: 'b1' })
    assert.deepEqual(await sweep.sweepWaitlist(db, end + MIN), { lapsed: 0, ended: 1 })
    assert.deepEqual(await sweep.sweepWaitlist(db, end + MIN), { lapsed: 0, ended: 0 })
    assert.equal((await data(`waitlist/${tomorrow}`)).status, 'waiting')
    assert.equal((await data(`waitlist/${claimed}`)).status, 'claimed')
    assert.equal((await data(`waitlist/${done}`)).expireReason, 'offer_lapsed') // its reason is not overwritten
    assert.equal((await data(`waitlist/${due}`)).status, 'expired')
  })
  it('an entry for today lasts until midnight Singapore time', async () => {
    const u = newUser()
    const today = dateOf(Date.now())
    const out = await join(u, { date: today })
    assert.equal((await data(`waitlist/${out.entryId}`)).expiresAt.toMillis(), wl.dateEndMs(today))
  })
})

describe('concurrency: two slots freed at once', () => {
  /** Frees the given bookings in the stored schedule and returns one trigger event per barber-day. */
  async function freeAll(items) {
    const events = []
    for (const [id, start, barber] of items) {
      const before = await schedRef(barber, start).get()
      await booking.cancelBooking({ auth: staffAuth, data: { requestId: id } })
      events.push(event(before, await schedRef(barber, start).get()))
    }
    return events
  }
  const offersOf = async () => (await wlAppointments()).reduce((m, a) => ({ ...m, [a.waitlistEntryId]: [...(m[a.waitlistEntryId] || []), a] }), {})

  it('two slots and three entries: the two earliest-joined each get exactly one offer, the third keeps waiting', async () => {
    for (let round = 0; round < 6; round++) {
      await clear()
      await beforeEachSeed()
      const start = slotAt(2, round)
      const ids = [await booked(start, 'b1'), await booked(start, 'b2')]
      const entries = []
      for (let i = 0; i < 3; i++) entries.push(await entry(newUser(), { date: dateOf(start) }))
      // Free both bookings, then deliver both trigger events at the same moment (and in a varying order).
      const events = await freeAll([[ids[0], start, 'b1'], [ids[1], start, 'b2']])
      if (round % 2) events.reverse()
      const results = await Promise.all(events.map((ev) => wl.onScheduleWritten(ev, db)))
      assert.equal(results.reduce((n, r) => n + r.offers, 0), 2)
      const per = await offersOf()
      assert.deepEqual(Object.keys(per).sort(), [entries[0], entries[1]].sort()) // earliest two
      for (const list of Object.values(per)) assert.equal(list.length, 1) // never two offers for one entry
      assert.equal((await data(`waitlist/${entries[2]}`)).status, 'waiting')
      for (const barber of ['b1', 'b2']) assert.equal((await holdsAt(barber, start)).length, 1) // one hold per slot
      const barbersOffered = Object.values(per).flat().map((a) => a.barberId).sort()
      assert.deepEqual(barbersOffered, ['b1', 'b2'])
    }
  })
  it('two slots and one entry: exactly one offer, and the other slot stays open', async () => {
    for (let round = 0; round < 4; round++) {
      await clear()
      await beforeEachSeed()
      const start = slotAt(2, round)
      const ids = [await booked(start, 'b1'), await booked(start, 'b2')]
      const only = await entry(newUser(), { date: dateOf(start) })
      const events = await freeAll([[ids[0], start, 'b1'], [ids[1], start, 'b2']])
      const results = await Promise.all(events.map((ev) => wl.onScheduleWritten(ev, db)))
      assert.equal(results.reduce((n, r) => n + r.offers, 0), 1)
      assert.equal((await data(`waitlist/${only}`)).status, 'offered')
      assert.equal((await wlAppointments()).length, 1)
      const holds = (await holdsAt('b1', start)).length + (await holdsAt('b2', start)).length
      assert.equal(holds, 1)
    }
  })
  it('respects barber preferences whichever event is handled first', async () => {
    for (let round = 0; round < 6; round++) {
      await clear()
      await beforeEachSeed()
      const start = slotAt(2, round)
      const ids = [await booked(start, 'b1'), await booked(start, 'b2')]
      const wantsB2 = await entry(newUser(), { date: dateOf(start), barberId: 'b2' }) // joined first
      const anyone = await entry(newUser(), { date: dateOf(start) })
      const events = await freeAll([[ids[0], start, 'b1'], [ids[1], start, 'b2']])
      if (round % 2) events.reverse()
      await Promise.all(events.map((ev) => wl.onScheduleWritten(ev, db)))
      const bySlot = Object.fromEntries((await wlAppointments()).map((a) => [a.waitlistEntryId, a.barberId]))
      assert.deepEqual(bySlot, { [wantsB2]: 'b2', [anyone]: 'b1' })
    }
  })
  it('several freed intervals on one barber-day in one write are offered separately, one entry each', async () => {
    const start = slotAt(2)
    const ids = [await booked(start), await booked(start + 2 * HOUR), await booked(start + 4 * HOUR)]
    const entries = []
    for (let i = 0; i < 4; i++) entries.push(await entry(newUser(), { date: dateOf(start) }))
    const before = await schedRef('b1', start).get()
    for (const id of ids) await booking.cancelBooking({ auth: staffAuth, data: { requestId: id } })
    const out = await wl.onScheduleWritten(event(before, await schedRef('b1', start).get()), db)
    assert.equal(out.offers, 3)
    const per = await offersOf()
    assert.deepEqual(Object.keys(per).sort(), entries.slice(0, 3).sort())
    for (const list of Object.values(per)) assert.equal(list.length, 1)
  })
  it('the same trigger event delivered many times at once makes one offer', async () => {
    const start = slotAt(2)
    const id = await booked(start)
    for (let i = 0; i < 3; i++) await entry(newUser())
    const ev = await cancelEvent(id, start)
    const results = await Promise.all(Array.from({ length: 6 }, () => wl.onScheduleWritten(ev, db)))
    assert.equal(results.reduce((n, r) => n + r.offers, 0), 1)
    assert.equal((await wlAppointments()).length, 1)
    assert.equal((await holdsAt('b1', start)).length, 1)
    assert.equal((await db.collection('waitlist').where('status', '==', 'offered').get()).size, 1)
  })
})

/** Reseeds the shop after a mid-test clear (the loops above start each round from an empty database). */
async function beforeEachSeed() {
  await db.doc(`shops/${SHOP}`).set({ name: 'Test shop', status: 'verified', openingHours: week, noticeMins: 120, latePolicy: 'block' })
  for (const b of ['b1', 'b2']) await db.doc(`shops/${SHOP}/barbers/${b}`).set({ displayName: b, active: true, serviceIds: ['cut', 'long'], workingHours: week })
  await db.doc(`shops/${SHOP}/services/cut`).set({ name: 'Cut', durationMin: 30, priceCents: 2500, active: true })
  await db.doc(`shops/${SHOP}/services/long`).set({ name: 'Long cut', durationMin: 45, priceCents: 4000, active: true })
}

describe('concurrency: an offer claim racing its expiry', () => {
  it('over 15 races, each ends in exactly one consistent state', async () => {
    const tally = { claimed: 0, lapsed: 0 }
    for (let i = 0; i < 15; i++) {
      const o = await makeOffer()
      const expire = () => sweep.runAll(db, { send: async () => ({ ok: true }) }, o.expiresAt + 1000)
      // Stagger the two so that, over the rounds, each gets to go first (the sweep takes several milliseconds).
      const lag = [0, 4, 8, 12, 16, 22, 30][i % 7]
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const claimJob = (async () => { if (i % 2) await wait(lag); return claim(o.user, o.entryId).then((v) => ({ ok: v }), (e) => ({ err: e.details && e.details.reason })) })()
      const expireJob = (async () => { if (!(i % 2)) await wait(lag); return expire() })()
      const results = await Promise.all([claimJob, expireJob])
      const claimResult = results.find((r) => 'ok' in r || 'err' in r)
      const a = await data(`appointments/${o.requestId}`)
      const e = await data(`waitlist/${o.entryId}`)
      const mine = (await intervalsAt('b1', o.start)).filter((iv) => iv.start.toMillis() === o.start)
      const kinds = (await audits(o.requestId)).map((r) => r.action).sort()
      if (a.status === 'CONFIRMED') {
        assert.equal(claimResult.ok.status, 'CONFIRMED')
        assert.deepEqual([e.status, e.claimedBookingId], ['claimed', o.requestId])
        assert.deepEqual(mine.map((iv) => iv.kind), ['booking'])
        assert.deepEqual(kinds, ['confirm', 'offer'])
        assert.equal((await taskTypes(o.requestId)).includes('confirmation'), true)
        tally.claimed++
      } else {
        assert.equal(a.status, 'EXPIRED')
        assert.equal(claimResult.err, 'OFFER_EXPIRED')
        assert.equal(e.status, 'expired')
        assert.deepEqual(mine, []) // the slot is free again, never stuck
        assert.deepEqual(kinds, ['expire', 'offer'])
        assert.equal((await taskTypes(o.requestId)).includes('confirmation'), false) // no booking, no reminders
        tally.lapsed++
      }
    }
    console.log(`  (claim vs expiry, 15 races: ${tally.claimed} claimed first, ${tally.lapsed} expired first)`)
  })
  it('the same customer claiming five times at once confirms once', async () => {
    const o = await makeOffer()
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(o.user, o.entryId).then((v) => v.status, (e) => e.code)))
    assert.ok(results.every((r) => r === 'CONFIRMED'), results.join())
    assert.equal((await audits(o.requestId)).filter((r) => r.action === 'confirm').length, 1)
    assert.equal((await taskTypes(o.requestId)).filter((t) => t === 'confirmation').length, 1)
  })
  it('a claim racing a different customer\'s claim: only the entry\'s customer can win', async () => {
    const o = await makeOffer()
    const stranger = newUser()
    const [mine, theirs] = await Promise.all([
      claim(o.user, o.entryId).then((v) => v.status, (e) => e.details.reason),
      claim(stranger, o.entryId).then((v) => v.status, (e) => e.details.reason)])
    assert.deepEqual([mine, theirs], ['CONFIRMED', 'OFFER_NOT_FOUND'])
    assert.equal((await data(`appointments/${o.requestId}`)).customerId, o.user.uid)
  })
})

describe('concurrency: a normal customer racing the offered slot', () => {
  it('over 12 races, either the customer or the waitlist entry gets the slot, never both', async () => {
    const tally = { customer: 0, waitlist: 0 }
    for (let i = 0; i < 12; i++) {
      const start = slotAt(2 + i) // a date of its own, so earlier entries cannot be offered first
      const id = await booked(start)
      const user = newUser()
      const entryId = await entry(user, { date: dateOf(start) })
      const ev = await cancelEvent(id, start)
      const requestId = `normal-${String(i).padStart(2, '0')}-${'c'.repeat(20)}`
      // Stagger the two (the offer does several reads first, so the customer needs a head start to win).
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const lag = [0, 3, 6, 9, 12, 16][i % 6]
      const offerJob = (async () => { if (i % 2) await wait(lag); return wl.onScheduleWritten(ev, db).then((v) => ({ offer: v.offers }), (e) => ({ offerErr: e.message })) })()
      const holdJob = (async () => { if (!(i % 2)) await wait(lag); return booking.holdSlot({ shopId: SHOP, serviceId: 'cut', barberId: 'b1', start, requestId }).then((v) => ({ held: v.status }), (e) => ({ heldErr: e.details && e.details.reason })) })()
      const results = Object.assign({}, ...(await Promise.all([offerJob, holdJob])))
      assert.equal('offerErr' in results, false, results.offerErr)
      const holds = await holdsAt('b1', start)
      assert.equal(holds.length, 1, 'exactly one hold on the slot')
      const e = await data(`waitlist/${entryId}`)
      const waitlistApts = await wlAppointments()
      const normal = await data(`appointments/${requestId}`)
      if (results.held === 'HELD') { // the customer won: no offer was made and the entry keeps waiting
        assert.equal(results.offer, 0)
        assert.equal(e.status, 'waiting')
        assert.deepEqual(waitlistApts.filter((a) => a.waitlistEntryId === entryId), [])
        assert.equal(normal.status, 'HELD')
        tally.customer++
      } else { // the entry won: the customer was told the slot is taken
        assert.equal(results.heldErr, 'SLOT_TAKEN')
        assert.equal(results.offer, 1)
        assert.equal(e.status, 'offered')
        assert.equal(waitlistApts.filter((a) => a.waitlistEntryId === entryId).length, 1)
        assert.equal(normal, undefined)
        tally.waitlist++
      }
    }
    console.log(`  (normal customer vs offer, 12 races: ${tally.customer} customer first, ${tally.waitlist} waitlist first)`)
  })
  it('a customer who holds the slot first means the waitlist gets nothing, and the entry can still be offered other time', async () => {
    const start = slotAt(2)
    const id = await booked(start)
    const entryId = await entry(newUser(), { date: dateOf(start) })
    const ev = await cancelEvent(id, start)
    await booking.holdSlot({ shopId: SHOP, serviceId: 'cut', barberId: 'b1', start, requestId: `first-${'d'.repeat(24)}` })
    assert.deepEqual(await wl.onScheduleWritten(ev, db), { offers: 0, skipped: 0 })
    assert.equal((await data(`waitlist/${entryId}`)).status, 'waiting')
    const later = await booked(start + 3 * HOUR)
    assert.equal((await wl.onScheduleWritten(await cancelEvent(later, start + 3 * HOUR), db)).offers, 1)
  })
})
