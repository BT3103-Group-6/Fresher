// FR-14: the onAppointmentWritten handler and backfill against the Firestore emulator (no Functions emulator
// needed; the handler is called directly with the same event shape). Uses its own project id, so seeded data
// is untouched. Key property: repeated, concurrent or out-of-order deliveries never double-count.
import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const PROJECT = 'fresher-stats-test'
process.env.GCLOUD_PROJECT = PROJECT
// Use the copy of firebase-admin that functions/stats.js uses, so FieldValue sentinels match.
const fromFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = fromFunctions('firebase-admin/app')
const { Timestamp, getFirestore } = fromFunctions('firebase-admin/firestore')
const stats = createRequire(import.meta.url)('../functions/stats.js')

const app = initializeApp({ projectId: PROJECT }, 'stats-test')
const db = getFirestore(app)
after(() => deleteApp(app))

const SHOP = 'shopx'
const SG_10AM = Date.UTC(2030, 0, 7, 2, 0)
const DAY = 24 * 3600e3
const apt = (over = {}) => ({
  shopId: SHOP, barberId: 'b1', status: 'CONFIRMED', priceCents: 2500, durationMin: 30,
  start: Timestamp.fromMillis(SG_10AM), ...over,
})
const snap = (data) => ({ exists: data !== null, data: () => data })
const event = (id, before, after) => ({ params: { appointmentId: id }, data: { before: snap(before), after: snap(after) } })

/** Writes the appointment, then delivers the event for that change. */
async function write(id, before, afterData) {
  await db.doc(`appointments/${id}`).set(afterData)
  return stats.onAppointmentWritten(event(id, before, afterData), db)
}
const day = async (key) => (await db.doc(`shops/${SHOP}/dailyStats/${key}`).get()).data()
const clear = () => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })

beforeEach(clear)

describe('onAppointmentWritten', () => {
  it('counts a completed booking once, however often the same event is delivered', async () => {
    const before = apt({ status: 'IN_SERVICE' })
    const done = apt({ status: 'COMPLETED' })
    await db.doc('appointments/a1').set(done)
    const ev = event('a1', before, done)
    assert.equal(await stats.onAppointmentWritten(ev, db), true)
    for (let i = 0; i < 4; i++) assert.equal(await stats.onAppointmentWritten(ev, db), false)
    assert.deepEqual((await day('20300107')).barbers.b1, { completed: 1, valueCents: 2500, noShows: 0, bookedMin: 30 })
  })

  it('counts once when the same event is delivered 10 times at the same moment', async () => {
    const done = apt({ status: 'COMPLETED' })
    await db.doc('appointments/a2').set(done)
    const ev = event('a2', apt({ status: 'IN_SERVICE' }), done)
    await Promise.all(Array.from({ length: 10 }, () => stats.onAppointmentWritten(ev, db)))
    assert.deepEqual((await day('20300107')).barbers.b1, { completed: 1, valueCents: 2500, noShows: 0, bookedMin: 30 })
  })

  it('a stale event delivered after a newer state changes nothing', async () => {
    const confirmed = apt()
    const noShow = apt({ status: 'NO_SHOW' })
    await write('a3', confirmed, noShow) // marked.
    assert.equal((await day('20300107')).barbers.b1.noShows, 1)
    await write('a3', noShow, confirmed) // reversed.
    assert.equal((await day('20300107')).barbers.b1.noShows, 0)
    // The "marked" event arrives again late. The appointment is CONFIRMED now, so nothing is counted.
    assert.equal(await stats.onAppointmentWritten(event('a3', confirmed, noShow), db), false)
    assert.equal((await day('20300107')).barbers.b1.noShows, 0)
  })

  it('a moved appointment leaves the old day and lands on the new one', async () => {
    const done = apt({ status: 'COMPLETED' })
    await write('a4', apt({ status: 'IN_SERVICE' }), done)
    await write('a4', done, apt({ status: 'COMPLETED', start: Timestamp.fromMillis(SG_10AM + DAY) }))
    assert.deepEqual((await day('20300107')).barbers.b1, { completed: 0, valueCents: 0, noShows: 0, bookedMin: 0 })
    assert.deepEqual((await day('20300108')).barbers.b1, { completed: 1, valueCents: 2500, noShows: 0, bookedMin: 30 })
  })

  it('sums several appointments and keeps barbers apart', async () => {
    await write('a5', apt({ status: 'IN_SERVICE' }), apt({ status: 'COMPLETED' }))
    await write('a6', apt({ status: 'IN_SERVICE' }), apt({ status: 'COMPLETED', priceCents: 4000, durationMin: 45 }))
    await write('a7', apt(), apt({ status: 'NO_SHOW', barberId: 'b2' }))
    const d = await day('20300107')
    assert.deepEqual(d.barbers.b1, { completed: 2, valueCents: 6500, noShows: 0, bookedMin: 75 })
    assert.deepEqual(d.barbers.b2, { completed: 0, valueCents: 0, noShows: 1, bookedMin: 0 })
  })

  it('ignores writes that do not change the counters (no reads, no ledger)', async () => {
    assert.equal(await write('a8', null, apt({ status: 'HELD' })), false)
    assert.equal(await write('a8', apt({ status: 'HELD' }), apt()), false)
    assert.equal((await db.doc(`shops/${SHOP}/statContrib/a8`).get()).exists, false)
    assert.equal((await db.collection(`shops/${SHOP}/dailyStats`).get()).size, 0)
  })
})

