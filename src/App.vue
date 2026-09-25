<script setup>
import { useRouter } from 'vue-router'
import { session, signOut } from '@/stores/session'

const router = useRouter()

async function onSignOut() {
  await signOut()
  router.push({ name: 'login' })
}
</script>

<template>
  <header v-if="session.user" class="bar">
    <span class="who">{{ session.user.email }}</span>
    <button type="button" class="btn secondary" @click="onSignOut">Sign out</button>
  </header>
  <RouterView />
</template>
