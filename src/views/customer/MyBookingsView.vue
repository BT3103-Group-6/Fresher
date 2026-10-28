<script setup>
// UI-C4 My bookings (FR-04, FR-05, FR-11). A fresh OTP on the booking's mobile number comes first (the server
// re-checks it), then the customer's upcoming bookings are listed and can be cancelled or moved, and the History
// tab lists past ones with a Rebook action (decisions A13). Both tabs come from one customerId query.
// cancelBooking and reschedule are the authority: the notice window and late policy shown here are a
// preview of what the server decides.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useRouter } from 'vue-router'
import { db, functions } from '@/firebase'
import { dateOptions, formatDate, formatTime, freeSlots, sgDateKey, toIntervals, weekdayOf } from '@/lib/slots'
import { normalizeSgMobile, otpErrorMessage, sendOtp, verifyOtp } from '@/lib/customerAuth'
import { historyItems, historyLabel, pendingPaymentItems, resolveRebook, upcomingItems } from '@/lib/history'
import { countdown, depositAmountCents, money as depositMoney } from '@/lib/deposit'
import { draft, resetDraft } from '@/stores/booking'

const cancelBooking = httpsCallable(functions, 'cancelBooking')
const reschedule = httpsCallable(functions, 'reschedule')

const step = ref('phone') // phone -> code -> list
const phone = ref(draft.phone || '')
const code = ref('')
const uid = ref('')
const errors = ref({})
const formError = ref('')
const notice = ref('')
const pending = ref(false)
const online = ref(navigator.onLine)
const now = ref(Date.now())

const router = useRouter()
const HISTORY_PAGE = 20
const tab = ref('upcoming') // upcoming | history
const allAppointments = ref([])
const historyShown = ref(HISTORY_PAGE)
const bookings = computed(() => upcomingItems(allAppointments.value, now.value))
const awaiting = computed(() => pendingPaymentItems(allAppointments.value, now.value)) // FR-13: deposit due
const historyAll = computed(() => historyItems(allAppointments.value, now.value))
const history = computed(() => historyAll.value.slice(0, historyShown.value))
const meta = reactive({}) // shopId -> { shop, services, barbers }
const loadingList = ref(true)

const action = ref(null) // { type: 'cancel' | 'move', id }
const move = reactive({ dateKey: '', start: null, loaded: false, intervals: [] })
const dates = computed(() => dateOptions(now.value))

const money = (cents) => `S$${(cents / 100).toFixed(2)}`
const shopOf = (b) => meta[b.shopId]?.shop
const serviceOf = (b) => meta[b.shopId]?.services[b.serviceId]
const barberOf = (b) => meta[b.shopId]?.barbers[b.barberId]

