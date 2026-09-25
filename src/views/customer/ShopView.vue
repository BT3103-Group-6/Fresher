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
    }, onError),
    onSnapshot(query(collection(db, `shops/${shopId}/barbers`), where('active', '==', true)), (snap) => {
      barbers.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.displayName.localeCompare(b.displayName))
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
  <main>
    <template v-if="shopMissing">
      <h1>Shop not found</h1>
      <p>This shop does not exist or is not open for bookings yet.</p>
    </template>
    <template v-else>
      <h1>{{ shop?.name ?? 'Book an appointment' }}</h1>
      <p v-if="shop" class="hint">{{ shop.address }}</p>

      <p v-if="!online" class="banner" role="alert">
        You appear to be offline. Your choices are kept; reconnect to continue.
      </p>
      <p v-if="loadError" class="banner" role="alert">{{ loadError }}</p>
      <p v-if="formError" class="banner" role="alert">{{ formError }}</p>

      <form novalidate @submit.prevent="onContinue">
        <div class="field">
          <label for="service">Service</label>
          <select id="service" v-model="draft.serviceId" :aria-invalid="!!errors.service"
            :aria-describedby="errors.service ? 'service-err' : undefined">
            <option value="" disabled>Select a service</option>
            <option v-for="s in services" :key="s.id" :value="s.id">
              {{ s.name }} · {{ s.durationMin }} min · {{ money(s.priceCents) }}
            </option>
          </select>
          <span v-if="errors.service" id="service-err" class="error">{{ errors.service }}</span>
        </div>

        <div class="field">
          <label for="barber">Barber</label>
          <select id="barber" v-model="draft.barberId" :disabled="!draft.serviceId">
            <option value="any">Any available barber</option>
            <option v-for="b in offering" :key="b.id" :value="b.id">{{ b.displayName }}</option>
          </select>
        </div>

        <div class="field">
          <label for="date">Date</label>
          <select id="date" v-model="draft.dateKey">
            <option v-for="d in dates" :key="d.key" :value="d.key">{{ d.label }}</option>
          </select>
        </div>

        <fieldset :aria-describedby="errors.slot ? 'slot-err' : 'slot-hint'">
          <legend>Time</legend>
          <p id="slot-hint" class="hint" aria-live="polite">
            <template v-if="!draft.serviceId">Choose a service to see available times.</template>
            <template v-else-if="!ready">Loading times…</template>
            <template v-else-if="!slots.length">No times available on this date. Try another day.</template>
            <template v-else>Times update live. All times are Singapore time.</template>
          </p>
          <div v-if="slots.length" class="slots" role="radiogroup" aria-label="Available times">
            <label v-for="s in slots" :key="s" class="slot">
              <input v-model="draft.start" type="radio" name="slot" :value="s" />
              <span>{{ formatTime(s) }}</span>
            </label>
          </div>
          <span v-if="errors.slot" id="slot-err" class="error">{{ errors.slot }}</span>
        </fieldset>

        <button class="btn" type="submit" :disabled="pending || !online">
          {{ pending ? 'Holding your slot…' : 'Continue' }}
        </button>
        <p class="hint">We hold your slot for 10 minutes while you verify your mobile number.</p>
      </form>
    </template>
  </main>
</template>
