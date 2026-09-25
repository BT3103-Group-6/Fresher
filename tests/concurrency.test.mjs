// NFR-03 / NFR-05: scripted concurrent calls against the running Auth, Functions and Firestore
// emulators (`npm run test:concurrency`). Uses its own throwaway shops, so seeded data is untouched.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'

const PROJECT = 'fresher-6d857' // must match the project the emulators run functions for
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST
if (!process.env.FIRESTORE_EMULATOR_HOST || !AUTH_HOST) {
  console.error('Refusing to run: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (use `npm run test:concurrency`).')
  process.exit(1)
}
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT}/asia-southeast1`
const app = initializeApp({ projectId: PROJECT })
const db = getFirestore(app)

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
async function makeShop(barberIds, extra = {}) {
  const id = `test-${randomUUID().slice(0, 8)}`
  shopIds.push(id)
  const shop = db.doc(`shops/${id}`)
  await shop.set({ name: 'Concurrency test shop', status: 'verified', tz: 'Asia/Singapore', openingHours: allWeek, noticeMins: 120, latePolicy: 'block', ...extra })
  await shop.collection('services').doc('cut').set({ name: 'Cut', durationMin: 30, priceCents: 2500, active: true })
  for (const b of barberIds) {
    await shop.collection('barbers').doc(b).set({ displayName: b, active: true, serviceIds: ['cut'], workingHours: allWeek })
  }
  return id
}

// Transport failures (the Functions emulator resetting a connection or timing out under 50 concurrent cold
// workers and Firestore lock timeouts) are not callable responses: they carry neither `result` nor `error`.
// They must never be read as success, so a response is accepted only if it is a real callable envelope.
// The calls under test are idempotent, so a client would retry the same request; we do too, and report it.
const transportFailures = []
const MAX_TRANSPORT_RETRIES = 3
async function call(name, data, idToken) {
  for (let attempt = 0; ; attempt++) {
    let status = 0
    let text = ''
    let body = null
    try {
      const res = await fetch(`${FUNCTIONS}/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify({ data }),
      })
      status = res.status
      text = await res.text()
      body = JSON.parse(text)
    } catch { /* body stays null: not a callable response */ }
    if (body && (body.error || 'result' in body)) {
      return body.error
        ? { ok: false, status: body.error.status, reason: body.error.details && body.error.details.reason }
        : { ok: true, data: body.result }
    }
    transportFailures.push(`${name} attempt ${attempt + 1}: HTTP ${status} ${text.slice(0, 120)}`)
    if (attempt >= MAX_TRANSPORT_RETRIES) throw new Error(`${name}: no callable response after ${attempt + 1} tries (HTTP ${status} ${text.slice(0, 120)})`)
  }
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
  if (transportFailures.length) {
    console.log(`NOTE: ${transportFailures.length} emulator transport failure(s) were retried (never counted as results):`)
    for (const f of transportFailures.slice(0, 10)) console.log(`  ${f}`)
  }
  for (const id of shopIds) await db.recursiveDelete(db.doc(`shops/${id}`))
  for (let i = 0; i < shopIds.length; i += 30) { // Firestore allows 30 values per "in"
    for (const c of ['appointments', 'auditLog']) {
      const snap = await db.collection(c).where('shopId', 'in', shopIds.slice(i, i + 30)).get()
      await Promise.all(snap.docs.map((d) => d.ref.delete()))
    }
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

// ---- FR-04 / FR-05: cancelBooking and reschedule ----

let phoneSeq = 0
const newPhone = () => `+659${String(3000000 + phoneSeq++)}`
const MIN = 60e3
const DAY = 24 * 3600e3

/** Books a CONFIRMED appointment through holdSlot and confirmBooking as a fresh phone customer. */
async function book(shopId, barberId, start) {
  const held = await hold(shopId, barberId, start)
  assert.ok(held.ok, `hold failed: ${held.reason}`)
  const user = await phoneIdToken(newPhone())
  const r = await call('confirmBooking', { requestId: held.data.requestId, displayName: 'Test' }, user.idToken)
  assert.ok(r.ok, `confirm failed: ${r.reason}`)
  return { requestId: held.data.requestId, ...user }
}

/** Writes a CONFIRMED appointment directly, for starts too soon for holdSlot's future checks to matter. */
async function seedBooking(shopId, barberId, start, uid) {
  const requestId = randomUUID()
  const s = Timestamp.fromMillis(start)
  const e = Timestamp.fromMillis(start + 30 * MIN)
  await db.doc(`appointments/${requestId}`).set({
    requestId, shopId, barberId, serviceId: 'cut', customerId: uid, customerName: 'Seed', customerPhoneMasked: '+65 9••• ••00',
    start: s, end: e, status: 'CONFIRMED', holdExpiresAt: null, priceCents: 2500, durationMin: 30,
  })
  await db.doc(`shops/${shopId}/schedules/${barberId}_${dateKey(start)}`).set({
    barberId, date: dateKey(start), intervals: [{ start: s, end: e, kind: 'booking', refId: requestId }],
  })
  return requestId
}

async function staffToken(claims) {
  const email = `${randomUUID().slice(0, 8)}@test.example`
  const user = await getAuth(app).createUser({ email, password: 'password123' })
  await getAuth(app).setCustomUserClaims(user.uid, claims)
  const res = await (await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  })).json()
  return res.idToken
}

