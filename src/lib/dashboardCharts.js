// UI-O2 (decisions A19): chart and trend data shaping. Pure, no Firebase or Chart.js imports, so node tests load it.
// It only reshapes what src/lib/dashboard.js computes (A7 formulas are reused, never re-derived here).
import { DAY_MS, sgDateKey, sgTimeToMs, weekdayOf } from './slots.js'
import { buildDashboard, dayKeys, formatMoney, formatPercent, NONE } from './dashboard.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = [
  { key: 'mon', short: 'Mon', long: 'Monday' }, { key: 'tue', short: 'Tue', long: 'Tuesday' },
  { key: 'wed', short: 'Wed', long: 'Wednesday' }, { key: 'thu', short: 'Thu', long: 'Thursday' },
  { key: 'fri', short: 'Fri', long: 'Friday' }, { key: 'sat', short: 'Sat', long: 'Saturday' },
  { key: 'sun', short: 'Sun', long: 'Sunday' },
]

/** '20300107' to '7 Jan' (or '7 Jan 2030' with `year`). */
export const formatDay = (key, year = false) =>
  `${+key.slice(6, 8)} ${MONTHS[+key.slice(4, 6) - 1]}${year ? ` ${key.slice(0, 4)}` : ''}`

/** The same number of days ending the day before `keys` starts; empty for an empty range. */
export function previousKeys(keys) {
  if (!keys.length) return []
  const first = sgTimeToMs(keys[0], '12:00')
  return keys.map((_, i) => sgDateKey(first - (keys.length - i) * DAY_MS))
}

export const previousLabel = (n) => (n === 1 ? 'previous day' : `previous ${n} days`)

/**
 * Trend of one figure against the previous period. `kind` is 'count' (percentage change) or 'rate' (change in
 * percentage points; values are ratios or null). Direction and the words carry the meaning, `tone` is only an extra cue.
 * Returns { direction: 'up' | 'down' | 'flat' | 'none', tone: 'good' | 'bad' | 'neutral', symbol, text }.
 */
export function compareMetric({ current, previous, kind = 'count', lowerIsBetter = false, days }) {
  const label = previousLabel(days)
  if (current === null || previous === null || current === undefined || previous === undefined) {
    return { direction: 'none', tone: 'neutral', symbol: '–', text: `No data for the ${label}` }
  }
  let direction
  let text
  if (kind === 'rate') {
    const points = Math.round((current - previous) * 100)
    direction = points > 0 ? 'up' : points < 0 ? 'down' : 'flat'
    text = direction === 'flat' ? `No change vs ${label}` : `${points > 0 ? '+' : '−'}${Math.abs(points)} pts vs ${label}`
  } else if (previous === 0) {
    direction = current > 0 ? 'up' : 'flat'
    text = current > 0 ? `Up from 0 vs ${label}` : `No change vs ${label}`
  } else {
    const percent = Math.round(((current - previous) / previous) * 100)
    direction = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'
    text = direction === 'flat' ? `No change vs ${label}` : `${percent > 0 ? '+' : '−'}${Math.abs(percent)}% vs ${label}`
  }
  const tone = direction === 'flat' ? 'neutral' : (direction === 'up') === lowerIsBetter ? 'bad' : 'good'
  return { direction, tone, symbol: { up: '▲', down: '▼', flat: '►' }[direction], text }
}

/** Plain words for a screen reader, for example "Up, better: +12% vs previous 14 days". */
export function trendSpeech(t) {
  if (t.direction === 'none') return t.text
  const head = { up: 'Up', down: 'Down', flat: 'Unchanged' }[t.direction]
  const verdict = t.tone === 'good' ? ', better' : t.tone === 'bad' ? ', worse' : ''
  return `${head}${verdict}: ${t.text}`
}

const groupById = (docs) => {
  const map = new Map()
  for (const d of docs) if (d && d.id) map.set(d.id, [...(map.get(d.id) || []), d])
  return map
}

