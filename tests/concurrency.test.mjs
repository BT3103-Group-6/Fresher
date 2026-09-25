// NFR-03 / NFR-05: scripted concurrent calls against the running Auth, Functions and Firestore
// emulators (`npm run test:concurrency`). Uses its own throwaway shops, so seeded data is untouched.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'

const PROJECT = 'fresher-6d857' // must match the project the emulators run functions for
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST
if (!process.env.FIRESTORE_EMULATOR_HOST || !AUTH_HOST) {
  console.error('Refusing to run: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (use `npm run test:concurrency`).')
  process.exit(1)
}
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT}/asia-southeast1`
const db = getFirestore(initializeApp({ projectId: PROJECT }))

const SG_OFFSET_MS = 8 * 3600e3
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const allWeek = Object.fromEntries(DAYS.map((d) => [d, [{ start: '00:00', end: '23:59' }]]))
const dateKey = (ms) => new Date(ms + SG_OFFSET_MS).toISOString().slice(0, 10).replaceAll('-', '')
// Tomorrow 10:00 in Singapore: always in the future and inside the 14-day horizon.
const tomorrow = Date.now() + 24 * 3600e3
const slot = (hh, mm = 0) => {
  const k = dateKey(tomorrow)
  return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), hh, mm) - SG_OFFSET_MS
}

const shopIds = []
async function makeShop(barberIds) {
  const id = `test-${randomUUID().slice(0, 8)}`
  shopIds.push(id)
  const shop = db.doc(`shops/${id}`)
  await shop.set({ name: 'Concurrency test shop', status: 'verified', tz: 'Asia/Singapore', openingHours: allWeek, noticeMins: 120 })
  await shop.collection('services').doc('cut').set({ name: 'Cut', durationMin: 30, priceCents: 2500, active: true })
  for (const b of barberIds) {
    await shop.collection('barbers').doc(b).set({ displayName: b, active: true, serviceIds: ['cut'], workingHours: allWeek })
  }
  return id
}

async function call(name, data, idToken) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const body = await res.json()
  return body.error
    ? { ok: false, status: body.error.status, reason: body.error.details && body.error.details.reason }
    : { ok: true, data: body.result }
}
const hold = (shopId, barberId, start, requestId = randomUUID()) =>
  call('holdSlot', { shopId, serviceId: 'cut', barberId, start, requestId })

// A phone-authenticated customer, through the same REST flow the Auth emulator serves to the SDK.
async function phoneIdToken(phone) {
  const base = `http://${AUTH_HOST}`
  const send = await (await fetch(`${base}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneNumber: phone, recaptchaToken: 'x' }),
  })).json()
  const { verificationCodes } = await (await fetch(`${base}/emulator/v1/projects/${PROJECT}/verificationCodes`)).json()
  const code = verificationCodes.filter((v) => v.sessionInfo === send.sessionInfo)[0].code
  const signIn = await (await fetch(`${base}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionInfo: send.sessionInfo, code }),
  })).json()
  return { idToken: signIn.idToken, uid: signIn.localId }
}

const intervalsOf = async (shopId, barberId, start) =>
  ((await db.doc(`shops/${shopId}/schedules/${barberId}_${dateKey(start)}`).get()).data() || { intervals: [] }).intervals
const count = async (collection, shopId) =>
  (await db.collection(collection).where('shopId', '==', shopId).get()).size

before(async () => {
  const probe = await hold('nope', 'b1', slot(10))
  assert.ok(!probe.ok && probe.status, 'holdSlot must be reachable on the Functions emulator (is it running with functions loaded?)')
})

