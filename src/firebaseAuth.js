import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { app } from './firebaseApp'

export const auth = getAuth(app)

// Module state is reset on HMR, so guard against connecting twice.
if (import.meta.env.DEV && !globalThis.__fresherAuthEmulator) {
  globalThis.__fresherAuthEmulator = true
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}
