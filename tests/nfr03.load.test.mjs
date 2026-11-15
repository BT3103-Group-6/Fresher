// NFR-03 part 2: 1,000 booking transactions against the running Auth, Functions and Firestore emulators,
// then a full check that no barber is ever booked twice for overlapping time. Part 1 (50 simultaneous
// holds on one slot: exactly one wins) is tests/concurrency.test.mjs from PR-19; this file covers the
// "across 1000 test booking transactions: zero double bookings" criterion (docs/requirements.md).
// Uses its own throwaway shop, so seeded data is untouched. Run with the emulators up:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node --test tests/nfr03.load.test.mjs
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT = 'fresher-6d857' // must match the project the emulators run functions for
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: set FIRESTORE_EMULATOR_HOST (and run the Functions emulator) first.')
  process.exit(1)
}
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT}/asia-southeast1`
const db = getFirestore(initializeApp({ projectId: PROJECT }, 'nfr03-load'))

const TOTAL = 1000 // booking transactions in phase 1
const CHURN_RELEASES = 100 // phase 2: releases of won holds ...
const CHURN_HOLDS = 300 // ... racing new holds into the same days
const CONCURRENCY = 25 // requests in flight at once
const BARBERS = Array.from({ length: 10 }, (_, i) => `b${i + 1}`)
const DAYS_AHEAD = [1, 2, 3] // three days, all inside the 14-day booking horizon
const SERVICE_MIN = 30
const SG_OFFSET_MS = 8 * 3600e3
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const allWeek = Object.fromEntries(WEEK.map((d) => [d, [{ start: '00:00', end: '23:59' }]]))

const dateKey = (ms) => new Date(ms + SG_OFFSET_MS).toISOString().slice(0, 10).replaceAll('-', '')
const sgTime = (daysAhead, hh, mm) => {
  const k = dateKey(Date.now() + daysAhead * 24 * 3600e3)
  return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), hh, mm) - SG_OFFSET_MS
}
// 09:00 to 17:45 in 15-minute steps with a 30-minute service: neighbouring starts overlap, so many
// requests race for the same or overlapping time.
const STARTS = DAYS_AHEAD.flatMap((d) => Array.from({ length: 36 }, (_, i) => sgTime(d, 9 + Math.floor(i / 4), (i % 4) * 15)))
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

let shopId
const transportRetries = []
async function call(name, data) {
  for (let attempt = 0; ; attempt++) {
    let status = 0
    let text = ''
    let body = null
    try {
      const res = await fetch(`${FUNCTIONS}/${name}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }),
      })
      status = res.status
      text = await res.text()
      body = JSON.parse(text)
    } catch { /* not a callable response */ }
    // Only a real callable envelope counts as a result; a dropped connection is retried with the same
    // requestId (the calls are idempotent), and never read as success.
    if (body && (body.error || 'result' in body)) {
      return body.error
        ? { ok: false, status: body.error.status, reason: body.error.details && body.error.details.reason }
        : { ok: true, data: body.result }
    }
    transportRetries.push(`${name}: HTTP ${status} ${text.slice(0, 80)}`)
    if (attempt >= 3) throw new Error(`${name}: no callable response after ${attempt + 1} tries`)
  }
}

async function pool(tasks, limit) {
  const results = new Array(tasks.length)
  let next = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }))
  return results
}

const holdTask = (barberId, start) => {
  const requestId = randomUUID()
  return async () => ({ requestId, barberId, start, ...(await call('holdSlot', { shopId, serviceId: 'cut', barberId, start, requestId })) })
}

// Reads every barber-day schedule and returns the intervals still in force (expired holds dropped,
// exactly as the server does).
async function liveIntervals() {
  const now = Date.now()
  const out = []
  for (const b of BARBERS) {
    for (const d of DAYS_AHEAD) {
      const snap = await db.doc(`shops/${shopId}/schedules/${b}_${dateKey(sgTime(d, 12, 0))}`).get()
      for (const i of (snap.exists ? snap.data().intervals : []) || []) {
        if (i.kind === 'hold' && i.holdExpiresAt.toMillis() <= now) continue
        out.push({ barberId: b, start: i.start.toMillis(), end: i.end.toMillis(), kind: i.kind })
      }
    }
  }
  return out
}

function doubleBookings(intervals) {
  const clashes = []
  const byBarber = Object.groupBy(intervals, (i) => i.barberId)
  for (const list of Object.values(byBarber)) {
    list.sort((a, b) => a.start - b.start)
    for (let k = 1; k < list.length; k++) {
      if (list[k].start < list[k - 1].end) clashes.push([list[k - 1], list[k]]) // half-open intervals
    }
  }
  return clashes
}

const heldAppointments = async () =>
  (await db.collection('appointments').where('shopId', '==', shopId).where('status', '==', 'HELD').get()).docs.map((d) => d.data())

const summary = {}

