import { createRouter, createWebHistory } from 'vue-router'
import { isBarber, isOwner, isStaff, landingRoute, loadSession, mayHaveStaffSession, session } from '@/stores/session'
import { draft } from '@/stores/booking'

const router = createRouter({
  history: createWebHistory(),
  // Back from a shop restores the results' scroll position; #hash links scroll to their section.
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  },
  routes: [
    // Customer home: discover shops (FR-01). Staff sign in at /login.
    { path: '/', name: 'discover', meta: { wide: true }, component: () => import('@/views/customer/DiscoverView.vue') },
    // Customer booking (FR-02, FR-03). No sign-in needed until the OTP step.
    { path: '/shops/:shopId', name: 'book', component: () => import('@/views/customer/ShopView.vue') },
    {
      path: '/shops/:shopId/verify',
      name: 'book-verify',
      component: () => import('@/views/customer/VerifyView.vue'),
      // The draft is in memory only, so a reload lands back on slot selection.
      beforeEnter: (to) => (draft.hold && draft.shopId === to.params.shopId ? true : { name: 'book', params: to.params }),
    },
    // Deposit checkout (FR-13). Reached from UI-C3 or UI-C4; reads everything from the live booking, so a reload is safe.
    { path: '/deposit/:requestId', name: 'deposit', component: () => import('@/views/customer/DepositView.vue') },
    // Waitlist (FR-15): join from UI-C2 (?shop=&service=&barber=&date=) and claim offers. Runs its own OTP step.
    { path: '/waitlist', name: 'waitlist', component: () => import('@/views/customer/WaitlistView.vue') },
    // Customer bookings (FR-04, FR-05). The view runs its own fresh-OTP step; the server re-checks it.
    { path: '/my-bookings', name: 'my-bookings', component: () => import('@/views/customer/MyBookingsView.vue') },
    // Barber schedule (FR-08): barbers see their own day, owners pick any barber in their shop.
    {
      path: '/staff/schedule',
      name: 'schedule',
      component: () => import('@/views/staff/ScheduleView.vue'),
      meta: { requiresStaff: true },
    },
    // Queue management (FR-10): barbers see only their own queue, owners pick a barber.
    {
      path: '/staff/queue',
      name: 'queue',
      component: () => import('@/views/staff/QueueView.vue'),
      meta: { requiresStaff: true },
    },
    // Shop dashboard (FR-14): owner only; barbers are redirected to their schedule by the guard below.
    {
      path: '/staff/dashboard',
      name: 'dashboard',
      component: () => import('@/views/staff/DashboardView.vue'),
      meta: { requiresOwner: true },
    },
    { path: '/login', name: 'login', component: () => import('@/views/staff/SignInView.vue') },
    {
      path: '/staff/config',
      name: 'shop-config',
      component: () => import('@/views/staff/ShopConfigView.vue'),
      meta: { requiresOwner: true },
    },
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
