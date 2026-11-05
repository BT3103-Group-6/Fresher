// Dev-only: three CONFIRMED appointments for trying the FR-12 buttons on UI-B1 (/staff/schedule).
// Barber Jun Wei at shop-jurong (run `npm run seed` first), one test customer:
//   started 30 min ago (20-min wash and style: Mark no-show is enabled),
//   started 5 min ago  (Start is enabled, Mark no-show is locked for another 10 min),
//   starts in 45 min   (Start is enabled, being within the hour before the slot).
// Jun Wei is used rather than Daniel because the first two must not overlap, and only he offers a 20-minute
// service. Safe to rerun: fixed IDs; each run resets the three appointments, their audit records and the
// customer's no-show count, and moves the times to "now". Refuses to run outside the emulator.
import { initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'node:module'

const { scheduleId, sgDateKey } = createRequire(import.meta.url)('../functions/booking.js')

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) {
  console.error(
    'Refusing to seed: FIRESTORE_EMULATOR_HOST must point at a local emulator ' +
      '(run this through `npm run seed:fr12`) so it can never touch production.',
  )
  process.exit(1)
}

const db = getFirestore(initializeApp({ projectId: 'fresher-6d857' }))

const SHOP = 'shop-jurong'
const BARBER = 'jun-wei'
const CUSTOMER = 'fr12-test-customer'
const MIN = 60e3
const now = Date.now()

const shop = await db.doc(`shops/${SHOP}`).get()
if (!shop.exists) {
  console.error(`${SHOP} not found. Run \`npm run seed\` first.`)
  process.exit(1)
}
const services = Object.fromEntries(
  (await db.collection(`shops/${SHOP}/services`).get()).docs.map((d) => [d.id, d.data()]),
)

const plan = [
  { id: 'fr12-seed-started-30m', serviceId: 'wash-style', startsInMin: -30 },
  { id: 'fr12-seed-started-5m', serviceId: 'gents-cut', startsInMin: -5 },
  { id: 'fr12-seed-starts-in-45m', serviceId: 'gents-cut', startsInMin: 45 },
]

await db.doc(`customers/${CUSTOMER}`).set({ phoneE164: '+6591230000', displayName: 'FR12 Test Customer' })
await db.doc(`customers/${CUSTOMER}/shopStats/${SHOP}`).set({ noShowCount: 0, lateCancels: 0 })

const byDoc = new Map() // schedule doc ref path -> {ref, start, adds[]}
for (const p of plan) {
  const svc = services[p.serviceId]
  const start = now + p.startsInMin * MIN
  const end = start + svc.durationMin * MIN
  await db.doc(`appointments/${p.id}`).set({
    requestId: p.id, shopId: SHOP, barberId: BARBER, serviceId: p.serviceId,
    customerId: CUSTOMER, customerName: 'FR12 Test Customer', customerPhoneMasked: '+65 9••• ••00',
    start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(end), status: 'CONFIRMED',
    holdExpiresAt: null, priceCents: svc.priceCents, durationMin: svc.durationMin,
    lateCancel: false, // set() replaces the doc, clearing any actualStart/actualEnd/noShowAt from a previous run.
  })
  for (const a of (await db.collection('auditLog').where('shopId', '==', SHOP).where('bookingId', '==', p.id).get()).docs) {
    await a.ref.delete()
  }
  const ref = db.doc(`shops/${SHOP}/schedules/${scheduleId(BARBER, start)}`)
  const entry = byDoc.get(ref.path) ?? { ref, start, adds: [] }
  entry.adds.push({ start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(end), kind: 'booking', refId: p.id })
  byDoc.set(ref.path, entry)
}

// The schedule doc is the lock document: keep whatever else is on it, replace only our own booking intervals.
const ours = new Set(plan.map((p) => p.id))
for (const { ref, start, adds } of byDoc.values()) {
  const kept = ((await ref.get()).data()?.intervals ?? []).filter((i) => !ours.has(i.refId))
  await ref.set({ barberId: BARBER, date: sgDateKey(start), intervals: [...kept, ...adds] }, { merge: true })
}

const fmt = (ms) => new Date(ms).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' })
console.log(`Seeded ${plan.length} CONFIRMED appointments for Jun Wei at ${shop.data().name} (fictional data):`)
for (const p of plan) console.log(`  ${fmt(now + p.startsInMin * MIN)}  ${services[p.serviceId].name.padEnd(15)} ${p.id}`)
console.log('Sign in as owner@shop-jurong.example.com (password123) and open /staff/schedule, choosing Jun Wei.')
if (byDoc.size > 1) console.log('Note: the times straddle midnight in Singapore, so they sit on two different days.')
