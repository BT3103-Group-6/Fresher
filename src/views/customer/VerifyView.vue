<script setup>
// UI-C3 Verify and confirm (FR-03). The slot is already held (holdSlot); the customer gives a name and
// a Singapore mobile, proves the number with an SMS OTP (Firebase Phone Auth), and confirmBooking turns
// the hold into a booking. The mobile number is read from the verified token on the server.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import { formatDate, formatTime } from '@/lib/slots'
import { normalizeSgMobile, otpErrorMessage, sendOtp, verifyOtp } from '@/lib/customerAuth'
import { draft, newAttempt } from '@/stores/booking'

const router = useRouter()
const confirmBooking = httpsCallable(functions, 'confirmBooking')
const releaseHold = httpsCallable(functions, 'releaseHold')

const MAX_OTP_FAILURES = 3 // decisions A2
const hold = draft.hold
const shopId = draft.shopId

const shop = ref(null)
const service = ref(null)
const barber = ref(null)
const step = ref('details') // details -> code -> done
const code = ref('')
const errors = ref({})
const formError = ref('')
const pending = ref(false)
const failures = ref(0)
const verified = ref(false) // OTP accepted; a failed confirmBooking can be retried without a new code
const confirmed = ref(null)
const now = ref(Date.now())
const online = ref(navigator.onLine)

