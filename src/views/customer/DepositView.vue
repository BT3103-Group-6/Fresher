<script setup>
// UI-C5 Deposit checkout (FR-13, decisions A6 addendum). A customer with two or more no-shows at a shop pays a
// deposit to keep a slot: confirmBooking left it PENDING_PAYMENT with a 10-minute deadline. This page shows why,
// the amount and a countdown, registers the payment (createDeposit) and offers the MOCK checkout (mockPay, which
// exists only in the Functions emulator). The server decides every outcome; the page follows the live booking and
// deposit, so a reload, a second tab or a slow network never shows a stale result.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useRoute } from 'vue-router'
import { auth, db, functions } from '@/firebase'
import { formatDate, formatTime } from '@/lib/slots'
import { CHECKOUT_MESSAGES, canPay, checkoutState, countdown, money, reasonText } from '@/lib/deposit'

const route = useRoute()
const requestId = route.params.requestId
const createDeposit = httpsCallable(functions, 'createDeposit')
const mockPay = httpsCallable(functions, 'mockPay')

const step = ref('loading') // loading -> ready | signin | missing
const info = ref(null) // createDeposit result: amount, reason, provider
const appointment = ref(null) // live appointment: status, deadline, start, price
const deposit = ref(null) // live deposit: status, paidAfterExpiry
const shopName = ref('')
const serviceName = ref('')
const now = ref(Date.now())
const online = ref(navigator.onLine)
const busy = ref('') // '' | 'success' | 'failure'
const error = ref('')

const deadline = computed(() => appointment.value?.deadline ?? info.value?.deadline ?? null)
const state = computed(() => checkoutState({
  bookingStatus: appointment.value?.status ?? info.value?.bookingStatus,
  depositStatus: deposit.value?.status ?? info.value?.depositStatus,
  paidAfterExpiry: deposit.value?.paidAfterExpiry ?? info.value?.paidAfterExpiry,
  deadline: deadline.value,
}, now.value))
const timer = computed(() => countdown(deadline.value, now.value))
// A screen-reader summary that changes once a minute, not every second.
const spoken = computed(() => (state.value === 'awaiting' ? `About ${Math.max(1, Math.ceil(timer.value.remainingMs / 60000))} minutes left to pay.` : ''))

const setOnline = () => { online.value = navigator.onLine }
let ticker
const unsubs = []
onMounted(async () => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
  await load()
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  unsubs.splice(0).forEach((u) => u())
})

async function load() {
  error.value = ''
  step.value = 'loading'
  await auth.authStateReady()
  if (!auth.currentUser?.phoneNumber) { step.value = 'signin'; return }
  try {
    const { data } = await createDeposit({ requestId })
    info.value = data
    follow(data.shopId)
    step.value = 'ready'
  } catch (err) {
    if (err.details?.reason === 'DEPOSIT_NOT_FOUND') step.value = 'missing'
    else if (err.code === 'functions/unauthenticated') step.value = 'signin'
    else {
      step.value = 'ready-error'
      error.value = 'Could not load this payment. Check your connection and try again.'
    }
  }
}

/** Live listeners: the appointment and its deposit are readable by the customer they belong to (Security Rules). */
function follow(shopId) {
  const ms = (t) => (t ? t.toMillis() : null)
  unsubs.push(
    onSnapshot(doc(db, `appointments/${requestId}`), (snap) => {
      const d = snap.data()
      if (d) appointment.value = { status: d.status, deadline: ms(d.holdExpiresAt) ?? appointment.value?.deadline ?? null, start: ms(d.start), priceCents: d.priceCents, serviceId: d.serviceId }
    }, () => {}),
    onSnapshot(doc(db, `deposits/${requestId}`), (snap) => {
      const d = snap.data()
      if (d) deposit.value = { status: d.status, paidAfterExpiry: d.paidAfterExpiry === true }
    }, () => {}),
  )
  getDoc(doc(db, `shops/${shopId}`)).then((s) => { shopName.value = s.data()?.name ?? '' }).catch(() => {})
}
const shopLink = computed(() => (info.value ? { name: 'book', params: { shopId: info.value.shopId } } : { name: 'discover' }))

