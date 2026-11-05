// Loads fictional shops, barbers, services and staff accounts into the Firebase EMULATORS, then the A18 demo dataset
// (50 shops with bookings, customers, waitlist and walk-ins; see docs/decisions.md A18). `--skip-demo` leaves that out.
// Usage: start the emulators, then `npm run seed`. Safe to rerun (fixed IDs, upserts).
// Live mode (`npm run seed:live -- --confirm-live=<project id>`) is for the public demo project only (A17).
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'node:module'
import { geohashForLocation } from 'geofire-common'
import { generateDemoData } from './demo/generate.mjs'
import { validateDataset } from './demo/validate.mjs'
import { seedDemo } from './demo/write.mjs'

// Same summary the services trigger computes, so seeded shops look identical with or without the Functions emulator.
const { summarizeServices } = createRequire(import.meta.url)('../functions/discovery.js')

const PROJECT_ID = 'fresher-6d857'
const args = process.argv.slice(2)
const live = args.includes('--live')
const overwrite = args.includes('--overwrite')
const skipDemo = args.includes('--skip-demo')
const emulatorVars = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']
const die = (message) => {
  console.error(message)
  process.exit(1)
}

let staffPassword = 'password123'
if (live) {
  // A17 live mode: writes to the REAL project. Runs only with --confirm-live=<project id>, never with emulator
  // variables set, and never with a default password. `npm run seed:live` on its own therefore refuses.
  const known = ['--live', '--overwrite', '--skip-demo']
  const unknown = args.filter((a) => !known.includes(a) && !a.startsWith('--confirm-live='))
  if (unknown.length) die(`Refusing to seed: unknown option ${unknown.join(' ')}.`)
  if (emulatorVars.some((v) => process.env[v])) {
    die('Refusing to seed live: emulator variables are set (' + emulatorVars.join(', ') + '). Unset them.')
  }
  const confirm = args.find((a) => a.startsWith('--confirm-live='))?.slice('--confirm-live='.length)
  if (confirm !== PROJECT_ID) {
    die(
      `Refusing to seed the LIVE project. To write sample data to ${PROJECT_ID}, run:\n` +
        `  SEED_STAFF_PASSWORD='<12+ characters>' npm run seed:live -- --confirm-live=${PROJECT_ID}\n` +
        'Needs Application Default Credentials (gcloud auth application-default login). ' +
        'Add --overwrite to replace sample shops that already exist.',
    )
  }
  staffPassword = process.env.SEED_STAFF_PASSWORD ?? ''
  if (staffPassword.length < 12) die('Refusing to seed live: set SEED_STAFF_PASSWORD to at least 12 characters.')
} else {
  const unknown = args.filter((a) => a !== '--skip-demo')
  if (unknown.length) die(`Refusing to seed: unknown option ${unknown.join(' ')}. Live seeding is \`npm run seed:live\` (see docs/deployment.md).`)
  if (!emulatorVars.every((v) => process.env[v])) {
    die(
      'Refusing to seed: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST ' +
        '(e.g. via `npm run seed`) so this can never touch production.',
    )
  }
}

const app = initializeApp({ projectId: PROJECT_ID })
const db = getFirestore(app)
const auth = getAuth(app)

// A18: generate and validate the demo dataset before anything is written, so a bad dataset never reaches Firebase.
const demo = skipDemo ? null : generateDemoData()
if (demo) {
  const problems = validateDataset(demo)
  if (problems.length) die(`Refusing to seed: the demo dataset failed validation:\n  ${problems.slice(0, 10).join('\n  ')}`)
}

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
    services: [
      ['gents-cut', 'Gents haircut', 'haircut', 30, 2500],
      ['fade', 'Skin fade', 'haircut', 45, 3500],
      ['beard', 'Beard trim', 'beard', 15, 1500],
      ['cut-beard', 'Haircut and beard', 'haircut', 45, 4000],
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
    services: [
      ['kids-cut', 'Kids haircut', 'kids', 20, 1200],
      ['gents-cut', 'Gents haircut', 'haircut', 30, 1800],
      ['shave', 'Classic shave', 'shave', 20, 1500],
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
    services: [
      ['gents-cut', 'Gents haircut', 'haircut', 30, 2200],
      ['perm', 'Textured perm', 'perm', 90, 8000],
      ['colour', 'Hair colour', 'colour', 60, 6500],
      ['wash-style', 'Wash and style', 'other', 20, 1800],
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
    services: [['gents-cut', 'Gents haircut', 'haircut', 30, 2000]],
    barbers: [['newcomer', 'Newcomer', ['gents-cut']]],
  },
]

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

if (live && !overwrite) {
  const existing = []
  for (const { id } of [...shops, ...(demo ? demo.shops : [])]) if ((await db.doc(`shops/${id}`).get()).exists) existing.push(id)
  if (existing.length) {
    die(`Refusing to seed live: ${existing.slice(0, 6).join(', ')}${existing.length > 6 ? ` and ${existing.length - 6} more` : ''} already exist. Add --overwrite to replace them.`)
  }
}
if (live) console.log(`Seeding LIVE project ${PROJECT_ID}${overwrite ? ' (overwriting existing sample shops)' : ''}...`)

for (const shop of shops) {
  const { id, services, barbers, open, ...profile } = shop
  const shopRef = db.doc(`shops/${id}`)
  await shopRef.set({
    ...profile,
    geohash: geohashForLocation([shop.lat, shop.lng]),
    ...summarizeServices(services.map(([, , category, durationMin, priceCents]) => ({ category, durationMin, priceCents, active: true }))),
    openingHours: open,
    tz: 'Asia/Singapore',
    noticeMins: 120,
  })

  for (const [serviceId, name, category, durationMin, priceCents] of services) {
    await shopRef
      .collection('services')
      .doc(serviceId)
      .set({ name, category, durationMin, priceCents, active: true })
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
console.log(live ? 'Staff logins (password: the SEED_STAFF_PASSWORD you gave):' : `Staff logins (password for all: ${staffPassword}):`)
for (const [email, claims] of staffAccounts) console.log(`  ${email}  ${claims}`)

if (demo) {
  // With --overwrite (live) or in the emulator, the demo shops' earlier generated data is removed first.
  const result = await seedDemo({ db, auth, ds: demo, password: staffPassword, clean: !live || overwrite })
  console.log(`\nDemo staff logins (same password as above): owner@<shop id>.example.com and <barber id>@<shop id>.example.com`)
  for (const s of demo.shops) console.log(`  ${s.id.padEnd(28)} ${s.barbers.map((b) => b.id).join(', ')}`)
  console.log('\nShowcase customers (Auth users; add these numbers as Firebase test phone numbers to sign in as them):')
  for (const c of demo.showcase) console.log(`  ${c.phoneE164}  ${c.displayName.padEnd(20)} ${c.role === 'deposit' ? 'two or more no-shows at one shop (deposit checkout)' : 'history across shops (History and Rebook)'}`)
  if (!result.ok) process.exit(1)
}
