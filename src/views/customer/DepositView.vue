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
  <main class="deposit">
    <header class="page-head">
      <h1>Deposit</h1>
      <p class="lede">A small deposit keeps your slot held.</p>
    </header>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Reconnect to continue; your booking is unchanged.</p>
    <p v-if="step === 'loading'" class="hint" role="status">Loading your payment…</p>

    <section v-else-if="step === 'signin'" class="card panel" aria-labelledby="signin-h">
      <h2 id="signin-h">Verify your number</h2>
      <p class="banner" role="alert">Verify your mobile number to see this payment.</p>
      <p><router-link class="btn" :to="{ name: 'my-bookings' }">Verify and open my bookings</router-link></p>
    </section>

    <section v-else-if="step === 'missing'" class="card panel" aria-labelledby="missing-h">
      <h2 id="missing-h">Payment not found</h2>
      <p class="banner" role="alert">We could not find a payment for this booking on your number.</p>
      <p><router-link class="btn secondary" :to="{ name: 'my-bookings' }">Go to my bookings</router-link></p>
    </section>

    <section v-else-if="step === 'ready-error'" class="card panel" aria-labelledby="err-h">
      <h2 id="err-h">Something went wrong</h2>
      <p class="banner" role="alert">{{ error }}</p>
      <button class="btn" type="button" @click="load">Try again</button>
    </section>

    <template v-else>
      <p class="test-note" role="note">
        <span class="badge warn">Test mode</span>
        This prototype uses a mock payment provider. No real money moves and no card is needed.
      </p>

      <section class="card panel" aria-labelledby="why-h">
        <h2 id="why-h">Why a deposit</h2>
        <p class="reason">{{ reasonText(info.noShowCount, shopName) }}</p>
        <p class="amount">
          <span class="amount-label">Deposit due</span>
          <strong class="amount-value">{{ money(info.amountCents) }}</strong>
          <span class="hint">Half the price, rounded up to 10 cents</span>
        </p>
        <dl class="summary">
          <dt>Shop</dt><dd>{{ shopName || 'Your shop' }}</dd>
          <template v-if="appointment?.start">
            <dt>When</dt><dd>{{ formatDate(appointment.start) }}, {{ formatTime(appointment.start) }}</dd>
          </template>
          <template v-if="appointment?.priceCents != null">
            <dt>Service price</dt><dd>{{ money(appointment.priceCents) }}</dd>
          </template>
          <dt>Reference</dt><dd class="ref">{{ requestId.slice(0, 8).toUpperCase() }}</dd>
        </dl>
      </section>

      <section class="card panel" aria-labelledby="status-h">
        <h2 id="status-h">Status</h2>
        <p v-if="state === 'awaiting'" class="timer countdown" role="timer" :aria-label="`Time left to pay: ${timer.spoken}`">
          <span class="badge warn">Awaiting payment</span>
          <span>Time left: <strong>{{ timer.text }}</strong></span>
        </p>
        <p v-else class="badge state" :class="{ warn: state !== 'confirmed', ok: state === 'confirmed', off: state === 'released' }">
          <span v-if="state === 'confirmed'" aria-hidden="true">✓ </span>{{ { 'timed-out': 'Time ran out', confirmed: 'Confirmed', released: 'Slot released', 'paid-late': 'Paid too late', unavailable: 'Not payable' }[state] }}
        </p>
        <p class="message" role="status">{{ CHECKOUT_MESSAGES[state] }}</p>
        <p class="sr-only" aria-live="polite">{{ spoken }}</p>

        <p v-if="error" class="banner" role="alert">{{ error }}</p>

        <template v-if="canPay(state)">
          <div class="pay">
            <h3 id="pay-h">Mock checkout</h3>
            <p class="hint">Choose what the mock provider should do. Only the emulator can complete a mock payment.</p>
            <div class="actions" role="group" aria-labelledby="pay-h">
              <button class="btn" type="button" :disabled="!!busy || !online" @click="onMockPay('success')">
                {{ busy === 'success' ? 'Paying…' : `Pay ${money(info.amountCents)} (mock)` }}
              </button>
              <button class="btn secondary" type="button" :disabled="!!busy || !online" @click="onMockPay('failure')">
                {{ busy === 'failure' ? 'Sending…' : 'Simulate a failed payment' }}
              </button>
            </div>
          </div>
        </template>

        <p v-if="state === 'confirmed'" class="after">
          <router-link class="btn" :to="{ name: 'my-bookings' }">See my bookings</router-link>
        </p>
        <p v-else-if="state === 'released' || state === 'timed-out' || state === 'paid-late'" class="after">
          <router-link class="btn" :to="shopLink">Choose a time again</router-link>
        </p>
        <p v-if="state === 'confirmed'" class="hint">Prototype note: SMS reminders are mocked, so no text is sent.</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 34rem; }
.page-head { margin-bottom: var(--space-5); padding-top: var(--space-3); }
.page-head h1 { font-size: clamp(1.9rem, 6vw, 2.8rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }

.panel { padding: var(--space-4) var(--space-4) var(--space-5); margin-bottom: var(--space-5); }
.panel h2 { margin-bottom: var(--space-4); }
.panel > p + p { margin-top: var(--space-3); }
.panel .banner { margin-bottom: var(--space-4); }

.test-note { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-5); color: var(--color-muted); font-size: var(--text-sm); }

.reason { max-width: 40rem; }
.amount { display: flex; flex-direction: column; margin: var(--space-4) 0; padding: var(--space-4) 0; border-block: 1px solid var(--color-line); }
.amount-label { font-size: var(--text-sm); font-weight: 600; color: var(--color-muted); }
.amount-value { font-size: 2.2rem; font-weight: 800; line-height: 1.15; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.summary { gap: var(--space-3) var(--space-5); margin: 0; }
.summary dt { color: var(--color-muted); font-weight: 600; }
.summary dd { font-weight: 700; }
.summary .ref { font-variant-numeric: tabular-nums; letter-spacing: 0.06em; }

.countdown { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-variant-numeric: tabular-nums; }
.countdown strong { font-size: 1.4rem; }
.state { font-size: var(--text-sm); padding: var(--space-1) var(--space-3); }
.message { margin-top: var(--space-3); max-width: 40rem; }

.pay { margin-top: var(--space-5); padding-top: var(--space-5); border-top: 1px solid var(--color-line); }
.pay h3 { font-size: var(--text-lg); margin-bottom: var(--space-2); }
.pay .hint { margin-bottom: var(--space-4); }
.actions { display: grid; gap: var(--space-3); }
.actions .btn, .after .btn { min-height: 52px; width: 100%; }
.after { margin-top: var(--space-5); }

@media (min-width: 720px) {
  .panel { padding: var(--space-5) var(--space-5) var(--space-6); }
  .amount { flex-direction: row; align-items: baseline; gap: var(--space-4); }
  .actions { display: flex; }
  .actions .btn, .after .btn { width: auto; min-width: 14rem; }
}
</style>