const apt = async (id) => (await db.doc(`appointments/${id}`).get()).data()
const lateCancels = async (shopId, uid) => (await db.doc(`customers/${uid}/shopStats/${shopId}`).get()).data()?.lateCancels ?? 0
const audit = async (shopId, bookingId) =>
  (await db.collection('auditLog').where('shopId', '==', shopId).where('bookingId', '==', bookingId).get()).docs.map((d) => d.data())
const actions = async (shopId, bookingId) => (await audit(shopId, bookingId)).map((a) => a.action).sort()
const covering = (intervals, start) => intervals.filter((iv) => iv.start.toMillis() < start + 30 * MIN && start < iv.end.toMillis())
const cancel = (requestId, idToken) => call('cancelBooking', { requestId }, idToken)
const move = (requestId, newStart, idToken) => call('reschedule', { requestId, newStart }, idToken)

describe('audit actions', () => {
  it('records hold, confirm and release with an action', async () => {
    const shopId = await makeShop(['b1'])
    const a = await book(shopId, 'b1', slot(10))
    assert.deepEqual(await actions(shopId, a.requestId), ['confirm', 'hold'])
    const h = await hold(shopId, 'b1', slot(11))
    await call('releaseHold', { requestId: h.data.requestId })
    assert.deepEqual(await actions(shopId, h.data.requestId), ['hold', 'release'])
  })
})

