// FR-08 / UI-B1: pure day-view logic (no Firebase imports, so node tests can load it).
import { DAY_MS, formatDate, formatTime, sgDateKey, sgTimeToMs } from './slots.js'

const LIVE = ['PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW']
export const STATUS_LABELS = {
  HELD: 'Awaiting customer verification',
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  IN_SERVICE: 'In service',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}

/** [start, end) in ms of a Singapore calendar day (yyyymmdd). */
export function dayBounds(dateKey) {
  const start = sgTimeToMs(dateKey, '00:00')
  return { start, end: start + DAY_MS }
}

/**
 * The status to show. A HELD appointment whose hold has passed is EXPIRED, whatever the stored status
 * says, because expired holds stay HELD until the cleanup job runs (limitation L2). `holdExpiresAt <= now`
 * is expired, matching the server.
 */
export function displayStatus(apt, now) {
  if (apt.status === 'HELD' && !(apt.holdExpiresAt > now)) return 'EXPIRED'
  return apt.status
}

/** True for anything that occupies the barber's time: a live booking or a live hold. */
export const isActive = (apt, now) => {
  const s = displayStatus(apt, now)
  return s === 'HELD' || LIVE.includes(s)
}

/** True for confirmed-style bookings, not holds (used for the day's booking count). */
export const isBooking = (apt, now) => LIVE.includes(displayStatus(apt, now))

/**
 * Splits a day's appointments into those on the timeline and those hidden by default
 * (cancelled, expired, and expired holds), each sorted by start.
 */
export function partitionDay(appointments, now) {
  const byStart = (a, b) => a.start - b.start || a.id.localeCompare(b.id)
  const active = appointments.filter((a) => isActive(a, now)).sort(byStart)
  const inactive = appointments.filter((a) => !isActive(a, now)).sort(byStart)
  return { active, inactive }
}

/** Blocks that overlap an appointment (half-open intervals). */
export const overlappingBlocks = (apt, blocks) => blocks.filter((b) => b.start < apt.end && apt.start < b.end)

// FR-12 windows (decisions A5). The server enforces them with its own clock; these only decide what to show.
export const START_EARLY_MS = 60 * 60e3
export const NO_SHOW_AFTER_MS = 15 * 60e3
export const REVERSAL_MS = 24 * 3600e3

/**
 * Staff actions to offer for an appointment: [{ action, label, enabled, availableAt? }].
 * A disabled action carries `availableAt` (ms) so the row can say when it unlocks. Reverse disappears once
 * its 24 h window has closed; `start` unlocks 60 min before the slot, `noShow` 15 min after it starts.
 */
export function availableActions(apt, now) {
  const status = displayStatus(apt, now)
  if (status === 'CONFIRMED') {
    const startAt = apt.start - START_EARLY_MS
    const noShowAt = apt.start + NO_SHOW_AFTER_MS
    return [
      { action: 'start', label: 'Start', enabled: now >= startAt, availableAt: startAt },
      { action: 'noShow', label: 'Mark no-show', enabled: now >= noShowAt, availableAt: noShowAt },
    ]
  }
  if (status === 'IN_SERVICE') return [{ action: 'finish', label: 'Finish', enabled: true }]
  if (status === 'NO_SHOW' && apt.noShowAt && now <= apt.noShowAt + REVERSAL_MS) {
    return [{ action: 'reverse', label: 'Reverse no-show', enabled: true }]
  }
  return []
}

/** Firestore appointment data (Timestamps) -> plain ms fields. */
export function toAppointment(id, data) {
  return {
    id,
    barberId: data.barberId,
    serviceId: data.serviceId,
    status: data.status,
    start: data.start.toMillis(),
    end: data.end.toMillis(),
    holdExpiresAt: data.holdExpiresAt ? data.holdExpiresAt.toMillis() : null,
    customerName: data.customerName ?? null,
    customerPhoneMasked: data.customerPhoneMasked ?? null,
    priceCents: data.priceCents,
    durationMin: data.durationMin,
    noShowAt: data.noShowAt ? data.noShowAt.toMillis() : null,
    actualStart: data.actualStart ? data.actualStart.toMillis() : null,
    actualEnd: data.actualEnd ? data.actualEnd.toMillis() : null,
  }
}

// ---- FR-09 reminder status (decisions A4 addendum) ----
export const REMINDER_TYPES = [
  { type: 'confirmation', label: 'Confirmation' },
  { type: 'reminder24h', label: '24 h reminder' },
  { type: 'reminder2h', label: '2 h reminder' },
]
export const MAX_REMINDER_ATTEMPTS = 3 // the first try plus 2 retries; mirrors functions/sweep.js

/** notifications doc (Timestamps) -> plain fields. Attempts are reduced to the ones for the current `rev`. */
export function toReminderTask(id, data) {
  const attempts = (data.attempts ?? [])
    .filter((a) => a.rev === data.rev)
    .map((a) => ({ at: a.at.toMillis(), outcome: a.outcome, error: a.error ?? null }))
  return {
    id,
    bookingId: data.bookingId,
    type: data.type,
    status: data.status,
    dueAt: data.dueAt.toMillis(),
    nextAttemptAt: data.nextAttemptAt ? data.nextAttemptAt.toMillis() : null,
    // When the reminders were last planned (the confirmation task carries it); older tasks only have createdAt.
    plannedAt: (data.plannedAt ?? data.createdAt)?.toMillis() ?? null,
    cancelReason: data.cancelReason ?? null,
    attempts,
  }
}

