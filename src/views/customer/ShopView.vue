<script setup>
// UI-C2 Select service and slot (FR-02). Availability comes from live listeners on the barber-day
// schedule docs, so a slot taken elsewhere disappears without a refresh. holdSlot is still the
// authority: if it answers SLOT_TAKEN the list simply catches up and the selections stay.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import { dateOptions, formatTime, slotsForBarbers, toIntervals } from '@/lib/slots'
import { resolveRebook } from '@/lib/history'
import { draft, ensureRequestId, newAttempt, resetDraft } from '@/stores/booking'

const route = useRoute()
const router = useRouter()
const shopId = route.params.shopId
const holdSlot = httpsCallable(functions, 'holdSlot')

const shop = ref(null)
const shopMissing = ref(false)
const services = ref([])
const barbers = ref([])
const schedules = reactive({}) // barberId -> intervals (ms), for the chosen date
const loaded = reactive({}) // barberId -> true once its schedule listener has answered
const loadError = ref('')
const formError = ref('')
const rebookNotes = ref([])
const listed = reactive({ services: false, barbers: false })
const errors = ref({})
const pending = ref(false)
const online = ref(navigator.onLine)
const now = ref(Date.now())

const dates = computed(() => dateOptions(now.value))
const money = (cents) => `S$${(cents / 100).toFixed(2)}`

if (draft.shopId !== shopId) resetDraft({ shopId })
if (!draft.dateKey) draft.dateKey = dates.value[0].key

const service = computed(() => services.value.find((s) => s.id === draft.serviceId))
const offering = computed(() =>
  barbers.value.filter((b) => Array.isArray(b.serviceIds) && b.serviceIds.includes(draft.serviceId)))
const candidates = computed(() => {
  if (!service.value) return []
  return draft.barberId === 'any' ? offering.value : offering.value.filter((b) => b.id === draft.barberId)
})

const unsubs = []
const scheduleUnsubs = []
const stopAll = (list) => list.splice(0).forEach((u) => u())

// One listener per candidate barber for the chosen date.
watch(
  () => [candidates.value.map((b) => b.id).join(','), draft.dateKey],
  () => {
    stopAll(scheduleUnsubs)
    for (const k of Object.keys(loaded)) { delete loaded[k]; delete schedules[k] }
    if (!draft.dateKey) return
    for (const b of candidates.value) {
      scheduleUnsubs.push(onSnapshot(
        doc(db, `shops/${shopId}/schedules/${b.id}_${draft.dateKey}`),
        (snap) => { schedules[b.id] = toIntervals(snap.data()?.intervals); loaded[b.id] = true },
        () => { loadError.value = 'Could not load availability. Check your connection.' },
      ))
    }
  },
  { immediate: true },
)

const ready = computed(() => candidates.value.length > 0 && candidates.value.every((b) => loaded[b.id]))
const slots = computed(() => {
  if (!ready.value) return []
  return slotsForBarbers({
    barbers: candidates.value,
    shopHours: shop.value?.openingHours,
    dateKey: draft.dateKey,
    durationMin: service.value.durationMin,
    schedules,
    now: now.value,
  })
})

// The chosen slot was taken (or aged out) while the customer was looking at the list.
watch(slots, (list) => {
  if (draft.start && ready.value && !list.includes(draft.start)) {
    draft.start = null
    formError.value = 'That time is no longer available. Please choose another.'
  }
})
// FR-11: a Rebook from History pre-selects service and barber. Once both live lists have arrived (they hold
// active items only), whatever is no longer offered is dropped and the reason shown. No time is chosen.
watch(() => listed.services && listed.barbers, (both) => {
  const wanted = draft.rebook
  if (!both || !wanted) return
  draft.rebook = null
  const service = services.value.find((s) => s.id === wanted.serviceId) ?? null
  const barber = barbers.value.find((b) => b.id === wanted.barberId) ?? null
  const r = resolveRebook({ serviceId: wanted.serviceId, barberId: wanted.barberId, service, barber })
  draft.serviceId = r.serviceId
  draft.barberId = r.barberId
  rebookNotes.value = r.notes
})
// A different selection is a different attempt, so it gets its own requestId.
watch(() => [draft.serviceId, draft.barberId, draft.start], newAttempt)
watch(() => draft.serviceId, () => { errors.value = {}; if (draft.barberId !== 'any' && !offering.value.some((b) => b.id === draft.barberId)) draft.barberId = 'any' })

