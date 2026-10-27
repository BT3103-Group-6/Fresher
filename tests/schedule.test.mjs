// FR-08 / UI-B1 pure day-view logic: expired holds are never live bookings (limitation L2), block overlap
// flags and the block form's validation. No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_REMINDER_ATTEMPTS, availableActions, isHeldStatus, reminderSummary, tasksByBooking, toReminderTask, blockTimeToMs, dayBounds, displayStatus, isActive, isBooking, overlappingBlocks, partitionDay, timeOptions, toAppointment, validateBlockForm } from '../src/lib/schedule.js'
import { sgTimeToMs } from '../src/lib/slots.js'

const KEY = '20300107'
const at = (hhmm) => sgTimeToMs(KEY, hhmm)
const NOW = at('12:00')
const apt = (id, status, s, e, extra = {}) => ({ id, status, start: at(s), end: at(e), holdExpiresAt: null, ...extra })

describe('displayStatus (L2: expired holds are never live)', () => {
  it('shows a HELD appointment past its expiry as EXPIRED', () => {
    assert.equal(displayStatus(apt('a', 'HELD', '10:00', '10:30', { holdExpiresAt: NOW - 1 }), NOW), 'EXPIRED')
  })
  it('treats a hold expiring exactly now as expired, matching the server', () => {
    assert.equal(displayStatus(apt('a', 'HELD', '13:00', '13:30', { holdExpiresAt: NOW }), NOW), 'EXPIRED')
    assert.equal(displayStatus(apt('a', 'HELD', '13:00', '13:30', { holdExpiresAt: NOW + 1 }), NOW), 'HELD')
  })
  it('expires a HELD appointment with no expiry recorded rather than trusting it', () => {
    assert.equal(displayStatus(apt('a', 'HELD', '13:00', '13:30'), NOW), 'EXPIRED')
  })
  it('leaves other statuses alone, even with an old holdExpiresAt', () => {
    for (const status of ['CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED']) {
      assert.equal(displayStatus(apt('a', status, '10:00', '10:30', { holdExpiresAt: NOW - 1e6 }), NOW), status)
    }
  })
  it('flips from live to expired as time passes', () => {
    const hold = apt('a', 'HELD', '13:00', '13:30', { holdExpiresAt: NOW + 60e3 })
    assert.equal(isActive(hold, NOW), true)
    assert.equal(isActive(hold, NOW + 60e3), false)
  })
})

describe('partitionDay', () => {
  const list = [
    apt('conf', 'CONFIRMED', '15:00', '15:30'),
    apt('liveHold', 'HELD', '13:00', '13:30', { holdExpiresAt: NOW + 5 * 60e3 }),
    apt('deadHold', 'HELD', '10:00', '10:30', { holdExpiresAt: NOW - 5 * 60e3 }),
    apt('cancelled', 'CANCELLED', '11:00', '11:30'),
    apt('expired', 'EXPIRED', '09:00', '09:30'),
    apt('done', 'COMPLETED', '09:30', '10:00'),
  ]
  it('puts live bookings and live holds on the timeline, sorted by start', () => {
    assert.deepEqual(partitionDay(list, NOW).active.map((a) => a.id), ['done', 'liveHold', 'conf'])
  })
  it('hides expired holds, cancelled and expired ones by default', () => {
    assert.deepEqual(partitionDay(list, NOW).inactive.map((a) => a.id), ['expired', 'deadHold', 'cancelled'])
  })
  it('never counts an expired hold or a live hold as a booking', () => {
    assert.equal(list.filter((a) => isBooking(a, NOW)).length, 2)
    assert.equal(isBooking(list[2], NOW), false)
    assert.equal(isBooking(list[1], NOW), false)
  })
})

describe('overlappingBlocks', () => {
  const block = { id: 'k', start: at('10:00'), end: at('11:00') }
  it('flags any overlap but treats adjacent times as free (half-open)', () => {
    assert.equal(overlappingBlocks(apt('a', 'CONFIRMED', '10:30', '11:30'), [block]).length, 1)
    assert.equal(overlappingBlocks(apt('a', 'CONFIRMED', '09:30', '10:00'), [block]).length, 0)
    assert.equal(overlappingBlocks(apt('a', 'CONFIRMED', '11:00', '11:30'), [block]).length, 0)
    assert.equal(overlappingBlocks(apt('a', 'CONFIRMED', '09:00', '12:00'), [block]).length, 1)
  })
})

describe('day bounds and Firestore mapping', () => {
  it('spans one Singapore day', () => {
    const { start, end } = dayBounds(KEY)
    assert.equal(start, at('00:00'))
    assert.equal(end - start, 24 * 3600e3)
  })
  it('maps Timestamps to milliseconds', () => {
    const ts = (ms) => ({ toMillis: () => ms })
    const out = toAppointment('x', { barberId: 'b1', status: 'HELD', start: ts(1), end: ts(2), holdExpiresAt: ts(3) })
    assert.deepEqual([out.start, out.end, out.holdExpiresAt, out.customerName], [1, 2, 3, null])
  })
})

