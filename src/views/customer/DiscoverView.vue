<script setup>
// UI-C1 Discover shops (FR-01). Postal code (geocoded server-side) or device location -> verified shops
// within 3 km -> optional service-type filter -> cards with distance, price range and next slot.
// The next slot is looked up only for the nearest shops, one at a time, after the list is on screen.
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { formatDate, formatTime, sgDateKey } from '@/lib/slots'
import { NEXT_SLOT_DAYS, NEXT_SLOT_SHOPS, RADIUS_M, filterByType, formatDistance, formatPriceRange } from '@/lib/discovery'
import { SERVICE_TYPES, serviceTypeLabel } from '@/lib/serviceTypes'
import { geocode, nextSlotFor, searchShops } from '@/lib/discoveryData'

const postalCode = ref('')
const type = ref('')
const fieldError = ref('')
const notice = ref('')
const searching = ref(false)
const searched = ref(false)
const origin = ref('')
const shops = ref([])
const slotState = reactive({}) // `${shopId}|${type}` -> 'loading' | 'error' | { at: ms | null }
const online = ref(navigator.onLine)
const setOnline = () => { online.value = navigator.onLine }
window.addEventListener('online', setOnline)
window.addEventListener('offline', setOnline)
onUnmounted(() => {
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
})

const results = computed(() => filterByType(shops.value, type.value))
const keyFor = (shop) => `${shop.id}|${type.value}`

async function run(center, label) {
  searching.value = true
  notice.value = ''
  try {
    shops.value = await searchShops(center)
    origin.value = label
    searched.value = true
  } catch {
    notice.value = 'Could not load shops. Check your connection and try again. Your search is kept.'
  } finally {
    searching.value = false
  }
}

async function onSearch() {
  fieldError.value = ''
  const code = postalCode.value.trim()
  if (!/^\d{6}$/.test(code)) {
    fieldError.value = 'Enter a 6-digit Singapore postal code.'
    return
  }
  searching.value = true
  try {
    const { lat, lng } = await geocode(code)
    await run([lat, lng], `postal code ${code}`)
  } catch (err) {
    searching.value = false
    if (err.code === 'functions/not-found' || err.code === 'functions/invalid-argument') fieldError.value = err.message
    else notice.value = 'Postal code search is unavailable right now. Check your connection and try again.'
  }
}

const locating = ref(false)
function onUseLocation() {
  fieldError.value = ''
  notice.value = ''
  if (!navigator.geolocation) {
    notice.value = 'Location is not available on this device. Enter your postal code instead.'
    return
  }
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      locating.value = false
      await run([coords.latitude, coords.longitude], 'your location')
    },
    (err) => {
      locating.value = false
      // The postal code field is always on screen; say why it is the way forward.
      notice.value = err.code === 1
        ? 'Location permission was denied. Enter your postal code instead.'
        : 'We could not get your location. Enter your postal code instead.'
    },
    { timeout: 10000, maximumAge: 60000 },
  )
}

// Next slot: nearest shops only, sequentially. Re-runs when the filter changes; data is cached.
let runId = 0
async function loadSlots() {
  const id = ++runId
  for (const shop of results.value.slice(0, NEXT_SLOT_SHOPS)) {
    const key = keyFor(shop)
    if (slotState[key] && slotState[key] !== 'error') continue
    slotState[key] = 'loading'
    try {
      slotState[key] = { at: await nextSlotFor(shop, type.value) }
    } catch {
      slotState[key] = 'error'
    }
    if (id !== runId) return
  }
}
watch(results, loadSlots)

function slotText(shop) {
  const s = slotState[keyFor(shop)]
  if (!s || s === 'loading') return shops.value.indexOf(shop) < NEXT_SLOT_SHOPS ? 'Checking availability…' : 'Open shop to see times'
  if (s === 'error') return 'Availability unavailable'
  if (s.at === null) return `No slots in the next ${NEXT_SLOT_DAYS} days`
  const today = sgDateKey(Date.now()) === sgDateKey(s.at)
  return `${today ? 'Today' : formatDate(s.at)}, ${formatTime(s.at)}`
}
</script>

<template>
  <main>
    <h1>Find a barber near you</h1>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Your search is kept; reconnect to continue.</p>
    <p v-if="notice" class="banner" role="alert">{{ notice }}</p>

    <form novalidate @submit.prevent="onSearch">
      <div class="field">
        <label for="postal">Postal code</label>
        <input id="postal" v-model="postalCode" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="6"
          :aria-invalid="!!fieldError" aria-describedby="postal-hint postal-err" />
        <span id="postal-hint" class="hint">6 digits, for example 160055.</span>
        <span id="postal-err" class="error" role="alert">{{ fieldError }}</span>
      </div>
      <div class="row-actions">
        <button class="btn" type="submit" :disabled="searching || !online">{{ searching ? 'Searching…' : 'Search' }}</button>
        <button class="btn secondary" type="button" :disabled="locating || searching" @click="onUseLocation">
          {{ locating ? 'Locating…' : 'Use my location' }}
        </button>
      </div>
    </form>

    <section v-if="searched" aria-labelledby="results-h" class="results">
      <h2 id="results-h">Shops within {{ RADIUS_M / 1000 }} km of {{ origin }}</h2>

      <div class="field">
        <label for="type">Service type</label>
        <select id="type" v-model="type">
          <option value="">All services</option>
          <option v-for="t in SERVICE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>

      <p class="hint" role="status">
        {{ results.length }} {{ results.length === 1 ? 'shop' : 'shops' }} found.
        <template v-if="!results.length && shops.length">Try "All services".</template>
        <template v-else-if="!results.length">Try another postal code.</template>
      </p>

      <ul class="shops">
        <li v-for="shop in results" :key="shop.id" class="card">
          <h3><RouterLink :to="{ name: 'book', params: { shopId: shop.id } }">{{ shop.name }}</RouterLink></h3>
          <p class="hint">{{ shop.address }}</p>
          <dl class="summary">
            <dt>Distance</dt><dd>{{ formatDistance(shop.distanceM) }}</dd>
            <dt>Price</dt><dd>{{ formatPriceRange(shop.priceMin, shop.priceMax) ?? 'Not listed' }}</dd>
            <dt>Next available</dt><dd>{{ slotText(shop) }}</dd>
          </dl>
          <p v-if="shop.serviceTypes?.length" class="tags">
            <span v-for="t in shop.serviceTypes" :key="t" class="badge">{{ serviceTypeLabel(t) }}</span>
          </p>
          <RouterLink class="btn" :to="{ name: 'book', params: { shopId: shop.id } }">Book at {{ shop.name }}</RouterLink>
        </li>
      </ul>
    </section>

    <p class="hint footer"><RouterLink to="/my-bookings">My bookings</RouterLink> · <RouterLink to="/login">Staff sign in</RouterLink></p>
  </main>
</template>
