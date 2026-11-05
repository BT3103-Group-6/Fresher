// FR-04/FR-05 pure rules from functions/booking.js: the notice boundary and the fresh-OTP window.
// No emulator needed. (The emulator cannot mint a stale auth_time, so freshness is tested here.)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { isLate, requireFreshCustomer } = createRequire(import.meta.url)('../functions/booking.js')
const MIN = 60e3
const NOW = Date.UTC(2030, 0, 7, 3, 0)

describe('isLate (decisions A3)', () => {
  it('exactly noticeMins before the start is free', () => {
    assert.equal(isLate(NOW + 120 * MIN, NOW, 120), false)
  })
  it('one millisecond inside the window is late', () => {
    assert.equal(isLate(NOW + 120 * MIN - 1, NOW, 120), true)
  })
  it('well outside is free and well inside is late', () => {
    assert.equal(isLate(NOW + 24 * 60 * MIN, NOW, 120), false)
    assert.equal(isLate(NOW + 5 * MIN, NOW, 120), true)
  })
  it('honours a shop-specific window, including 0', () => {
    assert.equal(isLate(NOW + 30 * MIN, NOW, 60), true)
    assert.equal(isLate(NOW + 30 * MIN, NOW, 15), false)
    assert.equal(isLate(NOW, NOW, 0), false)
  })
})

describe('requireFreshCustomer (fresh OTP = auth_time within 10 minutes)', () => {
  const auth = (over = {}) => ({ uid: 'u1', token: { phone_number: '+6591234567', auth_time: NOW / 1000 - 60, ...over } })
  const code = (fn) => { try { fn() } catch (e) { return [e.code, e.details && e.details.reason] } }

  it('accepts a sign-in within the window, including exactly 10 minutes ago', () => {
    assert.equal(requireFreshCustomer(auth(), NOW), 'u1')
    assert.equal(requireFreshCustomer(auth({ auth_time: NOW / 1000 - 600 }), NOW), 'u1')
  })
  it('asks for a new OTP once the sign-in is older than 10 minutes', () => {
    assert.deepEqual(code(() => requireFreshCustomer(auth({ auth_time: NOW / 1000 - 601 }), NOW)), ['unauthenticated', 'REAUTH_REQUIRED'])
  })
  it('treats a missing auth_time as stale', () => {
    assert.deepEqual(code(() => requireFreshCustomer(auth({ auth_time: undefined }), NOW)), ['unauthenticated', 'REAUTH_REQUIRED'])
  })
  it('rejects anonymous callers and non-Singapore or missing numbers', () => {
    assert.equal(code(() => requireFreshCustomer(null, NOW))[0], 'unauthenticated')
    assert.equal(code(() => requireFreshCustomer(auth({ phone_number: '+14155550101' }), NOW))[0], 'permission-denied')
    assert.equal(code(() => requireFreshCustomer(auth({ phone_number: undefined }), NOW))[0], 'permission-denied')
  })
})