describe('block form', () => {
  it('offers a 15-minute grid, with 24:00 as an end time only', () => {
    assert.equal(timeOptions().length, 96)
    assert.equal(timeOptions()[0], '00:00')
    assert.equal(timeOptions().at(-1), '23:45')
    assert.equal(timeOptions({ endOfDay: true })[0], '00:15')
    assert.equal(timeOptions({ endOfDay: true }).at(-1), '24:00')
  })
  it('turns 24:00 into midnight at the end of the chosen day', () => {
    assert.equal(blockTimeToMs(KEY, '24:00'), dayBounds(KEY).end)
    assert.equal(blockTimeToMs(KEY, '10:15'), at('10:15'))
  })
  it('names each missing field', () => {
    assert.deepEqual(Object.keys(validateBlockForm({ dateKey: '', start: '', end: '' }, NOW)).sort(), ['date', 'end', 'start'])
    assert.deepEqual(Object.keys(validateBlockForm({ dateKey: KEY, start: '13:00', end: '' }, NOW)), ['end'])
  })
  it('requires the end after the start, and not entirely in the past', () => {
    assert.ok(validateBlockForm({ dateKey: KEY, start: '14:00', end: '14:00' }, NOW).end)
    assert.ok(validateBlockForm({ dateKey: KEY, start: '15:00', end: '14:00' }, NOW).end)
    assert.ok(validateBlockForm({ dateKey: KEY, start: '10:00', end: '11:00' }, NOW).start)
    assert.deepEqual(validateBlockForm({ dateKey: KEY, start: '11:00', end: '12:30' }, NOW), {})
    assert.deepEqual(validateBlockForm({ dateKey: KEY, start: '22:00', end: '24:00' }, NOW), {})
  })
})

describe('availableActions (FR-12)', () => {
  const ids = (a, now) => availableActions(a, now).map((x) => `${x.action}:${x.enabled}`)
  const conf = apt('a', 'CONFIRMED', '14:00', '14:30')
  it('start unlocks exactly 60 minutes before the start; no-show 15 minutes after', () => {
    assert.deepEqual(ids(conf, at('13:00') - 1), ['start:false', 'noShow:false'])
    assert.deepEqual(ids(conf, at('13:00')), ['start:true', 'noShow:false'])
    assert.deepEqual(ids(conf, at('14:15') - 1), ['start:true', 'noShow:false'])
    assert.deepEqual(ids(conf, at('14:15')), ['start:true', 'noShow:true'])
  })
  it('a disabled action says when it unlocks', () => {
    const [start, noShow] = availableActions(conf, at('10:00'))
    assert.equal(start.availableAt, at('13:00'))
    assert.equal(noShow.availableAt, at('14:15'))
  })
  it('in-service offers finish; reverse shows only within 24 hours of marking', () => {
    assert.deepEqual(ids(apt('a', 'IN_SERVICE', '10:00', '10:30'), NOW), ['finish:true'])
    const ns = apt('a', 'NO_SHOW', '10:00', '10:30', { noShowAt: NOW })
    assert.deepEqual(ids(ns, NOW + 24 * 3600e3), ['reverse:true'])
    assert.deepEqual(ids(ns, NOW + 24 * 3600e3 + 1), [])
  })
  it('offers nothing for other states, including an expired hold', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED', 'PENDING_PAYMENT']) assert.deepEqual(ids(apt('a', status, '10:00', '10:30'), NOW), [])
    assert.deepEqual(ids(apt('a', 'HELD', '13:00', '13:30', { holdExpiresAt: NOW - 1 }), NOW), [])
  })
})

