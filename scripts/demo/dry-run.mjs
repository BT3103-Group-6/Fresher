// A18: build the demo dataset in memory, validate it and print the counts and the write estimate.
// No Firebase access. Usage: `npm run demo:dry-run [-- --density 0.8]`.
import { generateDemoData } from './generate.mjs'
import { validateDataset, docCounts, formatReport } from './validate.mjs'

const i = process.argv.indexOf('--density')
const density = i >= 0 ? Number(process.argv[i + 1]) : undefined
const ds = generateDemoData({ density })
const problems = validateDataset(ds)
console.log(formatReport(docCounts(ds)))
if (problems.length) {
  console.error(`\n${problems.length} validation problem(s):`)
  for (const p of problems.slice(0, 30)) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('\nValidation passed: no problems found.')
