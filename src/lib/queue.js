// FR-10 / UI-B2 (decisions A5 addendum): the delay projection and the warning rule, plus what the queue
// screen shows. `project` and `warningDecision` are a copy of functions/queueDelay.js (the server is
// authoritative and writes the warnings); tests/queue.unit.test.mjs runs both on the same cases, so
// change both together. No Firebase imports, so node tests can load it. Times are epoch ms.
import { formatTime } from './slots.js'

const MINUTE_MS = 60 * 1000
export const DELAY_THRESHOLD_MS = 10 * MINUTE_MS // warn when delay is over this
export const WARN_LEAD_MS = 15 * MINUTE_MS // and this long before the start

/**
 * @param {number} ms A duration in ms.
 * @return {number} Whole minutes, rounded up.
 */
export function minutesUp(ms) {
  return ms <= 0 ? 0 : Math.ceil(ms / MINUTE_MS)
}

/**
 * @param {string} a First ID.
 * @param {string} b Second ID.
 * @return {number} Sort order for ties.
 */
function byId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Projects one barber's timeline.
 *
 * The barber is free at max(now, latest expected end of what is in service),
 * where a service expects to end at actualStart + durationMin. Unstarted
 * bookings are chained in start order: each starts at max(its start, when the
 * barber is free), and a booking's delay is that start minus its own. Waiting
 * walk-ins never delay a booking (bookings first); each is placed, in join
 * order and never ahead of an earlier walk-in, at the first time that does
 * not overlap a booking's projected interval.
 * @param {Object} input {now, inService: [{actualStart, durationMin}],
 *   bookings: [{id, start, durationMin}] (unstarted CONFIRMED only),
 *   walkIns: [{id, joinedAt, durationMin}] (waiting only)}.
 * @return {Object} {freeAt, bookings: [{id, start, delayMs, delayMin,
 *   projectedStart}], walkIns: [{id, estimatedStart, waitMin}]}.
 */
export function project({now, inService, bookings, walkIns}) {
  const freeAt = inService.reduce(
      (latest, s) => Math.max(latest, s.actualStart + s.durationMin * MINUTE_MS),
      now)

  // A booking whose slot is over and that never started is treated as missed.
  const live = bookings
      .filter((b) => b.start + b.durationMin * MINUTE_MS > now)
      .sort((a, b) => a.start - b.start || byId(a.id, b.id))
  let cursor = freeAt
  const projected = live.map((b) => {
    const projectedStart = Math.max(b.start, cursor)
    const delayMs = projectedStart - b.start
    cursor = projectedStart + b.durationMin * MINUTE_MS
    return {
      id: b.id, start: b.start, delayMs, delayMin: minutesUp(delayMs),
      projectedStart, durationMin: b.durationMin,
    }
  })

  let t = freeAt
  const waits = [...walkIns]
      .sort((a, b) => a.joinedAt - b.joinedAt || byId(a.id, b.id))
      .map((w) => {
        const dur = w.durationMin * MINUTE_MS
        for (const b of projected) {
          const bStart = b.projectedStart
          const bEnd = bStart + b.durationMin * MINUTE_MS
          if (t + dur <= bStart) break; // fits before this booking.
          if (t < bEnd) t = Math.max(t, bEnd); // overlaps: goes after it.
        }
        const estimatedStart = t
        t += dur
        return {
          id: w.id, estimatedStart,
          waitMin: minutesUp(estimatedStart - now),
        }
      })

  return {
    freeAt,
    bookings: projected.map(({durationMin, ...rest}) => rest),
    walkIns: waits,
  }
}

/**
 * Whether a delay warning should be written now. Over 10 minutes is strict
 * (exactly 10 is not over). The warning must be detectable at least 15
 * minutes before the start (exactly 15 is allowed). At most once: any
 * existing task blocks it.
 * @param {Object} input {delayMs, start, now, taskExists}.
 * @return {{warn: boolean, reason: string}} reason is 'warn',
 *   'within_threshold', 'already_exists' or 'too_late'.
 */