describe('FR-04 reschedule', () => {
  it('moves a booking to another day atomically, keeps snapshots, audits once, and replays idempotently', async () => {
    const shopId = await makeShop(['b1'])
    const from = slot(10)
    const to = slot(14) + DAY
    const a = await book(shopId, 'b1', from)

    const r = await move(a.requestId, to, a.idToken)
    assert.equal(r.ok, true)
    assert.equal(r.data.start, to)
    const doc = await apt(a.requestId)
    assert.equal(doc.start.toMillis(), to)
    assert.equal(doc.end.toMillis() - to, 30 * MIN)
    assert.equal(doc.priceCents, 2500)
    assert.equal(doc.status, 'CONFIRMED')
    assert.equal((await intervalsOf(shopId, 'b1', from)).length, 0, 'the original slot is released')
    const now = await intervalsOf(shopId, 'b1', to)
    assert.equal(now.length, 1)
    assert.deepEqual([now[0].kind, now[0].refId], ['booking', a.requestId])
    assert.equal((await hold(shopId, 'b1', from)).ok, true, 'the released slot is immediately bookable')

    assert.equal((await move(a.requestId, to, a.idToken)).ok, true, 'a retry is a replay, not an error')
    assert.deepEqual(await actions(shopId, a.requestId), ['confirm', 'hold', 'reschedule'])
    const rec = (await audit(shopId, a.requestId)).find((x) => x.action === 'reschedule')
    assert.deepEqual([rec.fromStatus, rec.toStatus, rec.role], ['CONFIRMED', 'CONFIRMED', 'customer'])
  })

  it('lets a booking shift into time that overlaps its own current slot', async () => {
    const shopId = await makeShop(['b1'])
    const a = await book(shopId, 'b1', slot(10))
    assert.equal((await move(a.requestId, slot(10, 15), a.idToken)).ok, true)
    const intervals = await intervalsOf(shopId, 'b1', slot(10))
    assert.equal(intervals.length, 1)
    assert.equal(intervals[0].start.toMillis(), slot(10, 15))
  })

  it('leaves the original untouched when the new slot is taken', async () => {
    const shopId = await makeShop(['b1'])
    const a = await book(shopId, 'b1', slot(10))
    await book(shopId, 'b1', slot(11))
    const r = await move(a.requestId, slot(11, 15), a.idToken)
    assert.equal(r.reason, 'SLOT_TAKEN')
    assert.equal((await apt(a.requestId)).start.toMillis(), slot(10))
    const intervals = await intervalsOf(shopId, 'b1', slot(10))
    assert.equal(intervals.length, 2)
    assert.ok(intervals.some((iv) => iv.refId === a.requestId && iv.start.toMillis() === slot(10)))
    assert.deepEqual(await actions(shopId, a.requestId), ['confirm', 'hold'], 'a failed reschedule writes no audit record')
  })

  for (const mode of ['same day', 'next day']) {
    it(`reschedule racing 8 new bookings for the same slot (${mode}): the slot has exactly one owner and the original stands if it loses`, async () => {
      for (let round = 0; round < 8; round++) {
        const shopId = await makeShop(['b1'])
        const from = slot(10)
        const target = mode === 'same day' ? slot(11) : slot(11) + DAY
        const a = await book(shopId, 'b1', from)

        const [re, ...holds] = await Promise.all([
          move(a.requestId, target, a.idToken),
          ...Array.from({ length: 8 }, () => hold(shopId, 'b1', target)),
        ])
        const winners = holds.filter((h) => h.ok)
        assert.ok(holds.every((h) => h.ok || h.reason === 'SLOT_TAKEN'), 'holdSlot losers report SLOT_TAKEN only')
        assert.equal(covering(await intervalsOf(shopId, 'b1', target), target).length, 1, `round ${round}: one owner of the target slot`)

        const doc = await apt(a.requestId)
        const origin = await intervalsOf(shopId, 'b1', from)
        if (re.ok) {
          assert.equal(winners.length, 0, 'the reschedule won, so no hold can have')
          assert.equal(doc.start.toMillis(), target)
          assert.equal(covering(origin, from).length, 0, 'the old slot is released')
          const owner = covering(await intervalsOf(shopId, 'b1', target), target)[0]
          assert.deepEqual([owner.kind, owner.refId], ['booking', a.requestId])
          assert.equal(await count('appointments', shopId), 1)
        } else {
          assert.equal(re.reason, 'SLOT_TAKEN')
          assert.equal(winners.length, 1, 'a hold won the slot')
          assert.equal(doc.start.toMillis(), from, 'the original booking is unchanged')
          assert.equal(doc.status, 'CONFIRMED')
          assert.ok(origin.some((iv) => iv.kind === 'booking' && iv.refId === a.requestId && iv.start.toMillis() === from))
          assert.deepEqual(await actions(shopId, a.requestId), ['confirm', 'hold'])
        }
      }
    })
  }

  it('two customers rescheduling into the same slot: exactly one wins, the other keeps their booking', async () => {
    const shopId = await makeShop(['b1'])
    const a = await book(shopId, 'b1', slot(10))
    const b = await book(shopId, 'b1', slot(12))
    const target = slot(14)
    const results = await Promise.all([move(a.requestId, target, a.idToken), move(b.requestId, target, b.idToken)])
    assert.equal(results.filter((r) => r.ok).length, 1)
    assert.equal(results.find((r) => !r.ok).reason, 'SLOT_TAKEN')
    const [loser, from] = results[0].ok ? [b, slot(12)] : [a, slot(10)]
    assert.equal((await apt(loser.requestId)).start.toMillis(), from)
    const all = await intervalsOf(shopId, 'b1', target)
    assert.equal(all.length, 2)
    assert.equal(covering(all, target).length, 1)
  })

  it('cancel racing reschedule on one booking ends consistent: cancelled, no interval anywhere', async () => {
    for (let round = 0; round < 6; round++) {
      const shopId = await makeShop(['b1'])
      const a = await book(shopId, 'b1', slot(10))
      const target = slot(12) + DAY
      const [c, m] = await Promise.all([cancel(a.requestId, a.idToken), move(a.requestId, target, a.idToken)])
      assert.equal(c.ok, true)
      assert.ok(m.ok || m.reason === 'NOT_RESCHEDULABLE', `unexpected reschedule outcome ${m.reason}`)
      assert.equal((await apt(a.requestId)).status, 'CANCELLED')
      assert.equal((await intervalsOf(shopId, 'b1', slot(10))).length, 0)
      assert.equal((await intervalsOf(shopId, 'b1', target)).length, 0)
    }
  })

  it('rejects other customers, anonymous callers, bad times, late changes and deactivated barbers, changing nothing', async () => {
    const shopId = await makeShop(['b1'])
    const a = await book(shopId, 'b1', slot(10))
    const other = await phoneIdToken(newPhone())
    assert.equal((await move(a.requestId, slot(12), other.idToken)).reason, 'BOOKING_NOT_FOUND')
    assert.equal((await move(a.requestId, slot(12))).status, 'UNAUTHENTICATED')
    assert.equal((await move(a.requestId, slot(12, 7), a.idToken)).status, 'INVALID_ARGUMENT')
    assert.equal((await move(a.requestId, Date.now() - 3600e3, a.idToken)).status, 'INVALID_ARGUMENT')
    assert.equal((await move(a.requestId, slot(10) + 20 * DAY, a.idToken)).status, 'INVALID_ARGUMENT')

    await db.doc(`shops/${shopId}/barbers/b1`).update({ active: false })
    assert.equal((await move(a.requestId, slot(12), a.idToken)).status, 'INVALID_ARGUMENT')
    await db.doc(`shops/${shopId}/barbers/b1`).update({ active: true })
    assert.equal((await apt(a.requestId)).start.toMillis(), slot(10))

    const cust = await phoneIdToken(newPhone())
    const soon = await seedBooking(shopId, 'b1', Date.now() + 30 * MIN, cust.uid)
    assert.equal((await move(soon, slot(15), cust.idToken)).reason, 'LATE_CHANGE')
    assert.equal(await lateCancels(shopId, cust.uid), 0, 'a late reschedule does not count as a late cancel')
    assert.equal((await apt(soon)).start.toMillis() < slot(15), true)
  })
})

