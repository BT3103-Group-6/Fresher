import { createRouter, createWebHistory } from 'vue-router'
import { isBarber, isOwner, isStaff, landingRoute, loadSession, mayHaveStaffSession, session } from '@/stores/session'

const router = createRouter({
  history: createWebHistory(),
  // Back from a shop restores the results' scroll position; #hash links scroll to their section.
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  },
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/staff/SignInView.vue') },
    // Integration stubs (replaced story by story): the shared headers link to these named routes, so until
    // the PR that brings in each screen replaces its stub with the real route, it shows the sign-in page.
    { path: '/', name: 'discover', component: () => import('@/views/staff/SignInView.vue') },
    { path: '/my-bookings', name: 'my-bookings', component: () => import('@/views/staff/SignInView.vue') },
    { path: '/staff/schedule', name: 'schedule', component: () => import('@/views/staff/SignInView.vue') },
    { path: '/staff/queue', name: 'queue', component: () => import('@/views/staff/SignInView.vue') },
    { path: '/staff/dashboard', name: 'dashboard', component: () => import('@/views/staff/SignInView.vue') },
    { path: '/staff/config', name: 'shop-config', component: () => import('@/views/staff/ShopConfigView.vue'), meta: { requiresOwner: true }, },
  ],
})

router.beforeEach(async (to) => {
  // Only staff routes and the sign-in page need the session before they render; other pages start it in the
  // background (or, on the landing page, only if this browser has a staff session).
  const needsSession = to.meta.requiresOwner || to.meta.requiresStaff || to.name === 'login'
  if (needsSession) await loadSession()
  else if (to.name !== 'discover' || mayHaveStaffSession()) loadSession().catch(() => {})
  if (to.meta.requiresOwner || to.meta.requiresStaff) {
    if (!session.user) return { name: 'login', query: { redirect: to.fullPath } }
    // A barber opening an owner-only page lands on their schedule instead of a dead end.
    if (to.meta.requiresOwner && !isOwner() && isBarber()) return { name: 'schedule' }
    // Signed in but not staff (customer, admin): sent to sign-in with a reason.
    if (!isStaff()) return { name: 'login', query: { denied: '1' } }
  }
  if (to.name === 'login' && isStaff() && !to.query.denied) return landingRoute()
})

export default router
