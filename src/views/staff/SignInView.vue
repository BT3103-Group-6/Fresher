<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isStaff, landingRoute, session, signIn, signOut } from '@/stores/session'

const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const errors = ref({})
const formError = ref('')
const pending = ref(false)
const isDev = import.meta.env.DEV

function validate() {
  const e = {}
  if (!email.value.trim()) e.email = 'Enter your email address.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) e.email = 'Enter a valid email address.'
  if (!password.value) e.password = 'Enter your password.'
  errors.value = e
  return Object.keys(e).length === 0
}

// Signed in but not staff (customer, admin): show why, instead of the form.
async function onSignOut() {
  await signOut()
  router.replace({ name: 'login' })
}

async function onSubmit() {
  formError.value = ''
  if (!validate()) return
  pending.value = true
  try {
    await signIn(email.value.trim(), password.value)
    const target = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : router.resolve(landingRoute()).fullPath
    await router.push(target)
  } catch (err) {
    // The email stays filled in; only the password is cleared.
    password.value = ''
    if (err.code === 'auth/network-request-failed') formError.value = 'Network problem. Check your connection and try again.'
    else if (err.code === 'auth/too-many-requests') formError.value = 'Too many attempts. Wait a moment and try again.'
    else formError.value = 'Email or password is incorrect.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="signin">
    <section v-if="session.user && !isStaff()" class="card panel" aria-labelledby="na-h">
      <h1 id="na-h">Not authorised</h1>
      <p class="banner" role="alert">
        The staff area is for shop owners and barbers. You are signed in as
        {{ session.user.email ?? session.user.phoneNumber }}, which is not a staff account.
      </p>
      <button class="btn" type="button" @click="onSignOut">Sign out</button>
    </section>
    <section v-else class="panel" aria-labelledby="si-h">
    <h1 id="si-h">Staff sign in</h1>
    <p class="lede">For shop owners and barbers. Customers do not need an account.</p>
    <p v-if="formError" class="banner" role="alert">{{ formError }}</p>

    <form class="card" novalidate @submit.prevent="onSubmit">
      <div class="field">
        <label for="email">Email</label>
        <input id="email" v-model="email" type="email" autocomplete="username"
          :aria-invalid="!!errors.email" :aria-describedby="errors.email ? 'email-err' : undefined" />
        <span v-if="errors.email" id="email-err" class="error">{{ errors.email }}</span>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password"
          :aria-invalid="!!errors.password" :aria-describedby="errors.password ? 'password-err' : undefined" />
        <span v-if="errors.password" id="password-err" class="error">{{ errors.password }}</span>
      </div>
      <button class="btn" type="submit" :disabled="pending">{{ pending ? 'Signing in…' : 'Sign in' }}</button>
    </form>

    <p v-if="isDev" class="hint dev">
      Dev accounts (run <code>npm run seed</code>): owner@shop-jurong.example.com, password123.
    </p>
    </section>
  </main>
</template>

<style scoped>
.signin { padding: var(--space-5) 0 var(--space-6); }
.panel { max-width: 28rem; }
.card.panel { padding: var(--space-5); box-shadow: 0 8px 28px rgba(30, 43, 42, 0.1); }
h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.lede { font-size: 1.1rem; color: var(--color-muted); margin-bottom: var(--space-5); }
form.card { padding: var(--space-5); box-shadow: 0 8px 28px rgba(30, 43, 42, 0.1); margin-bottom: var(--space-4); }
.field { margin-bottom: var(--space-4); }
input { font-size: 1.1rem; min-height: 52px; }
form .btn { width: 100%; margin-top: var(--space-2); }
.panel > .banner { margin-bottom: var(--space-4); }
.card.panel .btn { min-width: 8rem; }
.dev { max-width: 28rem; }
</style>
