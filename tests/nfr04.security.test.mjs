// NFR-04: security cases that tests/rules.test.mjs does not cover yet
// (docs/evidence/NFR-04/test-cases.md, S-34 and S-36). Needs the Firestore emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/nfr04.security.test.mjs
import { after, before, beforeEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, setDoc, setLogLevel, updateDoc } from 'firebase/firestore'

// Denied writes are expected here; keep the SDK from logging each one.
setLogLevel('silent')

let env

const owner = (shopId) => env.authenticatedContext(`${shopId}-owner`, { shopId, role: 'owner' }).firestore()
const barber = (shopId, barberId = 'b1') =>
  env.authenticatedContext(`${shopId}-barber`, { shopId, role: 'barber', barberId }).firestore()

const service = { name: 'Cut', category: 'haircut', durationMin: 30, priceCents: 2500, active: true }

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'fresher-nfr04-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
after(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'shops/a'), { name: 'a', status: 'verified', tz: 'Asia/Singapore', noticeMins: 120 })
    await setDoc(doc(db, 'shops/a/services/s1'), service)
  })
})

describe('NFR-04 barber cannot do owner-only shop configuration', () => {
  // S-34
  it('a barber cannot edit, deactivate or delete an existing service in their own shop', async () => {
    const ref = () => doc(barber('a'), 'shops/a/services/s1')
    await assertFails(updateDoc(ref(), { active: false }))
    await assertFails(updateDoc(ref(), { priceCents: 100 }))
    await assertFails(setDoc(ref(), { ...service, durationMin: 60 }))
    await assertFails(deleteDoc(ref()))
    // Control: the owner may make the same change.
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a/services/s1'), { active: false }))
  })
  // S-36
  it('a barber cannot edit their own shop\'s profile', async () => {
    const ref = () => doc(barber('a'), 'shops/a')
    await assertFails(updateDoc(ref(), { noticeMins: 60 }))
    await assertFails(updateDoc(ref(), { name: 'Renamed' }))
    // Control: the owner may make the same change.
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a'), { noticeMins: 60 }))
  })
})
