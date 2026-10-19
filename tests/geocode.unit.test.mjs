// FR-01 geocode callable: input validation, the mock lookup when ONEMAP_TOKEN is unset, and the
// OneMap path with an injected fetch. No emulator or network needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { geocode, parsePostalCode, pickResult, MOCK_POSTAL_CODES } = createRequire(import.meta.url)('../functions/geocode.js')
const { SECTORS, sectorCentroid } = createRequire(import.meta.url)('../functions/postalSectors.js')

const rejects = (fn, code) => {
  try {
    fn()
  } catch (err) {
    assert.equal(err.code, code)
    assert.equal(err.details?.field, 'postalCode', 'error names the field')
    return
  }
  assert.fail('expected an error')
}

describe('parsePostalCode', () => {
  it('accepts exactly six digits, trimming whitespace', () => {
    assert.equal(parsePostalCode({ postalCode: '160055' }), '160055')
    assert.equal(parsePostalCode({ postalCode: ' 018956\n' }), '018956')
  })
  it('rejects missing, non-string and non-object input', () => {
    for (const data of [undefined, null, 'x', 160055, [], {}, { postalCode: 160055 }, { postalCode: null }, { postalCode: ['160055'] }, { postalCode: {} }]) {
      rejects(() => parsePostalCode(data), 'invalid-argument')
    }
  })
  it('rejects wrong length, non-digits and embedded whitespace', () => {
    for (const postalCode of ['', '   ', '16005', '1600555', 'abcdef', '16005a', '16 0055', '160-055', '-60055', '1.60055', '１６００５５', '160055; drop', '160055\n160055']) {
      rejects(() => parsePostalCode({ postalCode }), 'invalid-argument')
    }
  })
})

describe('geocode without a token in the emulator (mock lookup)', () => {
  const neverFetch = () => assert.fail('must not call OneMap without a token')
  it('resolves the seed shop postal codes', async () => {
    for (const code of ['160055', '520478', '600135', '579804']) {
      const out = await geocode({ postalCode: code }, '', neverFetch, true)
      assert.deepEqual(Object.keys(out).sort(), ['label', 'lat', 'lng'])
      assert.ok(Number.isFinite(out.lat) && Number.isFinite(out.lng))
    }
    assert.ok(Object.keys(MOCK_POSTAL_CODES).length > 4, 'covers a few areas beyond the seed shops')
  })
  it('returns not-found for a code in a sector that does not exist', async () => {
    await assert.rejects(geocode({ postalCode: '999999' }, '', neverFetch, true), (e) => e.code === 'not-found' && e.details.field === 'postalCode')
  })
  it('validates before looking anything up', async () => {
    await assert.rejects(geocode({ postalCode: '12' }, '', neverFetch, true), (e) => e.code === 'invalid-argument')
  })
})

describe('geocode postal-sector fallback (A18)', () => {
  const neverFetch = () => assert.fail('must not call OneMap without a token')
  const look = (postalCode, emulator = true) => geocode({ postalCode }, '', neverFetch, emulator)
  const km = (a, b) => Math.hypot((a.lat - b.lat) * 111.2, (a.lng - b.lng) * 111.2 * Math.cos((a.lat * Math.PI) / 180))

  it('tries the exact table first, and exact results carry no approximate flag', async () => {
    const out = await look('160055')
    assert.deepEqual(out, { ...MOCK_POSTAL_CODES['160055'] })
    assert.equal('approximate' in out, false)
    assert.equal((await look('819663')).label, 'Changi Airport')
  })
  it('falls back to the sector centroid, marked approximate and labelled as such', async () => {
    const out = await look('570123') // Bishan, not in the exact table
    assert.equal(out.approximate, true)
    assert.match(out.label, /approximate/i)
    assert.match(out.label, /Bishan/)
    const c = sectorCentroid('570123')
    assert.deepEqual([out.lat, out.lng], [c.lat, c.lng])
    assert.deepEqual(Object.keys(out).sort(), ['approximate', 'label', 'lat', 'lng'])
  })
  it('gives every valid sector (01 to 82, except 74) a result, and nothing else', async () => {
    const valid = []
    for (let n = 0; n <= 99; n++) valid.push(String(n).padStart(2, '0'))
    for (const sector of valid) {
      const code = `${sector}1234`
      const should = Number(sector) >= 1 && Number(sector) <= 82 && sector !== '74'
      if (should) {
        const out = await look(code)
        assert.ok(Number.isFinite(out.lat) && Number.isFinite(out.lng), sector)
      } else {
        await assert.rejects(look(code), (e) => e.code === 'not-found' && e.details.field === 'postalCode', sector)
      }
    }
    assert.equal(Object.keys(SECTORS).length, 81)
  })
  it('puts every centroid inside Singapore and keeps the sectors of the sample shops near their coordinates', () => {
    for (const [sector, [name, lat, lng]] of Object.entries(SECTORS)) {
      assert.ok(name && lat > 1.2 && lat < 1.48 && lng > 103.6 && lng < 104.05, sector)
    }
    for (const code of ['160055', '520478', '600135', '579804']) {
      assert.ok(km(MOCK_POSTAL_CODES[code], sectorCentroid(code)) < 2.5, `${code} is within about 2 km of its sector centroid`)
    }
  })
  it('still validates input and never leaks past the mock modes', async () => {
    await assert.rejects(look('12'), (e) => e.code === 'invalid-argument')
    await assert.rejects(look('570123', false), (e) => e.code === 'unavailable' && !e.details) // no mock data outside emulator or demo mode
    const withToken = await geocode({ postalCode: '570123' }, 't', async () => ({ ok: true, json: async () => ({ results: [{ POSTAL: '570123', LATITUDE: '1.5', LONGITUDE: '103.9', ADDRESS: 'X' }] }) }), false)
    assert.deepEqual(withToken, { lat: 1.5, lng: 103.9, label: 'X' }) // OneMap behaviour unchanged, no approximation
  })
})

