<script setup>
// UI-O2 (A19): a titled card around one chart: written summary (always visible), "View as table" toggle with the same
// numbers, a loading skeleton and an empty message. The chart goes in the default slot.
import { ref, useId } from 'vue'

defineProps({
  title: { type: String, required: true },
  summary: { type: String, default: '' },
  table: { type: Object, default: null }, // { columns: [{ key, label, numeric }], rows: [{ [key]: text }] }
  loading: { type: Boolean, default: false },
  empty: { type: String, default: '' }, // message shown instead of the chart and table
  height: { type: String, default: '18rem' },
})

const uid = useId()
const asTable = ref(false)
</script>

<template>
  <section class="card chart-card" :aria-labelledby="`${uid}-h`">
    <div class="chart-head">
      <h2 :id="`${uid}-h`">{{ title }}</h2>
      <button
        v-if="table && !loading && !empty"
        class="btn secondary toggle"
        type="button"
        :aria-controls="`${uid}-table`"
        @click="asTable = !asTable"
      >{{ asTable ? 'View as chart' : 'View as table' }}</button>
    </div>

    <template v-if="loading">
      <span class="skeleton line" aria-hidden="true"></span>
      <span class="skeleton body" :style="{ height }" aria-hidden="true"></span>
      <span class="sr-only" role="status">Loading {{ title }}</span>
    </template>
    <p v-else-if="empty" class="empty" role="status">{{ empty }}</p>
    <template v-else>
      <p class="chart-summary">{{ summary }}</p>
      <div v-show="!asTable"><slot /></div>
      <div v-if="table" v-show="asTable" :id="`${uid}-table`" class="table-wrap" tabindex="0" role="region" :aria-label="`${title}, table view`">
        <table>
          <caption class="sr-only">{{ title }}</caption>
          <thead>
            <tr><th v-for="c in table.columns" :key="c.key" scope="col" :class="{ num: c.numeric }">{{ c.label }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in table.rows" :key="i">
              <template v-for="c in table.columns" :key="c.key">
                <th v-if="c === table.columns[0]" scope="row">{{ row[c.key] }}</th>
                <td v-else :class="{ num: c.numeric }">{{ row[c.key] }}</td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.chart-card { margin: 0; padding: var(--space-5); min-width: 0; }
.chart-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); }
.chart-head h2 { font-size: var(--text-lg); margin: 0; padding-top: var(--space-2); }
.toggle { min-height: 40px; padding: 0 var(--space-4); font-size: var(--text-sm); flex: none; }
.chart-summary { font-size: var(--text-sm); color: var(--color-muted); margin: 0 0 var(--space-4); max-width: 60rem; }
.empty { margin: var(--space-4) 0 var(--space-2); padding: var(--space-5) var(--space-4); border: 1px dashed var(--color-field-border); border-radius: var(--radius-md); color: var(--color-muted); text-align: center; }
.line { height: 0.9rem; width: 70%; margin-bottom: var(--space-4); }
.body { width: 100%; }
.table-wrap { max-height: 22rem; overflow: auto; border: 1px solid var(--color-line); border-radius: var(--radius-md); }
table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
th, td { padding: var(--space-2) var(--space-3); text-align: left; border-bottom: 1px solid var(--color-line); white-space: nowrap; }
thead th { position: sticky; top: 0; background: var(--color-neutral-bg); font-weight: 700; }
tbody th { font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr:last-child > * { border-bottom: 0; }
@media (max-width: 480px) {
  .chart-card { padding: var(--space-4); }
}
</style>