describe('backfill', () => {
  const seed = async () => {
    await db.doc('appointments/c1').set(apt({ status: 'COMPLETED' }))
    await db.doc('appointments/c2').set(apt({ status: 'COMPLETED', start: Timestamp.fromMillis(SG_10AM + DAY), priceCents: 3000, durationMin: 60 }))
    await db.doc('appointments/c3').set(apt({ status: 'NO_SHOW' }))
    await db.doc('appointments/c4').set(apt({ status: 'CANCELLED' }))
    await db.doc('appointments/c5').set(apt({ shopId: 'other', status: 'COMPLETED' }))
  }

  it('rebuilds stats from existing appointments, and rerunning changes nothing', async () => {
    await seed()
    const first = await stats.backfill(db, { shopId: SHOP })
    assert.deepEqual(first, { appointments: 3, changed: 3 })
    const expected = {
      '20300107': { completed: 1, valueCents: 2500, noShows: 1, bookedMin: 30 },
      '20300108': { completed: 1, valueCents: 3000, noShows: 0, bookedMin: 60 },
    }
    for (const [k, v] of Object.entries(expected)) assert.deepEqual((await day(k)).barbers.b1, v)
    const second = await stats.backfill(db, { shopId: SHOP })
    assert.deepEqual(second, { appointments: 3, changed: 0 })
    for (const [k, v] of Object.entries(expected)) assert.deepEqual((await day(k)).barbers.b1, v)
  })

  it('gives the same numbers as the trigger built', async () => {
    await seed()
    // Trigger path for the same appointments, then backfill on top: nothing moves.
    for (const id of ['c1', 'c2', 'c3']) {
      const data = (await db.doc(`appointments/${id}`).get()).data()
      await stats.onAppointmentWritten(event(id, null, data), db)
    }
    const before = [await day('20300107'), await day('20300108')]
    assert.deepEqual(await stats.backfill(db, { shopId: SHOP }), { appointments: 3, changed: 0 })
    assert.deepEqual([await day('20300107'), await day('20300108')], before)
  })

  it('reset repairs wrong counters', async () => {
    await seed()
    await stats.backfill(db, { shopId: SHOP })
    await db.doc(`shops/${SHOP}/dailyStats/20300107`).set({ barbers: { b1: { completed: 99, valueCents: 1, noShows: 0, bookedMin: 0 } } })
    await stats.backfill(db, { shopId: SHOP, reset: true })
    assert.deepEqual((await day('20300107')).barbers.b1, { completed: 1, valueCents: 2500, noShows: 1, bookedMin: 30 })
  })
})
