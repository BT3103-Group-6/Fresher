// FR-13 / UI-C5 pure logic: the countdown, the checkout state and the reason text (decisions A6 addendum).
// No emulator needed. Also checks the client's display formula against the server's.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { CHECKOUT_MESSAGES, canPay, checkoutState, countdown, depositAmountCents, money, reasonText } from '../src/lib/deposit.js'

const server = createRequire(import.meta.url)('../functions/booking.js')
const NOW = Date.UTC(2030, 0, 7, 3, 0)
const MIN = 60e3

describe('countdown to the payment deadline', () => {
  it('shows minutes and seconds, rounding a partial second up so it never reads 0:00 early', () => {
    assert.equal(countdown(NOW + 10 * MIN, NOW).text, '10:00')
    assert.equal(countdown(NOW + 9 * MIN + 59_001, NOW).text, '10:00')
    assert.equal(countdown(NOW + 65_000, NOW).text, '1:05')
    assert.equal(countdown(NOW + 1, NOW).text, '0:01')
    assert.equal(countdown(NOW + 59_000, NOW).text, '0:59')
  })
  it('is expired at the deadline itself, as the server treats it, and never negative', () => {
    assert.deepEqual([countdown(NOW, NOW).expired, countdown(NOW, NOW).text], [true, '0:00'])
    assert.equal(countdown(NOW - 5000, NOW).remainingMs, 0)
    assert.equal(countdown(NOW + 1, NOW).expired, false)
  })
  it('treats a missing deadline as expired', () => {
    assert.equal(countdown(null, NOW).expired, true)
    assert.equal(countdown(undefined, NOW).text, '0:00')
  })
  it('says the time in words for screen readers, with singular and plural', () => {
    assert.equal(countdown(NOW + 2 * MIN + 1000, NOW).spoken, '2 minutes 1 second')
    assert.equal(countdown(NOW + MIN, NOW).spoken, '1 minute 0 seconds')
    assert.equal(countdown(NOW + 30_000, NOW).spoken, '30 seconds')
  })
})

describe('checkoutState', () => {
  const at = (over) => checkoutState({ bookingStatus: 'PENDING_PAYMENT', depositStatus: 'pending', paidAfterExpiry: false, deadline: NOW + 5 * MIN, ...over }, NOW)

  it('is awaiting while pending and before the deadline; timed out at or after it', () => {
    assert.equal(at({}), 'awaiting')
    assert.equal(at({ deadline: NOW + 1 }), 'awaiting')
    assert.equal(at({ deadline: NOW }), 'timed-out')
    assert.equal(at({ deadline: NOW - 1 }), 'timed-out')
    assert.equal(at({ deadline: null }), 'timed-out')
  })
  it('is confirmed once the booking is confirmed or beyond', () => {
    for (const bookingStatus of ['CONFIRMED', 'IN_SERVICE', 'COMPLETED']) assert.equal(at({ bookingStatus, depositStatus: 'paid' }), 'confirmed')
  })
  it('is released when the booking expired and nothing was paid', () => {
    assert.equal(at({ bookingStatus: 'EXPIRED', depositStatus: 'failed' }), 'released')
    assert.equal(at({ bookingStatus: 'EXPIRED', depositStatus: 'pending' }), 'released')
  })
  it('is paid-late when the money arrived after the slot was released', () => {
    assert.equal(at({ bookingStatus: 'EXPIRED', depositStatus: 'refundable', paidAfterExpiry: true }), 'paid-late')
    // A refundable deposit on a booking that was attended is just a confirmed booking.
    assert.equal(at({ bookingStatus: 'COMPLETED', depositStatus: 'refundable', paidAfterExpiry: false }), 'confirmed')
  })
  it('is unavailable for anything else, and only awaiting offers the pay buttons', () => {
    assert.equal(at({ bookingStatus: 'CANCELLED' }), 'unavailable')
    assert.equal(at({ bookingStatus: undefined }), 'unavailable')
    assert.equal(canPay('awaiting'), true)
    for (const s of ['timed-out', 'confirmed', 'released', 'paid-late', 'unavailable']) assert.equal(canPay(s), false, s)
  })
  it('has a message for every state', () => {
    for (const s of ['awaiting', 'timed-out', 'confirmed', 'released', 'paid-late', 'unavailable']) assert.ok(CHECKOUT_MESSAGES[s], s)
  })
})

describe('reasonText and money', () => {
  it('names the shop and the number of missed appointments, and says the deposit is refundable', () => {
    const text = reasonText(3, 'Fade & Co')
    assert.match(text, /missed 3 appointments at Fade & Co/)
    assert.match(text, /refundable when you attend/)
  })
  it('falls back to safe wording when the count or shop is unknown', () => {
    assert.match(reasonText(undefined, ''), /missed 2 appointments at this shop/)
    assert.match(reasonText(0, undefined), /missed 2 appointments at this shop/)
  })
  it('formats cents as dollars', () => {
    assert.equal(money(1250), 'S$12.50')
    assert.equal(money(5), 'S$0.05')
  })
})

describe('the client\'s deposit display matches the server\'s formula', () => {
  it('agrees on every price up to S$200', () => {
    for (let price = 0; price <= 20000; price++) assert.equal(depositAmountCents(price), server.depositAmountCents(price), `price ${price}`)
  })
})
