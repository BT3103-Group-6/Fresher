// FR-14 / UI-O2: pure dashboard logic (no Firebase imports, so node tests can load it). Formulas follow
// decisions A7: no-show rate = NO_SHOW / (COMPLETED + NO_SHOW); utilisation = completed minutes / open minutes,
// where open minutes = working hours within shop hours, minus blocks, clipped to now. Dates are Asia/Singapore.
import { DAY_MS, sgDateKey, sgTimeToMs, weekdayOf } from './slots.js'

export const MAX_RANGE_DAYS = 92
export const NONE = '—'

/** 'yyyy-mm-dd' (date input value) to 'yyyymmdd', or null when it is not a real calendar date. */
export function inputToKey(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  return m[1] + m[2] + m[3]
}

export const keyToInput = (key) => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

/** Every Singapore date key from `fromKey` to `toKey` inclusive. */
export function dayKeys(fromKey, toKey) {
  const keys = []
  for (let ms = sgTimeToMs(fromKey, '12:00'); sgDateKey(ms) <= toKey; ms += DAY_MS) keys.push(sgDateKey(ms))
  return keys
}

/** Field-level messages for a from/to pair of date inputs; an empty object means the range is valid. */
export function validateRange(from, to) {
  const errors = {}
  const a = inputToKey(from)
  const b = inputToKey(to)
  if (!a) errors.from = 'Enter a start date.'
  if (!b) errors.to = 'Enter an end date.'
  if (a && b) {
    if (a > b) errors.to = 'The end date must be on or after the start date.'
    else if (dayKeys(a, b).length > MAX_RANGE_DAYS) errors.to = `Choose a range of at most ${MAX_RANGE_DAYS} days.`
  }
  return errors
}

/** Preset ranges ending today, as date input values. */
export function presetRange(name, now = Date.now()) {
  const today = sgDateKey(now)
  const at = (offsetDays) => keyToInput(sgDateKey(sgTimeToMs(today, '12:00') + offsetDays * DAY_MS))
  if (name === 'last7') return { from: at(-6), to: keyToInput(today) }
  if (name === 'month') return { from: keyToInput(today.slice(0, 6) + '01'), to: keyToInput(today) }
  return { from: at(-29), to: keyToInput(today) } // 'last30', the default.
}

const ZERO = () => ({ completed: 0, valueCents: 0, noShows: 0, bookedMin: 0 })
const FIELDS = Object.keys(ZERO())

/** Adds up dailyStats docs ([{ barbers: { [barberId]: counters } }]) into per-barber counters. */
export function sumStats(docs) {
  const byBarber = {}
  for (const doc of docs) {
    for (const [id, c] of Object.entries((doc && doc.barbers) || {})) {
      const row = (byBarber[id] ||= ZERO())
      for (const f of FIELDS) row[f] += c[f] || 0
    }
  }
  return byBarber
}

export function noShowRate({ completed, noShows }) {
  const denominator = completed + noShows
  return denominator > 0 ? noShows / denominator : null
}

export function utilisation(bookedMin, openMin) {
  return openMin > 0 ? bookedMin / openMin : null
}

const clip = (segments, from, to) =>
  segments.map(([s, e]) => [Math.max(s, from), Math.min(e, to)]).filter(([s, e]) => s < e)

/** Overlap of two lists of [start, end) intervals. */
function intersect(a, b) {
  const out = []
  for (const [s1, e1] of a) {
    for (const [s2, e2] of b) {
      const s = Math.max(s1, s2)
      const e = Math.min(e1, e2)
      if (s < e) out.push([s, e])
    }
  }
  return out
}

/** Removes the blocked intervals from `segments`; blocks are merged first so overlaps are never subtracted twice. */
function subtract(segments, blocks) {
  const merged = []
  for (const [s, e] of [...blocks].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  let out = segments
  for (const [bs, be] of merged) {
    out = out.flatMap(([s, e]) => {
      if (be <= s || bs >= e) return [[s, e]]
      const parts = []
      if (bs > s) parts.push([s, bs])
      if (be < e) parts.push([be, e])
      return parts
    })
  }
  return out
}

/**
 * Open minutes for one barber over `keys`: their working hours within the shop's opening hours (when known),
 * minus their blocks, counting only time up to `now`. `blocks` are [{ start, end }] in ms for this barber.
 */
export function openMinutes({ workingHours, shopHours, blocks = [], keys, now }) {
  let total = 0
  for (const key of keys) {
    const day = weekdayOf(key)
    const toMs = (ranges) => (ranges || []).map((r) => [sgTimeToMs(key, r.start), sgTimeToMs(key, r.end)])
    let open = toMs(workingHours?.[day])
    if (shopHours) open = intersect(open, toMs(shopHours[day]))
    open = clip(open, -Infinity, now)
    open = subtract(open, blocks.map((b) => [b.start, b.end]))
    total += open.reduce((sum, [s, e]) => sum + (e - s) / 60e3, 0)
  }
  return Math.round(total)
}

/**
 * The dashboard table. `barbers` is [{ id, displayName, active, workingHours }], `stats` the dailyStats docs
 * for the range, `blocks` [{ barberId, start, end }] (ms). Every active barber gets a row, even with no
 * bookings. A barber who is no longer listed but has stats becomes a "Former barber" row with no open time.
 * Inactive barbers have no open time. Totals use utilisation over listed barbers only.
 */
export function buildDashboard({ barbers, stats, blocks, shopHours, keys, now }) {
  const sums = sumStats(stats)
  const ids = new Set([...barbers.filter((b) => b.active !== false).map((b) => b.id), ...Object.keys(sums)])
  const rows = [...ids].map((id) => {
    const barber = barbers.find((b) => b.id === id)
    const counters = sums[id] || ZERO()
    const openMin = barber && barber.active !== false
      ? openMinutes({
        workingHours: barber.workingHours, shopHours, keys, now, blocks: blocks.filter((b) => b.barberId === id),
      })
      : 0
    return {
      id,
      name: barber ? barber.displayName : 'Former barber',
      ...counters,
      openMin,
      noShowRate: noShowRate(counters),
      utilisation: utilisation(counters.bookedMin, openMin),
    }
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

  const totals = ZERO()
  let openMin = 0
  let listedBooked = 0
  for (const r of rows) {
    for (const f of FIELDS) totals[f] += r[f]
    openMin += r.openMin
    if (r.name !== 'Former barber') listedBooked += r.bookedMin
  }
  return {
    rows,
    totals: { ...totals, openMin, noShowRate: noShowRate(totals), utilisation: utilisation(listedBooked, openMin) },
    empty: totals.completed + totals.noShows === 0,
  }
}

export const formatMoney = (cents) => `S$${(cents / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const formatPercent = (ratio) => (ratio === null ? NONE : `${Math.round(ratio * 100)}%`)
