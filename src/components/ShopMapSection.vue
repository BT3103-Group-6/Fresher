<script setup>
// Landing page map (decisions A20), loaded by DiscoverView only after its placeholder scrolls into view. One
// cached read of the verified shops feeds a Google map (clustered leaf pins, a shop card) and a "View as list"
// alternative grouped by region. The Google script loads here, in parallel with the shop read; with no key, a
// rejected key or no network the list still works.
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { serviceTypeLabel } from '@/lib/serviceTypes'
import { groupByRegion, mapSummary, matchSet, pinsOf } from '@/lib/shopMap'
import { loadMapShops } from '@/lib/shopMapData'

const props = defineProps({
  // The shops the current search matches (ids), or null when nothing was searched.
  matchIds: { type: Array, default: null },
  // The searched point [lat, lng], or null.
  center: { type: Array, default: null },
  // Element id to move focus to when someone skips past the map.
  skipTarget: { type: String, default: '' },
})
const emit = defineEmits(['ready'])

const shops = ref([])
const dataState = ref('loading') // 'loading' | 'ready' | 'error'
const mapState = ref('loading') // 'loading' | 'ready' | 'error' | 'nokey'
const view = ref('map') // 'map' | 'list'
const selectedId = ref(null)
const showPrices = ref(false)

const mapEl = ref(null)
const cardEl = ref(null)
const ctrl = shallowRef(null)
let gmaps = null
let stopAuthWatch = null
let building = false

const matches = computed(() => matchSet(props.matchIds !== null, props.matchIds))
const groups = computed(() => groupByRegion(shops.value))
const pins = computed(() => pinsOf(shops.value))
const summary = computed(() => mapSummary(shops.value))
const mapUsable = computed(() => mapState.value !== 'error' && mapState.value !== 'nokey')
const selected = computed(() => shops.value.find((s) => s.id === selectedId.value) ?? null)

async function loadShops() {
  dataState.value = 'loading'
  try {
    shops.value = await loadMapShops()
    dataState.value = 'ready'
  } catch {
    dataState.value = 'error'
  }
}

async function loadMap() {
  mapState.value = 'loading'
  try {
    const mod = await import('@/lib/googleMap')
    if (!mod.hasMapsKey()) {
      mapState.value = 'nokey'
      view.value = 'list' // the list needs no map
      return
    }
    stopAuthWatch = mod.onAuthFailure(() => { // Google rejected the key
      ctrl.value?.destroy()
      ctrl.value = null
      mapState.value = 'error'
      view.value = 'list'
    })
    gmaps = await mod.loadGoogleMaps()
    mapState.value = 'ready'
  } catch {
    mapState.value = 'error'
    view.value = 'list'
  }
}

function retry() {
  if (dataState.value === 'error') loadShops()
  if (mapState.value === 'error') { view.value = 'map'; loadMap() }
}

// Builds the map once the Google script, the shops and a visible container all exist.
async function build() {
  if (building || ctrl.value || !gmaps || dataState.value !== 'ready' || view.value !== 'map' || !mapEl.value) return
  building = true
  try {
    const { createShopMap } = await import('@/lib/googleMap')
    ctrl.value = await createShopMap(gmaps, mapEl.value, { onSelect: (id) => open(id) })
    ctrl.value.setPins(pins.value, matches.value, showPrices.value)
    ctrl.value.fitPins(pins.value)
    if (props.center) ctrl.value.setSearch(props.center)
  } catch {
    ctrl.value?.destroy()
    ctrl.value = null
    mapState.value = 'error'
    view.value = 'list'
    return
  } finally {
    building = false
  }
}

watch([() => mapState.value, () => dataState.value], build)
watch(view, async (v) => {
  if (v !== 'map') return
  await nextTick()
  if (ctrl.value) ctrl.value.invalidate()
  else build()
})
watch(matches, (m) => ctrl.value?.setPins(pins.value, m, showPrices.value))
watch(showPrices, (on) => ctrl.value?.setPins(pins.value, matches.value, on))
watch(() => props.center, (c) => ctrl.value?.setSearch(c))

async function open(id) {
  selectedId.value = id
  ctrl.value?.select(id)
  await nextTick()
  cardEl.value?.focus()
}
function close() {
  const id = selectedId.value
  selectedId.value = null
  ctrl.value?.select(null)
  if (id) ctrl.value?.focusPin(id)
}

function skip() {
  const target = props.skipTarget && document.getElementById(props.skipTarget)
  if (!target) return
  target.tabIndex = -1
  target.focus()
}

onMounted(() => {
  emit('ready')
  loadShops()
  loadMap()
})
onUnmounted(() => {
  stopAuthWatch?.()
  ctrl.value?.destroy()
})
</script>