const noticeMins = (b) => shopOf(b)?.noticeMins ?? 120
const isLate = (b) => b.start - now.value < noticeMins(b) * 60e3
const windowText = (b) => {
  const m = noticeMins(b)
  return m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`
}
function policyText(b) {
  const flag = shopOf(b)?.latePolicy === 'flag'
  return flag
    ? `Free cancellation until ${windowText(b)} before your appointment. Later cancellations are allowed but recorded against your number.`
    : `Free cancellation until ${windowText(b)} before your appointment. Inside that window the booking cannot be cancelled online.`
}

const setOnline = () => { online.value = navigator.onLine }
let ticker
let unsubList
let unsubSchedule
onMounted(() => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 30000)
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  unsubList?.()
  unsubSchedule?.()
})

// Fetches whatever names these bookings still need (shop, services, barbers), once each. A shop that is not
// verified cannot be read by customers, which is recorded as shopUnavailable; a deleted service or barber is null.
async function loadMeta(shopId, items) {
  meta[shopId] ??= { shop: null, shopUnavailable: false, services: {}, barbers: {}, asked: new Set() }
  const entry = meta[shopId] // the reactive proxy, so rebook plans update when a fetch lands
  const ref = doc(db, `shops/${shopId}`)
  const fetches = []
  const ask = (key, run) => { if (!entry.asked.has(key)) { entry.asked.add(key); fetches.push(run().catch(() => entry.asked.delete(key))) } }
  ask('shop', async () => {
    try {
      const snap = await getDoc(ref)
      entry.shop = snap.data() ?? null
      entry.shopUnavailable = !snap.exists()
    } catch (err) {
      if (err.code !== 'permission-denied') throw err
      entry.shopUnavailable = true
    }
  })
  for (const b of items.filter((x) => x.shopId === shopId)) {
    ask(`s:${b.serviceId}`, async () => { entry.services[b.serviceId] = (await getDoc(doc(ref, 'services', b.serviceId))).data() ?? null })
    ask(`b:${b.barberId}`, async () => { entry.barbers[b.barberId] = (await getDoc(doc(ref, 'barbers', b.barberId))).data() ?? null })
  }
  await Promise.all(fetches)
}

// Upcoming always; History items only once that tab is opened, and only the ones shown (NFR-07).
async function refreshMeta() {
  const upcoming = [...awaiting.value, ...bookings.value]
  const items = tab.value === 'history' ? [...upcoming, ...history.value] : upcoming
  try {
    await Promise.all([...new Set(items.map((b) => b.shopId))].map((id) => loadMeta(id, items)))
  } catch {
    formError.value = 'Could not load some booking details. Check your connection.'
  }
}
watch([tab, historyShown], refreshMeta)

function listen() {
  loadingList.value = true
  unsubList?.()
  // Filtered by customerId only (no composite index); status and time are split into tabs in src/lib/history.js.
  unsubList = onSnapshot(query(collection(db, 'appointments'), where('customerId', '==', uid.value)), async (snap) => {
    allAppointments.value = snap.docs
      .map((d) => ({
        ...d.data(), id: d.id, start: d.data().start.toMillis(), end: d.data().end.toMillis(),
        holdExpiresAt: d.data().holdExpiresAt?.toMillis() ?? null, // the payment deadline while PENDING_PAYMENT
      }))
    await refreshMeta()
    loadingList.value = false
  }, () => {
    loadingList.value = false
    formError.value = 'Could not load your bookings. Check your connection and try again.'
  })
}

async function onSendCode() {
  formError.value = ''
  const e164 = normalizeSgMobile(phone.value)
  if (!phone.value.trim()) errors.value = { phone: 'Enter your mobile number.' }
  else if (!e164) errors.value = { phone: 'Enter a Singapore mobile number: 8 digits starting with 8 or 9.' }
  else errors.value = {}
  if (errors.value.phone) return
  pending.value = true
  try {
    await sendOtp(e164, 'recaptcha-container')
    code.value = ''
    step.value = 'code'
  } catch (err) {
    if (err.code === 'auth/invalid-phone-number') errors.value = { phone: otpErrorMessage(err) }
    else formError.value = otpErrorMessage(err)
  } finally {
    pending.value = false
  }
}

async function onVerify() {
  formError.value = ''
  if (!/^\d{6}$/.test(code.value.trim())) {
    errors.value = { code: 'Enter the 6-digit code.' }
    return
  }
  errors.value = {}
  pending.value = true
  try {
    const user = await verifyOtp(code.value.trim())
    uid.value = user.uid
    step.value = 'list'
    listen()
  } catch (err) {
    if (err.code === 'auth/invalid-verification-code') errors.value = { code: 'That code is not correct.' }
    else formError.value = otpErrorMessage(err)
  } finally {
    pending.value = false
  }
}

function needOtpAgain() {
  action.value = null
  unsubList?.()
  step.value = 'phone'
  notice.value = 'For your security, please verify your mobile again to continue.'
}

function openCancel(b) {
  notice.value = ''
  formError.value = ''
  action.value = { type: 'cancel', id: b.id }
}

function openMove(b) {
  notice.value = ''
  formError.value = ''
  move.dateKey = sgDateKey(b.start)
  if (!dates.value.some((d) => d.key === move.dateKey)) move.dateKey = dates.value[0].key
  move.start = null
  action.value = { type: 'move', id: b.id }
}

const activeBooking = computed(() => bookings.value.find((b) => b.id === action.value?.id))

// Live availability for the barber-day being browsed; the customer's own slot is not "busy" to them.
watch(() => [action.value?.type === 'move' && action.value.id, move.dateKey], () => {
  unsubSchedule?.()
  move.loaded = false
  move.intervals = []
  const b = activeBooking.value
  if (action.value?.type !== 'move' || !b) return
  unsubSchedule = onSnapshot(doc(db, `shops/${b.shopId}/schedules/${b.barberId}_${move.dateKey}`), (snap) => {
    move.intervals = toIntervals((snap.data()?.intervals || []).filter((iv) => iv.refId !== b.id))
    move.loaded = true
  }, () => { formError.value = 'Could not load availability. Check your connection.' })
})

const moveSlots = computed(() => {
  const b = activeBooking.value
  if (action.value?.type !== 'move' || !b || !move.loaded || !serviceOf(b)) return []
  const day = weekdayOf(move.dateKey)
  return freeSlots({
    ranges: barberOf(b)?.workingHours?.[day],
    shopRanges: shopOf(b)?.openingHours?.[day],
    dateKey: move.dateKey,
    durationMin: b.durationMin,
    intervals: move.intervals,
    now: now.value,
  }).filter((s) => s !== b.start)
})

watch(moveSlots, (list) => {
  if (move.start && move.loaded && !list.includes(move.start)) {
    move.start = null
    formError.value = 'That time is no longer available. Please choose another.'
  }
})

// What Rebook would pre-fill for a history item; null while its shop, service or barber is still loading.
function rebookPlan(b) {
  const entry = meta[b.shopId]
  if (!entry || (!entry.shop && !entry.shopUnavailable)) return null
  if (!entry.shopUnavailable && (!(b.serviceId in entry.services) || !(b.barberId in entry.barbers))) return null
  return resolveRebook({
    serviceId: b.serviceId,
    barberId: b.barberId,
    service: entry.services[b.serviceId] ?? null,
    barber: entry.barbers[b.barberId] ?? null,
    shopAvailable: !entry.shopUnavailable,
  })
}

// Always starts from a clean draft (a stale one for the same shop must not survive); only the verified phone
// carries over. UI-C2 re-checks against its live lists and picks no time, so slot availability still decides.
function onRebook(b) {
  const plan = rebookPlan(b)
  if (plan && !plan.canRebook) return
  resetDraft({
    shopId: b.shopId,
    serviceId: plan ? plan.serviceId : b.serviceId,
    barberId: plan ? plan.barberId : b.barberId,
    phone: phone.value,
    rebook: { serviceId: b.serviceId, barberId: b.barberId },
  })
  router.push({ name: 'book', params: { shopId: b.shopId } })
}

const TABS = ['upcoming', 'history']
function onTabKey(e) {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
  if (!step) return
  tab.value = TABS[(TABS.indexOf(tab.value) + step + TABS.length) % TABS.length]
  document.getElementById(`tab-${tab.value}`)?.focus()
}

function reasonMessage(err) {
  switch (err.details?.reason) {
    case 'LATE_CANCEL_BLOCKED': return 'This booking is inside the cancellation window, so it cannot be cancelled online. Please contact the shop.'
    case 'LATE_CHANGE': return 'This booking is inside the notice window, so it cannot be moved online. Please contact the shop.'
    case 'ALREADY_STARTED': return 'This appointment has already started.'
    case 'BOOKING_NOT_FOUND': return 'We could not find that booking.'
    case 'NOT_CANCELLABLE':
    case 'NOT_RESCHEDULABLE': return 'This booking can no longer be changed.'
    case 'SLOT_TAKEN': return 'Sorry, that time was just taken. Your original booking is unchanged. Please choose another time.'
    case 'BUSY': return 'We are busy right now. Please try again in a moment.'
    case 'BOOKING_CHANGED': return 'This booking just changed. Please try again.'
    default: return err.code === 'functions/invalid-argument'
      ? err.message
      : 'Could not reach the server. Your choices are kept. Check your connection and try again.'
  }
}

async function run(call) {
  formError.value = ''
  notice.value = ''
  pending.value = true
  try {
    await call()
    return true
  } catch (err) {
    if (err.details?.reason === 'REAUTH_REQUIRED') needOtpAgain()
    else {
      formError.value = reasonMessage(err)
      if (err.details?.reason === 'SLOT_TAKEN') move.start = null // the list refreshes on its own
    }
    return false
  } finally {
    pending.value = false
  }
}

async function onCancel(b) {
  const ok = await run(() => cancelBooking({ requestId: b.id }))
  if (ok) { action.value = null; notice.value = 'Your booking was cancelled and the time was released.' }
}

async function onMove(b) {
  if (!move.start) { errors.value = { slot: 'Choose a new time.' }; return }
  errors.value = {}
  const ok = await run(() => reschedule({ requestId: b.id, newStart: move.start }))
  if (ok) { action.value = null; notice.value = 'Your booking was moved.' }
}
</script>

<template>
  <main class="bookings">
    <header class="page-head">
      <h1>My bookings</h1>
      <p class="lede">See, move or cancel your appointments.</p>
      <p class="waitlist-link">On a waitlist? <router-link :to="{ name: 'waitlist' }">See my waitlist entries and offers</router-link></p>
    </header>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Reconnect to continue.</p>
    <p v-if="formError" class="banner" role="alert">{{ formError }}</p>
    <p v-if="notice" class="banner success" role="status">{{ notice }}</p>

    <form v-if="step === 'phone'" class="card verify" novalidate @submit.prevent="onSendCode">
      <h2>Verify your mobile</h2>
      <p class="hint step-intro">Verify your mobile number to see and change your bookings.</p>
      <div class="field">
        <label for="phone">Singapore mobile number</label>
        <input id="phone" v-model="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="9123 4567"
          :aria-invalid="!!errors.phone" :aria-describedby="errors.phone ? 'phone-err' : 'phone-hint'" />
        <span v-if="errors.phone" id="phone-err" class="error">{{ errors.phone }}</span>
        <span v-else id="phone-hint" class="hint">We send a 6-digit code by SMS. Use the number you booked with.</span>
      </div>
      <button class="btn" type="submit" :disabled="pending || !online">{{ pending ? 'Sending code…' : 'Send code' }}</button>
    </form>

    <form v-else-if="step === 'code'" class="card verify" novalidate @submit.prevent="onVerify">
      <h2>Enter your code</h2>
      <p class="hint step-intro">We sent a code to {{ phone }}.</p>
      <div class="field">
        <label for="code">6-digit code</label>
        <input id="code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
          :aria-invalid="!!errors.code" :aria-describedby="errors.code ? 'code-err' : undefined" />
        <span v-if="errors.code" id="code-err" class="error">{{ errors.code }}</span>
      </div>
      <div class="row-actions card-actions">
        <button class="btn" type="submit" :disabled="pending || !online">{{ pending ? 'Verifying…' : 'Verify' }}</button>
        <button class="btn secondary" type="button" :disabled="pending" @click="step = 'phone'">Change number</button>
      </div>
    </form>

    <template v-else>
      <div class="seg" role="tablist" aria-label="My bookings" @keydown="onTabKey">
        <button id="tab-upcoming" class="seg-tab" type="button" role="tab" aria-controls="panel-bookings"
          :aria-selected="tab === 'upcoming'" :tabindex="tab === 'upcoming' ? 0 : -1" @click="tab = 'upcoming'">Upcoming</button>
        <button id="tab-history" class="seg-tab" type="button" role="tab" aria-controls="panel-bookings"
          :aria-selected="tab === 'history'" :tabindex="tab === 'history' ? 0 : -1" @click="tab = 'history'">History</button>
      </div>

      <div id="panel-bookings" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <p v-if="loadingList" class="hint empty">Loading your bookings…</p>
      <p v-else-if="tab === 'upcoming' && !bookings.length && !awaiting.length" class="empty">You have no upcoming bookings.</p>
      <p v-else-if="tab === 'history' && !history.length" class="empty">You have no past bookings yet.</p>

      <div class="list-grid">

      <template v-if="tab === 'history'">
        <section v-for="b in history" :key="b.id" class="card booking" :aria-labelledby="`hh-${b.id}`">
          <div class="card-head">
            <h2 :id="`hh-${b.id}`">{{ shopOf(b)?.name ?? (meta[b.shopId]?.shopUnavailable ? 'Shop no longer available' : 'Past booking') }}</h2>
            <p class="badge" :class="{ off: b.status !== 'COMPLETED' }">Status: {{ historyLabel(b) }}</p>
          </div>
          <dl class="summary">
            <dt>Service</dt><dd>{{ serviceOf(b)?.name ?? 'Not available' }} · {{ b.durationMin }} min</dd>
            <dt>Barber</dt><dd>{{ barberOf(b)?.displayName ?? 'Not available' }}</dd>
            <dt>When</dt><dd>{{ formatDate(b.start) }}, {{ formatTime(b.start) }}</dd>
            <dt>Price</dt><dd>{{ money(b.priceCents) }}</dd>
            <dt>Reference</dt><dd>{{ b.id.slice(0, 8).toUpperCase() }}</dd>
          </dl>
          <div v-if="rebookPlan(b)?.notes.length" class="hint" :id="`rb-${b.id}`">
            <p v-for="n in rebookPlan(b).notes" :key="n">{{ n }}</p>
          </div>
          <div class="row-actions card-actions">
            <button class="btn secondary" type="button" :disabled="pending || rebookPlan(b)?.canRebook === false"
              :aria-describedby="rebookPlan(b)?.notes.length ? `rb-${b.id}` : undefined" @click="onRebook(b)">Rebook</button>
          </div>
        </section>
      </template>

      <template v-else>
      <section v-for="b in awaiting" :key="`pay-${b.id}`" class="card booking" :aria-labelledby="`ph-${b.id}`">
        <div class="card-head">
          <h2 :id="`ph-${b.id}`">{{ shopOf(b)?.name ?? 'Your booking' }}</h2>
          <p class="badge warn" role="status">Status: Awaiting payment</p>
        </div>
        <dl class="summary">
          <dt>Service</dt><dd>{{ serviceOf(b)?.name ?? 'Service' }} · {{ b.durationMin }} min</dd>
          <dt>When</dt><dd>{{ formatDate(b.start) }}, {{ formatTime(b.start) }}</dd>
          <dt>Deposit due</dt><dd>{{ depositMoney(depositAmountCents(b.priceCents)) }} · about {{ countdown(b.holdExpiresAt, now).text }} left</dd>
        </dl>
        <p class="hint">Not a booking yet: the slot is held until you pay.</p>
        <div class="row-actions card-actions">
          <router-link class="btn" :to="{ name: 'deposit', params: { requestId: b.id } }">Continue to payment</router-link>
        </div>
      </section>
      <section v-for="b in bookings" :key="b.id" class="card booking" :class="{ acting: action?.id === b.id }" :aria-labelledby="`h-${b.id}`">
        <div class="card-head">
          <h2 :id="`h-${b.id}`">{{ shopOf(b)?.name ?? 'Your booking' }}</h2>
          <p class="badge ok" role="status">Status: Confirmed</p>
        </div>
        <dl class="summary">
          <dt>Service</dt><dd>{{ serviceOf(b)?.name }} · {{ b.durationMin }} min</dd>
          <dt>Barber</dt><dd>{{ barberOf(b)?.displayName }}</dd>
          <dt>When</dt><dd>{{ formatDate(b.start) }}, {{ formatTime(b.start) }}</dd>
          <dt>Price</dt><dd>{{ money(b.priceCents) }}</dd>
          <dt>Reference</dt><dd>{{ b.id.slice(0, 8).toUpperCase() }}</dd>
        </dl>
        <p class="hint policy">{{ policyText(b) }}</p>

        <div v-if="action?.id !== b.id" class="row-actions card-actions">
          <button class="btn secondary" type="button" :disabled="pending" @click="openMove(b)">Reschedule</button>
          <button class="btn secondary" type="button" :disabled="pending" @click="openCancel(b)">Cancel booking</button>
        </div>

        <div v-else-if="action.type === 'cancel'">
          <p v-if="isLate(b) && shopOf(b)?.latePolicy !== 'flag'" class="banner" role="alert">
            This booking is inside the {{ windowText(b) }} notice window and cannot be cancelled online. Trying is recorded against your number.
          </p>
          <p v-else-if="isLate(b)" class="banner" role="alert">
            This is inside the {{ windowText(b) }} notice window. You can still cancel, but it will be recorded as a late cancellation against your number.
          </p>
          <p v-else>Cancel this booking? The time is released straight away.</p>
          <div class="row-actions card-actions">
            <button class="btn danger" type="button" :disabled="pending || !online" @click="onCancel(b)">
              {{ pending ? 'Cancelling…' : 'Yes, cancel booking' }}
            </button>
            <button class="btn secondary" type="button" :disabled="pending" @click="action = null">Keep booking</button>
          </div>
        </div>

        <form v-else novalidate @submit.prevent="onMove(b)">
          <p v-if="isLate(b)" class="banner" role="alert">
            This booking is inside the {{ windowText(b) }} notice window and cannot be moved online.
          </p>
          <fieldset class="step">
            <legend><span class="step-no" aria-hidden="true">1</span> New date</legend>
            <div class="picks dates" role="radiogroup" aria-label="New date">
              <label v-for="d in dates" :key="d.key" class="pick">
                <input v-model="move.dateKey" type="radio" :name="`date-${b.id}`" :value="d.key" />
                <span>{{ d.label }}</span>
              </label>
            </div>
          </fieldset>
          <fieldset class="step" :aria-describedby="errors.slot ? 'slot-err' : `slot-hint-${b.id}`">
            <legend><span class="step-no" aria-hidden="true">2</span> New time</legend>
            <p :id="`slot-hint-${b.id}`" class="hint" aria-live="polite">
              <template v-if="!move.loaded">Loading times…</template>
              <template v-else-if="!moveSlots.length">No other times available on this date. Try another day.</template>
              <template v-else>Same barber and service. Times update live. Your current time is only replaced when the new one is confirmed.</template>
            </p>
            <div v-if="moveSlots.length" class="picks times" role="radiogroup" aria-label="Available times">
              <label v-for="s in moveSlots" :key="s" class="pick">
                <input v-model="move.start" type="radio" :name="`slot-${b.id}`" :value="s" />
                <span>{{ formatTime(s) }}</span>
              </label>
            </div>
            <span v-if="errors.slot" id="slot-err" class="error">{{ errors.slot }}</span>
          </fieldset>
          <div class="row-actions card-actions">
            <button class="btn" type="submit" :disabled="pending || !online || isLate(b)">
              {{ pending ? 'Moving…' : 'Move booking' }}
            </button>
            <button class="btn secondary" type="button" :disabled="pending" @click="action = null">Keep current time</button>
          </div>
        </form>
      </section>
      </template>
      </div>
      <button v-if="tab === 'history' && historyAll.length > historyShown" class="btn secondary more" type="button" @click="historyShown += HISTORY_PAGE">
        Show more
      </button>
      </div>
    </template>

    <div id="recaptcha-container"></div>
    <p class="hint proto-note">Prototype note: in development the Firebase Auth emulator prints the code in its terminal, and SMS notifications to the shop are mocked.</p>
  </main>
</template>

<style scoped>
.bookings { padding-bottom: var(--space-6); }
.page-head { margin-bottom: clamp(1.5rem, 5vw, 2.5rem); }
.page-head h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.lede { font-size: 1.1rem; color: var(--color-muted); margin-bottom: var(--space-3); }
.waitlist-link { font-size: var(--text-sm); color: var(--color-muted); margin: 0; }
.bookings .banner, .bookings .empty { margin-bottom: var(--space-4); }
.empty { color: var(--color-muted); padding: var(--space-6) 0; }

/* OTP steps */
.verify { max-width: 30rem; padding: var(--space-5); box-shadow: var(--shadow-raised); }
.verify h2 { margin-bottom: var(--space-1); }
.step-intro { margin-bottom: var(--space-4); }
.verify input { font-size: 1.15rem; min-height: 52px; }
.verify .btn { min-width: 8rem; }
.verify .row-actions { margin-top: var(--space-2); }

/* Tabs: a segmented control; the selected tab is also bold and gets a check, so colour is never the only cue */
.seg { display: inline-flex; gap: var(--space-1); padding: var(--space-1); background: var(--color-neutral-bg); border-radius: var(--radius-pill); margin-bottom: var(--space-5); }
.seg-tab {
  font: inherit; font-weight: 600; min-height: 40px; padding: 0 var(--space-5); border: 2px solid transparent; border-radius: var(--radius-pill);
  background: transparent; color: var(--color-neutral-fg); cursor: pointer;
}
.seg-tab:hover { background: var(--color-tint); }
.seg-tab[aria-selected='true'] { background: var(--color-surface); border-color: var(--color-accent); color: var(--color-accent-dark); font-weight: 800; box-shadow: var(--shadow-card); }
.seg-tab[aria-selected='true']::before { content: '\2713\00a0'; }

/* Booking cards */
.list-grid { display: grid; gap: var(--space-5); align-items: start; }
.booking { margin-bottom: 0; padding: var(--space-5); }
.card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-4); }
.card-head h2 { margin: 0; }
.card-head .badge { margin: 0; padding: 0.2rem var(--space-3); }
.booking .summary { grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-5); margin-bottom: var(--space-4); }
.booking .summary dt { font-weight: 600; color: var(--color-muted); }
.booking .summary dd { font-weight: 600; }
.policy { padding-top: var(--space-3); border-top: 1px solid var(--color-line); }
.booking .hint { margin-bottom: var(--space-4); }
.booking .banner { margin-bottom: var(--space-3); }
.card-actions { gap: var(--space-2) var(--space-3); margin-top: var(--space-4); }
.card-actions .btn { flex: 1 1 9rem; }
.acting { border-color: var(--color-accent); }
.more { margin-top: var(--space-5); }

/* Reschedule picker: numbered steps, big tap targets, selected = teal border + tint + check + bold */
.step { margin: 0 0 var(--space-5); min-width: 0; }
.step legend { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); padding: 0; }
.step-no {
  display: inline-flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; border-radius: var(--radius-pill);
  background: var(--color-tint); color: var(--color-accent-dark); font-size: var(--text-sm); font-weight: 800;
}
.picks { display: grid; gap: var(--space-2); }
.picks.dates { grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); }
.picks.times { grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); }
.pick { position: relative; display: block; }
.pick input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.pick span {
  display: flex; align-items: center; justify-content: center; gap: var(--space-1); min-height: 48px; padding: 0 var(--space-3); text-align: center;
  border: 2px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font-weight: 600;
}
.pick input:hover + span { border-color: var(--color-field-border); background: var(--color-tint); }
.pick input:checked + span { border-color: var(--color-accent); background: var(--color-tint); color: var(--color-accent-dark); font-weight: 800; }
.pick input:checked + span::before { content: '\2713'; }
.pick input:focus-visible + span { outline: 3px solid var(--color-focus); outline-offset: 2px; }
.step .hint { margin-bottom: var(--space-3); }

.proto-note { margin-top: var(--space-6); max-width: 44rem; }

@media (min-width: 900px) {
  .list-grid { grid-template-columns: repeat(2, 1fr); }
  .list-grid .acting { grid-column: 1 / -1; }
  .acting form, .acting .step { max-width: 46rem; }
}
</style>
