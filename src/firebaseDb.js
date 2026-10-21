import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { app } from './firebaseApp'

export const db = getFirestore(app)

if (import.meta.env.DEV && !globalThis.__fresherDbEmulator) {
  globalThis.__fresherDbEmulator = true
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
