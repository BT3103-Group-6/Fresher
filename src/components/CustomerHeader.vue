<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import FresherLogo from '@/components/FresherLogo.vue'
import { isStaff, landingRoute } from '@/stores/session'

// One header for every customer page (decisions A15). Signed-in staff get only a small "Staff area" link,
// never staff navigation. "For barbers" is offered on the landing page only.
const route = useRoute()
const staff = computed(() => isStaff())
const onLanding = computed(() => route.name === 'discover')
</script>

<template>
  <header class="customer-header">
    <RouterLink :to="{ name: 'discover' }" class="brand" aria-label="Fresher, home">
      <FresherLogo :size="28" background="#F6F8F7" />
    </RouterLink>
    <nav aria-label="Customer" class="customer-nav">
      <RouterLink :to="{ name: 'my-bookings' }">My bookings</RouterLink>
      <RouterLink v-if="staff" :to="landingRoute()" class="staff-area">Staff area</RouterLink>
      <RouterLink v-else-if="onLanding" :to="{ name: 'discover', hash: '#for-barbers' }">For barbers</RouterLink>
    </nav>
  </header>
</template>
