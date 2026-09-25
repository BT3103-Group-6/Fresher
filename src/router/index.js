import { createRouter, createWebHistory } from 'vue-router'
import { authReady, isOwner, session } from '@/stores/session'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/staff/config' },
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
