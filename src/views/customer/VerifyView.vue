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
  <main>
    <template v-if="step === 'done'">
      <h1>Booking confirmed</h1>
      <p class="badge" role="status">Status: Confirmed</p>
      <dl class="summary">
        <dt>Shop</dt><dd>{{ shop?.name }}</dd>
        <dt>Service</dt><dd>{{ service?.name }} · {{ confirmed.durationMin }} min</dd>
        <dt>Barber</dt><dd>{{ barber?.displayName }}</dd>
        <dt>When</dt><dd>{{ formatDate(confirmed.start) }}, {{ formatTime(confirmed.start) }}</dd>
        <dt>Price</dt><dd>{{ money(confirmed.priceCents) }}</dd>
        <dt>Booked for</dt><dd>{{ draft.name.trim() }}</dd>
        <dt>Reference</dt><dd>{{ confirmed.requestId.slice(0, 8).toUpperCase() }}</dd>
      </dl>
      <p class="hint">{{ noticeText }}</p>
      <p class="hint">Prototype note: SMS reminders are mocked, so no confirmation text is sent.</p>
      <p><router-link :to="{ name: 'my-bookings' }">Manage my bookings</router-link></p>
    </template>

    <template v-else>
      <h1>Verify and confirm</h1>

      <p v-if="expired" class="banner" role="alert">
        Your 10-minute hold has expired.
        <button type="button" class="btn secondary" @click="onChooseAnother">Choose a time again</button>
      </p>
      <p v-if="!online" class="banner" role="alert">You appear to be offline. Your details are kept; reconnect to continue.</p>
      <p v-if="formError" class="banner" role="alert">{{ formError }}</p>

      <section class="card" aria-labelledby="summary-h">
        <h2 id="summary-h">Your booking</h2>
        <dl class="summary">
          <dt>Shop</dt><dd>{{ shop?.name }}</dd>
          <dt>Service</dt><dd>{{ service?.name }} · {{ hold.durationMin }} min</dd>
          <dt>Barber</dt><dd>{{ barber?.displayName }}</dd>
          <dt>When</dt><dd>{{ formatDate(hold.start) }}, {{ formatTime(hold.start) }}</dd>
          <dt>Price</dt><dd>{{ money(hold.priceCents) }}</dd>
        </dl>
        <p class="hint">{{ noticeText }}</p>
        <p class="hold" :class="{ low: remainingMs < 60000 }" role="timer">
          Slot held for {{ countdown }}
        </p>
      </section>

      <form v-if="step === 'details'" novalidate @submit.prevent="onSendCode">
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
        <button class="btn" type="submit" :disabled="pending || expired || !online">
          {{ pending ? 'Sending code…' : 'Send code' }}
        </button>
      </form>

      <form v-else novalidate @submit.prevent="onConfirm">
        <p>We sent a code to {{ draft.phone }}.</p>
        <div v-if="!verified" class="field">
          <label for="code">6-digit code</label>
          <input id="code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
            :aria-invalid="!!errors.code" :aria-describedby="errors.code ? 'code-err' : undefined" />
          <span v-if="errors.code" id="code-err" class="error">{{ errors.code }}</span>
        </div>
        <p v-else class="badge" role="status">Number verified</p>
        <div class="row-actions">
          <button class="btn" type="submit" :disabled="pending || expired || !online">
            {{ pending ? 'Confirming…' : 'Confirm booking' }}
          </button>
          <button v-if="!verified" class="btn secondary" type="button" :disabled="pending" @click="step = 'details'">
            Change number
          </button>
        </div>
      </form>

      <div id="recaptcha-container"></div>
      <p class="hint">Prototype note: in development, the Firebase Auth emulator prints the code in its terminal; SMS is not really sent.</p>
      <p><button type="button" class="btn secondary" @click="onChooseAnother">Choose a different time</button></p>
    </template>
  </main>
</template>
