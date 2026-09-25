<script setup>
// UI-C6 Waitlist (FR-15, decisions A6 addendum). When a date has no suitable slot, a verified customer joins a
// waitlist for that date at a shop (service required, barber optional). When time frees up, the server offers it
// to the earliest-joined compatible entry, holds it exclusively for 15 minutes and texts them (mock messaging).
// This page joins, lists the customer's entries live, and claims an offer (claimOffer confirms it through the
// normal booking path, so a deposit may be required and UI-C5 takes over). The server decides every outcome.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { useRoute, useRouter } from 'vue-router'
import { auth, db, functions } from '@/firebase'
import { dateOptions, formatDate, formatTime } from '@/lib/slots'
import { normalizeSgMobile, otpErrorMessage, sendOtp, verifyOtp } from '@/lib/customerAuth'
import { countdown, money } from '@/lib/deposit'
import {
  STATE_LABELS, STATE_MESSAGES, canClaim, claimErrorMessage, entryState, expiredText, sortEntries, toEntry, validateJoin,
} from '@/lib/waitlist'
import { draft } from '@/stores/booking'

const route = useRoute()
const router = useRouter()
const joinWaitlist = httpsCallable(functions, 'joinWaitlist')
const claimOffer = httpsCallable(functions, 'claimOffer')

const step = ref('loading') // loading -> phone -> code -> main
const phone = ref(draft.phone || '')
const code = ref('')
const uid = ref('')
const errors = ref({})
const formError = ref('')
const notice = ref('')
const pending = ref(false)
const claiming = ref('')
const claimErrors = ref({}) // entryId -> message
const online = ref(navigator.onLine)
const now = ref(Date.now())

// ---- Join form: opened from UI-C2 with ?shop=&service=&barber=&date= ----
const shopId = route.query.shop ? String(route.query.shop) : ''
const shop = ref(null)
const services = ref([])
const barbers = ref([])
const dates = computed(() => dateOptions(now.value))
const form = reactive({
  serviceId: route.query.service ? String(route.query.service) : '',
  barberId: route.query.barber ? String(route.query.barber) : 'any',
  date: route.query.date ? String(route.query.date) : '',
  name: draft.name || '',
})
const offering = computed(() => barbers.value.filter((b) => Array.isArray(b.serviceIds) && b.serviceIds.includes(form.serviceId)))
watch(() => form.serviceId, () => {
  if (form.barberId !== 'any' && !offering.value.some((b) => b.id === form.barberId)) form.barberId = 'any'
})

// ---- Entries ----
const entries = ref([])
const names = reactive({}) // shopId -> { shop, services: { id: name } }
const loadingList = ref(true)
const list = computed(() => sortEntries(entries.value, now.value))

const setOnline = () => { online.value = navigator.onLine }
let ticker
let unsub
onMounted(async () => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
  await auth.authStateReady()
  if (auth.currentUser?.phoneNumber) await enter(auth.currentUser.uid)
  else step.value = 'phone'
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  unsub?.()
})

async function enter(id) {
  uid.value = id
  step.value = 'main'
  if (shopId) await loadShop()
  listen()
}

async function loadShop() {
  try {
    const ref = doc(db, `shops/${shopId}`)
    const [s, svc, bar] = await Promise.all([
      getDoc(ref), getDocs(collection(ref, 'services')), getDocs(collection(ref, 'barbers'))])
    shop.value = s.exists() ? s.data() : null
    services.value = svc.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.active)
    barbers.value = bar.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.active)
    if (!dates.value.some((d) => d.key === form.date)) form.date = dates.value[0].key
    if (!services.value.some((x) => x.id === form.serviceId)) form.serviceId = ''
  } catch {
    formError.value = 'Could not load the shop. Check your connection and try again.'
  }
}