export function warningDecision({delayMs, start, now, taskExists}) {
  if (!(delayMs > DELAY_THRESHOLD_MS)) {
    return {warn: false, reason: 'within_threshold'}
  }
  if (taskExists) return {warn: false, reason: 'already_exists'}
  if (now > start - WARN_LEAD_MS) return {warn: false, reason: 'too_late'}
  return {warn: true, reason: 'warn'}
}

export const MAX_WARNING_ATTEMPTS = 3

/** "On time" or "Delayed N min": a word, never colour alone. */
export const delayLabel = (delayMin) => (delayMin > 0 ? `Delayed ${delayMin} min` : 'On time')

/** A waiting walk-in's estimated wait. */
export const waitLabel = (waitMin) => (waitMin > 0 ? `About ${waitMin} min` : 'Next up')

/**
 * The warning status of one upcoming booking. `task` is that booking's delay task (or null):
 * {status, sentAt}. A task that exists wins over the delay now, because the warning was still sent.
 * @returns {{key: string, label: string}}
 */
export function warningStatus({ delayMs, start, now, task }) {
  if (task) {
    if (task.status === 'sent') return { key: 'sent', label: `Warning sent ${task.sentAt ? formatTime(task.sentAt) : ''}`.trim() }
    if (task.status === 'failed') return { key: 'failed', label: `Warning failed after ${MAX_WARNING_ATTEMPTS} attempts` }
    if (task.status === 'cancelled') return { key: 'cancelled', label: 'Warning cancelled (the booking changed)' }
    return { key: 'queued', label: 'Warning queued' }
  }
  const d = warningDecision({ delayMs, start, now, taskExists: false })
  if (d.reason === 'within_threshold') return { key: 'not_needed', label: 'No warning needed (10 min or less)' }
  if (d.reason === 'too_late') return { key: 'too_late', label: 'Not sent: too close to the start' }
  return { key: 'pending_detection', label: 'Warning will be sent shortly' }
}

/** Firestore queue entry -> plain ms fields. */
export function toWalkIn(id, data) {
  return {
    id,
    barberId: data.barberId,
    walkInName: data.walkInName,
    serviceId: data.serviceId,
    durationMin: data.durationMin,
    status: data.status,
    joinedAt: data.joinedAt ? data.joinedAt.toMillis() : 0,
    actualStart: data.actualStart ? data.actualStart.toMillis() : null,
    actualEnd: data.actualEnd ? data.actualEnd.toMillis() : null,
  }
}

/** Firestore delay notification -> {status, sentAt} for warningStatus. */
export function toDelayTask(id, data) {
  const sent = [...(data.attempts ?? [])].reverse().find((a) => a.outcome === 'sent')
  return { id, bookingId: data.bookingId, status: data.status, sentAt: sent ? sent.at.toMillis() : null, delayMin: data.delayMin ?? null }
}

/**
 * Splits one barber's appointments and queue into the projection's input. Only unstarted CONFIRMED bookings
 * are projected; IN_SERVICE bookings and in-service walk-ins are what the barber is doing; waiting
 * walk-ins are the queue.
 */
export function projectionInput(now, appointments, walkIns) {
  const inService = [
    ...appointments.filter((a) => a.status === 'IN_SERVICE' && a.actualStart != null),
    ...walkIns.filter((w) => w.status === 'in_service' && w.actualStart != null),
  ].map((x) => ({ actualStart: x.actualStart, durationMin: x.durationMin }))
  return {
    now,
    inService,
    bookings: appointments.filter((a) => a.status === 'CONFIRMED').map((a) => ({ id: a.id, start: a.start, durationMin: a.durationMin })),
    walkIns: walkIns.filter((w) => w.status === 'waiting').map((w) => ({ id: w.id, joinedAt: w.joinedAt, durationMin: w.durationMin })),
  }
}