describe('geocode without a token outside the emulator', () => {
  const neverFetch = () => assert.fail('must not call OneMap without a token')
  it('is unavailable, even for codes the mock knows, and returns no coordinates', async () => {
    for (const postalCode of ['160055', '999999']) {
      await assert.rejects(geocode({ postalCode }, '', neverFetch, false), (e) => e.code === 'unavailable' && !e.details)
    }
  })
  it('still validates input first', async () => {
    await assert.rejects(geocode({ postalCode: '12' }, '', neverFetch, false), (e) => e.code === 'invalid-argument' && e.details.field === 'postalCode')
  })
  it('defaults to the FUNCTIONS_EMULATOR environment variable', async () => {
    const saved = process.env.FUNCTIONS_EMULATOR
    try {
      process.env.FUNCTIONS_EMULATOR = 'true'
      assert.equal((await geocode({ postalCode: '160055' }, '', neverFetch)).lat, 1.2855)
      for (const value of ['false', '', undefined]) {
        if (value === undefined) delete process.env.FUNCTIONS_EMULATOR
        else process.env.FUNCTIONS_EMULATOR = value
        await assert.rejects(geocode({ postalCode: '160055' }, '', neverFetch), (e) => e.code === 'unavailable')
      }
    } finally {
      if (saved === undefined) delete process.env.FUNCTIONS_EMULATOR
      else process.env.FUNCTIONS_EMULATOR = saved
    }
  })
  it('ignores the emulator flag when a token is set', async () => {
    const out = await geocode({ postalCode: '160055' }, 't', async () => ({ ok: true, json: async () => ({ results: [{ POSTAL: '160055', LATITUDE: '1', LONGITUDE: '2' }] }) }), false)
    assert.equal(out.lat, 1)
  })
})

describe('geocode with a token (OneMap)', () => {
  const ok = (body) => async () => ({ ok: true, json: async () => body })
  const hit = { results: [{ POSTAL: '160055', LATITUDE: '1.2855', LONGITUDE: '103.8267', ADDRESS: '55 TIONG BAHRU ROAD' }] }
  it('calls OneMap with the token in the header only and returns just the location', async () => {
    let seen
    const out = await geocode({ postalCode: '160055' }, 'secret-token', async (url, init) => {
      seen = { url, init }
      return { ok: true, json: async () => hit }
    })
    assert.deepEqual(out, { lat: 1.2855, lng: 103.8267, label: '55 TIONG BAHRU ROAD' })
    assert.equal(seen.init.headers.Authorization, 'secret-token')
    assert.ok(!seen.url.includes('secret-token'), 'token is not in the URL')
    assert.ok(seen.url.includes('searchVal=160055'))
  })
  it('is not-found when OneMap has no result or unusable coordinates', async () => {
    for (const body of [{ results: [] }, {}, null, { results: [{ POSTAL: '160055', LATITUDE: 'x', LONGITUDE: 'y' }] }]) {
      await assert.rejects(geocode({ postalCode: '160055' }, 't', ok(body)), (e) => e.code === 'not-found')
    }
  })
  it('is unavailable (and never leaks the token) when OneMap fails', async () => {
    const failures = [async () => { throw new Error('boom secret-token') }, async () => ({ ok: false, status: 401 }), async () => ({ ok: true, json: async () => { throw new Error('bad json') } })]
    for (const f of failures) {
      await assert.rejects(geocode({ postalCode: '160055' }, 'secret-token', f), (e) => e.code === 'unavailable' && !JSON.stringify([e.message, e.details]).includes('secret-token'))
    }
  })
  it('prefers the result whose postal code matches', () => {
    const body = { results: [{ POSTAL: '160056', LATITUDE: '1', LONGITUDE: '2' }, { POSTAL: '160055', LATITUDE: '3', LONGITUDE: '4', ADDRESS: 'A' }] }
    assert.deepEqual(pickResult(body, '160055'), { lat: 3, lng: 4, label: 'A' })
  })
})
