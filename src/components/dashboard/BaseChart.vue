<script setup>
// UI-O2 (A19): a Chart.js canvas. Chart.js is imported here, on mount, so it loads with the dashboard route only.
// Keyboard: the canvas is focusable; arrow keys, Home and End step through the points and show the tooltip, a live
// region reads each point, Escape clears. `makeConfig(palette)` returns the chart configuration.
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

const props = defineProps({
  makeConfig: { type: Function, required: true },
  label: { type: String, required: true }, // the text summary, also the accessible name
  describe: { type: Function, required: true }, // (index) => sentence for the live region
  height: { type: String, default: '18rem' },
  keyboardDatasets: { type: Array, default: () => [0] },
})

const canvas = ref(null)
const status = ref('')
const failed = ref(false)
const ready = ref(false)
const chart = shallowRef(null)
let active = -1
let unmounted = false

const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

// Light amber with dark diagonal stripes: no-shows are told apart by pattern and lightness, not hue alone.
function hatch(stripe, fill) {
  const tile = document.createElement('canvas')
  tile.width = tile.height = 8
  const c = tile.getContext('2d')
  c.fillStyle = fill
  c.fillRect(0, 0, 8, 8)
  c.strokeStyle = stripe
  c.lineWidth = 1.6
  c.beginPath()
  c.moveTo(-2, 10); c.lineTo(10, -2); c.moveTo(-2, 2); c.lineTo(2, -2); c.moveTo(6, 10); c.lineTo(10, 6)
  c.stroke()
  return c.createPattern(tile, 'repeat')
}

function palette() {
  const noshow = token('--chart-noshow', '#8a5200')
  const fill = token('--chart-noshow-fill', '#f6d48a')
  return {
    primary: token('--chart-primary', '#1d5e5a'),
    noshow,
    noshowFill: hatch(noshow, fill),
    line: token('--chart-line', '#1e2b2a'),
    grid: token('--color-line', '#d3dcda'),
    muted: token('--color-muted', '#4a5a58'),
    text: token('--color-text', '#1e2b2a'),
    surface: token('--color-surface', '#ffffff'),
    font: token('--font-sans', 'sans-serif'),
    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

async function draw() {
  if (!canvas.value) return
  try {
    const { Chart } = await import('@/lib/chartSetup')
    if (unmounted) return
    const config = props.makeConfig(palette())
    // Recreated rather than updated in place: a live data change can alter the number of points, and an in-place
    // update kept stale bar positions from the previous range.
    chart.value?.destroy()
    chart.value = new Chart(canvas.value, config)
    active = -1
    failed.value = false
    ready.value = true
  } catch {
    failed.value = true
  }
}

onMounted(draw)
watch(() => props.makeConfig, draw)
onBeforeUnmount(() => { unmounted = true; chart.value?.destroy(); chart.value = null })

const points = () => (chart.value?.data.labels?.length || 0)

function show(index) {
  const c = chart.value
  if (!c || index < 0 || index >= points()) return
  active = index
  const elements = props.keyboardDatasets.map((datasetIndex) => ({ datasetIndex, index }))
  const anchor = c.getDatasetMeta(props.keyboardDatasets[0]).data[index]?.getProps(['x', 'y'], true)
  c.setActiveElements(elements)
  c.tooltip.setActiveElements(elements, anchor || { x: 0, y: 0 })
  c.update('none')
  status.value = props.describe(index)
}

function clear() {
  const c = chart.value
  active = -1
  if (!c) return
  c.setActiveElements([])
  c.tooltip.setActiveElements([], { x: 0, y: 0 })
  c.update('none')
  status.value = ''
}

function onKey(e) {
  const n = points()
  const horizontal = chart.value?.options.indexAxis === 'y'
  const next = horizontal ? 'ArrowDown' : 'ArrowRight'
  const previous = horizontal ? 'ArrowUp' : 'ArrowLeft'
  if (!n) return
  if (e.key === next || e.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) show(Math.min(n - 1, active + 1))
  else if (e.key === previous || e.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) show(Math.max(0, active < 0 ? 0 : active - 1))
  else if (e.key === 'Home') show(0)
  else if (e.key === 'End') show(n - 1)
  else if (e.key === 'Escape') clear()
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="chart-box" :style="{ height }">
    <span v-if="!ready && !failed" class="skeleton fill" aria-hidden="true"></span>
    <p v-if="failed" class="chart-failed" role="alert">The chart could not load. Use “View as table” to see the same figures.</p>
    <canvas
      ref="canvas"
      tabindex="0"
      role="img"
      :aria-label="`${label} Use the arrow keys to move between points.`"
      @keydown="onKey"
      @blur="clear"
    ></canvas>
    <p class="sr-only" role="status" aria-live="polite">{{ status }}</p>
  </div>
</template>

<style scoped>
.chart-box { position: relative; width: 100%; }
.fill { position: absolute; inset: 0; }
canvas { display: block; border-radius: var(--radius-sm); }
.chart-failed { margin: 0; color: var(--color-danger-fg); font-weight: 600; }
</style>
