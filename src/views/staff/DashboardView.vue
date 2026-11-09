<script setup>
// UI-O2 Shop dashboard (FR-14, decisions A7, redesign A19). Owner only. One live dailyStats range query covers the
// chosen range and the previous period of the same length (for the trend figures); rates, utilisation, trends and
// chart series are worked out here. Open time for utilisation comes from current working hours and blocks
// (limitation L19). Only bookings staff marked finished or no-show count. Chart.js loads with the first chart.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Timestamp, collection, doc, documentId, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { session } from '@/stores/session'
import { DAY_MS, sgTimeToMs } from '@/lib/slots'
import { MAX_RANGE_DAYS, dayKeys, inputToKey, presetRange, validateRange } from '@/lib/dashboard'
import { barberTable, buildAnalytics, dailyTable, previousKeys, weekdayTable } from '@/lib/dashboardCharts'
import { barberChartConfig, dailyChartConfig, describeBarber, describeDaily, describeWeekday, weekdayChartConfig } from '@/lib/chartConfigs'
import '@/components/dashboard/dashboard.css'
import KpiCard from '@/components/dashboard/KpiCard.vue'
import ChartCard from '@/components/dashboard/ChartCard.vue'
import BaseChart from '@/components/dashboard/BaseChart.vue'
import BarberTable from '@/components/dashboard/BarberTable.vue'

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
const analytics = computed(() => (ready.value
  ? buildAnalytics({ barbers: barbers.value, stats: stats.value, blocks: blocks.value, shopHours: shopHours.value, keys: keys.value, now: now.value })
  : null))
const KPI_LABELS = [
  { id: 'completed', label: 'Completed bookings' }, { id: 'value', label: 'Booked value' },
  { id: 'noShow', label: 'No-show rate' }, { id: 'utilisation', label: 'Utilisation' },
]
const kpiFor = (id) => analytics.value?.kpis.find((k) => k.id === id) || null
const EMPTY = 'No bookings in this period.'

