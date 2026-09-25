// A17 demo mode and App Check switches on the functions side. Pure, no emulator needed.
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const demo = createRequire(import.meta.url)('../functions/demo.js')

const saved = { DEMO_MODE: process.env.DEMO_MODE, FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR }
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})
const setEnv = ({ demoMode, emulator }) => {
  for (const [k, v] of [['DEMO_MODE', demoMode], ['FUNCTIONS_EMULATOR', emulator]]) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe('demo mode', () => {
  it('is off by default: production has no mocks and enforces App Check', () => {
    setEnv({})
    assert.equal(demo.demoMode(), false)
    assert.equal(demo.mocksAllowed(), false)
    assert.deepEqual(demo.appCheck(), { enforceAppCheck: true })
  })
  it('only the exact value "true" turns it on', () => {
    for (const v of ['', 'false', '1', 'TRUE', 'yes', ' true']) {
      setEnv({ demoMode: v })
      assert.equal(demo.demoMode(), false, JSON.stringify(v))
      assert.equal(demo.mocksAllowed(), false)
    }
    setEnv({ demoMode: 'true' })
    assert.equal(demo.demoMode(), true)
    assert.equal(demo.mocksAllowed(), true)
  })
  it('demo mode still enforces App Check', () => {
    setEnv({ demoMode: 'true' })
    assert.deepEqual(demo.appCheck(), { enforceAppCheck: true })
  })
  it('the emulator allows mocks and skips App Check, without demo mode', () => {
    setEnv({ emulator: 'true' })
    assert.equal(demo.demoMode(), false)
    assert.equal(demo.mocksAllowed(), true)
    assert.deepEqual(demo.appCheck(), { enforceAppCheck: false })
  })
})