after(async () => {
  for (const id of shopIds) await db.recursiveDelete(db.doc(`shops/${id}`))
  for (const c of ['appointments', 'auditLog']) {
    const snap = await db.collection(c).where('shopId', 'in', shopIds.slice(0, 30)).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
})

describe('NFR-03 booking integrity', () => {
  it('50 simultaneous holdSlot calls for one barber and slot: exactly one succeeds', async () => {
    const shopId = await makeShop(['b1'])
    const start = slot(10)
    const results = await Promise.all(Array.from({ length: 50 }, () => hold(shopId, 'b1', start)))

    const winners = results.filter((r) => r.ok)
    assert.equal(winners.length, 1, `successes: ${winners.length}`)
    const losers = results.filter((r) => !r.ok)
    assert.equal(losers.length, 49)
    assert.deepEqual([...new Set(losers.map((r) => r.reason))], ['SLOT_TAKEN'], 'every loser reports SLOT_TAKEN, never a raw error')

    const intervals = await intervalsOf(shopId, 'b1', start)
    assert.equal(intervals.length, 1)
    assert.equal(intervals[0].kind, 'hold')
    assert.equal('refId' in intervals[0], false, 'hold intervals must not expose the requestId')
    assert.equal(await count('appointments', shopId), 1)
    assert.equal(await count('auditLog', shopId), 1)
  })

  it('overlapping (not identical) simultaneous requests never both win', async () => {
    const shopId = await makeShop(['b1'])
    const starts = [slot(11, 0), slot(11, 15), slot(11, 15), slot(11, 30), slot(11, 45)] // 30-minute service
    const results = await Promise.all(starts.map((s) => hold(shopId, 'b1', s)))
    // Which request wins is a race, but the winners must never overlap and someone must win.
    const won = starts.filter((_, i) => results[i].ok).map((s) => [s, s + 30 * 60e3])
    assert.ok(won.length >= 1)
    for (const [i, x] of won.entries()) {
      for (const y of won.slice(i + 1)) assert.ok(x[1] <= y[0] || y[1] <= x[0], 'winning holds must not overlap')
    }
    assert.equal((await intervalsOf(shopId, 'b1', slot(11))).length, won.length)
  })

  it('back-to-back bookings do not conflict (half-open intervals)', async () => {
    const shopId = await makeShop(['b1'])
    assert.equal((await hold(shopId, 'b1', slot(11, 0))).ok, true) // 11:00-11:30
    assert.equal((await hold(shopId, 'b1', slot(11, 30))).ok, true) // 11:30-12:00
    assert.equal((await hold(shopId, 'b1', slot(11, 15))).reason, 'SLOT_TAKEN') // overlaps both
    assert.equal((await hold(shopId, 'b1', slot(10, 45))).reason, 'SLOT_TAKEN') // overlaps the first
  })

  it('"any available" with 3 barbers and 50 simultaneous calls: exactly 3 succeed, on 3 different barbers', async () => {
    const shopId = await makeShop(['b1', 'b2', 'b3'])
    const start = slot(12)
    const results = await Promise.all(Array.from({ length: 50 }, () => hold(shopId, 'any', start)))
    const winners = results.filter((r) => r.ok)
    assert.equal(winners.length, 3)
    assert.deepEqual(winners.map((w) => w.data.barberId).sort(), ['b1', 'b2', 'b3'])
    assert.deepEqual([...new Set(results.filter((r) => !r.ok).map((r) => r.reason))], ['SLOT_TAKEN'])
  })

  it('"any available" picks the barber with the fewest bookings that day, then the lowest barberId', async () => {
    const shopId = await makeShop(['b1', 'b2'])
    assert.equal((await hold(shopId, 'b1', slot(9))).ok, true) // b1 now has one booking
    const next = await hold(shopId, 'any', slot(15))
    assert.equal(next.data.barberId, 'b2')
    const tie = await hold(shopId, 'any', slot(16)) // one each, so tie goes to b1
    assert.equal(tie.data.barberId, 'b1')
  })

  it('ignores an expired hold and reuses the slot', async () => {
    const shopId = await makeShop(['b1'])
    const start = slot(13)
    const past = Timestamp.fromMillis(Date.now() - 60e3)
    await db.doc(`shops/${shopId}/schedules/b1_${dateKey(start)}`).set({
      intervals: [{ start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 30 * 60e3), kind: 'hold', holdExpiresAt: past }],
    })
    const r = await hold(shopId, 'b1', start)
    assert.equal(r.ok, true)
    const intervals = await intervalsOf(shopId, 'b1', start)
    assert.equal(intervals.length, 1, 'the expired hold is pruned when the new one is written')
    assert.ok(intervals[0].holdExpiresAt.toMillis() > Date.now())
  })

  it('respects personal time blocks', async () => {
    const shopId = await makeShop(['b1'])
    const start = slot(14)
    await db.doc(`shops/${shopId}/schedules/b1_${dateKey(start)}`).set({
      intervals: [{ start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + 60 * 60e3), kind: 'block' }],
    })
    const r = await hold(shopId, 'b1', slot(14, 30))
    assert.equal(r.reason, 'SLOT_TAKEN')
  })

  it('computes the end time from the stored service duration, not from the client', async () => {
    const shopId = await makeShop(['b1'])
    const r = await call('holdSlot', { shopId, serviceId: 'cut', barberId: 'b1', start: slot(10), requestId: randomUUID(), end: slot(18), durationMin: 5 })
    assert.equal(r.data.end - r.data.start, 30 * 60e3)
    assert.equal(r.data.priceCents, 2500)
  })

  it('rejects bad input without touching the schedule', async () => {
    const shopId = await makeShop(['b1'])
    assert.equal((await hold(shopId, 'b1', slot(10, 7))).status, 'INVALID_ARGUMENT') // off the 15-minute grid
    assert.equal((await hold(shopId, 'b1', Date.now() - 3600e3)).status, 'INVALID_ARGUMENT') // in the past
    assert.equal((await hold(shopId, 'b1', slot(10) + 20 * 24 * 3600e3)).status, 'INVALID_ARGUMENT') // beyond the horizon
    assert.equal((await hold(shopId, 'b1', slot(10), 'short')).status, 'INVALID_ARGUMENT')
    assert.equal((await hold(shopId, 'ghost', slot(10))).status, 'INVALID_ARGUMENT')
    assert.equal((await hold('no-such-shop', 'b1', slot(10))).status, 'NOT_FOUND')
    assert.equal((await intervalsOf(shopId, 'b1', slot(10))).length, 0)
  })
})