function listen() {
  loadingList.value = true
  unsub?.()
  unsub = onSnapshot(query(collection(db, 'waitlist'), where('customerId', '==', uid.value)), async (snap) => {
    entries.value = snap.docs.map((d) => toEntry(d.id, d.data()))
    await loadNames()
    loadingList.value = false
  }, () => {
    loadingList.value = false
    formError.value = 'Could not load your waitlist. Check your connection and try again.'
  })
}

/** Shop and service names for the entries shown (one fetch per shop and service, cached). */
async function loadNames() {
  await Promise.all(entries.value.map(async (e) => {
    const shopEntry = (names[e.shopId] ??= { shop: '', services: {} })
    try {
      if (!shopEntry.shop) shopEntry.shop = (await getDoc(doc(db, `shops/${e.shopId}`))).data()?.name ?? ''
      if (!(e.serviceId in shopEntry.services)) {
        shopEntry.services[e.serviceId] = (await getDoc(doc(db, `shops/${e.shopId}/services/${e.serviceId}`))).data()?.name ?? ''
      }
    } catch { /* names are a nicety; the row falls back to a generic label */ }
  }))
}
const shopName = (e) => names[e.shopId]?.shop || 'Shop'
const serviceName = (e) => names[e.shopId]?.services[e.serviceId] || 'Service'
const dateLabel = (key) => formatDate(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), 4))

// ---- Sign-in (OTP) ----
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
  if (!/^\d{6}$/.test(code.value.trim())) { errors.value = { code: 'Enter the 6-digit code.' }; return }
  errors.value = {}
  pending.value = true
  try {
    const user = await verifyOtp(code.value.trim())
    await enter(user.uid)
  } catch (err) {
    if (err.code === 'auth/invalid-verification-code') errors.value = { code: 'That code is not correct.' }
    else formError.value = otpErrorMessage(err)
  } finally {
    pending.value = false
  }
}

// ---- Join and claim ----
async function onJoin() {
  formError.value = ''
  notice.value = ''
  errors.value = validateJoin({ serviceId: form.serviceId, name: form.name, date: form.date }, dates.value.map((d) => d.key))
  if (Object.keys(errors.value).length) return
  pending.value = true
  try {
    const { data } = await joinWaitlist({
      shopId, serviceId: form.serviceId, barberId: form.barberId === 'any' ? null : form.barberId,
      date: form.date, displayName: form.name.trim(),
    })
    notice.value = data.alreadyJoined
      ? 'You are already on this waitlist. Your place is unchanged.'
      : `You are on the waitlist for ${dateLabel(form.date)}. We will text you if a slot opens.`
  } catch (err) {
    if (err.code === 'functions/invalid-argument') {
      const field = { serviceId: 'service', displayName: 'name', date: 'date', barberId: 'barber' }[err.details?.field]
      errors.value = field ? { [field]: err.message } : {}
      if (!field) formError.value = err.message
    } else if (err.code === 'functions/unauthenticated' || err.code === 'functions/permission-denied') {
      step.value = 'phone'
      formError.value = 'Please verify your mobile number again to join.'
    } else {
      formError.value = 'Could not join the waitlist. Your details are kept; check your connection and try again.'
    }
  } finally {
    pending.value = false
  }
}

async function onClaim(entry) {
  claimErrors.value = { ...claimErrors.value, [entry.id]: '' }
  claiming.value = entry.id
  try {
    const { data } = await claimOffer({ entryId: entry.id })
    if (data.status === 'PENDING_PAYMENT') { // FR-13: a deposit is due; UI-C5 takes over
      await router.push({ name: 'deposit', params: { requestId: data.requestId } })
    } else {
      notice.value = 'Booked! Your slot is confirmed. You can see it in My bookings.'
    }
  } catch (err) {
    claimErrors.value = { ...claimErrors.value, [entry.id]: claimErrorMessage(err.details?.reason) }
  } finally {
    claiming.value = ''
  }
}