<template>
  <div class="shop-map">
    <div class="map-bar">
      <p class="hint map-summary" role="status">
        <template v-if="dataState === 'ready'">{{ summary }}</template>
        <template v-else-if="dataState === 'loading'">Loading shops…</template>
      </p>
      <div class="map-actions">
        <button type="button" class="btn secondary list-toggle" :aria-pressed="showPrices" :disabled="dataState !== 'ready' || !mapUsable || view === 'list'" @click="showPrices = !showPrices">
          Show prices
        </button>
        <button type="button" class="btn secondary list-toggle" :aria-pressed="view === 'list'" :disabled="dataState !== 'ready' || !mapUsable" @click="view = view === 'list' ? 'map' : 'list'">
          View as list
        </button>
      </div>
    </div>

    <p v-if="dataState === 'error'" class="banner" role="alert">
      Could not load the shops. Check your connection.
      <button type="button" class="link-btn" @click="retry">Try again</button>
    </p>
    <p v-else-if="mapState === 'error'" class="banner" role="alert">
      The map could not be loaded, so the shops are shown as a list.
      <button type="button" class="link-btn" @click="retry">Try the map again</button>
    </p>
    <p v-else-if="mapState === 'nokey'" class="banner info" role="status">
      The map is not set up in this build, so the shops are shown as a list.
    </p>

    <div v-show="view === 'map' && dataState !== 'error' && mapUsable" class="map-stage">
      <button type="button" class="skip" @click="skip">Skip the map</button>
      <p id="shop-map-help" class="sr-only">
        Map of barber shops. Tab moves between shop pins and clusters, Enter or Space opens one, arrow keys move the map and plus and minus zoom. The mouse wheel scrolls the page; hold Control or Command to zoom.
        "View as list" shows the same shops as a list.
      </p>
      <div class="map-wrap">
        <div ref="mapEl" class="map-canvas" role="region" aria-label="Map of verified barber shops in Singapore" aria-describedby="shop-map-help"></div>
        <p v-if="mapState === 'loading' || dataState === 'loading'" class="map-loading" role="status">Loading map…</p>

        <div v-if="selected" ref="cardEl" class="shop-card card" tabindex="-1" role="region" aria-label="Selected shop" @keydown.esc="close">
          <button type="button" class="card-close" aria-label="Close shop card" @click="close">&times;</button>
          <h3>{{ selected.name }}</h3>
          <p v-if="selected.area" class="hint">{{ selected.area }}</p>
          <p class="price"><span class="hint">Price</span> {{ selected.priceText }}</p>
          <p v-if="selected.serviceTypes.length" class="tags">
            <span v-for="t in selected.serviceTypes" :key="t" class="badge">{{ serviceTypeLabel(t) }}</span>
          </p>
          <p v-if="matches?.has(selected.id)" class="match-note">Matches your search</p>
          <RouterLink class="btn" :to="{ name: 'book', params: { shopId: selected.id } }">View shop</RouterLink>
        </div>
      </div>
    </div>

    <div v-if="view === 'list' && dataState === 'ready'" class="region-list">
      <section v-for="g in groups" :key="g.key" :aria-labelledby="`region-${g.key}`" class="region">
        <h3 :id="`region-${g.key}`">{{ g.label }} <span class="count">{{ g.count }} {{ g.count === 1 ? 'shop' : 'shops' }}</span></h3>
        <ul v-if="g.count">
          <li v-for="s in g.shops" :key="s.id">
            <RouterLink :to="{ name: 'book', params: { shopId: s.id } }">{{ s.name }}</RouterLink>
            <span class="hint"> {{ [s.area, s.priceText].filter(Boolean).join(' · ') }}</span>
            <span v-if="matches?.has(s.id)" class="badge">Near your search</span>
          </li>
        </ul>
        <p v-else class="hint">No shops yet.</p>
      </section>
    </div>
  </div>
</template>

<style>
.shop-map { --map-height: 22rem; }
.shop-map .map-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); flex-wrap: wrap; }
.shop-map .map-summary { margin: 0; }
.shop-map .map-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.shop-map .list-toggle[aria-pressed='true'] { background: var(--color-accent); color: var(--color-surface); }
.shop-map .link-btn { font: inherit; color: var(--color-accent); background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; min-height: 44px; }
.shop-map .banner { margin-bottom: var(--space-3); }

.shop-map .skip { position: absolute; left: -9999px; }
.shop-map .skip:focus { position: static; display: inline-block; margin-bottom: var(--space-2); font: inherit; padding: var(--space-2) var(--space-3); background: var(--color-surface); border: 2px solid var(--color-focus); border-radius: var(--radius-sm); }

.shop-map .map-wrap { position: relative; height: var(--map-height); max-height: 80vh; border: 1px solid var(--color-line); border-radius: var(--radius-md); overflow: hidden; background: var(--color-tint); }
.shop-map .map-canvas { position: absolute; inset: 0; z-index: 0; font: inherit; background: var(--color-tint); }
.shop-map .map-canvas:focus-visible { outline: 3px solid var(--color-focus); outline-offset: -3px; }
.shop-map .map-loading { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--color-muted); pointer-events: none; z-index: 1; }

