import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dateOptions, freeSlots, sgDateKey, sgTimeToMs, weekdayOf } from '../src/lib/slots.js'

const KEY = '20300107' // a Monday, far in the future
const at = (hhmm) => sgTimeToMs(KEY, hhmm)
const now = at('00:00') - 3600e3
const base = { ranges: [{ start: '10:00', end: '12:00' }], dateKey: KEY, durationMin: 30, intervals: [], now }
const times = (slots) => slots.map((s) => new Date(s + 8 * 3600e3).toISOString().slice(11, 16))

describe('freeSlots', () => {
  it('offers a 15-minute grid where the service still fits before closing', () => {
    assert.deepEqual(times(freeSlots(base)), ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30'])
    assert.deepEqual(times(freeSlots({ ...base, durationMin: 45 })), ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15'])
  })
  it('treats intervals as half-open, so adjacent bookings are allowed', () => {
    const intervals = [{ start: at('10:30'), end: at('11:00'), kind: 'booking' }]
    assert.deepEqual(times(freeSlots({ ...base, intervals })), ['10:00', '11:00', '11:15', '11:30'])
  })
  it('excludes blocks and live holds but ignores expired holds', () => {
    const block = { start: at('10:00'), end: at('11:00'), kind: 'block' }
    assert.deepEqual(times(freeSlots({ ...base, intervals: [block] })).slice(0, 2), ['11:00', '11:15'])
    const live = { start: at('10:00'), end: at('10:30'), kind: 'hold', holdExpiresAt: now + 60e3 }
    assert.equal(times(freeSlots({ ...base, intervals: [live] }))[0], '10:30')
    const expired = { ...live, holdExpiresAt: now - 1 }
    assert.equal(times(freeSlots({ ...base, intervals: [expired] }))[0], '10:00')
  })
  it('skips past times and respects shop opening hours', () => {
    const later = at('10:20')
    assert.equal(times(freeSlots({ ...base, now: later }))[0], '10:30')
    const shopRanges = [{ start: '10:30', end: '11:30' }]
    assert.deepEqual(times(freeSlots({ ...base, shopRanges })), ['10:30', '10:45', '11:00'])
  })
  it('supports split shifts and returns nothing on a day off', () => {
    const ranges = [{ start: '10:00', end: '10:30' }, { start: '14:00', end: '14:30' }]
    assert.deepEqual(times(freeSlots({ ...base, ranges })), ['10:00', '14:00'])
    assert.deepEqual(freeSlots({ ...base, ranges: [] }), [])
  })
})

describe('Singapore dates', () => {
  it('uses Singapore, not UTC, for the calendar day and weekday', () => {
    assert.equal(sgDateKey(Date.UTC(2030, 0, 6, 17, 0)), '20300107') // 01:00 SGT on the 7th
    assert.equal(weekdayOf(KEY), 'mon')
  })
  it('offers 14 dates starting today', () => {
    const dates = dateOptions(Date.UTC(2030, 0, 6, 17, 0))
    assert.equal(dates.length, 14)
    assert.equal(dates[0].key, '20300107')
    assert.equal(dates[13].key, '20300120')
  })
})