/** One point per day: counts, value, no-show rate and utilisation, each from `buildDashboard` for that single day. */
export function dailySeries({ barbers, stats, blocks, shopHours, keys, now }) {
  const byDay = groupById(stats)
  return keys.map((key) => {
    const { totals } = buildDashboard({ barbers, stats: byDay.get(key) || [], blocks, shopHours, keys: [key], now })
    return {
      key,
      label: formatDay(key),
      completed: totals.completed,
      noShows: totals.noShows,
      valueCents: totals.valueCents,
      noShowRate: totals.noShowRate,
      utilisation: totals.utilisation,
    }
  })
}

/** Busiest weekdays: average completed bookings per occurrence of that weekday in `keys` (weekdays not in range are left out). */
export function weekdayBreakdown({ stats, keys }) {
  const byDay = groupById(stats)
  return WEEKDAYS.map((w) => {
    const days = keys.filter((k) => weekdayOf(k) === w.key)
    let completed = 0
    let noShows = 0
    for (const k of days) {
      for (const d of byDay.get(k) || []) {
        for (const c of Object.values(d.barbers || {})) { completed += c.completed || 0; noShows += c.noShows || 0 }
      }
    }
    return { ...w, days: days.length, completed, noShows, average: days.length ? completed / days.length : 0 }
  }).filter((w) => w.days > 0)
}

const KPI_SPECS = [
  { id: 'completed', label: 'Completed bookings', kind: 'count', lowerIsBetter: false, value: (t) => t.completed, format: (v) => String(v), spark: (d) => d.completed },
  { id: 'value', label: 'Booked value', kind: 'count', lowerIsBetter: false, value: (t) => t.valueCents, format: formatMoney, spark: (d) => d.valueCents },
  { id: 'noShow', label: 'No-show rate', kind: 'rate', lowerIsBetter: true, value: (t) => t.noShowRate, format: formatPercent, spark: (d) => d.noShowRate },
  { id: 'utilisation', label: 'Utilisation', kind: 'rate', lowerIsBetter: false, value: (t) => t.utilisation, format: formatPercent, spark: (d) => d.utilisation },
]

/** Sorts rows by `key`; null and undefined values always come last. Returns a new array. */
export function sortRows(rows, key, direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1
  const isNil = (v) => v === null || v === undefined
  return [...rows].sort((a, b) => {
    if (isNil(a[key]) && isNil(b[key])) return a.name.localeCompare(b.name)
    if (isNil(a[key])) return 1
    if (isNil(b[key])) return -1
    const diff = typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key]
    return diff * sign || a.name.localeCompare(b.name)
  })
}

const list = (items) => items.join(', ')

/**
 * Everything the dashboard draws. `stats` are dailyStats docs as { id: 'yyyymmdd', barbers } covering the range and the
 * previous period. Shows zero values and `empty: true` when the range has no completed or no-show bookings.
 */
