// Firebase for every screen except the landing page. Each service lives in its own module so a screen (or the
// landing page, lazily) can load only the services it needs; this file gathers all three for the other screens.
// Emulator wiring (DEV only) is done inside each module.
export { auth } from './firebaseAuth'
export { db } from './firebaseDb'
export { functions } from './firebaseFunctions'
