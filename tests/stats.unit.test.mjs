// FR-14 counters from functions/stats.js (decisions A7): what an appointment contributes and how a change is
// worked out as new minus old. No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { contribution, delta } = createRequire(import.meta.url)('../functions/stats.js')
const ts = (ms) => ({ toMillis: () => ms })
// 2030-01-07 10:00 Singapore = 02:00 UTC.
const SG_10AM = Date.UTC(2030, 0, 7, 2, 0)
const apt = (over = {}) => ({
  status: 'COMPLETED', barberId: 'b1', priceCents: 2500, durationMin: 30, start: ts(SG_10AM), ...over,
})

describe('contribution', () => {
  it('COMPLETED adds one booking, its price and its duration', () => {
    assert.deepEqual(contribution(apt()),
      { dateKey: '20300107', barberId: 'b1', completed: 1, valueCents: 2500, noShows: 0, bookedMin: 30 })
  })
  it('NO_SHOW adds only a no-show (no value, no booked minutes)', () => {
    assert.deepEqual(contribution(apt({ status: 'NO_SHOW' })),
      { dateKey: '20300107', barberId: 'b1', completed: 0, valueCents: 0, noShows: 1, bookedMin: 0 })
  })
  it('every other status contributes nothing', () => {
    for (const status of ['HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE', 'CANCELLED', 'EXPIRED']) {
      assert.equal(contribution(apt({ status })), null, status)
    }
    assert.equal(contribution(null), null)
  })
  it('counts by the Singapore date of the start, not the UTC date', () => {
    // 23:30 SGT on 7 Jan is 15:30 UTC the same day; 00:00 SGT on 8 Jan is 16:00 UTC on the 7th.
    assert.equal(contribution(apt({ start: ts(Date.UTC(2030, 0, 7, 15, 30)) })).dateKey, '20300107')
    assert.equal(contribution(apt({ start: ts(Date.UTC(2030, 0, 7, 16, 0)) })).dateKey, '20300108')
    assert.equal(contribution(apt({ start: ts(Date.UTC(2030, 0, 7, 15, 59, 59, 999)) })).dateKey, '20300107')
  })
})

describe('delta', () => {
  const done = contribution(apt())
  const noShow = contribution(apt({ status: 'NO_SHOW' }))

  it('is empty when nothing changed', () => {
    assert.deepEqual(delta(done, done), [])
    assert.deepEqual(delta(null, null), [])
  })
  it('a new completion adds its counters', () => {
    assert.deepEqual(delta(null, done),
      [{ dateKey: '20300107', barberId: 'b1', completed: 1, valueCents: 2500, noShows: 0, bookedMin: 30 }])
  })
  it('reversing a no-show (NO_SHOW to nothing) subtracts it', () => {
    assert.deepEqual(delta(noShow, null),
      [{ dateKey: '20300107', barberId: 'b1', completed: 0, valueCents: 0, noShows: -1, bookedMin: 0 }])
  })
  it('a move to another day subtracts from the old day and adds to the new one', () => {
    const moved = contribution(apt({ start: ts(SG_10AM + 24 * 3600e3) }))
    const d = delta(done, moved)
    assert.equal(d.length, 2)
    assert.deepEqual(d.find((e) => e.dateKey === '20300107'),
      { dateKey: '20300107', barberId: 'b1', completed: -1, valueCents: -2500, noShows: 0, bookedMin: -30 })
    assert.deepEqual(d.find((e) => e.dateKey === '20300108'),
      { dateKey: '20300108', barberId: 'b1', completed: 1, valueCents: 2500, noShows: 0, bookedMin: 30 })
  })
  it('a status change on the same day is one entry with the net difference', () => {
    const d = delta(noShow, done)
    assert.deepEqual(d,
      [{ dateKey: '20300107', barberId: 'b1', completed: 1, valueCents: 2500, noShows: -1, bookedMin: 30 }])
  })
})
