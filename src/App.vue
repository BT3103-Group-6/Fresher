<script setup>
import { useRouter } from 'vue-router'
import { isOwner, session, signOut } from '@/stores/session'

const router = useRouter()

async function onSignOut() {
  await signOut()
  router.push({ name: 'login' })
}
</script>

<template>
  <header v-if="session.user && session.claims.role" class="bar">
    <nav class="staff-nav" aria-label="Staff">
      <RouterLink :to="{ name: 'schedule' }">Schedule</RouterLink>
      <RouterLink v-if="isOwner()" :to="{ name: 'dashboard' }">Dashboard</RouterLink>
      <RouterLink v-if="isOwner()" :to="{ name: 'shop-config' }">Shop configuration</RouterLink>
    </nav>
    <span class="who">{{ session.user.email }}</span>
    <button type="button" class="btn secondary" @click="onSignOut">Sign out</button>
  </header>
  <RouterView />
</template>