const setOnline = () => { online.value = navigator.onLine }
let ticker
onMounted(async () => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 30000)
  const onError = () => { loadError.value = 'Could not load shop data. Check your connection.' }
  try {
    const snap = await getDoc(doc(db, `shops/${shopId}`))
    if (snap.exists()) shop.value = snap.data()
    else shopMissing.value = true
  } catch (err) {
    // Rules hide shops that are not verified, so "permission-denied" means "not found" to a customer.
    if (err.code === 'permission-denied') shopMissing.value = true
    else onError()
  }
  if (shopMissing.value) return
  unsubs.push(
    onSnapshot(query(collection(db, `shops/${shopId}/services`), where('active', '==', true)), (snap) => {
      services.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))
      listed.services = true
    }, onError),
    onSnapshot(query(collection(db, `shops/${shopId}/barbers`), where('active', '==', true)), (snap) => {
      barbers.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.displayName.localeCompare(b.displayName))
      listed.barbers = true
    }, onError),
  )
  if (draft.notice) { formError.value = draft.notice; draft.notice = '' }
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  stopAll(unsubs)
  stopAll(scheduleUnsubs)
})

function validate() {
  const e = {}
  if (!draft.serviceId) e.service = 'Choose a service.'
  if (!draft.start) e.slot = 'Choose a time.'
  errors.value = e
  return Object.keys(e).length === 0
}

