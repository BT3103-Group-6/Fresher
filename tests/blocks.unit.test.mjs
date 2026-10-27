// FR-08 pure rules from functions/blocks.js: input limits, who may block whose time, and conflicts.
// No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { parseBlockInput, authorizeStaff, findConflicts, describeConflicts } = createRequire(import.meta.url)('../functions/blocks.js')

const MIN = 60e3
const SG = 8 * 3600e3
// 2030-01-07 (a Monday) in Singapore, as epoch ms.
const at = (hh, mm = 0, day = 7) => Date.UTC(2030, 0, day, hh, mm) - SG
const NOW = at(9, 0)
const ID = 'block-0123456789abcdef'
const ok = { blockId: ID, start: at(14), end: at(15) }
const ts = (ms) => ({ toMillis: () => ms })
const iv = (kind, s, e, extra = {}) => ({ kind, start: ts(s), end: ts(e), ...extra })

const rejects = (fn, code, field) => {
  try {
    fn()
  } catch (err) {
    assert.equal(err.code, code)
    if (field) assert.equal(err.details?.field, field)
    return
  }
  assert.fail('expected an error')
}

describe('parseBlockInput (decisions A12)', () => {
  it('accepts a valid single-day block and defaults the reason', () => {
    assert.deepEqual(parseBlockInput(ok, NOW), { ...ok, reason: '' })
    assert.equal(parseBlockInput({ ...ok, reason: '  Dentist  ' }, NOW).reason, 'Dentist')
    assert.equal(parseBlockInput({ ...ok, reason: null }, NOW).reason, '')
  })
  it('allows a block that runs to midnight but not past it', () => {
    assert.equal(parseBlockInput({ ...ok, start: at(22), end: at(24) }, NOW).end, at(24))
    rejects(() => parseBlockInput({ ...ok, start: at(22), end: at(24, 15) }, NOW), 'invalid-argument', 'end')
    rejects(() => parseBlockInput({ ...ok, start: at(23), end: at(27) }, NOW), 'invalid-argument', 'end')
  })
  it('judges "the same day" in Singapore time, not UTC', () => {
    // 07:00 to 09:00 SGT is 23:00 to 01:00 UTC: two UTC dates, one Singapore day.
    assert.ok(parseBlockInput({ ...ok, start: at(7), end: at(9) }, NOW - 3 * 3600e3))
  })
  it('rejects off-grid times, non-integers and an end that is not after the start', () => {
    rejects(() => parseBlockInput({ ...ok, start: at(14, 10) }, NOW), 'invalid-argument', 'start')
    rejects(() => parseBlockInput({ ...ok, end: at(15, 5) }, NOW), 'invalid-argument', 'end')
    rejects(() => parseBlockInput({ ...ok, start: '14:00' }, NOW), 'invalid-argument', 'start')
    rejects(() => parseBlockInput({ ...ok, end: 1.5 }, NOW), 'invalid-argument', 'end')
    rejects(() => parseBlockInput({ ...ok, end: ok.start }, NOW), 'invalid-argument', 'end')
    rejects(() => parseBlockInput({ ...ok, end: ok.start - 15 * MIN }, NOW), 'invalid-argument', 'end')
  })
  it('rejects a block entirely in the past, but allows one still running', () => {
    rejects(() => parseBlockInput({ ...ok, start: at(6), end: at(7) }, NOW), 'invalid-argument', 'start')
    rejects(() => parseBlockInput({ ...ok, start: at(8), end: at(9) }, NOW), 'invalid-argument', 'start') // ends exactly now
    assert.ok(parseBlockInput({ ...ok, start: at(8), end: at(9, 15) }, NOW))
  })
  it('enforces the booking horizon (today to +13 days)', () => {
    assert.ok(parseBlockInput({ ...ok, start: at(14, 0, 20), end: at(15, 0, 20) }, NOW)) // +13 days
    rejects(() => parseBlockInput({ ...ok, start: at(14, 0, 21), end: at(15, 0, 21) }, NOW), 'invalid-argument', 'start') // +14
  })
  it('validates blockId and reason', () => {
    for (const blockId of [undefined, 5, '', 'short', 'has space 0123456789abc', 'x/y-0123456789abcdef']) {
      rejects(() => parseBlockInput({ ...ok, blockId }, NOW), 'invalid-argument', 'blockId')
    }
    rejects(() => parseBlockInput({ ...ok, reason: 'x'.repeat(201) }, NOW), 'invalid-argument', 'reason')
    assert.equal(parseBlockInput({ ...ok, reason: 'x'.repeat(200) }, NOW).reason.length, 200)
    rejects(() => parseBlockInput({ ...ok, reason: 7 }, NOW), 'invalid-argument', 'reason')
    rejects(() => parseBlockInput(null, NOW), 'invalid-argument', 'blockId')
  })
})