describe('reminderSummary (FR-09: reminder status per booking on UI-B1)', () => {
  const task = (type, over = {}) => ({ type, status: 'pending', dueAt: at('10:00'), nextAttemptAt: at('10:00'), cancelReason: null, attempts: [], bookingId: 'b', ...over })
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.type, r]))

  it('always returns confirmation, 24 h and 2 h rows, in that order', () => {
    assert.deepEqual(reminderSummary([], NOW, at('18:00')).map((r) => r.type), ['confirmation', 'reminder24h', 'reminder2h'])
  })
  const HOUR = 3600e3
  const START = NOW + 16 * HOUR
  const sentConfirmation = (plannedAt) => task('confirmation', { status: 'sent', nextAttemptAt: null, plannedAt, attempts: [{ at: plannedAt, outcome: 'sent' }] })

  it('a booking with no tasks at all (made before FR-09) is never blamed on short notice, even 16 h away', () => {
    const rows = reminderSummary([], NOW, START)
    assert.deepEqual(rows.map((r) => r.state), ['missing', 'missing', 'missing'])
    assert.equal(rows[1].text, 'No reminder recorded')
    assert.equal(rows[2].text, 'No reminder recorded')
    assert.equal(rows[0].text, 'No confirmation recorded')
    assert.equal(rows.some((r) => /too close/.test(r.text)), false)
  })
  it('says "too close" only when the booking was made after the reminder was due', () => {
    // Booked 5 h ahead: the 24 h reminder was already past, the 2 h one should exist.
    const start = NOW + 5 * HOUR
    const rows = by(reminderSummary([sentConfirmation(NOW)], NOW, start))
    assert.deepEqual([rows.reminder24h.state, rows.reminder24h.text], ['not-scheduled', 'Not scheduled: booked too close to the start'])
    assert.deepEqual([rows.reminder2h.state, rows.reminder2h.text], ['missing', 'No reminder recorded'])
  })
  it('under 2 h ahead both reminders are "too close"', () => {
    const rows = by(reminderSummary([sentConfirmation(NOW)], NOW, NOW + HOUR))
    assert.equal(rows.reminder24h.state, 'not-scheduled')
    assert.equal(rows.reminder2h.state, 'not-scheduled')
  })
  it('follows the server boundary: made exactly 24 h (or 2 h) ahead a reminder was due, 1 ms later it was not', () => {
    const start = NOW + 24 * HOUR
    assert.equal(by(reminderSummary([sentConfirmation(NOW)], NOW, start)).reminder24h.state, 'missing')
    assert.equal(by(reminderSummary([sentConfirmation(NOW + 1)], NOW, start)).reminder24h.state, 'not-scheduled')
    const near = NOW + 2 * HOUR
    assert.equal(by(reminderSummary([sentConfirmation(NOW)], NOW, near)).reminder2h.state, 'missing')
    assert.equal(by(reminderSummary([sentConfirmation(NOW + 1)], NOW, near)).reminder2h.state, 'not-scheduled')
  })
  it('a booking made well ahead whose reminders are absent says "No reminder recorded", not "too close"', () => {
    const rows = by(reminderSummary([sentConfirmation(NOW - 48 * HOUR)], NOW, START))
    assert.deepEqual([rows.reminder24h.state, rows.reminder2h.state], ['missing', 'missing'])
    assert.equal(rows.reminder24h.text, 'No reminder recorded')
  })
  it('a confirmation task without plannedAt falls back to createdAt', () => {
    const stamp = (ms) => ({ toMillis: () => ms })
    const t = toReminderTask('x_confirmation', { bookingId: 'x', type: 'confirmation', status: 'sent', rev: 1, dueAt: stamp(1), createdAt: stamp(77), attempts: [] })
    assert.equal(t.plannedAt, 77)
    assert.equal(toReminderTask('x_confirmation', { bookingId: 'x', type: 'confirmation', status: 'sent', rev: 1, dueAt: stamp(1), plannedAt: stamp(88), createdAt: stamp(77), attempts: [] }).plannedAt, 88)
  })
  it('never labels an existing task as missing', () => {
    const rows = reminderSummary([sentConfirmation(NOW), task('reminder2h', { dueAt: NOW + 1 })], NOW, NOW + 5 * HOUR)
    assert.equal(rows[2].state, 'scheduled')
  })
  it('shows a pending task as scheduled with its due time', () => {
    const r = by(reminderSummary([task('reminder2h', { dueAt: at('13:00') })], NOW)).reminder2h
    assert.equal(r.state, 'scheduled')
    assert.match(r.text, /^Due .*1:00 PM/)
  })
  it('shows a sent task with when it went out (the last successful attempt)', () => {
    const attempts = [{ at: at('09:00'), outcome: 'failed' }, { at: at('09:01'), outcome: 'sent' }]
    const r = by(reminderSummary([task('confirmation', { status: 'sent', nextAttemptAt: null, attempts })], NOW)).confirmation
    assert.equal(r.state, 'sent')
    assert.match(r.text, /9:01 AM/)
  })
  it('shows a task that failed once and will try again as retrying, counting the attempt', () => {
    const attempts = [{ at: at('11:00'), outcome: 'failed' }]
    const r = by(reminderSummary([task('reminder2h', { nextAttemptAt: at('11:01'), attempts })], NOW)).reminder2h
    assert.equal(r.state, 'retrying')
    assert.match(r.text, /attempt 2 of 3/)
    assert.match(r.text, /11:01 AM/)
  })
  it('shows a task out of attempts as failed', () => {
    const attempts = [1, 2, 3].map((n) => ({ at: at('11:00') + n * 60e3, outcome: 'failed' }))
    const r = by(reminderSummary([task('reminder2h', { status: 'failed', nextAttemptAt: null, attempts })], NOW)).reminder2h
    assert.equal(r.state, 'failed')
    assert.match(r.text, /Failed after 3 attempts/)
    assert.equal(MAX_REMINDER_ATTEMPTS, 3)
  })
  it('explains why a task was cancelled', () => {
    const cancelled = (cancelReason) => by(reminderSummary([task('reminder24h', { status: 'cancelled', cancelReason })], NOW)).reminder24h
    assert.match(cancelled('booking_cancelled').text, /with the booking/)
    assert.match(cancelled('past_due').text, /moved/)
    assert.equal(cancelled(null).state, 'cancelled')
  })
  it('names the day for a due time on another day', () => {
    const r = by(reminderSummary([task('reminder24h', { dueAt: at('10:00') - 24 * 3600e3 })], NOW)).reminder24h
    assert.match(r.text, /^Due \w+, \d+ \w+ 10:00 AM/)
  })
  it('toReminderTask keeps only the current revision\'s attempts and tasksByBooking groups by booking', () => {
    const stamp = (ms) => ({ toMillis: () => ms })
    const t = toReminderTask('x_reminder2h', {
      bookingId: 'x', type: 'reminder2h', status: 'pending', rev: 2, dueAt: stamp(5), nextAttemptAt: null,
      attempts: [{ rev: 1, at: stamp(1), outcome: 'sent' }, { rev: 2, at: stamp(4), outcome: 'failed', error: 'E' }],
    })
    assert.deepEqual(t.attempts, [{ at: 4, outcome: 'failed', error: 'E' }])
    assert.deepEqual(Object.keys(tasksByBooking([t, { ...t, bookingId: 'y' }])).sort(), ['x', 'y'])
  })
})

