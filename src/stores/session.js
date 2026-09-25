import { reactive } from 'vue'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth'
import { auth } from '@/firebase'

// Staff session: the signed-in user plus their custom claims { shopId, role, barberId }.
export const session = reactive({ user: null, claims: {}, ready: false })

async function apply(user) {
  session.user = user
  session.claims = user ? (await user.getIdTokenResult()).claims : {}
}

// Resolves once Firebase has restored (or found no) session, so the router guard never races it.
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, async (user) => {
    await apply(user)
    session.ready = true
    resolve()
  })
})

export const isOwner = () => session.claims.role === 'owner' && !!session.claims.shopId
export const isBarber = () => session.claims.role === 'barber' && !!session.claims.shopId && !!session.claims.barberId
export const isStaff = () => isOwner() || isBarber()
// Where staff land after sign-in (decisions A12): owners configure, barbers see their day.
export const landingRoute = () => (isOwner() ? { name: 'shop-config' } : { name: 'schedule' })

export async function signIn(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email, password)
  await apply(user)
}

export async function signOut() {
  await fbSignOut(auth)
  await apply(null)
}
