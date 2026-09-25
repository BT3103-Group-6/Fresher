import { reactive } from 'vue'

// Staff session: the signed-in user plus their custom claims { shopId, role, barberId }.
export const session = reactive({ user: null, claims: {}, ready: false })

// Firebase Auth is fetched on demand (NFR-01), never as part of the landing page's first load. `loadSession`
// starts it once; the router waits for it before staff routes and the sign-in page, and customer pages start it
// without waiting. `STAFF_HINT` remembers that this browser has a staff session, so the landing page (which
// otherwise never loads Auth) still knows to load it and offer the "Staff area" link.
const STAFF_HINT = 'fresher.staffHint'
export function mayHaveStaffSession() {
  try { return localStorage.getItem(STAFF_HINT) === '1' } catch { return false }
}
function setHint(on) {
  try { on ? localStorage.setItem(STAFF_HINT, '1') : localStorage.removeItem(STAFF_HINT) } catch { /* ignore */ }
}

let auth
async function apply(user) {
  session.user = user
  session.claims = user ? (await user.getIdTokenResult()).claims : {}
  setHint(isStaff())
}

let loading = null
/** Starts Firebase Auth once. Resolves when Firebase has restored (or found no) session. */
export function loadSession() {
  loading ??= Promise.all([import('firebase/auth'), import('@/firebaseAuth')]).then(
    ([{ onAuthStateChanged }, m]) =>
      new Promise((resolve) => {
        auth = m.auth
        onAuthStateChanged(auth, async (user) => {
          await apply(user)
          session.ready = true
          resolve()
        })
      }),
  )
  return loading
}

export const isOwner = () => session.claims.role === 'owner' && !!session.claims.shopId
export const isBarber = () => session.claims.role === 'barber' && !!session.claims.shopId && !!session.claims.barberId
export const isStaff = () => isOwner() || isBarber()
// Where staff land after sign-in (decisions A12): owners configure, barbers see their day.
export const landingRoute = () => (isOwner() ? { name: 'shop-config' } : { name: 'schedule' })

export async function signIn(email, password) {
  await loadSession()
  const { signInWithEmailAndPassword } = await import('firebase/auth')
  const { user } = await signInWithEmailAndPassword(auth, email, password)
  await apply(user)
}

export async function signOut() {
  await loadSession()
  const { signOut: fbSignOut } = await import('firebase/auth')
  await fbSignOut(auth)
  await apply(null)
}
