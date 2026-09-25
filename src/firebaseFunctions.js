import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { app } from './firebaseApp'

export const functions = getFunctions(app, 'asia-southeast1')

if (import.meta.env.DEV && !globalThis.__fresherFunctionsEmulator) {
  globalThis.__fresherFunctionsEmulator = true
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
