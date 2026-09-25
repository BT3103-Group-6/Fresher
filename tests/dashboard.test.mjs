// FR-14 metric formulas from src/lib/dashboard.js (decisions A7). No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RANGE_DAYS, buildDashboard, dayKeys, formatMoney, formatPercent, noShowRate, openMinutes, presetRange,
  sumStats, utilisation, validateRange,
} from '../src/lib/dashboard.js'

// Mon 7 Jan 2030 (Singapore). 09:00 SGT = 01:00 UTC.
const sg = (key, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), h - 8, m)
}
const MON = '20300107'
const LONG_AFTER = sg('20300201', '00:00')
const hours = (start, end) => ({ mon: [{ start, end }] })

describe('no-show rate', () => {
  it('is NO_SHOW / (COMPLETED + NO_SHOW)', () => {
    assert.equal(noShowRate({ completed: 3, noShows: 1 }), 0.25)
    assert.equal(noShowRate({ completed: 0, noShows: 2 }), 1)
    assert.equal(noShowRate({ completed: 5, noShows: 0 }), 0)
  })
  it('is unavailable (shown as a dash) when both are zero', () => {
    assert.equal(noShowRate({ completed: 0, noShows: 0 }), null)
    assert.equal(formatPercent(null), '—')
    assert.equal(formatPercent(0.25), '25%')
  })
})

describe('utilisation', () => {
  it('is booked minutes over open minutes, and unavailable with no open time', () => {
    assert.equal(utilisation(120, 480), 0.25)
    assert.equal(utilisation(0, 480), 0)
    assert.equal(utilisation(60, 0), null)
  })
})

describe('openMinutes', () => {
  const base = { workingHours: hours('09:00', '18:00'), keys: [MON], now: LONG_AFTER }
  it('is the working time of the day', () => assert.equal(openMinutes(base), 540))
  it('is zero on a day the barber does not work', () => {
    assert.equal(openMinutes({ ...base, keys: ['20300108'] }), 0)
  })
  it('stays inside shop opening hours', () => {
    assert.equal(openMinutes({ ...base, shopHours: hours('10:00', '17:00') }), 420)
    assert.equal(openMinutes({ ...base, shopHours: { tue: [{ start: '09:00', end: '18:00' }] } }), 0)
  })
  it('subtracts blocks, only where they overlap working time', () => {
    const blocks = [{ start: sg(MON, '12:00'), end: sg(MON, '13:00') }, { start: sg(MON, '17:30'), end: sg(MON, '19:00') }]
    assert.equal(openMinutes({ ...base, blocks }), 540 - 60 - 30)
  })
  it('does not subtract overlapping blocks twice', () => {
    const blocks = [{ start: sg(MON, '12:00'), end: sg(MON, '13:00') }, { start: sg(MON, '12:30'), end: sg(MON, '13:30') }]
    assert.equal(openMinutes({ ...base, blocks }), 540 - 90)
  })
  it('counts split working hours', () => {
    const workingHours = { mon: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] }
    assert.equal(openMinutes({ ...base, workingHours }), 480)
  })
  it('counts only time up to now', () => {
    assert.equal(openMinutes({ ...base, now: sg(MON, '12:00') }), 180)
    assert.equal(openMinutes({ ...base, now: sg(MON, '08:00') }), 0)
    assert.equal(openMinutes({ ...base, now: sg('20300106', '23:00') }), 0)
  })
  it('sums several days', () => {
    assert.equal(openMinutes({ ...base, keys: dayKeys('20300107', '20300114') }), 540 * 2)
  })
})

describe('sumStats and buildDashboard', () => {
  const stats = [
    { barbers: { b1: { completed: 2, valueCents: 5000, noShows: 1, bookedMin: 60 } } },
    { barbers: { b1: { completed: 1, valueCents: 2500, noShows: 0, bookedMin: 30 }, gone: { completed: 1, valueCents: 1000, noShows: 0, bookedMin: 20 } } },
  ]
  it('adds the days up per barber', () => {
    assert.deepEqual(sumStats(stats).b1, { completed: 3, valueCents: 7500, noShows: 1, bookedMin: 90 })
    assert.deepEqual(sumStats([]), {})
  })
  const barbers = [
    { id: 'b1', displayName: 'Ali', active: true, workingHours: hours('09:00', '18:00') },
    { id: 'b2', displayName: 'Ben', active: true, workingHours: hours('09:00', '18:00') },
    { id: 'b3', displayName: 'Old', active: false, workingHours: hours('09:00', '18:00') },
  ]
  const input = { barbers, stats, blocks: [], keys: [MON], now: LONG_AFTER }

  it('builds a row per active barber (idle ones at zero), a former-barber row, and totals', () => {
    const d = buildDashboard(input)
    assert.deepEqual(d.rows.map((r) => r.name), ['Ali', 'Ben', 'Former barber'])
    const ali = d.rows[0]
    assert.equal(ali.completed, 3)
    assert.equal(ali.noShowRate, 0.25)
    assert.equal(ali.utilisation, 90 / 540)
    const ben = d.rows[1]
    assert.deepEqual([ben.completed, ben.noShowRate, ben.utilisation], [0, null, 0])
    assert.equal(d.rows[2].openMin, 0)
    assert.equal(d.rows[2].utilisation, null)
    assert.equal(d.totals.completed, 4)
    assert.equal(d.totals.valueCents, 8500)
    assert.equal(d.totals.noShowRate, 0.2)
    // Former barber's minutes are left out of utilisation, as are inactive barbers' (no open time).
    assert.equal(d.totals.utilisation, 90 / 1080)
    assert.equal(d.empty, false)
  })
  it('is empty with zero values when there are no bookings', () => {
    const d = buildDashboard({ ...input, stats: [] })
    assert.equal(d.empty, true)
    assert.equal(d.totals.completed, 0)
    assert.equal(d.totals.valueCents, 0)
    assert.equal(d.totals.noShowRate, null)
    assert.equal(d.totals.utilisation, 0)
  })
  it('formats money', () => {
    assert.equal(formatMoney(0), 'S$0.00')
    assert.equal(formatMoney(250050), 'S$2,500.50')
  })
})

describe('range', () => {
  it('lists every day inclusive', () => {
    assert.deepEqual(dayKeys('20291230', '20300102'), ['20291230', '20291231', '20300101', '20300102'])
    assert.equal(dayKeys('20300107', '20300107').length, 1)
  })
  it('validates each field', () => {
    assert.deepEqual(validateRange('2030-01-01', '2030-01-31'), {})
    assert.ok(validateRange('', '2030-01-31').from)
    assert.ok(validateRange('2030-01-01', '').to)
    assert.ok(validateRange('2030-02-30', '2030-03-01').from)
    assert.ok(validateRange('2030-01-31', '2030-01-01').to)
  })
  it(`allows ${MAX_RANGE_DAYS} days and refuses one more`, () => {
    assert.deepEqual(validateRange('2030-01-01', '2030-04-02'), {}) // 92 days.
    assert.ok(validateRange('2030-01-01', '2030-04-03').to)
  })
  it('presets end today in Singapore time', () => {
    const now = Date.UTC(2030, 0, 15, 17, 0) // 01:00 on 16 Jan in Singapore.
    assert.deepEqual(presetRange('last7', now), { from: '2030-01-10', to: '2030-01-16' })
    assert.deepEqual(presetRange('last30', now), { from: '2029-12-18', to: '2030-01-16' })
    assert.deepEqual(presetRange('month', now), { from: '2030-01-01', to: '2030-01-16' })
  })
})
