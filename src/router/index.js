import { createRouter, createWebHistory } from 'vue-router'
import { authReady, isOwner, session } from '@/stores/session'
import { draft } from '@/stores/booking'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/staff/config' },
    // Customer booking (FR-02, FR-03). No sign-in needed until the OTP step.
    { path: '/shops/:shopId', name: 'book', component: () => import('@/views/customer/ShopView.vue') },
    {
      path: '/shops/:shopId/verify',
      name: 'book-verify',
      component: () => import('@/views/customer/VerifyView.vue'),
      // The draft is in memory only, so a reload lands back on slot selection.
      beforeEnter: (to) => (draft.hold && draft.shopId === to.params.shopId ? true : { name: 'book', params: to.params }),
    },
    // Customer bookings (FR-04, FR-05). The view runs its own fresh-OTP step; the server re-checks it.
    { path: '/my-bookings', name: 'my-bookings', component: () => import('@/views/customer/MyBookingsView.vue') },
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
  await authReady
  if (to.meta.requiresOwner) {
    if (!session.user) return { name: 'login', query: { redirect: to.fullPath } }
    // Signed in but not an owner (barber, admin, customer): sent to sign-in with a reason.
    if (!isOwner()) return { name: 'login', query: { denied: '1' } }
  }
  if (to.name === 'login' && isOwner() && !to.query.denied) return { name: 'shop-config' }
})

export default router
