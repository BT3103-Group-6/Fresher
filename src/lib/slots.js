// FR-02: client-side slot computation. The server (functions/booking.js) re-checks every rule in
// holdSlot, so this only decides what to offer. Singapore has no DST, so a fixed +8h offset is exact.
export const SG_OFFSET_MS = 8 * 3600e3
export const MINUTE_MS = 60e3
export const DAY_MS = 24 * 60 * MINUTE_MS
export const GRID_MS = 15 * MINUTE_MS // decisions A3
export const HORIZON_DAYS = 14 // decisions A3: today to +13 days
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export function sgDateKey(ms) {
  return new Date(ms + SG_OFFSET_MS).toISOString().slice(0, 10).replaceAll('-', '')
}

export function sgTimeToMs(dateKey, hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8), h, m) - SG_OFFSET_MS
}

export function weekdayOf(dateKey) {
  return DAYS[(new Date(sgTimeToMs(dateKey, '12:00') + SG_OFFSET_MS).getUTCDay() + 6) % 7]
}

const dateLabel = new Intl.DateTimeFormat('en-SG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' })
const timeLabel = new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' })
export const formatDate = (ms) => dateLabel.format(ms)
export const formatTime = (ms) => timeLabel.format(ms).replace(/\s?([ap])m/i, (_, x) => ` ${x.toUpperCase()}M`)

/** The bookable dates: today through +13 days, Singapore time. */
export function dateOptions(now = Date.now(), days = HORIZON_DAYS) {
  const today = sgTimeToMs(sgDateKey(now), '12:00')
  return Array.from({ length: days }, (_, i) => {
    const ms = today + i * DAY_MS
    return { key: sgDateKey(ms), label: formatDate(ms) }
  })
}

const blocking = (iv, now) => !(iv.kind === 'hold' && iv.holdExpiresAt <= now)

/**
 * Start times (ms) for one barber on one date. Intervals are half-open [start, end), so back-to-back
 * bookings do not conflict. Expired holds are ignored, as they are on the server.
 * @param {{ranges: {start: string, end: string}[], shopRanges?: {start: string, end: string}[], dateKey: string,
 *   durationMin: number, intervals: {start: number, end: number, kind: string, holdExpiresAt?: number}[], now?: number}} a
 */
export function freeSlots({ ranges, shopRanges, dateKey, durationMin, intervals, now = Date.now() }) {
  const busy = (intervals || []).filter((iv) => blocking(iv, now))
  const within = (list, s, e) => list.some((r) => sgTimeToMs(dateKey, r.start) <= s && e <= sgTimeToMs(dateKey, r.end))
  const slots = []
  for (const r of ranges || []) {
    const first = Math.ceil(sgTimeToMs(dateKey, r.start) / GRID_MS) * GRID_MS
    for (let s = first; ; s += GRID_MS) {
      const e = s + durationMin * MINUTE_MS
      if (e > sgTimeToMs(dateKey, r.end)) break
      if (s <= now) continue
      if (shopRanges && !within(shopRanges, s, e)) continue
      if (busy.some((iv) => iv.start < e && s < iv.end)) continue
      slots.push(s)
    }
  }
  return slots
}

/** Firestore Timestamps -> millisecond intervals for freeSlots. */
export function toIntervals(raw) {
  return (raw || []).map((iv) => ({
    start: iv.start.toMillis(),
    end: iv.end.toMillis(),
    kind: iv.kind,
    holdExpiresAt: iv.holdExpiresAt ? iv.holdExpiresAt.toMillis() : undefined,
  }))
}

/**
 * Bookable start times (ms) across barbers for one date, shared by UI-C2 and the UI-C1 next-slot lookup.
 * Only active barbers offering the service count; shop hours, working hours, busy intervals and past
 * times are handled by freeSlots.
 * @param {{barbers: object[], shopHours?: object, dateKey: string, durationMin: number,
 *   schedules: Record<string, object[]>, now?: number}} a
 */
export function slotsForBarbers({ barbers, shopHours, dateKey, durationMin, schedules, now = Date.now() }) {
  const day = weekdayOf(dateKey)
  const all = new Set()
  for (const b of barbers) {
    if (b.active === false) continue
    freeSlots({
      ranges: b.workingHours?.[day],
      shopRanges: shopHours?.[day],
      dateKey,
      durationMin,
      intervals: schedules[b.id],
      now,
    }).forEach((s) => all.add(s))
  }
  return [...all].sort((a, b) => a - b)
}
