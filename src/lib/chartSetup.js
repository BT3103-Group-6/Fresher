// UI-O2 (decisions A19): Chart.js with only the parts the dashboard uses. Imported dynamically by BaseChart.vue, so it is
// fetched on the dashboard route only and never reaches the landing page bundle.
import {
  BarController, BarElement, CategoryScale, Chart, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip,
} from 'chart.js'

// Draws a value label at the end of each bar (percentages, averages) so the numbers never depend on hovering.
const barLabels = {
  id: 'barLabels',
  afterDatasetsDraw(chart, _args, options) {
    if (!options || !options.format) return
    const { ctx } = chart
    const horizontal = chart.options.indexAxis === 'y'
    ctx.save()
    ctx.font = `700 12px ${options.font || 'sans-serif'}`
    ctx.fillStyle = options.color || '#1e2b2a'
    ctx.textBaseline = 'middle'
    chart.data.datasets.forEach((dataset, i) => {
      chart.getDatasetMeta(i).data.forEach((bar, index) => {
        const value = dataset.data[index]
        if (value === null || value === undefined) return
        const { x, y } = bar.getProps(['x', 'y'], true)
        const text = options.format(value)
        if (horizontal) {
          ctx.textAlign = 'left'
          ctx.fillText(text, x + 6, y)
        } else {
          ctx.textAlign = 'center'
          ctx.fillText(text, x, y - 10)
        }
      })
    })
    ctx.restore()
  },
}

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, barLabels)

export { Chart }