export function buildAnalytics({ barbers, stats, blocks, shopHours, keys, now }) {
  const prevKeys = previousKeys(keys)
  const byDay = groupById(stats)
  const within = (list_) => list_.flatMap((k) => byDay.get(k) || [])
  const common = { barbers, blocks, shopHours, now }
  const current = buildDashboard({ ...common, stats: within(keys), keys })
  const previous = buildDashboard({ ...common, stats: within(prevKeys), keys: prevKeys })
  const daily = dailySeries({ ...common, stats: within(keys), keys })
  const days = keys.length

  const kpis = KPI_SPECS.map((k) => ({
    id: k.id,
    label: k.label,
    value: k.format(k.value(current.totals)),
    trend: compareMetric({ current: k.value(current.totals), previous: k.value(previous.totals), kind: k.kind, lowerIsBetter: k.lowerIsBetter, days }),
    spark: daily.map((d) => k.spark(d)),
    sparkLabels: daily.map((d) => d.label),
  }))

  const busiest = daily.reduce((best, d) => (d.completed + d.noShows > (best ? best.completed + best.noShows : 0) ? d : best), null)
  const range = days ? `${formatDay(keys[0])} to ${formatDay(keys[days - 1], true)}` : ''
  const dailySummary = current.empty
    ? `No completed or no-show bookings from ${range}.`
    : `${range}: ${current.totals.completed} completed and ${current.totals.noShows} no-show${current.totals.noShows === 1 ? '' : 's'}, ${formatMoney(current.totals.valueCents)} booked value. `
      + `Busiest day: ${formatDay(busiest.key)} with ${busiest.completed + busiest.noShows} booking${busiest.completed + busiest.noShows === 1 ? '' : 's'}.`

  // Utilisation chart: listed barbers with open time, highest first. Former barbers and barbers with no open time have none.
  const barberBars = sortRows(current.rows.filter((r) => r.utilisation !== null), 'utilisation', 'desc')
  const barberSummary = barberBars.length
    ? `Utilisation by barber, highest first: ${list(barberBars.map((r) => `${r.name} ${formatPercent(r.utilisation)}`))}.`
    : 'No barber has open time in this period, so there is no utilisation to show.'

  const weekdays = weekdayBreakdown({ stats: within(keys), keys })
  const top = weekdays.reduce((best, w) => (w.average > (best ? best.average : 0) ? w : best), null)
  const weekdaySummary = top
    ? `Busiest weekday: ${top.long}, averaging ${top.average.toFixed(1)} completed bookings a day. ${list(weekdays.map((w) => `${w.short} ${w.average.toFixed(1)}`))}.`
    : 'No completed bookings on any weekday in this period.'

  return {
    days,
    previousDays: prevKeys.length,
    empty: current.empty,
    totals: current.totals,
    rows: current.rows,
    kpis,
    daily,
    dailySummary,
    barberBars,
    barberSummary,
    weekdays,
    weekdaySummary,
  }
}

/**
 * SVG path for a sparkline in a `width` × `height` box. Null values leave gaps (a new "M" after a gap); a single
 * point is drawn as a short flat line so it stays visible. Returns '' when nothing can be drawn.
 */
export function sparklinePath(values, width = 96, height = 28, pad = 2) {
  const points = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null && p.v !== undefined && Number.isFinite(p.v))
  if (!points.length) return ''
  const min = Math.min(...points.map((p) => p.v))
  const max = Math.max(...points.map((p) => p.v))
  const span = max - min
  const x = (i) => (values.length > 1 ? pad + (i / (values.length - 1)) * (width - 2 * pad) : width / 2)
  const y = (v) => (span === 0 ? height / 2 : height - pad - ((v - min) / span) * (height - 2 * pad))
  let path = ''
  let previous = null
  for (const p of points) {
    path += `${previous !== null && p.i === previous + 1 ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`
    previous = p.i
  }
  return points.length === 1 ? `${path}h3` : path
}

/** Table data for a chart's "View as table" view: { columns: [{ key, label, align }], rows: [{ ...cells as text }] }. */
export function dailyTable(daily) {
  return {
    columns: [{ key: 'date', label: 'Date' }, { key: 'completed', label: 'Completed', numeric: true },
      { key: 'noShows', label: 'No-shows', numeric: true }, { key: 'value', label: 'Booked value', numeric: true }],
    rows: daily.map((d) => ({ date: d.label, completed: String(d.completed), noShows: String(d.noShows), value: formatMoney(d.valueCents) })),
  }
}

export function barberTable(rows) {
  return {
    columns: [{ key: 'name', label: 'Barber' }, { key: 'utilisation', label: 'Utilisation', numeric: true },
      { key: 'bookedMin', label: 'Completed minutes', numeric: true }, { key: 'openMin', label: 'Open minutes', numeric: true }],
    rows: rows.map((r) => ({ name: r.name, utilisation: formatPercent(r.utilisation), bookedMin: String(r.bookedMin), openMin: String(r.openMin) })),
  }
}

export function weekdayTable(weekdays) {
  return {
    columns: [{ key: 'day', label: 'Day' }, { key: 'days', label: 'Days in range', numeric: true },
      { key: 'completed', label: 'Completed', numeric: true }, { key: 'average', label: 'Average per day', numeric: true }],
    rows: weekdays.map((w) => ({ day: w.long, days: String(w.days), completed: String(w.completed), average: w.average.toFixed(1) })),
  }
}

export { dayKeys, NONE }
