// Loads fictional shops, barbers, services and staff accounts into the Firebase EMULATORS.
// Usage: start the emulators, then `npm run seed`. Safe to rerun (fixed IDs, upserts).
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { geohashForLocation } from 'geofire-common'

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    'Refusing to seed: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST ' +
      '(e.g. via `npm run seed`) so this can never touch production.',
  )
  process.exit(1)
}

const app = initializeApp({ projectId: 'fresher-6d857' })
const db = getFirestore(app)
const auth = getAuth(app)

const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const hours = (days, start, end) =>
  Object.fromEntries(weekdays.map((d) => [d, days.includes(d) ? [{ start, end }] : []]))

const shops = [
  {
    id: 'shop-tiong-bahru',
    name: 'Kopi & Clippers',
    address: '55 Tiong Bahru Road, Singapore',
    postalCode: '160055',
    lat: 1.2855,
    lng: 103.8267,
    status: 'verified',
    latePolicy: 'block',
    open: hours(['tue', 'wed', 'thu', 'fri', 'sat', 'sun'], '10:00', '19:00'),
    priceMin: 1500,
    priceMax: 6000,
    services: [
      ['gents-cut', 'Gents haircut', 30, 2500],
      ['fade', 'Skin fade', 45, 3500],
      ['beard', 'Beard trim', 15, 1500],
      ['cut-beard', 'Haircut and beard', 45, 4000],
    ],
    barbers: [
      ['ah-meng', 'Meng', ['gents-cut', 'fade', 'beard', 'cut-beard']],
      ['sara', 'Sara', ['gents-cut', 'fade']],
    ],
  },
  {
    id: 'shop-tampines',
    name: 'Home Cuts by Rizal',
    address: '478 Tampines Street 44, Singapore',
    postalCode: '520478',
    lat: 1.3545,
    lng: 103.9436,
    status: 'verified',
    latePolicy: 'flag',
    open: hours(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], '11:00', '20:00'),
    priceMin: 1200,
    priceMax: 3000,
    services: [
      ['kids-cut', 'Kids haircut', 20, 1200],
      ['gents-cut', 'Gents haircut', 30, 1800],
      ['shave', 'Classic shave', 20, 1500],
    ],
    barbers: [['rizal', 'Rizal', ['kids-cut', 'gents-cut', 'shave']]],
  },
  {
    id: 'shop-jurong',
    name: 'Lakeside Barbers',
    address: '135 Jurong Gateway Road, Singapore',
    postalCode: '600135',
    lat: 1.3331,
    lng: 103.7423,
    status: 'verified',
    latePolicy: 'block',
    open: hours(weekdays, '09:00', '21:00'),
    priceMin: 1800,
    priceMax: 8000,
    services: [
      ['gents-cut', 'Gents haircut', 30, 2200],
      ['perm', 'Textured perm', 90, 8000],
      ['colour', 'Hair colour', 60, 6500],
      ['wash-style', 'Wash and style', 20, 1800],
    ],
    barbers: [
      ['jun-wei', 'Jun Wei', ['gents-cut', 'wash-style', 'perm']],
      ['priya', 'Priya', ['gents-cut', 'colour', 'wash-style']],
      ['daniel', 'Daniel', ['gents-cut', 'perm', 'colour']],
    ],
  },
  {
    id: 'shop-pending',
    name: 'Newcomer Cuts (awaiting verification)',
    address: '10 Bishan Street 15, Singapore',
    postalCode: '579804',
    lat: 1.3526,
    lng: 103.8352,
    status: 'pending',
    latePolicy: 'block',
    open: hours(['sat', 'sun'], '10:00', '18:00'),
    priceMin: 2000,
    priceMax: 2000,
    services: [['gents-cut', 'Gents haircut', 30, 2000]],
    barbers: [['newcomer', 'Newcomer', ['gents-cut']]],
  },
]

const staffPassword = 'password123'
const staffAccounts = []

async function upsertUser(uid, email, claims) {
  const user = { uid, email, password: staffPassword, emailVerified: true }
  try {
    await auth.updateUser(uid, user)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    await auth.createUser(user)
  }
  await auth.setCustomUserClaims(uid, claims)
  staffAccounts.push([email, JSON.stringify(claims)])
}

for (const shop of shops) {
  const { id, services, barbers, open, ...profile } = shop
  const shopRef = db.doc(`shops/${id}`)
  await shopRef.set({
    ...profile,
    geohash: geohashForLocation([shop.lat, shop.lng]),
    openingHours: open,
    tz: 'Asia/Singapore',
    noticeMins: 120,
  })

  for (const [serviceId, name, durationMin, priceCents] of services) {
    await shopRef
      .collection('services')
      .doc(serviceId)
      .set({ name, durationMin, priceCents, active: true })
  }

  for (const [barberId, displayName, serviceIds] of barbers) {
    await shopRef
      .collection('barbers')
      .doc(barberId)
      .set({ displayName, active: true, serviceIds, workingHours: open })
  }

  const ownerUid = `${id}-owner`
  await upsertUser(ownerUid, `owner@${id}.example.com`, { shopId: id, role: 'owner' })
  await shopRef.collection('members').doc(ownerUid).set({ role: 'owner' })

  // Solo shops are run by the owner alone; multi-barber shops also get a barber login
  // (for the last listed barber) so the barber role can be exercised.
  if (barbers.length > 1) {
    const [barberId] = barbers[barbers.length - 1]
    const barberUid = `${id}-barber`
    await upsertUser(barberUid, `barber@${id}.example.com`, { shopId: id, role: 'barber', barberId })
    await shopRef.collection('members').doc(barberUid).set({ role: 'barber', barberId })
  }
}

await upsertUser('platform-admin', 'admin@fresher.example.com', { admin: true })

console.log(`Seeded ${shops.length} shops (fictional data).`)
console.log(`Staff logins (password for all: ${staffPassword}):`)
for (const [email, claims] of staffAccounts) console.log(`  ${email}  ${claims}`)
