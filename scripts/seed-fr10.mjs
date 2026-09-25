// Dev-only: a barber running late, for trying UI-B2 (/staff/queue) and the FR-10 delay warning.
// Jun Wei at shop-jurong (run `npm run seed` first):
//   a booking in service since 20 min ago, booked as 75 min (expected to finish in 55 min),
//   a booking in 30 min (about 25 min late: a warning is written on the next start, finish or queue change,
//     or by `npm run sweep`, and sent through the mock provider),
//   a booking in 120 min (not delayed) and one walk-in waiting.
// Safe to rerun: fixed IDs; each run resets these documents (and any delay warning for them) and moves the
// times to "now". Refuses to run outside the emulator.
import { initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) {
  console.error(
    'Refusing to seed: FIRESTORE_EMULATOR_HOST must point at a local emulator ' +
      '(run this through `npm run seed:fr10`) so it can never touch production.',
  )
  process.exit(1)
}

const db = getFirestore(initializeApp({ projectId: 'fresher-6d857' }))
const SHOP = 'shop-jurong'
const BARBER = 'jun-wei'
const CUSTOMER = 'fr10-test-customer'
const MIN = 60e3
const now = Date.now()

const shop = await db.doc(`shops/${SHOP}`).get()
if (!shop.exists) {
  console.error(`${SHOP} not found. Run \`npm run seed\` first.`)
  process.exit(1)
}
const services = Object.fromEntries((await db.collection(`shops/${SHOP}/services`).get()).docs.map((d) => [d.id, d.data()]))
const cut = services['gents-cut']

await db.doc(`customers/${CUSTOMER}`).set({ phoneE164: '+6591230010', displayName: 'FR10 Test Customer' })

const plan = [
  { id: 'fr10-seed-in-service', startsInMin: -25, durationMin: 75, status: 'IN_SERVICE', actualStart: now - 20 * MIN },
  { id: 'fr10-seed-late-in-30m', startsInMin: 30, durationMin: cut.durationMin, status: 'CONFIRMED' },
  { id: 'fr10-seed-in-120m', startsInMin: 120, durationMin: cut.durationMin, status: 'CONFIRMED' },
]
for (const p of plan) {
  const start = now + p.startsInMin * MIN
  await db.doc(`appointments/${p.id}`).set({
    requestId: p.id, shopId: SHOP, barberId: BARBER, serviceId: 'gents-cut',
    customerId: CUSTOMER, customerName: 'FR10 Test Customer', customerPhoneMasked: '+65 9••• ••10',
    start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(start + p.durationMin * MIN), status: p.status,
    holdExpiresAt: null, priceCents: cut.priceCents, durationMin: p.durationMin, lateCancel: false,
    ...(p.actualStart ? { actualStart: Timestamp.fromMillis(p.actualStart) } : {}),
  })
  await db.doc(`notifications/${p.id}_delay`).delete() // a rerun may warn again
}
await db.doc(`shops/${SHOP}/queue/fr10-seed-walk-in-01`).set({
  shopId: SHOP, barberId: BARBER, walkInName: 'Walk-in Wei', serviceId: 'gents-cut', durationMin: cut.durationMin,
  status: 'waiting', joinedAt: Timestamp.fromMillis(now - 5 * MIN), createdBy: 'seed',
})
console.log('FR-10 test data ready: sign in as Jun Wei (or the owner) and open Queue. Run `npm run sweep` to write and send the warning.')