describe('FR-05 cancelBooking', () => {
  it('cancels outside the notice window: frees the slot, not late, audited', async () => {
    const shopId = await makeShop(['b1'])
    const a = await book(shopId, 'b1', slot(10))
    const r = await cancel(a.requestId, a.idToken)
    assert.equal(r.ok, true)
    const doc = await apt(a.requestId)
    assert.deepEqual([doc.status, doc.lateCancel], ['CANCELLED', false])
    assert.equal((await intervalsOf(shopId, 'b1', slot(10))).length, 0)
    assert.equal(await lateCancels(shopId, a.uid), 0)
    assert.deepEqual(await actions(shopId, a.requestId), ['cancel', 'confirm', 'hold'])
    assert.equal((await hold(shopId, 'b1', slot(10))).ok, true, 'the released slot returns to the pool immediately')
  })

  it('20 simultaneous cancels change state once', async () => {
    const shopId = await makeShop(['b1'], { latePolicy: 'flag' })
    const cust = await phoneIdToken(newPhone())
    const id = await seedBooking(shopId, 'b1', Date.now() + 30 * MIN, cust.uid) // late, so a double count would show
    const results = await Promise.all(Array.from({ length: 20 }, () => cancel(id, cust.idToken)))
    assert.ok(results.every((r) => r.ok))
    assert.equal((await actions(shopId, id)).filter((x) => x === 'cancel').length, 1)
    assert.equal(await lateCancels(shopId, cust.uid), 1)
  })

  it('block policy: a late cancel is refused, the booking stands, and repeated attempts count once in total', async () => {
    const shopId = await makeShop(['b1'], { latePolicy: 'block' })
    const cust = await phoneIdToken(newPhone())
    const start = Date.now() + 30 * MIN
    const id = await seedBooking(shopId, 'b1', start, cust.uid)

    const first = await cancel(id, cust.idToken)
    assert.equal(first.reason, 'LATE_CANCEL_BLOCKED')
    assert.equal(await lateCancels(shopId, cust.uid), 1)
    assert.equal((await apt(id)).lateCancelAttempted, true)

    const rest = await Promise.all(Array.from({ length: 10 }, () => cancel(id, cust.idToken)))
    assert.ok(rest.every((r) => r.reason === 'LATE_CANCEL_BLOCKED'))
    assert.equal(await lateCancels(shopId, cust.uid), 1, 'repeated attempts are +1 in total, not +1 each')

    const doc = await apt(id)
    assert.equal(doc.status, 'CONFIRMED')
    assert.equal(doc.lateCancel, undefined)
    assert.equal((await intervalsOf(shopId, 'b1', start)).length, 1, 'the slot is not released')
    const acts = await actions(shopId, id)
    assert.equal(acts.length, 11, 'every refused attempt is audited')
    assert.ok(acts.every((x) => x === 'lateCancelRefused'))
    const rec = (await audit(shopId, id))[0]
    assert.deepEqual([rec.fromStatus, rec.toStatus], ['CONFIRMED', 'CONFIRMED'])
  })

  it('flag policy: a late cancel proceeds, is flagged, and counts once', async () => {
    const shopId = await makeShop(['b1'], { latePolicy: 'flag' })
    const cust = await phoneIdToken(newPhone())
    const start = Date.now() + 30 * MIN
    const id = await seedBooking(shopId, 'b1', start, cust.uid)
    assert.equal((await cancel(id, cust.idToken)).ok, true)
    const doc = await apt(id)
    assert.deepEqual([doc.status, doc.lateCancel], ['CANCELLED', true])
    assert.equal(await lateCancels(shopId, cust.uid), 1)
    assert.equal((await intervalsOf(shopId, 'b1', start)).length, 0)
    assert.equal((await cancel(id, cust.idToken)).ok, true, 'a retry is a replay')
    assert.equal(await lateCancels(shopId, cust.uid), 1)
    assert.deepEqual(await actions(shopId, id), ['cancel'])
  })

  it('applies the shop\'s own noticeMins either side of the boundary', async () => {
    const shopId = await makeShop(['b1'], { noticeMins: 60, latePolicy: 'block' })
    const cust = await phoneIdToken(newPhone())
    const inside = await seedBooking(shopId, 'b1', Date.now() + 60 * MIN - 90e3, cust.uid)
    const outside = await seedBooking(shopId, 'b1', Date.now() + 60 * MIN + 90e3 + 40 * MIN, cust.uid)
    assert.equal((await cancel(inside, cust.idToken)).reason, 'LATE_CANCEL_BLOCKED')
    assert.equal((await cancel(outside, cust.idToken)).ok, true)
    assert.equal((await apt(outside)).lateCancel, false)
  })

  it('refuses a customer cancelling an appointment that has already started, without counting it', async () => {
    const shopId = await makeShop(['b1'])
    const cust = await phoneIdToken(newPhone())
    const id = await seedBooking(shopId, 'b1', Date.now() - 5 * MIN, cust.uid)
    assert.equal((await cancel(id, cust.idToken)).reason, 'ALREADY_STARTED')
    assert.equal(await lateCancels(shopId, cust.uid), 0)
    assert.equal((await apt(id)).status, 'CONFIRMED')
  })

  it('staff cancellations are never late and never count against the customer', async () => {
    const shopId = await makeShop(['b1', 'b2'], { latePolicy: 'block' })
    const cust = await phoneIdToken(newPhone())
    const owner = await staffToken({ shopId, role: 'owner' })
    const barber = await staffToken({ shopId, role: 'barber', barberId: 'b1' })
    const start = Date.now() + 20 * MIN

    const byOwner = await seedBooking(shopId, 'b1', start, cust.uid)
    assert.equal((await cancel(byOwner, owner)).ok, true)
    const byBarber = await seedBooking(shopId, 'b1', start + 40 * MIN, cust.uid)
    assert.equal((await cancel(byBarber, barber)).ok, true)
    for (const id of [byOwner, byBarber]) {
      const doc = await apt(id)
      assert.deepEqual([doc.status, doc.lateCancel], ['CANCELLED', false])
    }
    assert.equal(await lateCancels(shopId, cust.uid), 0)
    assert.deepEqual((await audit(shopId, byOwner)).map((a) => [a.action, a.role]), [['cancel', 'owner']])
    assert.deepEqual((await audit(shopId, byBarber)).map((a) => [a.action, a.role]), [['cancel', 'barber']])
  })

  it('rejects staff of another shop, another barber, other customers and anonymous callers', async () => {
    const shopId = await makeShop(['b1', 'b2'])
    const otherShop = await makeShop(['b1'])
    const cust = await phoneIdToken(newPhone())
    const id = await seedBooking(shopId, 'b1', slot(10), cust.uid)
    const stranger = await phoneIdToken(newPhone())
    const tokens = [
      await staffToken({ shopId: otherShop, role: 'owner' }),
      await staffToken({ shopId, role: 'barber', barberId: 'b2' }),
      stranger.idToken,
    ]
    for (const t of tokens) assert.equal((await cancel(id, t)).reason, 'BOOKING_NOT_FOUND')
    assert.equal((await cancel(id)).status, 'UNAUTHENTICATED')
    assert.equal((await apt(id)).status, 'CONFIRMED')
    assert.equal((await intervalsOf(shopId, 'b1', slot(10))).length, 1)
  })
})