async function onContinue() {
  formError.value = ''
  if (!validate()) return
  pending.value = true
  try {
    const { data } = await holdSlot({
      shopId,
      serviceId: draft.serviceId,
      barberId: draft.barberId,
      start: draft.start,
      requestId: ensureRequestId(),
    })
    draft.hold = data
    await router.push({ name: 'book-verify', params: { shopId } })
  } catch (err) {
    // Everything the customer picked stays put; only the message changes.
    const reason = err.details?.reason
    if (reason === 'SLOT_TAKEN') {
      formError.value = 'Sorry, that time was just taken. The list has been refreshed. Please choose another.'
      draft.start = null
    } else if (reason === 'BUSY') formError.value = 'We are busy right now. Please try again in a moment.'
    else if (err.code === 'functions/invalid-argument') formError.value = err.message
    else formError.value = 'Could not reach the server. Your choices are kept. Check your connection and try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="shop">
    <template v-if="shopMissing">
      <h1>Shop not found</h1>
      <p class="lede">This shop does not exist or is not open for bookings yet.</p>
    </template>
    <template v-else>
      <header class="shop-head">
        <h1>{{ shop?.name ?? 'Book an appointment' }}</h1>
        <p v-if="shop" class="lede">{{ shop.address }}</p>
      </header>

      <p v-if="!online" class="banner" role="alert">
        You appear to be offline. Your choices are kept; reconnect to continue.
      </p>
      <p v-if="loadError" class="banner" role="alert">{{ loadError }}</p>
      <p v-if="formError" class="banner" role="alert">{{ formError }}</p>
      <div v-if="rebookNotes.length" class="banner info" role="status">
        <p v-for="n in rebookNotes" :key="n">{{ n }}</p>
      </div>

      <form novalidate @submit.prevent="onContinue">
        <fieldset class="card step" :aria-describedby="errors.service ? 'service-err' : undefined">
          <legend><span class="step-no" aria-hidden="true">1</span>Service</legend>
          <p v-if="listed.services && !services.length" class="hint">This shop has no services to book yet.</p>
          <div class="opts">
            <label v-for="s in services" :key="s.id" class="opt">
              <input v-model="draft.serviceId" type="radio" name="service" :value="s.id" />
              <span class="opt-body">
                <span class="mark" aria-hidden="true"></span>
                <span class="opt-main">
                  <span class="opt-title">{{ s.name }}</span>
                  <span class="opt-sub">{{ s.durationMin }} min</span>
                </span>
                <span class="opt-price">{{ money(s.priceCents) }}</span>
              </span>
            </label>
          </div>
          <span v-if="errors.service" id="service-err" class="error" role="alert">{{ errors.service }}</span>
        </fieldset>

        <fieldset class="card step" :disabled="!draft.serviceId">
          <legend><span class="step-no" aria-hidden="true">2</span>Barber</legend>
          <p v-if="!draft.serviceId" class="hint">Choose a service first.</p>
          <div class="opts">
            <label class="opt">
              <input v-model="draft.barberId" type="radio" name="barber" value="any" />
              <span class="opt-body">
                <span class="mark" aria-hidden="true"></span>
                <span class="opt-main">
                  <span class="opt-title">Any available barber</span>
                  <span class="opt-sub">Most times to choose from</span>
                </span>
              </span>
            </label>
            <label v-for="b in offering" :key="b.id" class="opt">
              <input v-model="draft.barberId" type="radio" name="barber" :value="b.id" />
              <span class="opt-body">
                <span class="mark" aria-hidden="true"></span>
                <span class="opt-main"><span class="opt-title">{{ b.displayName }}</span></span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset class="card step">
          <legend><span class="step-no" aria-hidden="true">3</span>Date</legend>
          <div class="dates">
            <label v-for="d in dates" :key="d.key" class="pill">
              <input v-model="draft.dateKey" type="radio" name="date" :value="d.key" />
              <span class="pill-body">{{ d.label }}</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="card step" :aria-describedby="errors.slot ? 'slot-err' : 'slot-hint'">
          <legend><span class="step-no" aria-hidden="true">4</span>Time</legend>
          <p id="slot-hint" class="hint" aria-live="polite">
            <template v-if="!draft.serviceId">Choose a service to see available times.</template>
            <template v-else-if="!ready">Loading times…</template>
            <template v-else-if="!slots.length">No times available on this date. Try another day, or join the waitlist below.</template>
            <template v-else>Times update live. All times are Singapore time.</template>
          </p>
          <p v-if="draft.serviceId && ready && !slots.length" class="waitlist-cta">
            <router-link class="btn secondary" :to="{ name: 'waitlist', query: { shop: shopId, service: draft.serviceId, barber: draft.barberId, date: draft.dateKey } }">
              Join the waitlist for this date
            </router-link>
          </p>
          <div v-if="slots.length" class="times" role="radiogroup" aria-label="Available times">
            <label v-for="s in slots" :key="s" class="pill time">
              <input v-model="draft.start" type="radio" name="slot" :value="s" />
              <span class="pill-body">{{ formatTime(s) }}</span>
            </label>
          </div>
          <span v-if="errors.slot" id="slot-err" class="error" role="alert">{{ errors.slot }}</span>
        </fieldset>

        <div class="continue">
          <button class="btn" type="submit" :disabled="pending || !online">
            {{ pending ? 'Holding your slot…' : 'Continue' }}
          </button>
          <p class="hint">We hold your slot for 10 minutes while you verify your mobile number.</p>
        </div>
      </form>
    </template>
  </main>
</template>

<style scoped>
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 34rem; }
.shop-head { margin-bottom: var(--space-5); padding-top: var(--space-3); }
.shop-head h1 { font-size: clamp(1.9rem, 6vw, 2.8rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.shop .banner p + p { margin-top: var(--space-1); }

.step { margin: 0 0 var(--space-5); padding: var(--space-4) var(--space-4) var(--space-5); min-width: 0; }
.step legend { display: flex; align-items: center; gap: var(--space-3); float: left; width: 100%; font-size: var(--text-lg); font-weight: 800; margin-bottom: var(--space-4); padding: 0; }
.step legend + * { clear: both; }
.step-no {
  display: inline-grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: var(--radius-pill);
  background: var(--color-tint); color: var(--color-accent-dark); font-size: var(--text-sm); font-weight: 800;
}
.step:disabled { opacity: 0.7; }
.step .hint { margin-bottom: var(--space-3); }
.step .error { display: block; margin-top: var(--space-3); }

/* Visually hidden radios keep native keyboard and screen reader behaviour. */
.opt, .pill { position: relative; display: block; }
.opt input, .pill input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.step:disabled input { cursor: not-allowed; }

.opts { display: grid; gap: var(--space-3); }
.opt-body {
  display: flex; align-items: center; gap: var(--space-3); min-height: 56px; padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-field-border); border-radius: var(--radius-md); background: var(--color-surface);
}
.opt:hover input:not(:disabled) + .opt-body { background: var(--color-tint); }
.mark {
  flex: none; display: grid; place-items: center; width: 1.4rem; height: 1.4rem; border-radius: var(--radius-pill);
  border: 2px solid var(--color-field-border); background: var(--color-surface); color: var(--color-surface);
  font-size: 0.85rem; font-weight: 800; line-height: 1;
}
.opt-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.opt-title { font-weight: 700; overflow-wrap: anywhere; }
.opt-sub { font-size: var(--text-sm); color: var(--color-muted); }
.opt-price { font-weight: 700; font-variant-numeric: tabular-nums; }
/* Selected: thicker border, tint fill, filled tick and bold title, so it never depends on colour alone. */
.opt input:checked + .opt-body { border: 3px solid var(--color-accent); padding: calc(var(--space-3) - 2px) calc(var(--space-4) - 2px); background: var(--color-tint); }
.opt input:checked + .opt-body .mark { background: var(--color-accent); border-color: var(--color-accent); }
.opt input:checked + .opt-body .mark::after { content: '\2713'; }
.opt input:checked + .opt-body .opt-title { font-weight: 800; }
.opt input:checked + .opt-body .opt-sub { color: var(--color-text); }

.dates, .times { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.times { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: var(--space-2) var(--space-3); }
.pill-body {
  display: flex; align-items: center; justify-content: center; gap: var(--space-1); min-height: var(--tap-target); padding: 0 var(--space-4);
  border: 1px solid var(--color-field-border); border-radius: var(--radius-pill); background: var(--color-surface);
  font-weight: 600; font-size: var(--text-sm); white-space: nowrap;
}
.time .pill-body { font-size: var(--text-base); font-variant-numeric: tabular-nums; }
.pill:hover input:not(:disabled) + .pill-body { background: var(--color-tint); }
.pill input:checked + .pill-body { border: 3px solid var(--color-accent); background: var(--color-tint); font-weight: 800; padding: 0 calc(var(--space-4) - 2px); }
.pill input:checked + .pill-body::before { content: '\2713'; color: var(--color-accent); font-weight: 800; }
.opt input:focus-visible + .opt-body, .pill input:focus-visible + .pill-body { outline: 3px solid var(--color-focus); outline-offset: 2px; }

.waitlist-cta { margin-bottom: var(--space-2); }
.continue { margin-top: var(--space-6); margin-bottom: var(--space-6); }
.continue .btn { width: 100%; min-height: 52px; font-size: var(--text-lg); }
.continue .hint { margin-top: var(--space-3); text-align: center; }

@media (min-width: 720px) {
  .step { padding: var(--space-5) var(--space-5) var(--space-6); }
  .opts { grid-template-columns: repeat(2, 1fr); }
  .continue .btn { width: auto; min-width: 16rem; }
  .continue .hint { text-align: left; }
}
</style>