async function onMockPay(outcome) {
  if (busy.value) return
  busy.value = outcome
  error.value = ''
  try {
    await mockPay({ requestId, outcome })
    // The result arrives through the live listeners; nothing to do here.
  } catch (err) {
    if (err.code === 'functions/not-found' || err.code === 'functions/unavailable') {
      error.value = 'The mock checkout is only available while running against the Firebase emulators.'
    } else if (err.details?.reason === 'NOT_PAYABLE') {
      error.value = 'This payment can no longer be made.'
    } else {
      error.value = 'That did not go through. Nothing was changed on your booking; check your connection and try again.'
    }
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <main>
    <h1>Deposit</h1>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Reconnect to continue; your booking is unchanged.</p>
    <p v-if="step === 'loading'" class="hint" role="status">Loading your payment…</p>

    <template v-else-if="step === 'signin'">
      <p class="banner" role="alert">Verify your mobile number to see this payment.</p>
      <p><router-link class="btn" :to="{ name: 'my-bookings' }">Verify and open my bookings</router-link></p>
    </template>

    <template v-else-if="step === 'missing'">
      <p class="banner" role="alert">We could not find a payment for this booking on your number.</p>
      <p><router-link :to="{ name: 'my-bookings' }">Go to my bookings</router-link></p>
    </template>

    <template v-else-if="step === 'ready-error'">
      <p class="banner" role="alert">{{ error }}</p>
      <button class="btn" type="button" @click="load">Try again</button>
    </template>

    <template v-else>
      <p class="hint" role="note">
        <strong>Test mode.</strong> This prototype uses a mock payment provider. No real money moves and no card is needed.
      </p>

      <section aria-labelledby="why-h">
        <h2 id="why-h">Why a deposit</h2>
        <p>{{ reasonText(info.noShowCount, shopName) }}</p>
      </section>

      <dl class="summary">
        <dt>Deposit</dt><dd><strong>{{ money(info.amountCents) }}</strong> (half the price, rounded up to 10 cents)</dd>
        <dt>Shop</dt><dd>{{ shopName || 'Your shop' }}</dd>
        <template v-if="appointment?.start">
          <dt>When</dt><dd>{{ formatDate(appointment.start) }}, {{ formatTime(appointment.start) }}</dd>
        </template>
        <template v-if="appointment?.priceCents != null">
          <dt>Service price</dt><dd>{{ money(appointment.priceCents) }}</dd>
        </template>
        <dt>Reference</dt><dd>{{ requestId.slice(0, 8).toUpperCase() }}</dd>
      </dl>

      <section aria-labelledby="status-h">
        <h2 id="status-h">Status</h2>
        <p v-if="state === 'awaiting'" class="timer" role="timer" :aria-label="`Time left to pay: ${timer.spoken}`">
          <span class="badge warn">Awaiting payment</span>
          Time left: <strong>{{ timer.text }}</strong>
        </p>
        <p v-else class="badge" :class="{ warn: state !== 'confirmed', off: state === 'released' }">
          {{ { 'timed-out': 'Time ran out', confirmed: 'Confirmed', released: 'Slot released', 'paid-late': 'Paid too late', unavailable: 'Not payable' }[state] }}
        </p>
        <p role="status">{{ CHECKOUT_MESSAGES[state] }}</p>
        <p class="sr-only" aria-live="polite">{{ spoken }}</p>
      </section>

      <p v-if="error" class="banner" role="alert">{{ error }}</p>

      <section v-if="canPay(state)" aria-labelledby="pay-h">
        <h2 id="pay-h">Mock checkout</h2>
        <p class="hint">Choose what the mock provider should do. Only the emulator can complete a mock payment.</p>
        <div class="row-actions">
          <button class="btn" type="button" :disabled="!!busy || !online" @click="onMockPay('success')">
            {{ busy === 'success' ? 'Paying…' : `Pay ${money(info.amountCents)} (mock)` }}
          </button>
          <button class="btn secondary" type="button" :disabled="!!busy || !online" @click="onMockPay('failure')">
            {{ busy === 'failure' ? 'Sending…' : 'Simulate a failed payment' }}
          </button>
        </div>
      </section>

      <p v-if="state === 'confirmed'">
        <router-link class="btn" :to="{ name: 'my-bookings' }">See my bookings</router-link>
      </p>
      <p v-else-if="state === 'released' || state === 'timed-out' || state === 'paid-late'">
        <router-link class="btn" :to="shopLink">Choose a time again</router-link>
      </p>
      <p v-if="state === 'confirmed'" class="hint">Prototype note: SMS reminders are mocked, so no text is sent.</p>
    </template>
  </main>
</template>
