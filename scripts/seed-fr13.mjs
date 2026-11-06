// Dev-only: a test customer with two recorded no-shows at shop-jurong, so a booking they confirm goes to
// UI-C5 (Deposit checkout) instead of being confirmed. Sign in on UI-C3 with +65 9123 0013 (the Auth emulator
// prints the OTP in its terminal; it resolves to this seeded user). Safe to rerun: sets the no-show count back
// to 2 and removes the customer's earlier deposit test bookings. Refuses to run outside the emulators.
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const isLocal = (h) => !!h && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(h)
if (!isLocal(process.env.FIRESTORE_EMULATOR_HOST) || !isLocal(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must point at local emulators (use `npm run seed:fr13`).')
  process.exit(1)
}

const app = initializeApp({ projectId: 'fresher-6d857' })
const db = getFirestore(app)
const SHOP = 'shop-jurong'
const UID = 'fr13-test-customer'
const PHONE = '+6591230013'

if (!(await db.doc(`shops/${SHOP}`).get()).exists) {
  console.error(`${SHOP} not found. Run \`npm run seed\` first.`)
  process.exit(1)
}
await getAuth(app).getUser(UID).catch(() => getAuth(app).createUser({ uid: UID, phoneNumber: PHONE, displayName: 'FR-13 tester' }))
await db.doc(`customers/${UID}`).set({ phoneE164: PHONE, displayName: 'FR-13 tester' })
await db.doc(`customers/${UID}/shopStats/${SHOP}`).set({ noShowCount: 2, lateCancels: 0 })
for (const d of (await db.collection('appointments').where('customerId', '==', UID).get()).docs) {
  await db.doc(`deposits/${d.id}`).delete()
  await d.ref.delete()
}
console.log(`Ready: sign in as ${PHONE}. Two no-shows at ${SHOP}, so the next booking there needs a deposit.`)