describe('a waitlist offer on UI-B1 (FR-15)', () => {
  const stamp = (ms) => ({ toMillis: () => ms })
  const doc = (over = {}) => ({ barberId: 'b1', serviceId: 's', status: 'HELD', start: stamp(NOW), end: stamp(NOW + 30 * 60e3), holdExpiresAt: stamp(NOW + 15 * 60e3), priceCents: 2500, durationMin: 30, ...over })

  it('toAppointment carries waitlistEntryId so the row can say the hold is for a waitlist customer', () => {
    assert.equal(toAppointment('a', doc({ waitlistEntryId: 'e1' })).waitlistEntryId, 'e1')
    assert.equal(toAppointment('a', doc()).waitlistEntryId, null)
  })
  it('is an ordinary live hold: on the timeline until it lapses, never counted as a booking', () => {
    const a = toAppointment('a', doc({ waitlistEntryId: 'e1' }))
    assert.equal(displayStatus(a, NOW), 'HELD')
    assert.equal(isActive(a, NOW), true)
    assert.equal(isBooking(a, NOW), false)
    assert.equal(displayStatus(a, NOW + 15 * 60e3), 'EXPIRED')
  })
})

describe('PENDING_PAYMENT on UI-B1 (FR-13): held for a deposit, never a booking', () => {
  const unpaid = (deadline, extra = {}) => apt('a', 'PENDING_PAYMENT', '15:00', '15:30', { holdExpiresAt: deadline, ...extra })

  it('is shown as awaiting payment until its deadline, then as expired (like an expired hold)', () => {
    assert.equal(displayStatus(unpaid(NOW + 1), NOW), 'PENDING_PAYMENT')
    assert.equal(displayStatus(unpaid(NOW), NOW), 'EXPIRED')
    assert.equal(displayStatus(unpaid(NOW - 60e3), NOW), 'EXPIRED')
    assert.equal(displayStatus(unpaid(null), NOW), 'EXPIRED')
  })
  it('occupies the barber\'s time while it is live but is not counted as a booking', () => {
    assert.equal(isActive(unpaid(NOW + 60e3), NOW), true)
    assert.equal(isBooking(unpaid(NOW + 60e3), NOW), false)
    assert.equal(isActive(unpaid(NOW - 1), NOW), false)
  })
  it('lands on the timeline when live and in the hidden list once expired', () => {
    const list = [unpaid(NOW + 60e3, { id: 'live' }), unpaid(NOW - 1, { id: 'gone' })]
    const { active, inactive } = partitionDay(list, NOW)
    assert.deepEqual([active.map((x) => x.id), inactive.map((x) => x.id)], [['live'], ['gone']])
  })
  it('offers no staff actions while waiting for payment', () => {
    assert.deepEqual(availableActions(unpaid(NOW + 60e3), NOW), [])
  })
  it('isHeldStatus covers a hold waiting for the OTP and one waiting for the deposit only', () => {
    assert.deepEqual(['HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED'].map(isHeldStatus), [true, true, false, false])
  })
})