const remainingMs = computed(() => Math.max(0, hold.holdExpiresAt - now.value))
const expired = computed(() => step.value !== 'done' && remainingMs.value === 0)
const countdown = computed(() => {
  const s = Math.ceil(remainingMs.value / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
const money = (cents) => `S$${(cents / 100).toFixed(2)}`

const noticeText = computed(() => {
  const mins = shop.value?.noticeMins ?? 120
  const window = mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? '' : 's'}` : `${mins} minutes`
  return shop.value?.latePolicy === 'flag'
    ? `Free cancellation until ${window} before your appointment. Later cancellations are allowed but recorded against your number.`
    : `Free cancellation until ${window} before your appointment. Inside that window the booking cannot be cancelled online.`
})

const setOnline = () => { online.value = navigator.onLine }
let ticker
onMounted(async () => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
  try {
    const shopRef = doc(db, `shops/${shopId}`)
    const [s, svc, b] = await Promise.all([
      getDoc(shopRef),
      getDoc(doc(shopRef, 'services', draft.serviceId)),
      getDoc(doc(shopRef, 'barbers', hold.barberId)),
    ])
    shop.value = s.data()
    service.value = svc.data()
    barber.value = b.data()
  } catch {
    formError.value = 'Could not load the booking details. Check your connection.'
  }
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  // Leaving without confirming frees the slot straight away instead of after 10 minutes.
  if (!confirmed.value) abandon()
})

function abandon() {
  releaseHold({ requestId: hold.requestId }).catch(() => {}) // best effort; the hold expires anyway
  newAttempt()
}

function backToSlots(notice = '') {
  draft.notice = notice
  return router.replace({ name: 'book', params: { shopId } })
}

function validateDetails() {
  const e = {}
  const name = draft.name.trim()
  if (!name) e.name = 'Enter your name.'
  else if (name.length > 80) e.name = 'Name must be 80 characters or fewer.'
  if (!draft.phone.trim()) e.phone = 'Enter your mobile number.'
  else if (!normalizeSgMobile(draft.phone)) e.phone = 'Enter a Singapore mobile number: 8 digits starting with 8 or 9.'
  errors.value = e
  return Object.keys(e).length === 0
}

async function onSendCode() {
  formError.value = ''
  if (!validateDetails()) return
  pending.value = true
  try {
    await sendOtp(normalizeSgMobile(draft.phone), 'recaptcha-container')
    code.value = ''
    step.value = 'code'
  } catch (err) {
    if (err.code === 'auth/invalid-phone-number') errors.value = { phone: otpErrorMessage(err) }
    else formError.value = otpErrorMessage(err)
  } finally {
    pending.value = false
  }
}

async function onConfirm() {
  formError.value = ''
  if (!verified.value && !/^\d{6}$/.test(code.value.trim())) {
    errors.value = { code: 'Enter the 6-digit code.' }
    return
  }
  errors.value = {}
  pending.value = true
  try {
    if (!verified.value) {
      try {
        await verifyOtp(code.value.trim())
        verified.value = true
      } catch (err) {
        if (err.code === 'auth/invalid-verification-code') {
          failures.value += 1
          if (failures.value >= MAX_OTP_FAILURES) {
            // Three wrong codes end the attempt and release the slot (FR-03).
            await releaseHold({ requestId: hold.requestId }).catch(() => {})
            newAttempt()
            return await backToSlots('Too many incorrect codes, so we released your slot. Please choose a time and try again.')
          }
          const left = MAX_OTP_FAILURES - failures.value
          formError.value = `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`
        } else {
          formError.value = otpErrorMessage(err)
        }
        return
      }
    }
    const { data } = await confirmBooking({ requestId: hold.requestId, displayName: draft.name.trim() })
    confirmed.value = data
    if (data.status === 'PENDING_PAYMENT') { // FR-13: a deposit is due; UI-C5 takes over
      return await router.replace({ name: 'deposit', params: { requestId: data.requestId } })
    }
    step.value = 'done'
  } catch (err) {
    const reason = err.details?.reason
    if (reason === 'HOLD_EXPIRED' || reason === 'HOLD_NOT_FOUND') {
      newAttempt()
      await backToSlots('Your 10-minute hold expired. Please choose a time again.')
    } else if (reason === 'HOLD_ALREADY_USED') {
      formError.value = 'This booking can no longer be confirmed. Please choose a time again.'
    } else if (err.code === 'functions/invalid-argument') {
      step.value = 'details'
      errors.value = { name: err.message }
    } else {
      // Entered data and the verified number are kept; retrying is safe (confirmBooking is idempotent).
      formError.value = 'Could not confirm your booking. Check your connection and try again.'
    }
  } finally {
    pending.value = false
  }
}

async function onChooseAnother() {
  await backToSlots()
}
</script>

<template>
  <main class="verify">
    <template v-if="step === 'done'">
      <header class="page-head">
        <p class="badge ok" role="status"><span aria-hidden="true">✓ </span>Status: Confirmed</p>
        <h1>Booking confirmed</h1>
        <p class="lede">See you soon. Your details are below.</p>
      </header>
      <section class="card panel" aria-labelledby="done-h">
        <h2 id="done-h">Your appointment</h2>
        <dl class="summary">
          <dt>Shop</dt><dd>{{ shop?.name }}</dd>
          <dt>Service</dt><dd>{{ service?.name }} · {{ confirmed.durationMin }} min</dd>
          <dt>Barber</dt><dd>{{ barber?.displayName }}</dd>
          <dt>When</dt><dd>{{ formatDate(confirmed.start) }}, {{ formatTime(confirmed.start) }}</dd>
          <dt>Price</dt><dd>{{ money(confirmed.priceCents) }}</dd>
          <dt>Booked for</dt><dd>{{ draft.name.trim() }}</dd>
          <dt>Reference</dt><dd class="ref">{{ confirmed.requestId.slice(0, 8).toUpperCase() }}</dd>
        </dl>
        <p class="policy">{{ noticeText }}</p>
      </section>
      <p class="hint note">Prototype note: SMS reminders are mocked, so no confirmation text is sent.</p>
      <p class="after"><router-link class="btn" :to="{ name: 'my-bookings' }">Manage my bookings</router-link></p>
    </template>

    <template v-else>
      <header class="page-head">
        <h1>Verify and confirm</h1>
        <p class="lede">Check your booking, then confirm your mobile number with a text code.</p>
      </header>

      <div v-if="expired" class="banner" role="alert">
        <p>Your 10-minute hold has expired.</p>
        <button type="button" class="btn secondary" @click="onChooseAnother">Choose a time again</button>
      </div>
      <p v-if="!online" class="banner" role="alert">You appear to be offline. Your details are kept; reconnect to continue.</p>
      <p v-if="formError" class="banner" role="alert">{{ formError }}</p>

      <section class="card panel" aria-labelledby="summary-h">
        <h2 id="summary-h">Your booking</h2>
        <dl class="summary">
          <dt>Shop</dt><dd>{{ shop?.name }}</dd>
          <dt>Service</dt><dd>{{ service?.name }} · {{ hold.durationMin }} min</dd>
          <dt>Barber</dt><dd>{{ barber?.displayName }}</dd>
          <dt>When</dt><dd>{{ formatDate(hold.start) }}, {{ formatTime(hold.start) }}</dd>
          <dt>Price</dt><dd>{{ money(hold.priceCents) }}</dd>
        </dl>
        <p class="policy"><strong>Cancellation.</strong> {{ noticeText }}</p>
        <p class="hold" :class="{ low: remainingMs < 60000 }" role="timer">
          <span aria-hidden="true">⏱ </span>Slot held for <strong>{{ countdown }}</strong><span v-if="remainingMs < 60000"> · running out</span>
        </p>
      </section>

      <form v-if="step === 'details'" class="card panel" novalidate aria-labelledby="details-h" @submit.prevent="onSendCode">
        <h2 id="details-h"><span class="step-no" aria-hidden="true">1</span>Your details</h2>
        <div class="field">
          <label for="name">Your name</label>
          <input id="name" v-model="draft.name" type="text" autocomplete="name" maxlength="80"
            :aria-invalid="!!errors.name" :aria-describedby="errors.name ? 'name-err' : undefined" />
          <span v-if="errors.name" id="name-err" class="error">{{ errors.name }}</span>
        </div>
        <div class="field">
          <label for="phone">Singapore mobile number</label>
          <input id="phone" v-model="draft.phone" type="tel" inputmode="tel" autocomplete="tel-national"
            placeholder="9123 4567" :aria-invalid="!!errors.phone"
            :aria-describedby="errors.phone ? 'phone-err' : 'phone-hint'" />
          <span v-if="errors.phone" id="phone-err" class="error">{{ errors.phone }}</span>
          <span v-else id="phone-hint" class="hint">We send a 6-digit code by SMS to verify it. No password needed.</span>
        </div>
        <button class="btn wide-btn" type="submit" :disabled="pending || expired || !online">
          {{ pending ? 'Sending code…' : 'Send code' }}
        </button>
      </form>

      <form v-else class="card panel" novalidate aria-labelledby="code-h" @submit.prevent="onConfirm">
        <h2 id="code-h"><span class="step-no" aria-hidden="true">2</span>Enter your code</h2>
        <p class="sent">We sent a code to <strong>{{ draft.phone }}</strong>.</p>
        <div v-if="!verified" class="field">
          <label for="code">6-digit code</label>
          <input id="code" v-model="code" class="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
            :aria-invalid="!!errors.code" :aria-describedby="errors.code ? 'code-err' : undefined" />
          <span v-if="errors.code" id="code-err" class="error">{{ errors.code }}</span>
        </div>
        <p v-else class="badge ok verified" role="status"><span aria-hidden="true">✓ </span>Number verified</p>
        <div class="actions">
          <button class="btn" type="submit" :disabled="pending || expired || !online">
            {{ pending ? 'Confirming…' : 'Confirm booking' }}
          </button>
          <button v-if="!verified" class="btn secondary" type="button" :disabled="pending" @click="step = 'details'">
            Change number
          </button>
        </div>
      </form>

      <div id="recaptcha-container"></div>
      <p class="hint note">Prototype note: in development, the Firebase Auth emulator prints the code in its terminal; SMS is not really sent.</p>
      <p class="after"><button type="button" class="btn secondary" @click="onChooseAnother">Choose a different time</button></p>
    </template>
  </main>
</template>

<style scoped>
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 34rem; }
.page-head { margin-bottom: var(--space-5); padding-top: var(--space-3); }
.page-head h1 { font-size: clamp(1.9rem, 6vw, 2.8rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.page-head .badge { margin-bottom: var(--space-3); }

.panel { padding: var(--space-4) var(--space-4) var(--space-5); margin-bottom: var(--space-5); }
.panel h2 { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
.step-no {
  display: inline-grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: var(--radius-pill);
  background: var(--color-tint); color: var(--color-accent-dark); font-size: var(--text-sm); font-weight: 800;
}
.banner p + .btn { margin-top: var(--space-3); }

.summary { gap: var(--space-3) var(--space-5); margin-bottom: var(--space-4); }
.summary dt { color: var(--color-muted); font-weight: 600; }
.summary dd { font-weight: 700; }
.summary .ref { font-variant-numeric: tabular-nums; letter-spacing: 0.06em; }
.policy { padding-top: var(--space-4); border-top: 1px solid var(--color-line); color: var(--color-muted); font-size: var(--text-sm); }
.policy strong { color: var(--color-text); }
.hold {
  display: inline-block; margin-top: var(--space-4); padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill);
  background: var(--color-tint); color: var(--color-accent-dark); font-variant-numeric: tabular-nums;
}
.hold.low { background: var(--color-danger-bg); color: var(--color-danger-fg); }

.panel .field { margin-bottom: var(--space-4); }
.panel input { min-height: 52px; font-size: 1.1rem; }
.code-input { letter-spacing: 0.3em; font-variant-numeric: tabular-nums; }
.sent { margin-bottom: var(--space-4); }
.verified { margin-bottom: var(--space-4); font-size: var(--text-sm); padding: var(--space-1) var(--space-3); }
.wide-btn { width: 100%; min-height: 52px; }
.actions { display: grid; gap: var(--space-2); }
.actions .btn { min-height: 52px; }
.note { margin-bottom: var(--space-4); }
.after { margin-bottom: var(--space-6); }

@media (min-width: 720px) {
  .panel { padding: var(--space-5) var(--space-5) var(--space-6); }
  .wide-btn { width: auto; min-width: 14rem; }
  .actions { display: flex; }
  .actions .btn { min-width: 12rem; }
}
</style>
