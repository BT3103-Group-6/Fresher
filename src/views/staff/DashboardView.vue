<script setup>
// UI-O2 Shop dashboard (FR-14, decisions A7). Owner only. Reads one dailyStats doc per day in the chosen
// range (a single range query, live) and works out the rates here. Open time for utilisation comes from
// current working hours and blocks (limitation L19). Only bookings staff marked finished or no-show count.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Timestamp, collection, doc, documentId, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { session } from '@/stores/session'
import { DAY_MS, sgTimeToMs } from '@/lib/slots'
import {
  MAX_RANGE_DAYS, buildDashboard, dayKeys, formatMoney, formatPercent, inputToKey, presetRange, validateRange,
} from '@/lib/dashboard'

const shopId = session.claims.shopId
const initial = presetRange('last30')
const from = ref(initial.from)
const to = ref(initial.to)
const errors = computed(() => validateRange(from.value, to.value))
const valid = computed(() => Object.keys(errors.value).length === 0)

const stats = ref([])
const barbers = ref([])
const blocks = ref([])
const shopHours = ref(null)
const loaded = reactive({ stats: false, other: false })
const loadError = ref('')
const online = ref(navigator.onLine)
const now = ref(Date.now())

const keys = computed(() => (valid.value ? dayKeys(inputToKey(from.value), inputToKey(to.value)) : []))
const ready = computed(() => valid.value && loaded.stats && loaded.other)
const dashboard = computed(() => (ready.value
  ? buildDashboard({ barbers: barbers.value, stats: stats.value, blocks: blocks.value, shopHours: shopHours.value, keys: keys.value, now: now.value })
  : null))

let unsub = null
let token = 0 // ignores answers for a range the owner has already moved away from
const stop = () => { unsub?.(); unsub = null }

async function load() {
  stop()
  loaded.stats = false
  loaded.other = false
  loadError.value = ''
  if (!valid.value) return
  const mine = ++token
  const fromKey = inputToKey(from.value)
  const toKey = inputToKey(to.value)
  const onError = () => { if (mine === token) loadError.value = 'Could not load the dashboard. Check your connection and try again.' }
  // The daily docs are keyed yyyymmdd, so one document-ID range query returns exactly the days chosen.
  unsub = onSnapshot(
    query(collection(db, `shops/${shopId}/dailyStats`), where(documentId(), '>=', fromKey), where(documentId(), '<=', toKey)),
    (snap) => { if (mine === token) { stats.value = snap.docs.map((d) => d.data()); loaded.stats = true; loadError.value = '' } },
    onError,
  )
  try {
    const start = Timestamp.fromMillis(sgTimeToMs(fromKey, '00:00'))
    const end = Timestamp.fromMillis(sgTimeToMs(toKey, '00:00') + DAY_MS)
    const [b, bl, shop] = await Promise.all([
      getDocs(collection(db, `shops/${shopId}/barbers`)),
      getDocs(query(collection(db, `shops/${shopId}/blocks`), where('start', '>=', start), where('start', '<', end))),
      getDoc(doc(db, `shops/${shopId}`)),
    ])
    if (mine !== token) return
    barbers.value = b.docs.map((d) => ({ id: d.id, ...d.data() }))
    blocks.value = bl.docs.map((d) => ({ barberId: d.data().barberId, start: d.data().start.toMillis(), end: d.data().end.toMillis() }))
    shopHours.value = shop.data()?.openingHours ?? null
    loaded.other = true
  } catch {
    onError()
  }
}
watch([from, to], load)

let ticker
const setOnline = () => { online.value = navigator.onLine }
onMounted(() => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOnline)
  ticker = setInterval(() => { now.value = Date.now() }, 60000)
  load()
})
onUnmounted(() => {
  clearInterval(ticker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOnline)
  token++
  stop()
})

const applyPreset = (name) => { ({ from: from.value, to: to.value } = presetRange(name)) }
// A preset chip shows as selected while the chosen range equals it (display only).
const PRESETS = [{ name: 'last7', label: 'Last 7 days' }, { name: 'last30', label: 'Last 30 days' }, { name: 'month', label: 'This month' }]
const activePreset = (name) => { const r = presetRange(name); return r.from === from.value && r.to === to.value }
const tiles = computed(() => {
  const t = dashboard.value?.totals
  return [
    { label: 'Completed bookings', value: t ? String(t.completed) : '…' },
    { label: 'Booked value', value: t ? formatMoney(t.valueCents) : '…' },
    { label: 'No-show rate', value: t ? formatPercent(t.noShowRate) : '…' },
    { label: 'Utilisation', value: t ? formatPercent(t.utilisation) : '…' },
  ]
})
</script>

