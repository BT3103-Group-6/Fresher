// UI-O2 chart data shaping from src/lib/dashboardCharts.js (decisions A19). No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  barberTable, buildAnalytics, compareMetric, dailySeries, dailyTable, formatDay, previousKeys, sortRows,
  sparklinePath, trendSpeech, weekdayBreakdown, weekdayTable,
} from '../src/lib/dashboardCharts.js'
import { buildDashboard, dayKeys } from '../src/lib/dashboard.js'

const hours = { mon: [{ start: '09:00', end: '18:00' }], tue: [{ start: '09:00', end: '18:00' }], wed: [{ start: '09:00', end: '18:00' }] }
const barbers = [
  { id: 'b1', displayName: 'Ali', active: true, workingHours: hours },
  { id: 'b2', displayName: 'Ben', active: true, workingHours: hours },
]
// Mon 7, Tue 8, Wed 9 Jan 2030; the previous 3 days are Fri 4, Sat 5, Sun 6 (no working hours).
const keys = dayKeys('20300107', '20300109')
const now = Date.UTC(2030, 1, 1)
const c = (completed, valueCents, noShows, bookedMin) => ({ completed, valueCents, noShows, bookedMin })
const stats = [
  { id: '20300107', barbers: { b1: c(2, 5000, 1, 60), b2: c(1, 2000, 0, 30) } },
  { id: '20300109', barbers: { b1: c(3, 7500, 0, 90), gone: c(1, 1000, 0, 20) } },
  { id: '20300105', barbers: { b1: c(1, 2500, 0, 30) } }, // previous period
]
const base = { barbers, stats, blocks: [], shopHours: null, keys, now }

describe('previousKeys', () => {
  it('is the same number of days ending the day before', () => {
    assert.deepEqual(previousKeys(keys), ['20300104', '20300105', '20300106'])
    assert.deepEqual(previousKeys(['20300101']), ['20291231'])
    assert.deepEqual(previousKeys([]), [])
  })
})

describe('compareMetric', () => {
  it('shows a rounded percentage change for counts and value', () => {
    assert.deepEqual(compareMetric({ current: 112, previous: 100, days: 14 }), {
      direction: 'up', tone: 'good', symbol: '▲', text: '+12% vs previous 14 days',
    })
    const down = compareMetric({ current: 50, previous: 100, days: 7 })
    assert.equal(down.text, '−50% vs previous 7 days')
    assert.equal(down.direction, 'down')
    assert.equal(down.tone, 'bad')
  })
  it('handles a previous period with nothing in it', () => {
    assert.equal(compareMetric({ current: 5, previous: 0, days: 30 }).text, 'Up from 0 vs previous 30 days')
    const none = compareMetric({ current: 0, previous: 0, days: 30 })
    assert.equal(none.direction, 'flat')
    assert.equal(none.text, 'No change vs previous 30 days')
  })
  it('treats a change that rounds to zero as no change', () => {
    assert.equal(compareMetric({ current: 1001, previous: 1000, days: 2 }).direction, 'flat')
  })
  it('uses percentage points for rates, and lower is better when asked', () => {
    const t = compareMetric({ current: 0.2, previous: 0.15, kind: 'rate', lowerIsBetter: true, days: 1 })
    assert.equal(t.text, '+5 pts vs previous day')
    assert.equal(t.direction, 'up')
    assert.equal(t.tone, 'bad')
    assert.equal(compareMetric({ current: 0.1, previous: 0.15, kind: 'rate', lowerIsBetter: true, days: 1 }).tone, 'good')
    assert.equal(compareMetric({ current: 0.5, previous: 0.5, kind: 'rate', days: 3 }).text, 'No change vs previous 3 days')
  })
  it('says so when either side has no data', () => {
    const t = compareMetric({ current: 0.3, previous: null, kind: 'rate', days: 14 })
    assert.equal(t.direction, 'none')
    assert.equal(t.text, 'No data for the previous 14 days')
    assert.equal(compareMetric({ current: null, previous: 0.3, kind: 'rate', days: 14 }).direction, 'none')
  })
  it('gives a spoken form that names the direction in words', () => {
    assert.equal(trendSpeech(compareMetric({ current: 112, previous: 100, days: 14 })), 'Up, better: +12% vs previous 14 days')
    assert.equal(trendSpeech(compareMetric({ current: 0.2, previous: 0.1, kind: 'rate', lowerIsBetter: true, days: 7 })), 'Up, worse: +10 pts vs previous 7 days')
  })
})

