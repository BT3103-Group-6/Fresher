<script setup>
// UI-O2 (A19): barber comparison table, sortable by any column. Sort state is announced through aria-sort.
import { computed, ref } from 'vue'
import { formatMoney, formatPercent } from '@/lib/dashboard'
import { sortRows } from '@/lib/dashboardCharts'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  totals: { type: Object, default: null },
})

const COLUMNS = [
  { key: 'name', label: 'Barber' },
  { key: 'completed', label: 'Completed', numeric: true },
  { key: 'valueCents', label: 'Booked value', numeric: true },
  { key: 'noShowRate', label: 'No-show rate', numeric: true },
  { key: 'utilisation', label: 'Utilisation', numeric: true },
]
const sortKey = ref('completed')
const direction = ref('desc')
const sorted = computed(() => sortRows(props.rows, sortKey.value, direction.value))

function sortBy(key) {
  if (sortKey.value === key) direction.value = direction.value === 'asc' ? 'desc' : 'asc'
  else { sortKey.value = key; direction.value = key === 'name' ? 'asc' : 'desc' }
}
const ariaSort = (key) => (sortKey.value === key ? (direction.value === 'asc' ? 'ascending' : 'descending') : 'none')
</script>

<template>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Barber comparison table">
    <table>
      <caption class="sr-only">Barber comparison. Column headings are buttons that sort the table.</caption>
      <thead>
        <tr>
          <th v-for="c in COLUMNS" :key="c.key" scope="col" :class="{ num: c.numeric }" :aria-sort="ariaSort(c.key)">
            <button type="button" class="sort" @click="sortBy(c.key)">
              {{ c.label }}
              <span v-if="sortKey === c.key" aria-hidden="true" class="dir">{{ direction === 'asc' ? '▲' : '▼' }}</span>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.id">
          <th scope="row">{{ r.name }}</th>
          <td class="num">{{ r.completed }}</td>
          <td class="num">{{ formatMoney(r.valueCents) }}</td>
          <td class="num">{{ formatPercent(r.noShowRate) }}<span v-if="r.noShows" class="muted"> ({{ r.noShows }})</span></td>
          <td class="num">{{ formatPercent(r.utilisation) }}</td>
        </tr>
      </tbody>
      <tfoot v-if="totals && rows.length">
        <tr>
          <th scope="row">All barbers</th>
          <td class="num">{{ totals.completed }}</td>
          <td class="num">{{ formatMoney(totals.valueCents) }}</td>
          <td class="num">{{ formatPercent(totals.noShowRate) }}<span v-if="totals.noShows" class="muted"> ({{ totals.noShows }})</span></td>
          <td class="num">{{ formatPercent(totals.utilisation) }}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
.table-wrap { overflow-x: auto; border: 1px solid var(--color-line); border-radius: var(--radius-md); }
table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
th, td { padding: var(--space-3); text-align: left; border-bottom: 1px solid var(--color-line); white-space: nowrap; }
thead th { background: var(--color-neutral-bg); padding: 0; }
.sort {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: var(--space-1); width: 100%; min-height: var(--tap-target);
  padding: 0 var(--space-3); font-weight: 700; cursor: pointer; color: var(--color-text);
}
.num .sort { justify-content: flex-end; }
.sort:hover { background: var(--color-tint); }
.sort:focus-visible { outline: 3px solid var(--color-focus); outline-offset: -3px; }
.dir { font-size: 0.7em; }
tbody th { font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.muted { color: var(--color-muted); }
tbody tr:hover > * { background: var(--color-tint); }
tfoot th, tfoot td { font-weight: 800; background: var(--color-background); border-bottom: 0; border-top: 2px solid var(--color-line); }
tbody tr:last-child > * { border-bottom: 0; }
@media (max-width: 480px) {
  table { font-size: var(--text-xs); }
  th, td { padding: var(--space-2) 0.1rem; }
  th { white-space: normal; }
  td.num { white-space: nowrap; }
  .sort { gap: 0.1rem; padding: 0 0.1rem; text-align: inherit; min-height: var(--tap-target); }
  .num .sort { justify-content: flex-end; text-align: right; }
}
</style>
