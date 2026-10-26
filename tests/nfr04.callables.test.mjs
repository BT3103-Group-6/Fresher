// NFR-04: callable checks that Security Rules cannot cover
// (docs/evidence/NFR-04/test-cases.md, S-37). The permission check runs before
// any Firestore or Auth call, so no emulator is needed:
//   node --test tests/nfr04.callables.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Load the real exports, as deployed. No project or emulator is contacted.
process.env.GCLOUD_PROJECT ||= 'fresher-nfr04-test'
const { addBarber } = createRequire(import.meta.url)('../functions/index.js')

const input = {
  displayName: 'Mallory',
  email: 'mallory@example.com',
  password: 'temporary-pass',
  serviceIds: ['s1'],
  workingHours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, []])),
}
const call = (token) => addBarber.run({ auth: token && { uid: 'u1', token }, data: input })
const rejectsWith = (code) => (err) => { assert.equal(err.code, code); return true }

describe('NFR-04 addBarber is owner-only (S-37)', () => {
  it('rejects a barber of the same shop', async () => {
    await assert.rejects(call({ shopId: 'a', role: 'barber', barberId: 'b1' }), rejectsWith('permission-denied'))
  })
  it('rejects a signed-in customer and the platform admin', async () => {
    await assert.rejects(call({ phone_number: '+6591234567' }), rejectsWith('permission-denied'))
    await assert.rejects(call({ admin: true }), rejectsWith('permission-denied'))
  })
  it('rejects a signed-out caller', async () => {
    await assert.rejects(call(null), rejectsWith('unauthenticated'))
  })
})