// FR-08: personal time blocks (decisions A12). A block is written on the same barber-day schedule doc that
// holdSlot locks, so a block and a hold for the same time serialise: whichever commits second either
// sees the other (hold -> SLOT_TAKEN) or reports it (block -> conflict). Nothing is ever cancelled.
describe('FR-08 personal time blocks', () => {
  const block = (token, extra = {}) =>
    call('createBlock', { blockId: randomUUID(), start: slot(10), end: slot(11), ...extra }, token)
  const unblock = (token, blockId) => call('removeBlock', { blockId }, token)
  const blockDocs = async (shopId) => (await db.collection(`shops/${shopId}/blocks`).get()).docs
  const kind = (intervals, k) => intervals.filter((iv) => iv.kind === k)
  const overlapsWindow = (iv, s, e) => iv.start.toMillis() < e && s < iv.end.toMillis()

  it('a block racing simultaneous holds: every hold either wins before the block and is reported, or loses with SLOT_TAKEN', async () => {
    const shopId = await makeShop(['b1', 'b2', 'b3'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const [from, to] = [slot(10), slot(11)]
    const offsets = [-30, -15, 0, 0, 15, 15, 30, 30, 60] // minutes from 10:00; -30 and 60 do not overlap the block
    for (const barberId of ['b1', 'b2', 'b3']) {
      const calls = offsets.map((o) => hold(shopId, barberId, from + o * MIN))
      const [blockRes, ...holds] = await Promise.all([block(owner, { barberId }), ...calls])
      assert.equal(blockRes.ok, true, `createBlock failed: ${blockRes.reason ?? blockRes.status}`)

      const intervals = await intervalsOf(shopId, barberId, from)
      assert.equal(kind(intervals, 'block').length, 1, 'exactly one block interval')
      assert.equal(kind(intervals, 'block')[0].refId, blockRes.data.blockId)

      const winners = holds.map((h, i) => ({ h, start: from + offsets[i] * MIN })).filter((x) => x.h.ok)
      const overlapping = winners.filter((w) => w.start < to && from < w.start + 30 * MIN)
      const reported = blockRes.data.conflicts
      assert.ok(reported.every((c) => c.kind === 'hold'))
      assert.equal(reported.length, overlapping.length, 'every hold that beat the block is reported, and only those')
      assert.deepEqual(reported.map((c) => c.start).sort(), overlapping.map((w) => w.start).sort())
      // Holds that lost did so cleanly, and holds outside the block are unaffected by it.
      for (const [i, h] of holds.entries()) {
        if (h.ok) continue
        assert.equal(h.reason, 'SLOT_TAKEN', `hold at ${offsets[i]} min failed for a reason other than SLOT_TAKEN`)
      }
      // The final schedule has no double booking among holds either.
      const holdIntervals = kind(intervals, 'hold')
      for (const [i, a] of holdIntervals.entries()) {
        for (const b of holdIntervals.slice(i + 1)) assert.equal(overlapsWindow(a, b.start.toMillis(), b.end.toMillis()), false)
      }
      assert.equal(holdIntervals.filter((iv) => overlapsWindow(iv, from, to)).length, overlapping.length)
      assert.equal(await count('appointments', shopId) >= winners.length, true)
    }
    assert.equal((await blockDocs(shopId)).length, 3)
  })

  it('20 simultaneous createBlock calls with one blockId leave one block, and all report the same block', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const blockId = randomUUID()
    const results = await Promise.all(Array.from({ length: 20 }, () => block(owner, { blockId, barberId: 'b1' })))
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.find((r) => !r.ok)))
    assert.equal(new Set(results.map((r) => JSON.stringify(r.data))).size, 1)
    assert.equal((await blockDocs(shopId)).length, 1)
    assert.equal(kind(await intervalsOf(shopId, 'b1', slot(10)), 'block').length, 1)
  })

  it('rejects a reused blockId with different parameters, changing nothing', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const blockId = randomUUID()
    assert.equal((await block(owner, { blockId, barberId: 'b1' })).ok, true)
    const r = await block(owner, { blockId, barberId: 'b1', end: slot(12) })
    assert.equal(r.status, 'INVALID_ARGUMENT')
    const [doc] = await blockDocs(shopId)
    assert.equal(doc.data().end.toMillis(), slot(11))
  })

  it('two simultaneous overlapping blocks: exactly one wins, the other gets BLOCK_OVERLAP; adjacent blocks are fine', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const rs = await Promise.all([
      block(owner, { barberId: 'b1', start: slot(10), end: slot(11) }),
      block(owner, { barberId: 'b1', start: slot(10, 30), end: slot(11, 30) }),
      block(owner, { barberId: 'b1', start: slot(10, 45), end: slot(12) }),
    ])
    assert.equal(rs.filter((r) => r.ok).length, 1)
    for (const r of rs.filter((x) => !x.ok)) assert.equal(r.reason, 'BLOCK_OVERLAP')
    assert.equal((await blockDocs(shopId)).length, 1)
    assert.equal(kind(await intervalsOf(shopId, 'b1', slot(10)), 'block').length, 1)
    // Back-to-back with the winner (half-open) is allowed.
    const winner = (await blockDocs(shopId))[0].data()
    const after = await block(owner, { barberId: 'b1', start: winner.end.toMillis(), end: winner.end.toMillis() + 30 * MIN })
    assert.equal(after.ok, true)
  })

  it('never cancels or moves bookings and holds under a block: reports them, ignores expired holds, writes no audit', async () => {
    const shopId = await makeShop(['b1', 'b2'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const cust = await phoneIdToken(newPhone())
    const booked = await seedBooking(shopId, 'b1', slot(10), cust.uid)
    const held = await hold(shopId, 'b1', slot(10, 30))
    assert.equal(held.ok, true)
    const auditBefore = await count('auditLog', shopId)

    const r = await block(owner, { barberId: 'b1', reason: '  Dentist  ' })
    assert.equal(r.ok, true)
    assert.equal(r.data.reason, 'Dentist')
    assert.deepEqual(r.data.conflicts.map((c) => c.kind), ['booking', 'hold'])
    assert.deepEqual(r.data.conflicts[0], {
      kind: 'booking', start: slot(10), end: slot(10, 30), bookingId: booked, status: 'CONFIRMED',
      customerName: 'Seed', customerPhoneMasked: '+65 9••• ••00', serviceId: 'cut',
    })
    assert.equal(r.data.conflicts[1].start, slot(10, 30))
    assert.equal(JSON.stringify(r.data).includes(cust.uid), false, 'no customer ID is returned')

    assert.equal((await apt(booked)).status, 'CONFIRMED')
    assert.equal((await apt(held.data.requestId)).status, 'HELD')
    const intervals = await intervalsOf(shopId, 'b1', slot(10))
    assert.deepEqual(intervals.map((i) => i.kind).sort(), ['block', 'booking', 'hold'])
    assert.equal(await count('auditLog', shopId), auditBefore, 'blocks write no auditLog (decisions A12)')

    // An expired hold is not a conflict, and is pruned when the block is written.
    await db.doc(`shops/${shopId}/schedules/b2_${dateKey(slot(10))}`).set({
      barberId: 'b2', date: dateKey(slot(10)),
      intervals: [{ start: Timestamp.fromMillis(slot(10)), end: Timestamp.fromMillis(slot(10, 30)), kind: 'hold', holdExpiresAt: Timestamp.fromMillis(Date.now() - 60e3) }],
    })
    const r2 = await block(owner, { barberId: 'b2' })
    assert.deepEqual(r2.data.conflicts, [])
    assert.deepEqual((await intervalsOf(shopId, 'b2', slot(10))).map((i) => i.kind), ['block'])
  })

  it('a booking adjacent to a block is not a conflict', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const cust = await phoneIdToken(newPhone())
    await seedBooking(shopId, 'b1', slot(9, 30), cust.uid) // 09:30-10:00
    await seedBooking(shopId, 'b1', slot(11), cust.uid) // 11:00-11:30
    const r = await block(owner, { barberId: 'b1' })
    assert.equal(r.ok, true)
    assert.deepEqual(r.data.conflicts, [])
  })

  it('removeBlock frees the time, is idempotent, and leaves bookings alone', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const cust = await phoneIdToken(newPhone())
    const booked = await seedBooking(shopId, 'b1', slot(10), cust.uid)
    const made = await block(owner, { barberId: 'b1', start: slot(10), end: slot(12) })
    const { blockId } = made.data
    assert.equal((await hold(shopId, 'b1', slot(11))).reason, 'SLOT_TAKEN')

    assert.deepEqual((await unblock(owner, blockId)).data, { blockId, removed: true })
    assert.equal((await blockDocs(shopId)).length, 0)
    assert.deepEqual((await intervalsOf(shopId, 'b1', slot(10))).map((i) => i.kind), ['booking'])
    assert.equal((await apt(booked)).status, 'CONFIRMED')
    assert.equal((await hold(shopId, 'b1', slot(11))).ok, true)
    assert.deepEqual((await unblock(owner, blockId)).data, { blockId, removed: false })
    assert.equal(kind(await intervalsOf(shopId, 'b1', slot(10)), 'hold').length, 1, 'a repeat removal touches nothing')
  })

  it('removeBlock racing holdSlot for the same time: at most one hold, and never a block and a hold together', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const { blockId } = (await block(owner, { barberId: 'b1', start: slot(10), end: slot(11) })).data
    const [removed, ...holds] = await Promise.all([unblock(owner, blockId), ...Array.from({ length: 10 }, () => hold(shopId, 'b1', slot(10)))])
    assert.equal(removed.ok, true)
    assert.equal(holds.filter((h) => h.ok).length <= 1, true)
    for (const h of holds.filter((x) => !x.ok)) assert.equal(h.reason, 'SLOT_TAKEN')
    const intervals = await intervalsOf(shopId, 'b1', slot(10))
    assert.equal(kind(intervals, 'block').length, 0)
    assert.equal(kind(intervals, 'hold').length, holds.filter((h) => h.ok).length)
    assert.equal((await blockDocs(shopId)).length, 0)
  })

  it('a barber blocks only their own time; an owner blocks any barber of their own shop', async () => {
    const shopId = await makeShop(['b1', 'b2'])
    const b1 = await staffToken({ shopId, role: 'barber', barberId: 'b1' })
    const owner = await staffToken({ shopId, role: 'owner' })

    const own = await block(b1) // barberId defaults to the token's
    assert.equal(own.ok, true)
    assert.equal(own.data.barberId, 'b1')
    assert.equal((await block(b1, { barberId: 'b1', start: slot(12), end: slot(13) })).ok, true)
    const other = await block(b1, { barberId: 'b2' })
    assert.equal(other.status, 'PERMISSION_DENIED')
    assert.equal((await intervalsOf(shopId, 'b2', slot(10))).length, 0)

    assert.equal((await block(owner, { barberId: 'b2' })).ok, true)
    const docs = await blockDocs(shopId)
    assert.equal(docs.length, 3)
    assert.ok(docs.every((d) => typeof d.data().createdBy === 'string' && d.data().createdAt))
    assert.equal((await block(owner)).status, 'INVALID_ARGUMENT', 'an owner must name a barber')
    assert.equal((await block(owner, { barberId: 'ghost' })).status, 'INVALID_ARGUMENT')
  })

  it('a barber removes only their own blocks; other shops\' staff cannot touch them', async () => {
    const shopId = await makeShop(['b1', 'b2'])
    const otherShop = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const b1 = await staffToken({ shopId, role: 'barber', barberId: 'b1' })
    const b2 = await staffToken({ shopId, role: 'barber', barberId: 'b2' })
    const strangers = await staffToken({ shopId: otherShop, role: 'owner' })
    const cust = await phoneIdToken(newPhone())
    const { blockId } = (await block(owner, { barberId: 'b2' })).data

    assert.equal((await unblock(b1, blockId)).status, 'PERMISSION_DENIED')
    assert.deepEqual((await unblock(strangers, blockId)).data, { blockId, removed: false }, 'blocks are looked up in the caller\'s own shop')
    assert.equal((await unblock(cust.idToken, blockId)).status, 'PERMISSION_DENIED')
    assert.equal((await unblock(undefined, blockId)).status, 'UNAUTHENTICATED')
    assert.equal((await blockDocs(shopId)).length, 1)
    assert.equal(kind(await intervalsOf(shopId, 'b2', slot(10)), 'block').length, 1)

    assert.equal((await unblock(b2, blockId)).data.removed, true)
    const again = (await block(owner, { barberId: 'b2' })).data.blockId
    assert.equal((await unblock(owner, again)).data.removed, true, 'the owner may remove any block')
  })

  it('rejects customers, anonymous callers and other shops\' staff, and bad input, without writing anything', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    const cust = await phoneIdToken(newPhone())
    assert.equal((await block(undefined, { barberId: 'b1' })).status, 'UNAUTHENTICATED')
    assert.equal((await block(cust.idToken, { barberId: 'b1' })).status, 'PERMISSION_DENIED')
    assert.equal((await block(await staffToken({ admin: true }), { barberId: 'b1' })).status, 'PERMISSION_DENIED')

    const bad = [
      { start: slot(10, 10) }, // off the 15-minute grid
      { end: slot(10) }, // zero length
      { start: slot(23), end: slot(25) }, // crosses midnight: single-day only
      { start: slot(10) - 2 * 24 * 3600e3, end: slot(11) - 2 * 24 * 3600e3 }, // in the past
      { start: slot(10) + 20 * 24 * 3600e3, end: slot(11) + 20 * 24 * 3600e3 }, // beyond the booking horizon
      { reason: 'x'.repeat(201) },
      { blockId: 'short' },
    ]
    for (const extra of bad) assert.equal((await block(owner, { barberId: 'b1', ...extra })).status, 'INVALID_ARGUMENT', JSON.stringify(extra))
    assert.equal((await blockDocs(shopId)).length, 0)
    assert.equal((await db.collection(`shops/${shopId}/schedules`).get()).size, 0)
  })

  it('a block over a slot makes customer holds fail and lets neighbouring slots through', async () => {
    const shopId = await makeShop(['b1'])
    const owner = await staffToken({ shopId, role: 'owner' })
    assert.equal((await block(owner, { barberId: 'b1', start: slot(10), end: slot(11) })).ok, true)
    assert.equal((await hold(shopId, 'b1', slot(10, 30))).reason, 'SLOT_TAKEN')
    assert.equal((await hold(shopId, 'b1', slot(9, 45))).reason, 'SLOT_TAKEN', 'a 30-minute service starting 09:45 would run into the block')
    assert.equal((await hold(shopId, 'b1', slot(9, 30))).ok, true)
    assert.equal((await hold(shopId, 'b1', slot(11))).ok, true)
  })
})
