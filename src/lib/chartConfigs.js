// UI-O2 (decisions A19): Chart.js configurations for the dashboard. Plain objects, no Chart.js import, so tests can load
// them. `p` is the palette read from the design tokens at draw time:
// { primary, noshow, noshowFill (colour or canvas pattern), line, grid, muted, text, surface, font, animate }.
import { formatDay } from './dashboardCharts.js'
import { formatMoney } from './dashboard.js'

const HALO = 'halo'
const tick = (p) => ({ color: p.muted, font: { family: p.font, size: 12 } })
const title = (p, text) => ({ display: true, text, color: p.muted, font: { family: p.font, size: 12, weight: '600' } })
const base = (p) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: p.animate ? { duration: 300 } : false,
  transitions: { resize: { animation: { duration: 0 } } }, // no animation when the width changes (rotate, window resize)
  interaction: { mode: 'index', intersect: false },
})
const tooltip = (p, extra) => ({
  backgroundColor: p.text, titleColor: p.surface, bodyColor: p.surface, padding: 10, cornerRadius: 6,
  titleFont: { family: p.font, weight: '700' }, bodyFont: { family: p.font }, ...extra,
})

/** Bookings per day: completed and no-shows stacked (left axis), booked value as a line (right axis, S$). */
export function dailyChartConfig(daily, p) {
  const withMarkers = daily.length <= 31
  return {
    type: 'bar',
    data: {
      labels: daily.map((d) => d.label),
      datasets: [
        { type: 'bar', label: 'Completed', data: daily.map((d) => d.completed), backgroundColor: p.primary, stack: 'bookings', yAxisID: 'y', maxBarThickness: 28, order: 3 },
        {
          type: 'bar', label: 'No-shows', data: daily.map((d) => d.noShows), backgroundColor: p.noshowFill, borderColor: p.noshow,
          borderWidth: 1.5, borderSkipped: false, stack: 'bookings', yAxisID: 'y', maxBarThickness: 28, order: 3,
        },
        // A white halo under the line keeps it visible where it crosses the dark bars; it is left out of legend and tooltip.
        { type: 'line', label: HALO, data: daily.map((d) => d.valueCents / 100), borderColor: p.surface, borderWidth: 6, pointRadius: 0, pointHoverRadius: 0, yAxisID: 'y1', order: 2, tension: 0 },
        {
          type: 'line', label: 'Booked value', data: daily.map((d) => d.valueCents / 100), borderColor: p.line, borderWidth: 2.5,
          pointRadius: withMarkers ? 3.5 : 0, pointHoverRadius: 5, pointBackgroundColor: p.surface, pointBorderColor: p.line, pointBorderWidth: 2,
          yAxisID: 'y1', order: 1, tension: 0,
        },
      ],
    },
    options: {
      ...base(p),
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { ...tick(p), maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
        y: { stacked: true, beginAtZero: true, grid: { color: p.grid }, border: { display: false }, ticks: { ...tick(p), precision: 0 }, title: title(p, 'Bookings') },
        y1: {
          position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, border: { display: false },
          ticks: { ...tick(p), callback: (v) => `S$${v}` }, title: title(p, 'Booked value'),
        },
      },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: p.text, font: { family: p.font, size: 12 }, boxWidth: 14, boxHeight: 14, filter: (item) => item.text !== HALO } },
        tooltip: tooltip(p, {
          filter: (item) => item.dataset.label !== HALO,
          callbacks: {
            title: (items) => formatDay(daily[items[0].dataIndex].key, true),
            label: (item) => `${item.dataset.label}: ${item.dataset.yAxisID === 'y1' ? formatMoney(Math.round(item.parsed.y * 100)) : item.parsed.y}`,
          },
        }),
      },
    },
  }
}

/** Utilisation per barber: horizontal bars, already sorted by the caller, with percentage labels. */
export function barberChartConfig(bars, p) {
  return {
    type: 'bar',
    data: {
      labels: bars.map((r) => r.name),
      datasets: [{ label: 'Utilisation', data: bars.map((r) => r.utilisation * 100), backgroundColor: p.primary, maxBarThickness: 26 }],
    },
    options: {
      ...base(p),
      indexAxis: 'y',
      interaction: { mode: 'nearest', axis: 'y', intersect: false },
      scales: {
        x: {
          beginAtZero: true, suggestedMax: 100, grace: '12%', grid: { color: p.grid }, border: { display: false },
          ticks: { ...tick(p), callback: (v) => `${v}%` }, title: title(p, 'Completed minutes out of open minutes'),
        },
        y: { grid: { display: false }, ticks: { ...tick(p), color: p.text } },
      },
      plugins: {
        legend: { display: false },
        barLabels: { format: (v) => `${Math.round(v)}%`, color: p.text, font: p.font },
        tooltip: tooltip(p, {
          callbacks: {
            label: (item) => {
              const r = bars[item.dataIndex]
              return [`Utilisation: ${Math.round(item.parsed.x)}%`, `${r.bookedMin} of ${r.openMin} open minutes`]
            },
          },
        }),
      },
    },
  }
}

/** Busiest days of the week: average completed bookings per weekday. */
export function weekdayChartConfig(weekdays, p) {
  return {
    type: 'bar',
    data: {
      labels: weekdays.map((w) => w.short),
      datasets: [{ label: 'Average completed', data: weekdays.map((w) => w.average), backgroundColor: p.primary, maxBarThickness: 40 }],
    },
    options: {
      ...base(p),
      scales: {
        x: { grid: { display: false }, ticks: { ...tick(p), color: p.text } },
        y: { beginAtZero: true, grace: '15%', grid: { color: p.grid }, border: { display: false }, ticks: tick(p), title: title(p, 'Completed a day, on average') },
      },
      plugins: {
        legend: { display: false },
        barLabels: { format: (v) => v.toFixed(1), color: p.text, font: p.font },
        tooltip: tooltip(p, {
          callbacks: {
            title: (items) => weekdays[items[0].dataIndex].long,
            label: (item) => {
              const w = weekdays[item.dataIndex]
              return [`${w.average.toFixed(1)} completed a day on average`, `${w.completed} completed over ${w.days} day${w.days === 1 ? '' : 's'}`]
            },
          },
        }),
      },
    },
  }
}

/** One spoken sentence per chart point, for the live region while the chart is used from the keyboard. */
export const describeDaily = (daily) => (i) => {
  const d = daily[i]
  return `${formatDay(d.key, true)}: ${d.completed} completed, ${d.noShows} no-show${d.noShows === 1 ? '' : 's'}, ${formatMoney(d.valueCents)} booked value`
}
export const describeBarber = (bars) => (i) => `${bars[i].name}: ${Math.round(bars[i].utilisation * 100)}% utilisation`
export const describeWeekday = (weekdays) => (i) => `${weekdays[i].long}: ${weekdays[i].average.toFixed(1)} completed a day on average`
