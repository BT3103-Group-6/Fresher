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
  <main>
    <h1>Shop dashboard</h1>

    <p v-if="!online" class="banner" role="alert">You appear to be offline. Figures update when you reconnect.</p>
    <p v-if="loadError" class="banner" role="alert">
      {{ loadError }}
      <button class="btn secondary" type="button" @click="load">Try again</button>
    </p>

    <form class="range" novalidate aria-label="Date range" @submit.prevent>
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
      <div class="row-actions">
        <button class="btn secondary" type="button" @click="applyPreset('last7')">Last 7 days</button>
        <button class="btn secondary" type="button" @click="applyPreset('last30')">Last 30 days</button>
        <button class="btn secondary" type="button" @click="applyPreset('month')">This month</button>
      </div>
      <p class="hint">Days are Singapore dates, counted by appointment start time. Up to {{ MAX_RANGE_DAYS }} days.</p>
    </form>

    <section aria-labelledby="sum-h">
      <h2 id="sum-h">Summary</h2>
      <p v-if="valid && !ready && !loadError" class="hint" role="status">Loading…</p>
      <dl class="tiles">
        <div v-for="t in tiles" :key="t.label" class="tile">
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
      <h2 id="barber-h">By barber</h2>
      <p v-if="!dashboard.rows.length" class="hint">This shop has no barbers yet. Add one in Shop configuration.</p>
      <table v-else class="stat-table">
        <thead>
          <tr>
            <th scope="col">Barber</th>
            <th scope="col">Completed</th>
            <th scope="col">Booked value</th>
            <th scope="col">No-show rate</th>
            <th scope="col">Utilisation</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in dashboard.rows" :key="r.id">
            <th scope="row">{{ r.name }}</th>
            <td data-label="Completed">{{ r.completed }}</td>
            <td data-label="Booked value">{{ formatMoney(r.valueCents) }}</td>
            <td data-label="No-show rate">{{ formatPercent(r.noShowRate) }}<span v-if="r.noShows" class="hint"> ({{ r.noShows }} no-show{{ r.noShows === 1 ? '' : 's' }})</span></td>
            <td data-label="Utilisation">{{ formatPercent(r.utilisation) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
