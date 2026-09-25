<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FresherLogo from '@/components/FresherLogo.vue'
import { isOwner, session, signOut } from '@/stores/session'

const route = useRoute()
const router = useRouter()

const root = ref(null)
const navOpen = ref(false)
const accountOpen = ref(false)
const navToggle = ref(null)
const accountToggle = ref(null)

const email = computed(() => session.user?.email ?? '')
const initial = computed(() => (email.value ? email.value[0].toUpperCase() : 'A'))
const roleLabel = computed(() => (isOwner() ? 'Owner' : 'Barber'))

function closeAll(returnFocus = false) {
  const el = accountOpen.value ? accountToggle.value : navOpen.value ? navToggle.value : null
  navOpen.value = false
  accountOpen.value = false
  if (returnFocus && el) nextTick(() => el.focus())
}
function toggleNav() {
  accountOpen.value = false
  navOpen.value = !navOpen.value
}
function toggleAccount() {
  navOpen.value = false
  accountOpen.value = !accountOpen.value
}
function onDocPointer(e) {
  if (root.value && !root.value.contains(e.target)) closeAll()
}
function onKey(e) {
  if (e.key === 'Escape' && (navOpen.value || accountOpen.value)) closeAll(true)
}
// Keyboard users tabbing out of an open dropdown close it.
function onFocusOut(e) {
  if (root.value && e.relatedTarget && !root.value.contains(e.relatedTarget)) closeAll()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onKey)
})
watch(() => route.fullPath, () => closeAll())

async function onSignOut() {
  closeAll()
  await signOut()
  router.push({ name: 'login' })
}
</script>

<template>
  <header ref="root" class="staff-header" @focusout="onFocusOut">
    <RouterLink :to="{ name: 'schedule' }" class="brand" aria-label="Fresher, staff home">
      <FresherLogo :size="28" background="#F6F8F7" />
    </RouterLink>

    <button
      ref="navToggle"
      type="button"
      class="btn secondary header-btn nav-toggle"
      aria-controls="staff-nav"
      :aria-expanded="navOpen"
      @click="toggleNav"
    >
      Menu
    </button>
    <nav id="staff-nav" class="staff-nav" :class="{ open: navOpen }" aria-label="Staff">
      <RouterLink :to="{ name: 'schedule' }">Schedule</RouterLink>
      <RouterLink :to="{ name: 'queue' }">Queue</RouterLink>
      <RouterLink v-if="isOwner()" :to="{ name: 'dashboard' }">Dashboard</RouterLink>
      <RouterLink v-if="isOwner()" :to="{ name: 'shop-config' }">Shop configuration</RouterLink>
    </nav>

    <div class="account">
      <button
        ref="accountToggle"
        type="button"
        class="account-btn"
        aria-label="Account menu"
        aria-controls="account-menu"
        :aria-expanded="accountOpen"
        @click="toggleAccount"
      >
        {{ initial }}
      </button>
      <div v-show="accountOpen" id="account-menu" class="account-menu" role="group" aria-label="Account">
        <p class="account-email">{{ email }}</p>
        <p class="account-role">Role: {{ roleLabel }}</p>
        <RouterLink :to="{ name: 'discover' }" class="account-link">View customer site</RouterLink>
        <button type="button" class="btn secondary header-btn" @click="onSignOut">Sign out</button>
      </div>
    </div>
  </header>
</template>
