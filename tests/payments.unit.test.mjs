// FR-13 pure rules (decisions A6 addendum): the deposit amount, webhook signatures, and every webhook check
// that happens before the database is touched. No emulator needed (the db argument is never used).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const { depositAmountCents } = req('../functions/booking.js')
const payments = req('../functions/payments.js')

describe('depositAmountCents: 50% of the price, rounded up to the nearest 10 cents', () => {
  const cases = [
    [2500, 1250], // exact: S$25.00 -> S$12.50
    [2550, 1280], // 1275 rounds up
    [3000, 1500],
    [1, 10],      // never rounds down to nothing
    [19, 10],
    [21, 20],     // 10.5 -> 20
    [4999, 2500], // 2499.5 -> 2500
    [0, 0],       // a free service has no deposit
  ]
  for (const [price, deposit] of cases) {
    it(`S$${(price / 100).toFixed(2)} needs ${deposit} cents`, () => assert.equal(depositAmountCents(price), deposit))
  }
  it('is always a multiple of 10, at least half the price, and less than half the price plus 10', () => {
    for (let price = 0; price <= 20000; price += 7) {
      const d = depositAmountCents(price)
      assert.equal(d % 10, 0)
      assert.ok(d >= price / 2 && d < price / 2 + 10, `price ${price}`)
    }
  })
})

describe('webhook signatures (HMAC-SHA256 over the raw body)', () => {
  const secret = 's3cret'
  const body = Buffer.from('{"eventId":"e1"}')
  const good = payments.sign(secret, body)

  it('accepts the signature of the exact bytes', () => assert.equal(payments.verifySignature(secret, body, good), true))
  it('rejects a changed body, a wrong secret and a tampered signature', () => {
    assert.equal(payments.verifySignature(secret, Buffer.from('{"eventId":"e2"}'), good), false)
    assert.equal(payments.verifySignature('other', body, good), false)
    assert.equal(payments.verifySignature(secret, body, `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`), false)
  })
  it('rejects a missing, non-hex or wrong-length signature without throwing', () => {
    for (const bad of [undefined, null, '', 'abc', 'z'.repeat(64), good.slice(2), `${good}00`, 42]) {
      assert.equal(payments.verifySignature(secret, body, bad), false)
    }
  })
})

describe('resolveSecret (limitation L24)', () => {
  const run = (env, value) => {
    const saved = process.env.FUNCTIONS_EMULATOR
    if (env === undefined) delete process.env.FUNCTIONS_EMULATOR
    else process.env.FUNCTIONS_EMULATOR = env
    try { return payments.resolveSecret(value) } finally {
      if (saved === undefined) delete process.env.FUNCTIONS_EMULATOR
      else process.env.FUNCTIONS_EMULATOR = saved
    }
  }
  it('uses the configured secret everywhere', () => {
    assert.equal(run('true', 'real'), 'real')
    assert.equal(run(undefined, 'real'), 'real')
  })
  it('falls back to a mock secret only inside the Functions emulator', () => {
    assert.equal(run('true', ''), payments.MOCK_SECRET)
    assert.equal(run(undefined, ''), '')
    assert.equal(run('false', ''), '')
  })
})

describe('handleWebhook checks that come before any database access', () => {
  const secret = 's3cret'
  const NOW = Date.UTC(2030, 0, 7, 3, 0)
  const id = 'a'.repeat(20)
  const event = (over = {}) => ({ eventId: 'e1', type: 'payment.succeeded', depositId: id, providerRef: `mockpay_${id}`, occurredAt: NOW, ...over })
  const send = (over, { method = 'POST', key = secret, sec = secret, now = NOW } = {}) => {
    const rawBody = Buffer.from(typeof over === 'string' ? over : JSON.stringify(over))
    return payments.handleWebhook(null, { method, rawBody, signature: payments.sign(key, rawBody) }, sec, now)
  }
  const status = async (p) => (await p).status
  const error = async (p) => (await p).body.error

  it('refuses anything but POST', async () => assert.equal(await status(send(event(), { method: 'GET' })), 405))
  it('refuses every call when no secret is configured', async () => {
    const out = await send(event(), { sec: '' })
    assert.deepEqual([out.status, out.body.error], [503, 'WEBHOOK_NOT_CONFIGURED'])
  })
  it('401s a bad, wrong-secret or missing signature', async () => {
    assert.equal(await error(send(event(), { key: 'wrong' })), 'INVALID_SIGNATURE')
    const raw = Buffer.from(JSON.stringify(event()))
    for (const signature of ['nope', undefined]) {
      const out = await payments.handleWebhook(null, { method: 'POST', rawBody: raw, signature }, secret, NOW)
      assert.deepEqual([out.status, out.body.error], [401, 'INVALID_SIGNATURE'])
    }
    assert.equal((await payments.handleWebhook(null, { method: 'POST', rawBody: undefined, signature: 'x' }, secret, NOW)).status, 401)
  })
  it('400s a signed body that is not JSON or not a valid event', async () => {
    assert.equal(await error(send('not json')), 'INVALID_BODY')
    for (const bad of [
      event({ type: 'payment.refunded' }), event({ eventId: '' }), event({ depositId: '../x' }), event({ depositId: 'short' }),
      event({ providerRef: '' }), event({ occurredAt: 'now' }), event({ occurredAt: 1.5 }), [], null,
    ]) assert.equal(await error(send(bad)), 'INVALID_EVENT', JSON.stringify(bad))
  })
  it('refuses stale and future-dated events (replay limit of 5 minutes)', async () => {
    assert.equal(await error(send(event({ occurredAt: NOW - payments.TOLERANCE_MS - 1 }))), 'STALE_EVENT')
    assert.equal(await error(send(event({ occurredAt: NOW + payments.TOLERANCE_MS + 1 }))), 'STALE_EVENT')
    assert.equal(await status(send(event({ occurredAt: NOW - payments.TOLERANCE_MS }), { now: NOW })).catch(() => 'db'), 'db') // passes the check, then needs the db
  })
})

describe('mockPay and devRunSweep exist only inside the Functions emulator', () => {
  const exportsIn = (emulator) => {
    const env = { ...process.env, GCLOUD_PROJECT: 'fresher-exports-test' }
    delete env.FUNCTIONS_EMULATOR
    if (emulator) env.FUNCTIONS_EMULATOR = 'true'
    const out = execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(Object.keys(require('./index.js')).sort()))"],
      { cwd: new URL('../functions/', import.meta.url), env, encoding: 'utf8' })
    return JSON.parse(out.trim().split('\n').pop())
  }
  it('is not exported in a deployment', () => {
    const names = exportsIn(false)
    assert.equal(names.includes('mockPay'), false)
    assert.equal(names.includes('devRunSweep'), false)
    for (const kept of ['createDeposit', 'paymentWebhook', 'confirmBooking', 'processNotifications']) assert.ok(names.includes(kept), kept)
  })
  it('is exported in the Functions emulator', () => {
    const names = exportsIn(true)
    assert.ok(names.includes('mockPay'))
    assert.ok(names.includes('devRunSweep'))
  })
})