const slotText = (e) => (e.offerSlot ? `${formatDate(e.offerSlot.start)}, ${formatTime(e.offerSlot.start)}` : '')
const badgeClass = (state) => ({ warn: state === 'offered' || state === 'offer-lapsed', off: state === 'expired' })
</script>

<template>
  <main class="waitlist">
    <header class="page-head">
      <h1>Waitlist</h1>
      <p class="lede">No time works? Join a waitlist and we will offer you a slot if one opens up.</p>
      <p class="hint">
        Prototype note: offer messages are sent by a <strong>mock</strong> provider, so no real SMS is sent. Check this page for offers.
      </p>
    </header>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Reconnect to continue; nothing has changed.</p>
    <p v-if="formError" class="banner" role="alert">{{ formError }}</p>
    <p v-if="notice" class="banner success" role="status">{{ notice }}</p>

    <p v-if="step === 'loading'" class="hint" role="status">Loading…</p>

    <form v-else-if="step === 'phone'" class="card verify" novalidate @submit.prevent="onSendCode">
      <h2>Verify your mobile</h2>
      <p class="hint step-intro">Verify your mobile number to join the waitlist and see your offers.</p>
      <div class="field">
        <label for="phone">Singapore mobile number</label>
        <input id="phone" v-model="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="9123 4567"
          :aria-invalid="!!errors.phone" :aria-describedby="errors.phone ? 'phone-err' : 'phone-hint'" />
        <span v-if="errors.phone" id="phone-err" class="error">{{ errors.phone }}</span>
        <span v-else id="phone-hint" class="hint">We send a 6-digit code by SMS.</span>
      </div>
      <button class="btn" type="submit" :disabled="pending || !online">{{ pending ? 'Sending code…' : 'Send code' }}</button>
      <div id="recaptcha-container"></div>
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
        <button class="btn secondary" type="button" @click="step = 'phone'">Use a different number</button>
      </div>
    </form>

    <template v-else>
      <section v-if="shopId && shop" class="card join" aria-labelledby="join-h">
        <h2 id="join-h">Join the waitlist at {{ shop.name }}</h2>
        <p class="hint step-intro">Pick a service, a barber and a date. Times are not needed: we offer you one if it opens up.</p>
        <form novalidate @submit.prevent="onJoin">
          <fieldset class="step" :aria-describedby="errors.service ? 'service-err' : undefined">
            <legend><span class="step-no" aria-hidden="true">1</span> Service (required)</legend>
            <div class="options" role="radiogroup" aria-label="Service">
              <label v-for="s in services" :key="s.id" class="option">
                <input v-model="form.serviceId" type="radio" name="service" :value="s.id" />
                <span class="option-body">
                  <span class="option-name">{{ s.name }}</span>
                  <span class="option-meta">{{ s.durationMin }} min · {{ money(s.priceCents) }}</span>
                </span>
              </label>
            </div>
            <span v-if="errors.service" id="service-err" class="error">{{ errors.service }}</span>
          </fieldset>
          <fieldset class="step" :disabled="!form.serviceId">
            <legend><span class="step-no" aria-hidden="true">2</span> Barber (optional)</legend>
            <p v-if="!form.serviceId" class="hint">Choose a service first.</p>
            <div class="options" role="radiogroup" aria-label="Barber">
              <label class="option">
                <input v-model="form.barberId" type="radio" name="barber" value="any" />
                <span class="option-body"><span class="option-name">Any barber</span><span class="option-meta">Fastest to get an offer</span></span>
              </label>
              <label v-for="b in offering" :key="b.id" class="option">
                <input v-model="form.barberId" type="radio" name="barber" :value="b.id" />
                <span class="option-body"><span class="option-name">{{ b.displayName }}</span></span>
              </label>
            </div>
          </fieldset>
          <fieldset class="step" :aria-describedby="errors.date ? 'date-err' : undefined">
            <legend><span class="step-no" aria-hidden="true">3</span> Date</legend>
            <div class="picks" role="radiogroup" aria-label="Date">
              <label v-for="d in dates" :key="d.key" class="pick">
                <input v-model="form.date" type="radio" name="date" :value="d.key" />
                <span>{{ d.label }}</span>
              </label>
            </div>
            <span v-if="errors.date" id="date-err" class="error">{{ errors.date }}</span>
          </fieldset>
          <div class="field name-field">
            <label for="name"><span class="step-no" aria-hidden="true">4</span> Your name</label>
            <input id="name" v-model="form.name" type="text" autocomplete="name" maxlength="80"
              :aria-invalid="!!errors.name" :aria-describedby="errors.name ? 'name-err' : undefined" />
            <span v-if="errors.name" id="name-err" class="error">{{ errors.name }}</span>
          </div>
          <button class="btn" type="submit" :disabled="pending || !online">{{ pending ? 'Joining…' : 'Join the waitlist' }}</button>
        </form>
      </section>

      <section class="mine" aria-labelledby="mine-h">
        <h2 id="mine-h">My waitlist</h2>
        <p v-if="loadingList" class="hint" role="status">Loading your waitlist…</p>
        <p v-else-if="!list.length" class="empty">You are not on any waitlist yet. Open a shop, choose a date with no times, and join from there.</p>

        <div class="entries">
        <article v-for="e in list" :key="e.id" class="card entry" :class="{ offered: entryState(e, now) === 'offered' }" :aria-labelledby="`w-${e.id}`">
          <div class="card-head">
            <h3 :id="`w-${e.id}`">{{ shopName(e) }} · {{ dateLabel(e.date) }}</h3>
            <p class="badge" :class="badgeClass(entryState(e, now))" role="status">Status: {{ STATE_LABELS[entryState(e, now)] }}</p>
          </div>
          <dl class="summary">
            <dt>Service</dt><dd>{{ serviceName(e) }}</dd>
            <dt>Barber</dt><dd>{{ e.barberId ? 'Requested barber' : 'Any barber' }}</dd>
            <template v-if="entryState(e, now) === 'offered'">
              <dt>Offered slot</dt><dd><strong>{{ slotText(e) }}</strong></dd>
              <dt>Time left to claim</dt>
              <dd role="timer" :aria-label="`Time left to claim: ${countdown(e.offerExpiresAt, now).spoken}`">
                <strong>{{ countdown(e.offerExpiresAt, now).text }}</strong>
              </dd>
            </template>
          </dl>
          <p class="hint">{{ e.status === 'expired' ? expiredText(e) : STATE_MESSAGES[entryState(e, now)] }}</p>
          <p v-if="claimErrors[e.id]" class="banner" role="alert">{{ claimErrors[e.id] }}</p>
          <div class="row-actions card-actions">
            <button v-if="canClaim(e, now)" class="btn" type="button" :disabled="!!claiming || !online" @click="onClaim(e)">
              {{ claiming === e.id ? 'Claiming…' : 'Claim this slot' }}
            </button>
            <router-link v-if="e.status === 'claimed'" class="btn secondary" :to="{ name: 'my-bookings' }">See my bookings</router-link>
            <router-link v-if="entryState(e, now) === 'offer-lapsed' || e.status === 'expired'" class="btn secondary" :to="{ name: 'book', params: { shopId: e.shopId } }">
              Choose a time
            </router-link>
          </div>
        </article>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.waitlist { padding-bottom: var(--space-6); }