/** "10:00 AM" for today, "Mon, 7 Jan 10:00 AM" for another Singapore day. */
function when(ms, now) {
  return sgDateKey(ms) === sgDateKey(now) ? formatTime(ms) : `${formatDate(ms)} ${formatTime(ms)}`
}

const CANCEL_TEXT = {
  booking_cancelled: 'Cancelled with the booking',
  past_due: 'Not needed after the booking was moved',
  stale: 'Cancelled: the booking changed',
}

const REMINDER_LEAD_MS = { reminder24h: 24 * 3600e3, reminder2h: 2 * 3600e3 }

/**
 * Why a booking has no task of this type. "Too close" only when we know when the reminders were planned
 * (the confirmation task's `plannedAt`) and that moment was already past the reminder's due time
 * (start - 24 h or start - 2 h), which is the server's skip rule. Anything else, such as a booking made
 * before FR-09 (no tasks at all), is simply "not recorded"; it is never blamed on short notice.
 */
function missingReason(type, tasks, start) {
  if (type === 'confirmation') return { state: 'missing', text: 'No confirmation recorded' }
  const plannedAt = tasks.find((x) => x.type === 'confirmation')?.plannedAt
  if (plannedAt != null && plannedAt > start - REMINDER_LEAD_MS[type]) {
    return { state: 'not-scheduled', text: 'Not scheduled: booked too close to the start' }
  }
  return { state: 'missing', text: 'No reminder recorded' }
}

/**
 * Reminder status for one appointment, from that appointment's tasks (any order) and its start (ms).
 * Always three rows, so a missing reminder is visible: [{ type, label, state, text }]. `state` is one of
 * sent, scheduled, retrying, failed, cancelled, not-scheduled (booked too close), missing (nothing
 * recorded); `text` always says it in words (never colour alone).
 */
export function reminderSummary(tasks, now, start) {
  return REMINDER_TYPES.map(({ type, label }) => {
    const t = tasks.find((x) => x.type === type)
    if (!t) return { type, label, ...missingReason(type, tasks, start) }
    const failed = t.attempts.filter((a) => a.outcome === 'failed').length
    if (t.status === 'sent') {
      const sent = [...t.attempts].reverse().find((a) => a.outcome === 'sent')
      return { type, label, state: 'sent', text: sent ? `Sent ${when(sent.at, now)}` : 'Sent' }
    }
    if (t.status === 'failed') {
      return { type, label, state: 'failed', text: `Failed after ${t.attempts.length} attempts` }
    }
    if (t.status === 'cancelled') {
      return { type, label, state: 'cancelled', text: CANCEL_TEXT[t.cancelReason] ?? 'Cancelled' }
    }
    if (failed > 0) {
      const next = t.nextAttemptAt ? ` at ${when(t.nextAttemptAt, now)}` : ''
      return { type, label, state: 'retrying', text: `Retrying${next}, attempt ${failed + 1} of ${MAX_REMINDER_ATTEMPTS}` }
    }
    return { type, label, state: 'scheduled', text: `Due ${when(t.dueAt, now)}` }
  })
}

/** Groups tasks by booking ID. */
export function tasksByBooking(tasks) {
  const out = {}
  for (const t of tasks) (out[t.bookingId] ??= []).push(t)
  return out
}

/** Firestore block data -> plain ms fields. */
export const toBlock = (id, data) => ({
  id,
  barberId: data.barberId,
  start: data.start.toMillis(),
  end: data.end.toMillis(),
  reason: data.reason || '',
})

/** 15-minute time options ("HH:MM") for the block form; `endOfDay` adds "24:00" for a block running to midnight. */
export function timeOptions({ endOfDay = false } = {}) {
  const out = []
  for (let m = 0; m < 24 * 60; m += 15) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  return endOfDay ? [...out.slice(1), '24:00'] : out
}

/** "HH:MM" on a Singapore date -> ms; "24:00" is midnight at the end of that day. */
export function blockTimeToMs(dateKey, hhmm) {
  return hhmm === '24:00' ? dayBounds(dateKey).end : sgTimeToMs(dateKey, hhmm)
}

/** Field-level validation for the block form; returns {field: message}. */
export function validateBlockForm({ dateKey, start, end }, now = Date.now()) {
  const errors = {}
  if (!dateKey) errors.date = 'Choose a date.'
  if (!start) errors.start = 'Choose a start time.'
  if (!end) errors.end = 'Choose an end time.'
  if (errors.date || errors.start || errors.end) return errors
  const s = blockTimeToMs(dateKey, start)
  const e = blockTimeToMs(dateKey, end)
  if (e <= s) errors.end = 'End time must be after the start time.'
  else if (e <= now) errors.start = 'That time has already passed.'
  return errors
}

