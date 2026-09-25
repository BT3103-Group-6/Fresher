import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { historyItems, historyLabel, pendingPaymentItems, resolveRebook, upcomingItems } from '../src/lib/history.js'

const NOW = Date.UTC(2030, 0, 7, 4, 0)
const H = 3600e3
const apt = (id, status, startH, endH = startH + 1) => ({ id, status, start: NOW + startH * H, end: NOW + endH * H })

describe('upcomingItems', () => {
  it('keeps CONFIRMED bookings that have not ended, oldest first, including one in progress', () => {
    const list = [apt('later', 'CONFIRMED', 5), apt('running', 'CONFIRMED', -0.5, 0.5), apt('soon', 'CONFIRMED', 1)]
    assert.deepEqual(upcomingItems(list, NOW).map((a) => a.id), ['running', 'soon', 'later'])
  })
  it('treats end == now as over (half-open) and drops every other status', () => {
    const list = [
      apt('ended', 'CONFIRMED', -1, 0),
      ...['HELD', 'EXPIRED', 'PENDING_PAYMENT', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => apt(s, s, 2)),
    ]
    assert.deepEqual(upcomingItems(list, NOW), [])
  })
})

describe('historyItems', () => {
  it('lists completed, cancelled, no-show and past CONFIRMED bookings, newest first', () => {
    const list = [
      apt('old', 'COMPLETED', -72), apt('cancelled', 'CANCELLED', -24), apt('noshow', 'NO_SHOW', -48),
      apt('past', 'CONFIRMED', -3, -2), apt('cancelledFuture', 'CANCELLED', 24),
    ]
    assert.deepEqual(historyItems(list, NOW).map((a) => a.id), ['cancelledFuture', 'past', 'cancelled', 'noshow', 'old'])
  })
  it('excludes expired holds, held, pending payment, in-service and bookings that are still upcoming or running', () => {
    const list = [
      apt('h', 'HELD', -5), apt('e', 'EXPIRED', -5), apt('p', 'PENDING_PAYMENT', -5), apt('i', 'IN_SERVICE', -5),
      apt('future', 'CONFIRMED', 3), apt('running', 'CONFIRMED', -0.5, 0.5),
    ]
    assert.deepEqual(historyItems(list, NOW), [])
  })
  it('a CONFIRMED booking moves from Upcoming to History exactly when it ends', () => {
    const list = [apt('a', 'CONFIRMED', -1, 0)]
    assert.equal(upcomingItems(list, NOW - 1).length, 1)
    assert.equal(historyItems(list, NOW - 1).length, 0)
    assert.equal(upcomingItems(list, NOW).length, 0)
    assert.equal(historyItems(list, NOW).length, 1)
  })
  it('breaks start ties by ID and does not mutate its input', () => {
    const list = [apt('b', 'COMPLETED', -5), apt('a', 'COMPLETED', -5)]
    assert.deepEqual(historyItems(list, NOW).map((a) => a.id), ['a', 'b'])
    assert.deepEqual(list.map((a) => a.id), ['b', 'a'])
  })
})

describe('historyLabel', () => {
  it('uses a neutral label for a past CONFIRMED booking', () => {
    assert.equal(historyLabel(apt('a', 'CONFIRMED', -3, -2)), 'Past booking')
    assert.equal(historyLabel(apt('a', 'COMPLETED', -3)), 'Completed')
    assert.equal(historyLabel(apt('a', 'CANCELLED', -3)), 'Cancelled')
    assert.equal(historyLabel(apt('a', 'NO_SHOW', -3)), 'No-show')
  })
})

describe('resolveRebook', () => {
  const service = { name: 'Haircut', active: true }
  const barber = { displayName: 'Ali', active: true, serviceIds: ['s1'] }
  const base = { serviceId: 's1', barberId: 'b1', service, barber }

  it('pre-fills service and barber when both are still available', () => {
    assert.deepEqual(resolveRebook(base), { canRebook: true, serviceId: 's1', barberId: 'b1', notes: [] })
  })
  it('keeps "any barber" as it was', () => {
    assert.equal(resolveRebook({ ...base, barberId: 'any' }).barberId, 'any')
  })
  it('disables rebooking when the shop is unavailable', () => {
    const r = resolveRebook({ ...base, shopAvailable: false })
    assert.equal(r.canRebook, false)
    assert.equal(r.serviceId, '')
    assert.match(r.notes[0], /no longer available/)
  })
  it('drops the service, and the barber with it, when the service is inactive or deleted', () => {
    for (const s of [{ ...service, active: false }, null]) {
      const r = resolveRebook({ ...base, service: s })
      assert.equal(r.canRebook, true)
      assert.equal(r.serviceId, '')
      assert.equal(r.barberId, 'any')
      assert.match(r.notes[0], /no longer offered/)
    }
  })
  it('falls back to any barber, keeping the service, when the barber is inactive or deleted', () => {
    for (const b of [{ ...barber, active: false }, null]) {
      const r = resolveRebook({ ...base, barber: b })
      assert.equal(r.serviceId, 's1')
      assert.equal(r.barberId, 'any')
      assert.equal(r.notes.length, 1)
      assert.match(r.notes[0], /no longer available/)
    }
  })
  it('falls back to any barber when the barber no longer offers the service, and says so', () => {
    for (const b of [{ ...barber, serviceIds: ['s2'] }, { ...barber, serviceIds: undefined }]) {
      const r = resolveRebook({ ...base, barber: b })
      assert.equal(r.serviceId, 's1')
      assert.equal(r.barberId, 'any')
      assert.match(r.notes[0], /no longer offers Haircut/)
    }
  })
  it('names the service in the note when it is still known but inactive', () => {
    assert.match(resolveRebook({ ...base, service: { ...service, active: false } }).notes[0], /^Haircut is no longer offered/)
  })
})

describe('pendingPaymentItems (FR-13)', () => {
  const pay = (id, deadlineMin, status = 'PENDING_PAYMENT') => ({ ...apt(id, status, 30), holdExpiresAt: NOW + deadlineMin * 60e3 })

  it('lists PENDING_PAYMENT bookings whose deadline is still ahead, soonest deadline first', () => {
    const list = [pay('later', 8), pay('soon', 2), pay('expired', -1), pay('atDeadline', 0)]
    assert.deepEqual(pendingPaymentItems(list, NOW).map((a) => a.id), ['soon', 'later'])
  })
  it('ignores other statuses and a missing deadline', () => {
    const list = [pay('held', 5, 'HELD'), pay('confirmed', 5, 'CONFIRMED'), { ...apt('nodeadline', 'PENDING_PAYMENT', 30) }, pay('ok', 5)]
    assert.deepEqual(pendingPaymentItems(list, NOW).map((a) => a.id), ['ok'])
  })
  it('never appears in Upcoming or History (it is not a booking yet)', () => {
    const list = [pay('p', 5)]
    assert.deepEqual(upcomingItems(list, NOW), [])
    assert.deepEqual(historyItems(list, NOW), [])
  })
})