.page-head { margin-bottom: clamp(1.5rem, 5vw, 2.5rem); }
.page-head h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 34rem; margin-bottom: var(--space-3); }
.waitlist .banner { margin-bottom: var(--space-4); }
.empty { color: var(--color-muted); padding: var(--space-4) 0; }
.waitlist section { margin-bottom: clamp(2rem, 6vw, 3.5rem); }
.mine h2, .join h2 { font-size: clamp(1.3rem, 3vw, 1.6rem); }

/* OTP steps and join form share one card look */
.verify, .join { max-width: 34rem; padding: var(--space-5); box-shadow: 0 8px 28px rgba(30, 43, 42, 0.1); }
.verify { margin-bottom: var(--space-5); }
.verify h2 { margin-bottom: var(--space-1); }
.step-intro { margin-bottom: var(--space-5); }
.verify input, .name-field input { font-size: 1.1rem; min-height: 52px; }
.card-actions { gap: var(--space-2) var(--space-3); margin-top: var(--space-4); }
.card-actions .btn { flex: 1 1 9rem; }
.join > form > .btn { width: 100%; }

/* Numbered steps */
.step { margin: 0 0 var(--space-5); min-width: 0; }
.step legend, .name-field label { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); padding: 0; }
.name-field { margin-bottom: var(--space-5); }
.step-no {
  display: inline-flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; border-radius: var(--radius-pill);
  background: var(--color-tint); color: var(--color-accent-dark); font-size: var(--text-sm); font-weight: 800;
}
.step:disabled { opacity: 0.6; }
.step .error { display: block; margin-top: var(--space-2); }