describe('authorizeStaff: whose time may be changed', () => {
  const auth = (token) => ({ uid: 'u1', token })
  const owner = auth({ shopId: 's1', role: 'owner' })
  const barber = auth({ shopId: 's1', role: 'barber', barberId: 'b1' })

  it('rejects anonymous callers and non-staff', () => {
    rejects(() => authorizeStaff(null, 'b1'), 'unauthenticated')
    rejects(() => authorizeStaff(auth({}), 'b1'), 'permission-denied') // a customer
    rejects(() => authorizeStaff(auth({ admin: true }), 'b1'), 'permission-denied')
    rejects(() => authorizeStaff(auth({ role: 'owner' }), 'b1'), 'permission-denied') // no shop
    rejects(() => authorizeStaff(auth({ shopId: 's1', role: 'cashier' }), 'b1'), 'permission-denied')
  })
  it('lets a barber act only on their own barberId', () => {
    assert.deepEqual(authorizeStaff(barber, undefined), { shopId: 's1', barberId: 'b1', role: 'barber', uid: 'u1' })
    assert.equal(authorizeStaff(barber, 'b1').barberId, 'b1')
    rejects(() => authorizeStaff(barber, 'b2'), 'permission-denied')
    rejects(() => authorizeStaff(auth({ shopId: 's1', role: 'barber' }), 'b1'), 'permission-denied')
  })
  it('lets an owner name any barber, taking the shop from the token', () => {
    assert.deepEqual(authorizeStaff(owner, 'b9'), { shopId: 's1', barberId: 'b9', role: 'owner', uid: 'u1' })
    assert.equal(authorizeStaff(owner, undefined).barberId, null)
    rejects(() => authorizeStaff(owner, 42), 'invalid-argument', 'barberId')
    rejects(() => authorizeStaff(owner, 'a/b'), 'invalid-argument', 'barberId')
    rejects(() => authorizeStaff(owner, ''), 'invalid-argument', 'barberId')
  })
})

describe('findConflicts', () => {
  const start = at(14)
  const end = at(15)
  it('returns overlapping bookings and live holds, never blocks', () => {
    const list = [
      iv('booking', at(14, 30), at(15, 0), { refId: 'a1' }),
      iv('hold', at(13, 45), at(14, 15), { holdExpiresAt: ts(NOW + 5 * MIN) }),
      iv('block', at(14), at(15), { refId: 'k1' }),
    ]
    const out = findConflicts(list, start, end, NOW)
    assert.deepEqual(out.map((i) => i.kind), ['hold', 'booking'])
  })
  it('treats intervals as half-open: an adjacent booking is not a conflict', () => {
    const list = [iv('booking', at(13), at(14), { refId: 'a1' }), iv('booking', at(15), at(16), { refId: 'a2' })]
    assert.deepEqual(findConflicts(list, start, end, NOW), [])
    assert.equal(findConflicts([iv('booking', at(14, 45), at(15, 15), { refId: 'a3' })], start, end, NOW).length, 1)
  })
  it('ignores expired holds, including one expiring exactly now', () => {
    const list = [
      iv('hold', at(14), at(14, 30), { holdExpiresAt: ts(NOW - 1) }),
      iv('hold', at(14, 30), at(15), { holdExpiresAt: ts(NOW) }),
    ]
    assert.deepEqual(findConflicts(list, start, end, NOW), [])
    assert.equal(findConflicts([iv('hold', at(14), at(14, 30), { holdExpiresAt: ts(NOW + 1) })], start, end, NOW).length, 1)
  })
  it('copes with a missing schedule', () => {
    assert.deepEqual(findConflicts(undefined, start, end, NOW), [])
  })
})

describe('describeConflicts', () => {
  it('resolves bookings through their appointment and describes holds by time only', () => {
    const conflicts = [
      iv('booking', at(14), at(14, 30), { refId: 'a1' }),
      iv('booking', at(14, 30), at(15), { refId: 'gone' }),
      iv('hold', at(14, 45), at(15, 15), { holdExpiresAt: ts(NOW + 60e3) }),
    ]
    const apts = new Map([['a1', { status: 'CONFIRMED', customerName: 'Ali', customerPhoneMasked: '+65 9••• ••67', serviceId: 'cut', customerId: 'secret' }]])
    const out = describeConflicts(conflicts, apts)
    assert.deepEqual(out[0], {
      kind: 'booking', start: at(14), end: at(14, 30), bookingId: 'a1', status: 'CONFIRMED',
      customerName: 'Ali', customerPhoneMasked: '+65 9••• ••67', serviceId: 'cut',
    })
    assert.equal(out[1].status, null, 'a missing appointment doc still reports the interval')
    assert.deepEqual(out[2], { kind: 'hold', start: at(14, 45), end: at(15, 15), holdExpiresAt: NOW + 60e3 })
    assert.equal(JSON.stringify(out).includes('secret'), false, 'no customerId leaks')
  })
})