describe('NFR-05 repeated submissions', () => {
  it('100 submissions of the same requestId create at most one appointment and return identical results', async () => {
    const shopId = await makeShop(['b1'])
    const start = slot(10)
    const requestId = randomUUID()
    const results = await Promise.all(Array.from({ length: 100 }, () => hold(shopId, 'b1', start, requestId)))
    assert.ok(results.every((r) => r.ok), 'a replay is never an error')
    assert.equal(new Set(results.map((r) => JSON.stringify(r.data))).size, 1)
    assert.equal(await count('appointments', shopId), 1)
    assert.equal(await count('auditLog', shopId), 1)
    assert.equal((await intervalsOf(shopId, 'b1', start)).length, 1)
  })
})

describe('confirmBooking and releaseHold', () => {
  it('rejects confirmation without a verified phone', async () => {
    const shopId = await makeShop(['b1'])
    const { data } = await hold(shopId, 'b1', slot(10))
    const r = await call('confirmBooking', { requestId: data.requestId, displayName: 'Ali' })
    assert.equal(r.status, 'UNAUTHENTICATED')
    assert.equal((await db.doc(`appointments/${data.requestId}`).get()).data().status, 'HELD')
  })

  it('confirms once: sets customer, masked phone, booking interval and audit records', async () => {
    const shopId = await makeShop(['b1'])
    const start = slot(10)
    const { data } = await hold(shopId, 'b1', start)
    const { idToken, uid } = await phoneIdToken('+6591234567')

    const r = await call('confirmBooking', { requestId: data.requestId, displayName: '  Ali  ' }, idToken)
    assert.equal(r.ok, true)
    assert.equal(r.data.status, 'CONFIRMED')

    const apt = (await db.doc(`appointments/${data.requestId}`).get()).data()
    assert.equal(apt.status, 'CONFIRMED')
    assert.equal(apt.customerId, uid)
    assert.equal(apt.customerName, 'Ali')
    assert.equal(apt.customerPhoneMasked, '+65 9••• ••67')
    assert.equal(JSON.stringify(apt).includes('91234567'), false, 'the full number is never stored on the appointment')
    assert.equal((await db.doc(`customers/${uid}`).get()).data().phoneE164, '+6591234567')

    const intervals = await intervalsOf(shopId, 'b1', start)
    assert.equal(intervals.length, 1)
    assert.equal(intervals[0].kind, 'booking')
    assert.equal(intervals[0].refId, data.requestId)

    const audit = await db.collection('auditLog').where('shopId', '==', shopId).get()
    assert.deepEqual(audit.docs.map((d) => `${d.data().fromStatus}>${d.data().toStatus}`).sort(), ['HELD>CONFIRMED', 'null>HELD'])
    assert.ok(audit.docs.every((d) => d.data().expireAt.toMillis() > Date.now() + 300 * 24 * 3600e3))

    // Retrying the same confirmation is idempotent; another customer cannot take it over.
    assert.equal((await call('confirmBooking', { requestId: data.requestId, displayName: 'Ali' }, idToken)).ok, true)
    const other = await phoneIdToken('+6598765432')
    const stolen = await call('confirmBooking', { requestId: data.requestId, displayName: 'Mallory' }, other.idToken)
    assert.equal(stolen.reason, 'HOLD_ALREADY_USED')
    assert.equal((await db.doc(`appointments/${data.requestId}`).get()).data().customerId, uid)
    assert.equal((await hold(shopId, 'b1', start)).reason, 'SLOT_TAKEN', 'a confirmed booking blocks the slot')
  })

  it('rejects a non-Singapore mobile and an invalid name', async () => {
    const shopId = await makeShop(['b1'])
    const { data } = await hold(shopId, 'b1', slot(10))
    const foreign = await phoneIdToken('+14155550101')
    assert.equal((await call('confirmBooking', { requestId: data.requestId, displayName: 'Ali' }, foreign.idToken)).status, 'PERMISSION_DENIED')
    const sg = await phoneIdToken('+6591111111')
    assert.equal((await call('confirmBooking', { requestId: data.requestId, displayName: '   ' }, sg.idToken)).status, 'INVALID_ARGUMENT')
  })

  it('refuses to confirm an expired hold, marks it EXPIRED and frees the slot', async () => {
    const shopId = await makeShop(['b1'])
    const start = slot(10)
    const { data } = await hold(shopId, 'b1', start)
    // Age the hold by 11 minutes in both places it is recorded.
    const past = Timestamp.fromMillis(Date.now() - 60e3)
    await db.doc(`appointments/${data.requestId}`).update({ holdExpiresAt: past })
    const schedRef = db.doc(`shops/${shopId}/schedules/b1_${dateKey(start)}`)
    const sched = (await schedRef.get()).data()
    await schedRef.update({ intervals: sched.intervals.map((i) => ({ ...i, holdExpiresAt: past })) })

    const { idToken } = await phoneIdToken('+6591234567')
    const r = await call('confirmBooking', { requestId: data.requestId, displayName: 'Ali' }, idToken)
    assert.equal(r.reason, 'HOLD_EXPIRED')
    assert.equal((await db.doc(`appointments/${data.requestId}`).get()).data().status, 'EXPIRED')
    assert.equal((await intervalsOf(shopId, 'b1', start)).length, 0)
    assert.equal((await call('confirmBooking', { requestId: data.requestId, displayName: 'Ali' }, idToken)).reason, 'HOLD_EXPIRED')
  })

  it('releaseHold frees the slot, is idempotent, and cannot release a confirmed booking', async () => {
    const shopId = await makeShop(['b1'])
    const start = slot(10)
    const { data } = await hold(shopId, 'b1', start)
    assert.deepEqual((await call('releaseHold', { requestId: data.requestId })).data, { released: true })
    assert.equal((await db.doc(`appointments/${data.requestId}`).get()).data().status, 'EXPIRED')
    assert.equal((await intervalsOf(shopId, 'b1', start)).length, 0)
    assert.deepEqual((await call('releaseHold', { requestId: data.requestId })).data, { released: false })
    assert.equal((await hold(shopId, 'b1', start)).ok, true, 'the released slot can be booked again')

    const other = await hold(shopId, 'b1', slot(11))
    const { idToken } = await phoneIdToken('+6591234567')
    await call('confirmBooking', { requestId: other.data.requestId, displayName: 'Ali' }, idToken)
    assert.deepEqual((await call('releaseHold', { requestId: other.data.requestId })).data, { released: false })
    assert.equal((await db.doc(`appointments/${other.data.requestId}`).get()).data().status, 'CONFIRMED')
  })

  it('50 simultaneous confirmations of one hold by different customers: exactly one wins', async () => {
    const shopId = await makeShop(['b1'])
    const { data } = await hold(shopId, 'b1', slot(10))
    const users = await Promise.all(Array.from({ length: 50 }, (_, i) => phoneIdToken(`+659${String(1000000 + i)}`)))
    const results = await Promise.all(users.map((u, i) =>
      call('confirmBooking', { requestId: data.requestId, displayName: `C${i}` }, u.idToken)))
    assert.equal(results.filter((r) => r.ok).length, 1)
    assert.deepEqual([...new Set(results.filter((r) => !r.ok).map((r) => r.reason))], ['HOLD_ALREADY_USED'])
    assert.equal((await intervalsOf(shopId, 'b1', slot(10))).length, 1)
  })
})