<template>
  <main class="dashboard">
    <header class="page-head">
      <h1>Shop dashboard</h1>
      <p class="lede">How the shop is doing over the days you choose.</p>
    </header>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Figures update when you reconnect.</p>
    <p v-if="loadError" class="banner" role="alert">
      {{ loadError }}
      <button class="btn secondary" type="button" @click="load">Try again</button>
    </p>

    <form class="range card" novalidate aria-label="Date range" @submit.prevent>
      <fieldset class="presets">
        <legend>Quick range</legend>
        <div class="row-actions">
          <button v-for="p in PRESETS" :key="p.name" class="chip" type="button" :aria-pressed="activePreset(p.name)" @click="applyPreset(p.name)">{{ p.label }}</button>
        </div>
      </fieldset>
      <div class="form-grid">
        <div class="field">
          <label for="from">From</label>
          <input id="from" v-model="from" type="date" :aria-invalid="!!errors.from" :aria-describedby="errors.from ? 'from-err' : undefined" />
          <span v-if="errors.from" id="from-err" class="error">{{ errors.from }}</span>
        </div>
        <div class="field">
          <label for="to">To</label>
          <input id="to" v-model="to" type="date" :aria-invalid="!!errors.to" :aria-describedby="errors.to ? 'to-err' : undefined" />
          <span v-if="errors.to" id="to-err" class="error">{{ errors.to }}</span>
        </div>
      </div>
      <p class="hint">Days are Singapore dates, counted by appointment start time. Up to {{ MAX_RANGE_DAYS }} days.</p>
    </form>

    <section aria-labelledby="sum-h">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="sum-h">Summary</h2>
      <p v-if="valid && !ready && !loadError" class="hint" role="status">Loading…</p>
      <dl class="tiles">
        <div v-for="t in tiles" :key="t.label" class="tile card">
          <dt>{{ t.label }}</dt>
          <dd>{{ t.value }}</dd>
        </div>
      </dl>
      <p v-if="dashboard && dashboard.empty" class="banner info" role="status">
        No completed or no-show bookings in this period. Bookings appear here once staff mark them finished or no-show.
      </p>
      <p class="hint">
        Booked value counts completed bookings only. No-show rate is no-shows out of completed plus no-shows.
        Utilisation is completed minutes out of open minutes so far, using each barber's current working hours and blocks.
      </p>
    </section>

    <section v-if="dashboard" aria-labelledby="barber-h">
      <div class="comb-rule" aria-hidden="true"></div>
      <h2 id="barber-h">By barber</h2>
      <p v-if="!dashboard.rows.length" class="hint">This shop has no barbers yet. Add one in Shop configuration.</p>
      <ul v-else class="barber-cards">
        <li v-for="r in dashboard.rows" :key="r.id" class="card barber-card">
          <h3>{{ r.name }}</h3>
          <dl class="metrics">
            <div><dt>Completed</dt><dd>{{ r.completed }}</dd></div>
            <div><dt>Booked value</dt><dd>{{ formatMoney(r.valueCents) }}</dd></div>
            <div>
              <dt>No-show rate</dt>
              <dd>{{ formatPercent(r.noShowRate) }}<span v-if="r.noShows" class="hint"> ({{ r.noShows }} no-show{{ r.noShows === 1 ? '' : 's' }})</span></dd>
            </div>
            <div><dt>Utilisation</dt><dd>{{ formatPercent(r.utilisation) }}</dd></div>
          </dl>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.dashboard { padding-bottom: var(--space-6); }
.page-head { margin-bottom: clamp(1.5rem, 5vw, 2.5rem); }
.page-head h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.lede { font-size: 1.1rem; color: var(--color-muted); max-width: 36rem; }
.dashboard .banner { margin-bottom: var(--space-4); }
.dashboard .banner .btn { margin-left: var(--space-2); }
.dashboard section { margin-bottom: clamp(2.5rem, 7vw, 4rem); }
.dashboard h2 { font-size: clamp(1.3rem, 3vw, 1.7rem); margin-bottom: var(--space-4); }
.dashboard section > .hint { max-width: 44rem; }

.range { max-width: 40rem; padding: var(--space-5); margin-bottom: clamp(2rem, 6vw, 3.5rem); }
.presets { border: 0; padding: 0; margin: 0 0 var(--space-4); min-width: 0; }
.presets legend { padding: 0; margin-bottom: var(--space-2); }
.range .row-actions { gap: var(--space-2); }
.range .form-grid { grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0 var(--space-3); }
.range .hint { margin: 0; }
/* Selected preset: teal border + tint + check mark + bold, so colour is never the only cue */
.chip {
  font: inherit; font-weight: 600; font-size: var(--text-sm); min-height: 44px; padding: 0 var(--space-4);
  border: 2px solid var(--color-line); border-radius: var(--radius-pill); background: var(--color-surface); color: var(--color-text); cursor: pointer;
}
.chip:hover { border-color: var(--color-field-border); background: var(--color-tint); }
.chip[aria-pressed='true'] { border-color: var(--color-accent); background: var(--color-tint); color: var(--color-accent-dark); font-weight: 800; }
.chip[aria-pressed='true']::before { content: '\2713\00a0'; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: var(--space-4); margin: 0 0 var(--space-5); }
.tile { margin: 0; padding: var(--space-4) var(--space-5); box-shadow: none; }
.tile dt { font-size: var(--text-sm); color: var(--color-muted); font-weight: 600; }
.tile dd { margin: var(--space-1) 0 0; font-size: clamp(1.5rem, 4vw, 2rem); font-weight: 800; letter-spacing: -0.02em; color: var(--color-text); }

.barber-cards { list-style: none; padding: 0; display: grid; gap: var(--space-4); }
.barber-card { margin: 0; padding: var(--space-5); }
.barber-card h3 { font-size: var(--text-lg); margin-bottom: var(--space-4); }
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4) var(--space-5); margin: 0; }
.metrics dt { font-size: var(--text-sm); color: var(--color-muted); font-weight: 600; }
.metrics dd { margin: var(--space-1) 0 0; font-size: var(--text-lg); font-weight: 800; }
.metrics dd .hint { font-weight: 600; }

@media (min-width: 720px) {
  .barber-cards { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1000px) {
  .tiles { grid-template-columns: repeat(4, 1fr); }
}
@media (max-width: 480px) {
  .range { padding: var(--space-4); }
}
</style>
