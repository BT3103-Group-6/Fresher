<script setup>
// UI-O2 (A19): one headline figure with its trend against the previous period and a tiny sparkline.
// The trend is an arrow plus words (and spoken direction), never colour alone. The sparkline is decorative.
import { computed } from 'vue'
import { sparklinePath, trendSpeech } from '@/lib/dashboardCharts'

const props = defineProps({
  kpi: { type: Object, default: null }, // { label, value, trend, spark }
  label: { type: String, required: true },
})
const W = 96
const H = 28
const path = computed(() => (props.kpi ? sparklinePath(props.kpi.spark, W, H) : ''))
const speech = computed(() => (props.kpi ? trendSpeech(props.kpi.trend) : ''))
</script>

<template>
  <div class="card kpi" role="group" :aria-label="label">
    <template v-if="!kpi">
      <span class="skeleton l" aria-hidden="true"></span>
      <span class="skeleton v" aria-hidden="true"></span>
      <span class="skeleton t" aria-hidden="true"></span>
      <span class="sr-only" role="status">Loading {{ label }}</span>
    </template>
    <template v-else>
      <p class="name">{{ label }}</p>
      <p class="value">{{ kpi.value }}</p>
      <p class="trend" :class="kpi.trend.tone">
        <span aria-hidden="true" class="arrow">{{ kpi.trend.symbol }}</span>
        <span class="sr-only">{{ speech }}</span>
        <span aria-hidden="true">{{ kpi.trend.text }}</span>
      </p>
      <svg class="spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path v-if="path" :d="path" fill="none" stroke="var(--chart-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        <line v-else x1="2" :x2="W - 2" :y1="H / 2" :y2="H / 2" stroke="var(--color-line)" stroke-width="2" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" />
      </svg>
    </template>
  </div>
</template>

<style scoped>
.kpi { margin: 0; padding: var(--space-4) var(--space-5); box-shadow: var(--shadow-raised); display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.name { margin: 0; font-size: var(--text-sm); color: var(--color-muted); font-weight: 600; }
.value { margin: 0; font-size: clamp(1.5rem, 4vw, 2rem); font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; overflow-wrap: anywhere; }
.trend { margin: 0; font-size: var(--text-xs); font-weight: 700; color: var(--color-muted); display: flex; gap: 0.35em; align-items: baseline; min-height: 2.6em; }
.trend .arrow { font-size: 0.75em; }
.trend.good { color: var(--color-success-fg); }
.trend.bad { color: var(--color-danger-fg); }
.spark { width: 100%; height: 28px; margin-top: auto; }
.l { height: 0.8rem; width: 60%; }
.v { height: 1.9rem; width: 45%; margin: var(--space-2) 0; }
.t { height: 0.8rem; width: 85%; margin-bottom: var(--space-3); }
@media (max-width: 480px) {
  .kpi { padding: var(--space-3) var(--space-4); }
}
</style>
