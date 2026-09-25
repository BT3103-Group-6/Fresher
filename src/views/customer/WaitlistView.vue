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
  <main>
    <h1>Waitlist</h1>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Reconnect to continue; nothing has changed.</p>
    <p v-if="formError" class="banner" role="alert">{{ formError }}</p>
    <p v-if="notice" class="hint" role="status">{{ notice }}</p>
    <p class="hint">
      Prototype note: offer messages are sent by a <strong>mock</strong> provider, so no real SMS is sent. Check this page for offers.
    </p>

    <p v-if="step === 'loading'" class="hint" role="status">Loading…</p>

    <form v-else-if="step === 'phone'" novalidate @submit.prevent="onSendCode">
      <p>Verify your mobile number to join the waitlist and see your offers.</p>
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

    <form v-else-if="step === 'code'" novalidate @submit.prevent="onVerify">
      <p>We sent a code to {{ phone }}.</p>
      <div class="field">
        <label for="code">6-digit code</label>
        <input id="code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
          :aria-invalid="!!errors.code" :aria-describedby="errors.code ? 'code-err' : undefined" />
        <span v-if="errors.code" id="code-err" class="error">{{ errors.code }}</span>
      </div>
      <div class="row-actions">
        <button class="btn" type="submit" :disabled="pending || !online">{{ pending ? 'Verifying…' : 'Verify' }}</button>
        <button class="btn secondary" type="button" @click="step = 'phone'">Use a different number</button>
      </div>
    </form>

    <template v-else>
      <section v-if="shopId && shop" aria-labelledby="join-h">
        <h2 id="join-h">Join the waitlist at {{ shop.name }}</h2>
        <p class="hint">No time works for you? Pick a date and a service, and we will offer you a slot if one opens up.</p>
        <form novalidate @submit.prevent="onJoin">
          <div class="field">
            <label for="service">Service (required)</label>
            <select id="service" v-model="form.serviceId" :aria-invalid="!!errors.service" :aria-describedby="errors.service ? 'service-err' : undefined">
              <option value="" disabled>Choose a service</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} · {{ s.durationMin }} min · {{ money(s.priceCents) }}</option>
            </select>
            <span v-if="errors.service" id="service-err" class="error">{{ errors.service }}</span>
          </div>
          <div class="field">
            <label for="barber">Barber (optional)</label>
            <select id="barber" v-model="form.barberId" :disabled="!form.serviceId">
              <option value="any">Any barber</option>
              <option v-for="b in offering" :key="b.id" :value="b.id">{{ b.displayName }}</option>
            </select>
          </div>
          <div class="field">
            <label for="date">Date</label>
            <select id="date" v-model="form.date" :aria-invalid="!!errors.date" :aria-describedby="errors.date ? 'date-err' : undefined">
              <option v-for="d in dates" :key="d.key" :value="d.key">{{ d.label }}</option>
            </select>
            <span v-if="errors.date" id="date-err" class="error">{{ errors.date }}</span>
          </div>
          <div class="field">
            <label for="name">Your name</label>
            <input id="name" v-model="form.name" type="text" autocomplete="name" maxlength="80"
              :aria-invalid="!!errors.name" :aria-describedby="errors.name ? 'name-err' : undefined" />
            <span v-if="errors.name" id="name-err" class="error">{{ errors.name }}</span>
          </div>
          <button class="btn" type="submit" :disabled="pending || !online">{{ pending ? 'Joining…' : 'Join the waitlist' }}</button>
        </form>
      </section>

      <section aria-labelledby="mine-h">
        <h2 id="mine-h">My waitlist</h2>
        <p v-if="loadingList" class="hint" role="status">Loading your waitlist…</p>
        <p v-else-if="!list.length">You are not on any waitlist yet. Open a shop, choose a date with no times, and join from there.</p>

        <article v-for="e in list" :key="e.id" class="card" :aria-labelledby="`w-${e.id}`">
          <h3 :id="`w-${e.id}`">{{ shopName(e) }} · {{ dateLabel(e.date) }}</h3>
          <p class="badge" :class="badgeClass(entryState(e, now))" role="status">Status: {{ STATE_LABELS[entryState(e, now)] }}</p>
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
          <p>{{ e.status === 'expired' ? expiredText(e) : STATE_MESSAGES[entryState(e, now)] }}</p>
          <p v-if="claimErrors[e.id]" class="banner" role="alert">{{ claimErrors[e.id] }}</p>
          <div class="row-actions">
            <button v-if="canClaim(e, now)" class="btn" type="button" :disabled="!!claiming || !online" @click="onClaim(e)">
              {{ claiming === e.id ? 'Claiming…' : 'Claim this slot' }}
            </button>
            <router-link v-if="e.status === 'claimed'" class="btn secondary" :to="{ name: 'my-bookings' }">See my bookings</router-link>
            <router-link v-if="entryState(e, now) === 'offer-lapsed' || e.status === 'expired'" class="btn secondary" :to="{ name: 'book', params: { shopId: e.shopId } }">
              Choose a time
            </router-link>
          </div>
        </article>
      </section>
    </template>
  </main>
</template>
