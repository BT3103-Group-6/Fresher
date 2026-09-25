// FR-08 / UI-B1 pure day-view logic: expired holds are never live bookings (limitation L2), block overlap
// flags and the block form's validation. No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { availableActions, blockTimeToMs, dayBounds, displayStatus, isActive, isBooking, overlappingBlocks, partitionDay, timeOptions, toAppointment, validateBlockForm } from '../src/lib/schedule.js'
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
