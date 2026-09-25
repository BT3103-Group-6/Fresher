// Dev-only: builds shops/{shopId}/dailyStats from appointments that already exist in the Firebase EMULATORS
// (FR-14). Uses the same code as the onAppointmentWritten trigger, so it is safe to rerun and to run while the
// Functions emulator is live. Usage: `npm run backfill:stats [-- --shop <shopId>] [-- --reset]`.
// --reset deletes the shop's dailyStats and statContrib first (repairs wrong counters); avoid it while bookings change.
import { createRequire } from 'node:module'

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set. This script is for the emulators only.')
  process.exit(1)
}

const args = process.argv.slice(2)
const shopFlag = args.indexOf('--shop')
const shopId = shopFlag >= 0 ? args[shopFlag + 1] : undefined
if (shopFlag >= 0 && !shopId) {
  console.error('--shop needs a shop ID.')
  process.exit(1)
}
const reset = args.includes('--reset')

// Use the copy of firebase-admin that functions/stats.js loads, so FieldValue sentinels match.
const fromFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
const { backfill } = createRequire(import.meta.url)('../functions/stats.js')
const projectId = 'fresher-6d857' // same project id as scripts/seed.mjs
const { initializeApp } = fromFunctions('firebase-admin/app')
const { getFirestore } = fromFunctions('firebase-admin/firestore')
const db = getFirestore(initializeApp({ projectId }, 'backfill'))

const { appointments, changed } = await backfill(db, { shopId, reset })
console.log(`${shopId ? `Shop ${shopId}` : 'All shops'}${reset ? ' (reset first)' : ''}: checked ${appointments} counted appointments, updated ${changed}.`)
