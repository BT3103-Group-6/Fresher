<script setup>
// UI-C1 Discover shops (FR-01) as the landing page (decisions A15). Postal code (geocoded server-side) or
// device location -> verified shops within 3 km -> optional service-type filter -> cards with distance,
// price range and next slot. The next slot is looked up only for the nearest shops, one at a time, after
// the list is on screen. Search state lives in a store so going back from a shop keeps it.
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CombMotif from '@/components/CombMotif.vue'
import { isStaff, landingRoute } from '@/stores/session'
import { search } from '@/stores/discover'
import { formatDate, formatTime, sgDateKey } from '@/lib/slots'
import { NEXT_SLOT_DAYS, NEXT_SLOT_SHOPS, RADIUS_M, filterByType, formatDistance, formatPriceRange } from '@/lib/discovery'
import { SERVICE_TYPES, serviceTypeLabel } from '@/lib/serviceTypes'
import { geocode, nextSlotFor, preload, searchShops } from '@/lib/discoveryData'

// Neighbourhood quick picks: postal codes the geocode stub knows, each with a seeded shop nearby.
const QUICK_PICKS = [
  { label: 'Tiong Bahru', code: '160055' },
  { label: 'Tampines', code: '520478' },
  { label: 'Jurong East', code: '609731' },
  { label: 'Orchard', code: '238801' },
]

const fieldError = ref('')
const notice = ref('')
const searching = ref(false)
const slotState = search.slotState
const online = ref(navigator.onLine)
const setOnline = () => { online.value = navigator.onLine }
window.addEventListener('online', setOnline)
window.addEventListener('offline', setOnline)
onUnmounted(() => {
  mapObserver?.disconnect()
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
})

const results = computed(() => filterByType(search.shops, search.type))

// "Barbers across Singapore" map (A20): a placeholder until it scrolls into view, then its own chunk (the Google Maps
// script, the marker clusterer and the Firestore read all load with it), so none of that touches the first load.
const mapSection = ref(null)
const mapComp = shallowRef(null)
const mapWanted = ref(false)
const mapReady = ref(false)
const mapMatchIds = computed(() => (search.searched ? results.value.map((s) => s.id) : null))
let mapObserver = null
function loadMap() {
  mapWanted.value = true
  import('@/components/ShopMapSection.vue').then((m) => { mapComp.value = m.default }, () => { mapWanted.value = false })
}
const keyFor = (shop) => `${shop.id}|${search.type}`

async function run(center, label) {
  searching.value = true
  notice.value = ''
  try {
    search.shops = await searchShops(center)
    search.origin = label
    search.center = center
    search.searched = true
  } catch {
    notice.value = 'Could not load shops. Check your connection and try again. Your search is kept.'
  } finally {
    searching.value = false
  }
}

async function onSearch() {
  fieldError.value = ''
  notice.value = ''
  const code = search.postalCode.trim()
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
      slotState[key] = { at: await nextSlotFor(shop, search.type) }
    } catch {
      slotState[key] = 'error'
    }
    if (id !== runId) return
  }
}
watch(results, loadSlots)
onMounted(() => {
  if ('IntersectionObserver' in window) {
    mapObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        mapObserver.disconnect()
        loadMap()
      }
    }, { rootMargin: '0px' })
    mapObserver.observe(mapSection.value)
  } else {
    loadMap()
  }
  // A lookup interrupted by leaving the page must run again; finished ones are kept.
  for (const k of Object.keys(slotState)) if (slotState[k] === 'loading') delete slotState[k]
  if (search.searched) loadSlots()
})

function pick(p) {
  search.postalCode = p.code
  onSearch()
}

function slotText(shop) {
  const s = slotState[keyFor(shop)]
  if (!s || s === 'loading') return search.shops.indexOf(shop) < NEXT_SLOT_SHOPS ? 'Checking availability…' : 'Open shop to see times'
  if (s === 'error') return 'Availability unavailable'
  if (s.at === null) return `No slots in the next ${NEXT_SLOT_DAYS} days`
  const today = sgDateKey(Date.now()) === sgDateKey(s.at)
  return `${today ? 'Today' : formatDate(s.at)}, ${formatTime(s.at)}`
}
</script>

