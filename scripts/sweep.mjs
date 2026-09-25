// FR-09 dev helper: runs one notification + expiry sweep against the Functions emulator (the emulator
// does not fire schedules). `npm run sweep`, or `npm run sweep -- --watch` to repeat every 60 s like
// the real scheduler. The devRunSweep function only exists inside the Functions emulator.
import { readFileSync } from 'node:fs'

const project = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url))).projects.default
const url = `http://127.0.0.1:5001/${project}/asia-southeast1/devRunSweep`
const watch = process.argv.includes('--watch')

async function once() {
  try {
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}. Are the Functions emulator running and devRunSweep loaded?`)
    console.log(new Date().toISOString(), JSON.stringify(await res.json()))
  } catch (err) {
    console.error(new Date().toISOString(), err.message)
    if (!watch) process.exitCode = 1
  }
}

await once()
while (watch) {
  await new Promise((r) => setTimeout(r, 60_000))
  await once()
}
