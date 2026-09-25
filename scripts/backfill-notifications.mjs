// Dev-only: creates the reminder tasks that are missing for future CONFIRMED appointments in the Firebase
// EMULATORS (FR-09), for bookings made before reminders existed. Existing tasks are left alone and no
// confirmation message is created. Safe to rerun. The next `npm run sweep` (or the scheduler) sends what is due.
// Usage: `npm run backfill:notifications [-- --shop <shopId>]`.
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

// Use the copy of firebase-admin that functions/notifications.js loads, so Timestamps and sentinels match.
const fromFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
const { backfillTasks } = createRequire(import.meta.url)('../functions/notifications.js')
const projectId = 'fresher-6d857' // same project id as scripts/seed.mjs
const { initializeApp } = fromFunctions('firebase-admin/app')
const { getFirestore } = fromFunctions('firebase-admin/firestore')
const db = getFirestore(initializeApp({ projectId }, 'backfill-notifications'))

const { appointments, tasks } = await backfillTasks(db, { shopId })
console.log(`${shopId ? `Shop ${shopId}` : 'All shops'}: checked ${appointments} future CONFIRMED appointments, created ${tasks} reminder tasks.`)