<template>
  <main class="landing">
    <section class="hero" aria-labelledby="hero-h">
      <CombMotif class="hero-motif" />
      <h1 id="hero-h">A fresh cut, booked in a minute.</h1>
      <p class="lede">Find a barber near you and book a real time slot with just your phone number.</p>

      <p v-if="!online" class="banner" role="alert">You appear to be offline. Your search is kept; reconnect to continue.</p>
      <p v-if="notice" class="banner" role="alert">{{ notice }}</p>

      <form class="search card" novalidate @submit.prevent="onSearch">
        <div class="field">
          <label for="postal">Your postal code</label>
          <input id="postal" v-model="search.postalCode" @focus="preload" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="6"
            placeholder="e.g. 160055" :aria-invalid="!!fieldError" aria-describedby="postal-err" />
          <span id="postal-err" class="error" role="alert">{{ fieldError }}</span>
        </div>
        <div class="search-actions">
          <button class="btn" type="submit" :disabled="searching || !online">{{ searching ? 'Searching…' : 'Search' }}</button>
          <button class="btn secondary" type="button" :disabled="locating || searching" @click="onUseLocation">
            {{ locating ? 'Locating…' : 'Use my location' }}
          </button>
        </div>
        <div class="quick" role="group" aria-labelledby="quick-h">
          <span id="quick-h" class="quick-label">Or try</span>
          <button v-for="p in QUICK_PICKS" :key="p.code" type="button" class="chip" :disabled="searching || !online" @click="pick(p)">
            {{ p.label }}
          </button>
        </div>
      </form>
    </section>

    <section id="results" aria-labelledby="results-h" class="results">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="results-h">{{ search.searched ? `Shops within ${RADIUS_M / 1000} km of ${search.origin}` : 'Browse by service' }}</h2>

      <div class="chips" role="group" aria-label="Service type">
        <button type="button" class="chip" :aria-pressed="search.type === ''" @click="search.type = ''">All services</button>
        <button v-for="t in SERVICE_TYPES" :key="t.value" type="button" class="chip" :aria-pressed="search.type === t.value"
          @click="search.type = t.value">{{ t.label }}</button>
      </div>

      <p v-if="!search.searched" class="hint">Search by postal code above to see barbers near you.</p>
      <template v-else>
        <p class="hint" role="status">
          {{ results.length }} {{ results.length === 1 ? 'shop' : 'shops' }} found.
          <template v-if="!results.length && search.shops.length">Try "All services".</template>
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
      </template>
    </section>

    <section id="map" ref="mapSection" aria-labelledby="map-h" class="map-section">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="map-h">Barbers across Singapore</h2>
      <component :is="mapComp" v-if="mapComp" :match-ids="mapMatchIds" :center="search.searched ? search.center : null" skip-target="why-h" @ready="mapReady = true" />
      <div v-if="!mapReady" class="map-placeholder"><p class="hint" role="status">{{ mapWanted ? 'Loading map…' : 'The map loads as you scroll.' }}</p></div>
    </section>

    <section aria-labelledby="why-h" class="why">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="why-h">Why Fresher</h2>
      <ul class="why-grid">
        <li class="card">
          <h3>No account, no password</h3>
          <p>Book with just your mobile number. A text code confirms it is you.</p>
        </li>
        <li class="card">
          <h3>Live availability</h3>
          <p>Times update as they are taken, so the slot you pick is really free.</p>
        </li>
        <li class="card">
          <h3>Reminders</h3>
          <p>A text a day before and two hours before, so you never miss a cut.</p>
        </li>
        <li class="card">
          <h3>Only barbers</h3>
          <p>Every shop here cuts hair. No spa menus, no clutter.</p>
        </li>
      </ul>
    </section>

    <section id="for-barbers" aria-labelledby="barbers-h" class="for-barbers">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="barbers-h">For barbers</h2>
      <p class="lede">Run a shop? Manage your schedule, walk-ins and services in one place.</p>
      <RouterLink class="btn secondary" :to="isStaff() ? landingRoute() : { name: 'login' }">
        {{ isStaff() ? 'Open staff area' : 'Staff sign in' }}
      </RouterLink>
    </section>

    <footer class="landing-footer">
      <p>
        Fresher is a student prototype (BT3103). Shops, prices and bookings are mock data, and text messages
        and payments are simulated. Nothing is sent to a real phone and no money moves.
      </p>
    </footer>
  </main>
</template>

<style scoped>
.landing { overflow-x: clip; }
.landing > section { margin-bottom: clamp(3rem, 9vw, 5.5rem); }
.landing h2 { font-size: clamp(1.4rem, 3vw, 1.85rem); margin-bottom: var(--space-4); }
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 34rem; margin-bottom: var(--space-5); }

.hero { position: relative; padding: var(--space-5) 0 0; }
.hero > *:not(.hero-motif) { position: relative; }
.hero-motif { position: absolute; z-index: 0; top: -1.5rem; right: -3rem; width: 15rem; color: var(--color-tint); pointer-events: none; }
.hero h1 { font-size: clamp(2.2rem, 7vw, 4rem); line-height: 1.08; letter-spacing: -0.03em; max-width: 14ch; margin-bottom: var(--space-3); }

.search { max-width: 34rem; padding: var(--space-4); box-shadow: var(--shadow-raised); margin-bottom: 0; }
.search .field { margin-bottom: var(--space-3); }
.search input { font-size: 1.15rem; min-height: 52px; }
.search-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-bottom: var(--space-4); }
.quick { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.quick-label { font-size: var(--text-sm); color: var(--color-muted); font-weight: 600; }

.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
.chip {
  font: inherit; font-weight: 600; font-size: var(--text-sm); min-height: 40px; padding: 0 var(--space-4);
  border: 1px solid var(--color-field-border); border-radius: var(--radius-pill);
  background: var(--color-surface); color: var(--color-text); cursor: pointer;
}
.chip:hover:not(:disabled) { background: var(--color-tint); }
.chip:disabled { opacity: 0.6; cursor: not-allowed; }
.chip[aria-pressed='true'], .chip[aria-pressed='true']:hover { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-surface); }


.map-placeholder { display: grid; place-items: center; height: 22rem; max-height: 80vh; border: 1px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-tint); }
.map-placeholder .hint { margin: 0; }
.shops { display: grid; gap: var(--space-4); }
.shops .card { margin-bottom: 0; }
.why-grid { list-style: none; padding: 0; display: grid; gap: var(--space-4); }
.why-grid .card { margin-bottom: 0; box-shadow: none; }
.why-grid h3 { font-size: 1.05rem; margin-bottom: var(--space-2); }
.for-barbers { max-width: 34rem; }
.landing-footer { border-top: 1px solid var(--color-line); padding: var(--space-5) 0 var(--space-4); color: var(--color-muted); font-size: var(--text-sm); max-width: 44rem; }

@media (min-width: 720px) {
  .map-placeholder { height: 30rem; }
  .hero { padding-top: var(--space-7); }
  .hero-motif { width: 26rem; top: 0; right: -2rem; }
  .search-actions { display: flex; }
  .shops { grid-template-columns: repeat(2, 1fr); }
  .why-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1000px) {
  .why-grid { grid-template-columns: repeat(4, 1fr); }
  .shops { grid-template-columns: repeat(3, 1fr); }
}
</style>