/* Selectable options. Selected = teal border + tint + check mark + bold, so colour is never the only cue. */
.options { display: grid; gap: var(--space-2); }
.option, .pick { position: relative; display: block; }
.option input, .pick input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.option-body, .pick span {
  display: flex; border: 2px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text);
}
.option-body { align-items: center; justify-content: space-between; gap: var(--space-3); min-height: 56px; padding: var(--space-2) var(--space-4) var(--space-2) 2.6rem; position: relative; }
.option-body::before {
  content: ''; position: absolute; left: var(--space-3); top: 50%; width: 1.15rem; height: 1.15rem; margin-top: -0.575rem;
  border: 2px solid var(--color-field-border); border-radius: var(--radius-pill); background: var(--color-surface);
}
.option-name { font-weight: 700; }
.option-meta { font-size: var(--text-sm); color: var(--color-muted); white-space: nowrap; }
.option input:hover + .option-body, .pick input:hover + span { border-color: var(--color-field-border); background: var(--color-tint); }
.option input:checked + .option-body { border-color: var(--color-accent); background: var(--color-tint); }
.option input:checked + .option-body::before { content: '\2713'; display: flex; align-items: center; justify-content: center; border-color: var(--color-accent); background: var(--color-accent); color: var(--color-surface); font-size: 0.8rem; font-weight: 800; }
.option input:checked + .option-body .option-name { font-weight: 800; color: var(--color-accent-dark); }
.option input:disabled { cursor: not-allowed; }
.option input:focus-visible + .option-body, .pick input:focus-visible + span { outline: 3px solid var(--color-focus); outline-offset: 2px; }

.picks { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: var(--space-2); }
.pick span { align-items: center; justify-content: center; gap: var(--space-1); min-height: 48px; padding: 0 var(--space-3); text-align: center; font-weight: 600; }
.pick input:checked + span { border-color: var(--color-accent); background: var(--color-tint); color: var(--color-accent-dark); font-weight: 800; }
.pick input:checked + span::before { content: '\2713'; }

/* Entries */
.entries { display: grid; gap: var(--space-5); align-items: start; }
.entry { margin-bottom: 0; padding: var(--space-5); }
.entry.offered { border-color: var(--color-accent); }
.card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-4); }
.card-head h3 { margin: 0; font-size: var(--text-lg); }
.card-head .badge { margin: 0; padding: 0.2rem var(--space-3); }
.entry .summary { grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-5); margin-bottom: var(--space-4); }
.entry .summary dt { color: var(--color-muted); font-weight: 600; }
.entry .summary dd { font-weight: 600; }
.entry .hint { margin-bottom: 0; }
.entry .banner { margin: var(--space-3) 0 0; }

@media (min-width: 900px) {
  .entries { grid-template-columns: repeat(2, 1fr); }
  .options { grid-template-columns: repeat(2, 1fr); }
}
</style>