// Chart configs are functions of the palette, which BaseChart reads from the design tokens when it draws.
const dailyConfig = computed(() => (analytics.value ? (p) => dailyChartConfig(analytics.value.daily, p) : null))
const barberConfig = computed(() => (analytics.value ? (p) => barberChartConfig(analytics.value.barberBars, p) : null))
const weekdayConfig = computed(() => (analytics.value ? (p) => weekdayChartConfig(analytics.value.weekdays, p) : null))
const barberHeight = computed(() => `${Math.max(8, (analytics.value?.barberBars.length || 0) * 3 + 5)}rem`)

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
  const prevFromKey = previousKeys(dayKeys(fromKey, toKey))[0] // the previous period starts here (same number of days)
  const onError = () => { if (mine === token) loadError.value = 'Could not load the dashboard. Check your connection and try again.' }
  // The daily docs are keyed yyyymmdd, so one document-ID range query returns exactly the days chosen plus the
  // same number of days before them (the previous period, A19).
  unsub = onSnapshot(
    query(collection(db, `shops/${shopId}/dailyStats`), where(documentId(), '>=', prevFromKey), where(documentId(), '<=', toKey)),
    (snap) => { if (mine === token) { stats.value = snap.docs.map((d) => ({ id: d.id, ...d.data() })); loaded.stats = true; loadError.value = '' } },
    onError,
  )
  try {
    const start = Timestamp.fromMillis(sgTimeToMs(prevFromKey, '00:00'))
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
</script>

<template>
  <main class="dashboard">
    <header class="head">
      <div class="title">
        <h1>Shop dashboard</h1>
        <p class="lede">How the shop is doing over the days you choose.</p>
      </div>
      <form class="controls" novalidate aria-label="Date range" @submit.prevent>
        <div class="presets" role="group" aria-label="Quick range">
          <button v-for="p in PRESETS" :key="p.name" class="chip" type="button" :aria-pressed="activePreset(p.name)" @click="applyPreset(p.name)">{{ p.label }}</button>
        </div>
        <div class="dates">
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
      </form>
    </header>
    <p class="hint range-note">
      Days are Singapore dates, counted by appointment start time. Up to {{ MAX_RANGE_DAYS }} days.
      <template v-if="valid">Trends compare with the {{ keys.length === 1 ? 'previous day' : `previous ${keys.length} days` }}.</template>
    </p>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Figures update when you reconnect.</p>

    <section v-if="loadError" class="card error-panel" role="alert" aria-labelledby="err-h">
      <h2 id="err-h">The dashboard could not load</h2>
      <p>{{ loadError }}</p>
      <button class="btn" type="button" @click="load">Try again</button>
    </section>

    <p v-else-if="!valid" class="banner info" role="status">Fix the date range above to see the figures.</p>

    <template v-else>
      <p v-if="analytics && analytics.empty" class="banner info" role="status">
        No completed or no-show bookings in this period. Bookings appear here once staff mark them finished or no-show.
      </p>

      <h2 class="sr-only">Summary</h2>
      <div class="kpis">
        <KpiCard v-for="k in KPI_LABELS" :key="k.id" :label="k.label" :kpi="kpiFor(k.id)" />
      </div>

      <div class="grid">
        <ChartCard
          class="span-12"
          title="Bookings per day"
          :loading="!analytics"
          :empty="analytics && analytics.empty ? EMPTY : ''"
          :summary="analytics ? analytics.dailySummary : ''"
          :table="analytics ? dailyTable(analytics.daily) : null"
          height="20rem"
        >
          <BaseChart v-if="analytics" :make-config="dailyConfig" :label="analytics.dailySummary" :describe="describeDaily(analytics.daily)" :keyboard-datasets="[0, 1, 3]" height="20rem" />
        </ChartCard>

        <ChartCard
          class="span-7"
          title="Utilisation per barber"
          :loading="!analytics"
          :empty="analytics && (analytics.empty ? EMPTY : !analytics.barberBars.length ? analytics.barberSummary : '')"
          :summary="analytics ? analytics.barberSummary : ''"
          :table="analytics ? barberTable(analytics.barberBars) : null"
          :height="barberHeight"
        >
          <BaseChart v-if="analytics" :make-config="barberConfig" :label="analytics.barberSummary" :describe="describeBarber(analytics.barberBars)" :height="barberHeight" />
        </ChartCard>

        <ChartCard
          class="span-5"
          title="Busiest days of the week"
          :loading="!analytics"
          :empty="analytics && analytics.empty ? EMPTY : ''"
          :summary="analytics ? analytics.weekdaySummary : ''"
          :table="analytics ? weekdayTable(analytics.weekdays) : null"
          :height="barberHeight"
        >
          <BaseChart v-if="analytics" :make-config="weekdayConfig" :label="analytics.weekdaySummary" :describe="describeWeekday(analytics.weekdays)" :height="barberHeight" />
        </ChartCard>

        <section class="card span-12 compare" aria-labelledby="cmp-h">
          <h2 id="cmp-h">Barber comparison</h2>
          <span v-if="!analytics" class="skeleton table-skel" aria-hidden="true"></span>
          <p v-else-if="!analytics.rows.length" class="hint">This shop has no barbers yet. Add one in Shop configuration.</p>
          <BarberTable v-else :rows="analytics.rows" :totals="analytics.totals" />
        </section>
      </div>

      <p class="hint notes">
        Booked value counts completed bookings only. No-show rate is no-shows out of completed plus no-shows (a barber's no-show count is in brackets).
        Utilisation is completed minutes out of open minutes so far, using each barber's current working hours and blocks. Busiest days averages completed bookings per day of that name in the range.
      </p>
    </template>
  </main>
</template>

<style scoped>
.dashboard { padding-bottom: var(--space-6); }
.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: var(--space-5) var(--space-6); margin-bottom: var(--space-3); }
.title h1 { font-size: clamp(1.7rem, 4vw, 2.4rem); line-height: 1.1; letter-spacing: -0.03em; margin-bottom: var(--space-2); }
.lede { color: var(--color-muted); margin: 0; }
.controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3) var(--space-5); }
.presets { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-bottom: var(--space-3); }
.dates { display: flex; gap: var(--space-3); }
.dates .field { margin-bottom: var(--space-3); }
.range-note { margin: 0 0 var(--space-5); }
.dashboard .banner { margin-bottom: var(--space-4); }

/* Selected preset: teal border + tint + check mark + bold, so colour is never the only cue */
.chip {
  font: inherit; font-weight: 600; font-size: var(--text-sm); min-height: 44px; padding: 0 var(--space-4);
  border: 2px solid var(--color-line); border-radius: var(--radius-pill); background: var(--color-surface); color: var(--color-text); cursor: pointer;
}
.chip:hover { border-color: var(--color-field-border); background: var(--color-tint); }
.chip[aria-pressed='true'] { border-color: var(--color-accent); background: var(--color-tint); color: var(--color-accent-dark); font-weight: 800; }
.chip[aria-pressed='true']::before { content: '\2713\00a0'; }

.kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin-bottom: var(--space-4); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); margin-bottom: var(--space-5); }
.compare { margin: 0; padding: var(--space-5); min-width: 0; }
.compare h2 { font-size: var(--text-lg); margin-bottom: var(--space-4); }
.table-skel { height: 9rem; }
.error-panel { padding: var(--space-5); border-color: var(--color-danger-fg); }
.error-panel h2 { font-size: var(--text-lg); margin-bottom: var(--space-2); color: var(--color-danger-fg); }
.notes { max-width: 52rem; }

@media (max-width: 480px) {
  .dates { width: 100%; }
  .dates .field { flex: 1; min-width: 0; }
  .compare { padding: var(--space-3); }
  .presets { padding-bottom: 0; }
}
@media (min-width: 720px) {
  .kpis { gap: var(--space-4); }
}
@media (min-width: 1000px) {
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .span-12 { grid-column: span 12; }
  .span-7 { grid-column: span 7; }
  .span-5 { grid-column: span 5; }
}
</style>