/* Pins (Advanced Markers: the marker element gets the focus, its content is drawn here) */
.shop-map .shop-pin { position: relative; cursor: pointer; }
.shop-map .shop-pin svg { display: block; overflow: visible; transform-origin: 50% 100%; transition: transform 0.12s; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35)); }
.shop-map .pin-body { fill: var(--color-accent); stroke: #fff; stroke-width: 1.5; }
.shop-map .pin-scissors { stroke: #fff; stroke-width: 1.7; stroke-linecap: round; fill: none; }
.shop-map .shop-pin.is-match svg, .shop-map .shop-pin:hover svg, .shop-map gmp-advanced-marker:focus .shop-pin svg { transform: scale(1.25); }
.shop-map .shop-pin.is-match .pin-body { fill: var(--color-accent-dark); }
/* Selected: bigger, darker, thicker white outline and always labelled, so it never relies on colour alone. */
.shop-map .shop-pin.is-selected svg { transform: scale(1.5); }
.shop-map .shop-pin.is-selected .pin-body { fill: var(--color-accent-dark); stroke-width: 2.6; }
/* Price pills */
.shop-map .shop-pin-price { display: block; min-width: 2.6rem; padding: 3px 9px; border-radius: var(--radius-pill); background: var(--color-accent); color: #fff; border: 2px solid #fff; font-size: 0.8rem; font-weight: 700; line-height: 1.2; text-align: center; white-space: nowrap; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); transform-origin: 50% 100%; transition: transform 0.12s; }
.shop-map .shop-pin.is-price .shop-pin-label { left: 50%; top: -1.75rem; transform: translateX(-50%); }
.shop-map .shop-pin.is-price.is-match .shop-pin-price, .shop-map .shop-pin.is-price:hover .shop-pin-price, .shop-map gmp-advanced-marker:focus .shop-pin.is-price .shop-pin-price { transform: scale(1.15); }
.shop-map .shop-pin.is-price.is-match .shop-pin-price { background: var(--color-accent-dark); }
.shop-map .shop-pin.is-price.is-selected .shop-pin-price { transform: scale(1.4); background: var(--color-accent-dark); border-width: 3px; }
.shop-map .shop-pin.is-price.is-dim .shop-pin-price { background: var(--color-tint-strong); color: var(--color-text); }
.shop-map .shop-pin.is-dim svg { opacity: 0.55; }
.shop-map gmp-advanced-marker:focus { outline: none; }
.shop-map gmp-advanced-marker:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; border-radius: 10px; box-shadow: 0 0 0 5px #fff; z-index: 10000; }
.shop-map .shop-pin-label {
  position: absolute; left: 32px; top: 4px; padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--color-line);
  background: var(--color-surface); color: var(--color-text); font-size: 0.75rem; font-weight: 600; line-height: 1.25; white-space: nowrap;
  opacity: 0; pointer-events: none;
}
.shop-map .show-labels .shop-pin-label, .shop-map .shop-pin:hover .shop-pin-label, .shop-map gmp-advanced-marker:focus .shop-pin-label, .shop-map .shop-pin.is-selected .shop-pin-label { opacity: 1; }

/* Clusters */
.shop-map .shop-cluster { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--color-accent); color: #fff; font-weight: 700; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); cursor: pointer; }
.shop-map .shop-cluster.has-match { background: var(--color-accent-dark); box-shadow: 0 0 0 3px var(--color-accent-dark), 0 1px 4px rgba(0, 0, 0, 0.4); }
.shop-map .shop-cluster.is-dim { background: var(--color-tint-strong); color: var(--color-text); }

/* Shop card: bottom sheet on phones, corner card on wider screens */
.shop-map .shop-card { position: absolute; z-index: 1000; left: var(--space-3); right: var(--space-3); bottom: var(--space-3); margin: 0; padding: var(--space-3) var(--space-4); box-shadow: var(--shadow-raised); max-height: calc(100% - 1.5rem); overflow: auto; }
.shop-map .shop-card:focus { outline: 3px solid var(--color-focus); outline-offset: 2px; }
.shop-map .shop-card h3 { font-size: 1.05rem; margin: 0 2rem var(--space-1) 0; }
.shop-map .shop-card p { margin: 0 0 var(--space-2); }
.shop-map .card-close { position: absolute; top: var(--space-1); right: var(--space-1); width: 44px; height: 44px; font-size: 1.6rem; line-height: 1; background: none; border: 0; color: var(--color-text); cursor: pointer; border-radius: var(--radius-sm); }
.shop-map .card-close:focus-visible { outline: 3px solid var(--color-focus); outline-offset: -3px; }
.shop-map .match-note { font-weight: 600; color: var(--color-accent); }

/* List view */
.shop-map .region-list { display: grid; gap: var(--space-4); }
.shop-map .region h3 { font-size: 1.05rem; margin-bottom: var(--space-2); }
.shop-map .region .count { font-weight: 400; color: var(--color-muted); font-size: var(--text-sm); margin-left: var(--space-2); }
.shop-map .region ul { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-2); }
.shop-map .region li .badge { margin-left: var(--space-2); }

@media (min-width: 720px) {
  .shop-map { --map-height: 30rem; }
  .shop-map .shop-card { right: auto; width: 20rem; }
  .shop-map .region-list { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1000px) {
  .shop-map .region-list { grid-template-columns: repeat(3, 1fr); }
}
</style>
