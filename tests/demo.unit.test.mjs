// A17 demo mode and App Check switches on the functions side. Pure, no emulator needed.
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const demo = createRequire(import.meta.url)('../functions/demo.js')

const saved = {
  DEMO_MODE: process.env.DEMO_MODE,
  FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
  APP_CHECK_ENFORCE: process.env.APP_CHECK_ENFORCE,
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})
const setEnv = ({ demoMode, emulator, enforce }) => {
  for (const [k, v] of [['DEMO_MODE', demoMode], ['FUNCTIONS_EMULATOR', emulator], ['APP_CHECK_ENFORCE', enforce]]) {
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
  it('App Check is enforced by default and only APP_CHECK_ENFORCE=false turns it off', () => {
    for (const v of [undefined, '', 'true', '0', 'FALSE', 'no', ' false']) {
      setEnv({ enforce: v })
      assert.equal(demo.appCheckEnforced(), true, JSON.stringify(v))
      assert.deepEqual(demo.appCheck(), { enforceAppCheck: true })
    }
    setEnv({ enforce: 'false' })
    assert.equal(demo.appCheckEnforced(), false)
    assert.deepEqual(demo.appCheck(), { enforceAppCheck: false })
  })
  it('turning App Check off does not turn demo mode on, or the reverse', () => {
    setEnv({ enforce: 'false' })
    assert.equal(demo.demoMode(), false)
    assert.equal(demo.mocksAllowed(), false)
    setEnv({ demoMode: 'true' })
    assert.equal(demo.appCheckEnforced(), true)
  })
})

// Deploy-time behaviour: the CLI prompts for every *declared* secret, bound or not, so in demo mode ONEMAP_TOKEN must
// not be declared at all. Loads functions/index.js in a child process, as the CLI does when it analyses the functions.
describe('ONEMAP_TOKEN at deploy time', () => {
  const inspect = (env) => {
    const script = `
      const {declaredParams} = require('firebase-functions/params');
      const fns = require('./index.js');
      const secrets = (fns.geocode.__endpoint.secretEnvironmentVariables || []).map((s) => s.key);
      console.log(JSON.stringify({declared: declaredParams.map((p) => p.name), secrets}));`
    const clean = { ...process.env, ...env }
    for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k]
    const out = execFileSync(process.execPath, ['-e', script], { cwd: new URL('../functions/', import.meta.url), env: clean, encoding: 'utf8' })
    return JSON.parse(out.trim().split('\n').pop())
  }
  it('neither declares nor binds it when DEMO_MODE=true', () => {
    const r = inspect({ DEMO_MODE: 'true', FUNCTIONS_EMULATOR: undefined })
    assert.ok(!r.declared.includes('ONEMAP_TOKEN'))
    assert.deepEqual(r.secrets, [])
    assert.ok(r.declared.includes('PAYMENT_WEBHOOK_SECRET'), 'the payment secret is still declared')
  })
  it('declares and binds it when demo mode is off', () => {
    for (const DEMO_MODE of [undefined, 'false']) {
      const r = inspect({ DEMO_MODE, FUNCTIONS_EMULATOR: undefined })
      assert.ok(r.declared.includes('ONEMAP_TOKEN'))
      assert.deepEqual(r.secrets, ['ONEMAP_TOKEN'])
    }
  })
  it('still answers postal lookups without a token in demo mode', async () => {
    const { geocode } = createRequire(import.meta.url)('../functions/geocode.js')
    assert.equal((await geocode({ postalCode: '160055' }, '', () => assert.fail('no fetch'), true)).lat, 1.2855)
    assert.equal((await geocode({ postalCode: '123456' }, '', () => assert.fail('no fetch'), true)).approximate, true)
  })
})
