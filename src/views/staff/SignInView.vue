<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isOwner, session, signIn, signOut } from '@/stores/session'

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

// Signed in but not an owner (barber, admin): show why, instead of the form.
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
      : '/staff/config'
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
  <main>
    <template v-if="session.user && !isOwner()">
      <h1>Not authorised</h1>
      <p class="banner" role="alert">
        Shop configuration (UI-O1) is for shop owners only. You are signed in as
        {{ session.user.email }}, which is not an owner account.
      </p>
      <button class="btn" type="button" @click="onSignOut">Sign out</button>
    </template>
    <template v-else>
    <h1>Staff sign in</h1>
    <p v-if="formError" class="banner" role="alert">{{ formError }}</p>

    <form novalidate @submit.prevent="onSubmit">
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

    <p v-if="isDev" class="hint">
      Dev accounts (run <code>npm run seed</code>): owner@shop-jurong.example.com, password123.
    </p>
    </template>
  </main>
</template>
