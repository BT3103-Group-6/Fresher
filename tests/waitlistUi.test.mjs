// FR-15 / UI-C6 pure logic: entry states, ordering, form checks and error text. No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OFFER_MINUTES, STATE_LABELS, STATE_MESSAGES, canClaim, claimErrorMessage, entryState, expiredText, sortEntries, toEntry, validateJoin } from '../src/lib/waitlist.js'

const NOW = Date.UTC(2030, 0, 7, 3, 0)
const MIN = 60e3
const e = (id, status, over = {}) => ({ id, status, date: '20300108', joinedAt: NOW - 1000, offerExpiresAt: null, expireReason: null, ...over })

describe('entryState', () => {
  it('shows an offer as live until its deadline, and as lapsed at the deadline itself (matching the server)', () => {
    assert.equal(entryState(e('a', 'offered', { offerExpiresAt: NOW + 1 }), NOW), 'offered')
    assert.equal(entryState(e('a', 'offered', { offerExpiresAt: NOW }), NOW), 'offer-lapsed')
    assert.equal(entryState(e('a', 'offered', { offerExpiresAt: NOW - 5 * MIN }), NOW), 'offer-lapsed')
    assert.equal(entryState(e('a', 'offered'), NOW), 'offer-lapsed') // no deadline recorded: never claimable
  })
  it('passes the other statuses through', () => {
    for (const s of ['waiting', 'claimed', 'expired']) assert.equal(entryState(e('a', s), NOW), s)
  })
  it('only a live offer can be claimed', () => {
    assert.equal(canClaim(e('a', 'offered', { offerExpiresAt: NOW + MIN }), NOW), true)
    for (const x of [e('a', 'offered', { offerExpiresAt: NOW }), e('a', 'waiting'), e('a', 'claimed'), e('a', 'expired')]) assert.equal(canClaim(x, NOW), false)
  })
  it('has a label and message for every state', () => {
    for (const s of ['waiting', 'offered', 'offer-lapsed', 'claimed', 'expired']) {
      assert.ok(STATE_LABELS[s], s)
      assert.ok(STATE_MESSAGES[s], s)
    }
    assert.match(STATE_MESSAGES.offered, new RegExp(String(OFFER_MINUTES)))
  })
})

describe('expiredText', () => {
  it('explains why an entry ended', () => {
    assert.match(expiredText(e('a', 'expired', { expireReason: 'offer_lapsed' })), /not claimed in time/)
    assert.match(expiredText(e('a', 'expired', { expireReason: 'date_passed' })), /date has passed/)
    assert.equal(expiredText(e('a', 'expired')), STATE_MESSAGES.expired)
  })
})

describe('sortEntries', () => {
  it('puts live offers first (soonest deadline), then waiting by date and join order, then finished, newest date first', () => {
    const list = [
      e('done-old', 'expired', { date: '20300101' }),
      e('wait-late', 'waiting', { date: '20300110' }),
      e('offer-b', 'offered', { offerExpiresAt: NOW + 9 * MIN }),
      e('wait-early-2', 'waiting', { date: '20300108', joinedAt: 2 }),
      e('done-new', 'claimed', { date: '20300105' }),
      e('offer-a', 'offered', { offerExpiresAt: NOW + 2 * MIN }),
      e('wait-early-1', 'waiting', { date: '20300108', joinedAt: 1 }),
      e('lapsed', 'offered', { offerExpiresAt: NOW - 1, date: '20300109' }),
    ]
    assert.deepEqual(sortEntries(list, NOW).map((x) => x.id), ['offer-a', 'offer-b', 'wait-early-1', 'wait-early-2', 'wait-late', 'lapsed', 'done-new', 'done-old'])
  })
  it('does not change its input and is stable for equal keys', () => {
    const list = [e('b', 'waiting'), e('a', 'waiting')]
    assert.deepEqual(sortEntries(list, NOW).map((x) => x.id), ['a', 'b'])
    assert.deepEqual(list.map((x) => x.id), ['b', 'a'])
  })
})

describe('toEntry', () => {
  const stamp = (ms) => ({ toMillis: () => ms })
  it('maps Timestamps to ms and defaults missing fields', () => {
    const out = toEntry('x', {
      shopId: 's', serviceId: 'cut', barberId: undefined, date: '20300108', status: 'offered', joinedAt: stamp(5),
      offerSlot: { barberId: 'b1', start: stamp(10), end: stamp(20) }, offerExpiresAt: stamp(30),
    })
    assert.deepEqual([out.barberId, out.joinedAt, out.offerExpiresAt, out.offerSlot], [null, 5, 30, { barberId: 'b1', start: 10, end: 20 }])
    const waiting = toEntry('y', { shopId: 's', serviceId: 'cut', barberId: 'b2', date: '20300108', status: 'waiting', joinedAt: stamp(1) })
    assert.deepEqual([waiting.offerSlot, waiting.offerExpiresAt, waiting.claimedBookingId, waiting.expireReason, waiting.barberId], [null, null, null, null, 'b2'])
  })
})

describe('validateJoin', () => {
  const dates = ['20300107', '20300108']
  it('accepts a service, a name and a listed date', () => {
    assert.deepEqual(validateJoin({ serviceId: 'cut', name: 'Sam', date: '20300108' }, dates), {})
  })
  it('names each missing or invalid field', () => {
    assert.deepEqual(Object.keys(validateJoin({ serviceId: '', name: '  ', date: '' }, dates)).sort(), ['date', 'name', 'service'])
    assert.equal(validateJoin({ serviceId: 'cut', name: 'x'.repeat(81), date: '20300108' }, dates).name, 'Name must be 80 characters or fewer.')
    assert.equal(validateJoin({ serviceId: 'cut', name: 'Sam', date: '20300301' }, dates).date, 'Choose a date from the list.')
  })
  it('service is required, barber is not part of the form checks', () => {
    assert.equal(validateJoin({ serviceId: undefined, name: 'Sam', date: '20300107' }, dates).service, 'Choose a service.')
  })
})

describe('claimErrorMessage', () => {
  it('says a lapsed offer was passed on, and never blames the customer for a network error', () => {
    assert.match(claimErrorMessage('OFFER_EXPIRED'), /passed on/)
    assert.match(claimErrorMessage('OFFER_NOT_FOUND'), /could not find/)
    assert.match(claimErrorMessage(undefined), /unchanged/)
  })
})