describe('dailySeries', () => {
  const series = dailySeries(base)
  it('has one point per day, zero-filled, in order', () => {
    assert.deepEqual(series.map((d) => d.key), keys)
    assert.deepEqual(series.map((d) => d.label), ['7 Jan', '8 Jan', '9 Jan'])
    assert.deepEqual(series.map((d) => [d.completed, d.noShows, d.valueCents]), [[3, 1, 7000], [0, 0, 0], [4, 0, 8500]])
  })
  it('gives each day the A7 rates', () => {
    assert.equal(series[0].noShowRate, 0.25)
    assert.equal(series[1].noShowRate, null)
    assert.equal(series[0].utilisation, 90 / 1080) // two barbers x 540 min open
    assert.equal(series[1].utilisation, 0)
  })
  it('does not use stats from outside the day', () => {
    assert.equal(dailySeries({ ...base, keys: ['20300108'] })[0].completed, 0)
  })
})

describe('weekdayBreakdown', () => {
  it('averages per occurrence of the weekday and leaves out weekdays not in range', () => {
    const range = dayKeys('20300107', '20300121') // Mon 7 .. Mon 21: 3 Mondays, 2 of Tue..Sun
    const w = weekdayBreakdown({ keys: range, stats: [
      { id: '20300107', barbers: { b1: c(3, 0, 0, 0) } },
      { id: '20300114', barbers: { b1: c(3, 0, 0, 0), b2: c(3, 0, 1, 0) } },
    ] })
    assert.deepEqual(w.map((x) => x.short), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    assert.equal(w[0].days, 3)
    assert.equal(w[0].completed, 9)
    assert.equal(w[0].average, 3)
    assert.equal(w[0].noShows, 1)
    assert.equal(w[1].days, 2)
    assert.equal(w[1].average, 0)
    assert.deepEqual(weekdayBreakdown({ keys: dayKeys('20300107', '20300108'), stats: [] }).map((x) => x.short), ['Mon', 'Tue'])
  })
})

describe('sortRows', () => {
  const rows = [{ name: 'Ben', v: 2 }, { name: 'Ali', v: null }, { name: 'Cal', v: 9 }, { name: 'Dee', v: 2 }]
  it('sorts descending with nulls last, ties by name', () => {
    assert.deepEqual(sortRows(rows, 'v', 'desc').map((r) => r.name), ['Cal', 'Ben', 'Dee', 'Ali'])
  })
  it('sorts ascending with nulls still last, and by text', () => {
    assert.deepEqual(sortRows(rows, 'v', 'asc').map((r) => r.name), ['Ben', 'Dee', 'Cal', 'Ali'])
    assert.deepEqual(sortRows(rows, 'name', 'desc').map((r) => r.name), ['Dee', 'Cal', 'Ben', 'Ali'])
  })
  it('does not change the input', () => {
    const copy = [...rows]
    sortRows(rows, 'v')
    assert.deepEqual(rows, copy)
  })
})

describe('buildAnalytics', () => {
  const a = buildAnalytics(base)
  it('keeps the A7 totals exactly as buildDashboard computes them', () => {
    const reference = buildDashboard({ barbers, stats: stats.filter((s) => keys.includes(s.id)), blocks: [], shopHours: null, keys, now })
    assert.deepEqual(a.totals, reference.totals)
    assert.deepEqual(a.rows, reference.rows)
    assert.equal(a.days, 3)
  })
  it('builds the four KPIs with values, trends and sparklines', () => {
    assert.deepEqual(a.kpis.map((k) => k.id), ['completed', 'value', 'noShow', 'utilisation'])
    const [completed, value, noShow, util] = a.kpis
    assert.equal(completed.value, '7')
    assert.equal(completed.trend.text, '+600% vs previous 3 days') // 7 vs 1
    assert.equal(value.value, 'S$155.00')
    assert.equal(noShow.value, '13%')
    assert.equal(noShow.trend.direction, 'up') // 12.5% vs 0%
    assert.equal(noShow.trend.tone, 'bad')
    assert.equal(util.trend.direction, 'none') // the previous days have no open time, so no rate
    assert.deepEqual(completed.spark, [3, 0, 4])
    assert.deepEqual(noShow.spark, [0.25, null, 0])
  })
  it('compares against the previous period only, not the range', () => {
    const only = buildAnalytics({ ...base, stats: [{ id: '20300105', barbers: { b1: c(2, 5000, 0, 60) } }] })
    assert.equal(only.totals.completed, 0)
    assert.equal(only.kpis[0].trend.text, '−100% vs previous 3 days')
  })
  it('writes text summaries and the barber bars sorted with percentages', () => {
    assert.match(a.dailySummary, /7 Jan to 9 Jan 2030: 7 completed and 1 no-show, S\$155\.00 booked value\. Busiest day: 7 Jan with 4 bookings\./) // 7 and 9 Jan tie; the earlier day wins
    assert.deepEqual(a.barberBars.map((r) => r.name), ['Ali', 'Ben']) // Former barber has no utilisation
    assert.equal(a.barberSummary, 'Utilisation by barber, highest first: Ali 9%, Ben 2%.')
    assert.deepEqual(a.weekdays.map((w) => w.short), ['Mon', 'Tue', 'Wed'])
    assert.match(a.weekdaySummary, /^Busiest weekday: Wednesday, averaging 4\.0 completed bookings a day\./)
  })
  it('gives table data with the same numbers as the chart', () => {
    const t = dailyTable(a.daily)
    assert.deepEqual(t.rows[0], { date: '7 Jan', completed: '3', noShows: '1', value: 'S$70.00' })
    assert.equal(t.rows.length, 3)
    assert.deepEqual(barberTable(a.barberBars).rows[0], { name: 'Ali', utilisation: '9%', bookedMin: '150', openMin: '1620' })
    assert.deepEqual(weekdayTable(a.weekdays).rows[2], { day: 'Wednesday', days: '1', completed: '4', average: '4.0' })
  })
})

describe('an empty range', () => {
  const e = buildAnalytics({ ...base, stats: [] })
  it('shows zeros, flat trends, no bars and an empty flag', () => {
    assert.equal(e.empty, true)
    assert.deepEqual(e.kpis.map((k) => k.value), ['0', 'S$0.00', '—', '0%'])
    assert.equal(e.kpis[0].trend.text, 'No change vs previous 3 days')
    assert.equal(e.kpis[2].trend.direction, 'none')
    assert.deepEqual(e.daily.map((d) => d.completed + d.noShows), [0, 0, 0])
    assert.equal(e.dailySummary, 'No completed or no-show bookings from 7 Jan to 9 Jan 2030.')
    assert.equal(e.weekdaySummary, 'No completed bookings on any weekday in this period.')
  })
  it('copes with no barbers and with an invalid (empty) range', () => {
    const none = buildAnalytics({ ...base, barbers: [], stats: [] })
    assert.equal(none.barberSummary, 'No barber has open time in this period, so there is no utilisation to show.')
    assert.deepEqual(none.barberBars, [])
    const noRange = buildAnalytics({ ...base, keys: [] })
    assert.equal(noRange.days, 0)
    assert.deepEqual(noRange.daily, [])
  })
})

describe('sparklinePath', () => {
  it('draws a line across the box, highest value at the top', () => {
    assert.equal(sparklinePath([0, 10], 100, 20, 0), 'M0.0 20.0L100.0 0.0')
  })
  it('breaks the line at gaps', () => {
    assert.equal(sparklinePath([1, null, 3], 100, 20, 0), 'M0.0 20.0M100.0 0.0')
  })
  it('draws a flat series in the middle and a single point as a dash', () => {
    assert.equal(sparklinePath([5, 5, 5], 100, 20, 0), 'M0.0 10.0L50.0 10.0L100.0 10.0')
    assert.equal(sparklinePath([4], 100, 20, 0), 'M50.0 10.0h3')
  })
  it('is empty with nothing to draw', () => {
    assert.equal(sparklinePath([]), '')
    assert.equal(sparklinePath([null, null]), '')
  })
})

describe('formatDay', () => {
  it('formats a date key', () => {
    assert.equal(formatDay('20300107'), '7 Jan')
    assert.equal(formatDay('20291231', true), '31 Dec 2029')
  })
})