before(async () => {
  shopId = `load-${randomUUID().slice(0, 8)}`
  const shop = db.doc(`shops/${shopId}`)
  await shop.set({ name: 'NFR-03 load test shop', status: 'verified', tz: 'Asia/Singapore', openingHours: allWeek, noticeMins: 120, latePolicy: 'block' })
  await shop.collection('services').doc('cut').set({ name: 'Cut', durationMin: SERVICE_MIN, priceCents: 2500, active: true })
  for (const b of BARBERS) {
    await shop.collection('barbers').doc(b).set({ displayName: b, active: true, serviceIds: ['cut'], workingHours: allWeek })
  }
  const probe = await call('holdSlot', { shopId: 'nope', serviceId: 'cut', barberId: 'b1', start: STARTS[0], requestId: randomUUID() })
  assert.ok(!probe.ok && probe.status, 'holdSlot must be reachable on the Functions emulator')
})

after(async () => {
  console.log('\nNFR-03 load test summary')
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`)
  if (transportRetries.length) {
    console.log(`  emulator transport retries (never counted as results): ${transportRetries.length}`)
  }
  await db.recursiveDelete(db.doc(`shops/${shopId}`))
  for (const c of ['appointments', 'auditLog']) {
    const snap = await db.collection(c).where('shopId', '==', shopId).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
})

describe('NFR-03 load: 1,000 booking transactions', () => {
  let won = []

  it('1,000 concurrent holds (10% "any barber") end with zero double bookings', async () => {
    const tasks = Array.from({ length: TOTAL }, () =>
      holdTask(Math.random() < 0.1 ? 'any' : pick(BARBERS), pick(STARTS)))
    const t0 = Date.now()
    const results = await pool(tasks, CONCURRENCY)
    const ms = Date.now() - t0

    won = results.filter((r) => r.ok).map((r) => ({ ...r, barberId: r.data.barberId }))
    const lost = results.filter((r) => !r.ok)
    const reasons = Object.groupBy(lost, (r) => r.reason || r.status)
    summary['phase 1 requests'] = TOTAL
    summary['phase 1 succeeded'] = won.length
    summary['phase 1 refused'] = Object.entries(reasons).map(([k, v]) => `${v.length} ${k}`).join(', ')
    summary['phase 1 duration'] = `${(ms / 1000).toFixed(1)} s at ${CONCURRENCY} in flight`

    assert.ok(ms < 9 * 60e3, 'must finish inside the 10-minute hold window, or expired holds would skew the counts')
    assert.ok(won.length > 0, 'some requests must succeed')
    assert.deepEqual(Object.keys(reasons), ['SLOT_TAKEN'], 'every refusal is SLOT_TAKEN, never a raw error')

    const intervals = await liveIntervals()
    const clashes = doubleBookings(intervals)
    summary['phase 1 double bookings'] = clashes.length
    assert.equal(clashes.length, 0, `overlapping intervals: ${JSON.stringify(clashes.slice(0, 3))}`)
    assert.equal(intervals.length, won.length, 'one schedule interval per successful hold, no more, no less')

    const held = await heldAppointments()
    assert.equal(held.length, won.length, 'one HELD appointment per successful hold (no duplicates, none lost)')
    // Every winner's appointment matches the time and barber it was given.
    const key = (barberId, start) => `${barberId}@${start}`
    const heldKeys = new Set(held.map((a) => key(a.barberId, a.start.toMillis())))
    for (const w of won) assert.ok(heldKeys.has(key(w.barberId, w.start)), `missing appointment for ${key(w.barberId, w.start)}`)
  })

  it('releases racing new holds into the same days still end with zero double bookings', async () => {
    const toRelease = won.slice(0, Math.min(CHURN_RELEASES, won.length))
    const tasks = [
      ...toRelease.map((w) => async () => ({ release: true, ...(await call('releaseHold', { requestId: w.requestId })) })),
      ...Array.from({ length: CHURN_HOLDS }, () => holdTask(pick(BARBERS), pick(STARTS))),
    ].sort(() => Math.random() - 0.5)
    const results = await pool(tasks, CONCURRENCY)

    const releases = results.filter((r) => r.release)
    const holds = results.filter((r) => !r.release)
    assert.ok(releases.every((r) => r.ok && r.data.released === true), 'every release of a held booking succeeds and frees it')
    const newWins = holds.filter((r) => r.ok).length
    const reasons = [...new Set(holds.filter((r) => !r.ok).map((r) => r.reason || r.status))]
    summary['phase 2 releases'] = releases.length
    summary['phase 2 new holds'] = `${holds.length} requested, ${newWins} succeeded`
    assert.ok(reasons.every((r) => r === 'SLOT_TAKEN'), `unexpected refusals: ${reasons}`)

    const intervals = await liveIntervals()
    const clashes = doubleBookings(intervals)
    summary['phase 2 double bookings'] = clashes.length
    assert.equal(clashes.length, 0, `overlapping intervals: ${JSON.stringify(clashes.slice(0, 3))}`)
    assert.equal(intervals.length, won.length - releases.length + newWins, 'schedule intervals match the net holds')
    assert.equal((await heldAppointments()).length, intervals.length, 'HELD appointments match the schedule')
    summary['total booking transactions'] = TOTAL + releases.length + holds.length
  })
})
