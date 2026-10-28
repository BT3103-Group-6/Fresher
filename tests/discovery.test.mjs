// FR-01 pure logic: the exact-distance filter, geohash coverage, the service-type filter, next slot,
// and the shop summary the services trigger writes. No emulator needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { distanceBetween, geohashForLocation } from 'geofire-common'
import { boundsFor, filterByType, formatDistance, formatPriceRange, nextSlot, withinRadius } from '../src/lib/discovery.js'
import { sgTimeToMs } from '../src/lib/slots.js'

const { summarizeServices } = createRequire(import.meta.url)('../functions/discovery.js')

const CENTER = [1.2855, 103.8267] // Tiong Bahru
const M_PER_DEG_LAT = (Math.PI / 180) * 6371000 // the sphere geofire-common uses
const northOf = ([lat, lng], metres) => [lat + metres / M_PER_DEG_LAT, lng]
const shopAt = (id, [lat, lng], extra = {}) => ({ id, lat, lng, ...extra })

describe('withinRadius', () => {
  it('keeps shops inside 3 km and drops those outside', () => {
    const shops = [
      shopAt('in', northOf(CENTER, 2900)),
      shopAt('out', northOf(CENTER, 3100)),
      shopAt('tampines', [1.3545, 103.9436]), // ~14 km away
    ]
    assert.deepEqual(withinRadius(shops, CENTER).map((s) => s.id), ['in'])
  })
  it('includes a shop exactly on the radius and excludes one just past it', () => {
    const on = shopAt('on', northOf(CENTER, 3000))
    const exact = distanceBetween([on.lat, on.lng], CENTER) * 1000
    assert.deepEqual(withinRadius([on], CENTER, exact).map((s) => s.id), ['on'])
    assert.deepEqual(withinRadius([on], CENTER, exact - 0.01), [])
  })
  it('sorts nearest first and reports distance in metres', () => {
    const shops = [shopAt('far', northOf(CENTER, 2500)), shopAt('near', northOf(CENTER, 400)), shopAt('mid', northOf(CENTER, 1200))]
    const out = withinRadius(shops, CENTER)
    assert.deepEqual(out.map((s) => s.id), ['near', 'mid', 'far'])
    assert.ok(Math.abs(out[0].distanceM - 400) < 1)
  })
  it('drops shops without usable coordinates', () => {
    const shops = [{ id: 'a' }, { id: 'b', lat: null, lng: null }, { id: 'c', lat: '1.2', lng: '103.8' }, shopAt('ok', CENTER)]
    assert.deepEqual(withinRadius(shops, CENTER).map((s) => s.id), ['ok'])
  })
  it('discards geohash false positives at the corner of the search box', () => {
    // Inside the bounding box of the circle but ~4 km from the centre.
    const corner = [CENTER[0] + 2900 / M_PER_DEG_LAT, CENTER[1] + 2900 / (M_PER_DEG_LAT * Math.cos((CENTER[0] * Math.PI) / 180))]
    const h = geohashForLocation(corner)
    assert.ok(boundsFor(CENTER).some(([s, e]) => s <= h && h <= e), 'geohash range query returns it')
    assert.deepEqual(withinRadius([shopAt('corner', corner)], CENTER), [])
  })
})

describe('boundsFor', () => {
  it('covers every point within 3 km (no shop is missed by the range query)', () => {
    const bounds = boundsFor(CENTER)
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    let inside = 0
    for (let i = 0; i < 2000; i++) {
      const p = [CENTER[0] + rand() * 0.04, CENTER[1] + rand() * 0.04]
      if (distanceBetween(p, CENTER) * 1000 > 3000) continue
      inside++
      const h = geohashForLocation(p)
      assert.ok(bounds.some(([s, e]) => s <= h && h <= e), `missed ${p}`)
    }
    assert.ok(inside > 500)
  })
})

describe('filterByType', () => {
  const shops = [
    { id: 'a', serviceTypes: ['haircut', 'beard'] },
    { id: 'b', serviceTypes: ['kids'] },
    { id: 'c', serviceTypes: [] },
    { id: 'd' },
  ]
  it('keeps shops offering the type', () => {
    assert.deepEqual(filterByType(shops, 'beard').map((s) => s.id), ['a'])
    assert.deepEqual(filterByType(shops, 'perm'), [])
  })
  it('returns everything when no type is chosen', () => {
    assert.equal(filterByType(shops, '').length, 4)
  })
})

describe('formatting', () => {
  it('formats distance and price range', () => {
    assert.equal(formatDistance(430), '430 m')
    assert.equal(formatDistance(1234), '1.2 km')
    assert.equal(formatPriceRange(1500, 6000), 'S$15 to S$60')
    assert.equal(formatPriceRange(1850, 1850), 'S$18.50')
    assert.equal(formatPriceRange(null, null), null)
  })
})

describe('nextSlot (same logic as UI-C2)', () => {
  const MON = '20300107'
  const at = (dateKey, hhmm) => sgTimeToMs(dateKey, hhmm)
  const week = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ start: '10:00', end: '12:00' }]]))
  const cut = { id: 'cut', category: 'haircut', durationMin: 30, active: true }
  const barber = { id: 'b1', active: true, serviceIds: ['cut', 'long', 'kid'], workingHours: week }
  const base = { barbers: [barber], services: [cut], shopHours: week, now: at(MON, '10:20'), schedulesFor: async () => ({}) }

  it('excludes past times today', async () => {
    assert.equal(await nextSlot(base), at(MON, '10:30'))
  })
  it('moves to the next day when today is full or over', async () => {
    assert.equal(await nextSlot({ ...base, now: at(MON, '13:00') }), at('20300108', '10:00'))
    const full = { b1: [{ start: at(MON, '10:00'), end: at(MON, '12:00'), kind: 'block' }] }
    const calls = []
    const out = await nextSlot({ ...base, now: at(MON, '09:00'), schedulesFor: async (k) => (calls.push(k), k === MON ? full : {}) })
    assert.equal(out, at('20300108', '10:00'))
    assert.deepEqual(calls, [MON, '20300108'], 'stops reading at the first day with a slot')
  })
  it('gives up after 3 days and reads only those days', async () => {
    const full = (k) => ({ b1: [{ start: at(k, '10:00'), end: at(k, '12:00'), kind: 'block' }] })
    const calls = []
    const out = await nextSlot({ ...base, now: at(MON, '09:00'), schedulesFor: async (k) => (calls.push(k), full(k)) })
    assert.equal(out, null)
    assert.deepEqual(calls, [MON, '20300108', '20300109'])
  })
  it('ignores live holds as busy but expired holds as free', async () => {
    const now = at(MON, '09:00')
    const hold = (exp) => ({ b1: [{ start: at(MON, '10:00'), end: at(MON, '10:30'), kind: 'hold', holdExpiresAt: exp }] })
    assert.equal(await nextSlot({ ...base, now, schedulesFor: async () => hold(now + 60e3) }), at(MON, '10:30'))
    assert.equal(await nextSlot({ ...base, now, schedulesFor: async () => hold(now - 1) }), at(MON, '10:00'))
  })
  it('ignores inactive barbers', async () => {
    assert.equal(await nextSlot({ ...base, barbers: [{ ...barber, active: false }] }), null)
    const other = { ...barber, id: 'b2', workingHours: { ...week, mon: [{ start: '11:00', end: '12:00' }] } }
    assert.equal(await nextSlot({ ...base, barbers: [{ ...barber, active: false }, other] }), at(MON, '11:00'))
  })
  it('ignores inactive services', async () => {
    assert.equal(await nextSlot({ ...base, services: [{ ...cut, active: false }] }), null)
    // The only active service is 90 min: 10:30 fits before 12:00, 10:45 does not.
    const long = { id: 'long', category: 'haircut', durationMin: 90, active: true }
    assert.equal(await nextSlot({ ...base, services: [{ ...cut, active: false }, long] }), at(MON, '10:30'))
  })
  it('only counts barbers who offer a service of the chosen type', async () => {
    const kid = { id: 'kid', category: 'kids', durationMin: 15, active: true }
    const b2 = { ...barber, id: 'b2', serviceIds: ['cut'], workingHours: { ...week, mon: [{ start: '10:00', end: '12:00' }] } }
    const services = [cut, kid]
    assert.equal(await nextSlot({ ...base, services, type: 'kids', barbers: [b2] }), null)
    assert.equal(await nextSlot({ ...base, services, type: 'kids', barbers: [barber, b2] }), at(MON, '10:30'))
    assert.equal(await nextSlot({ ...base, services, type: 'perm' }), null)
  })
  it('respects shop opening hours and days off', async () => {
    assert.equal(await nextSlot({ ...base, shopHours: { ...week, mon: [] }, now: at(MON, '09:00') }), at('20300108', '10:00'))
  })
})

describe('summarizeServices (trigger-owned shop fields)', () => {
  const svc = (category, priceCents, durationMin, active = true) => ({ category, priceCents, durationMin, active })
  it('derives price range, categories and shortest duration from active services', () => {
    assert.deepEqual(summarizeServices([svc('beard', 1500, 15), svc('haircut', 6000, 45), svc('haircut', 2500, 30)]), {
      priceMin: 1500, priceMax: 6000, serviceTypes: ['haircut', 'beard'], minDurationMin: 15,
    })
  })
  it('ignores inactive services', () => {
    const out = summarizeServices([svc('perm', 9000, 90, false), svc('haircut', 2500, 30)])
    assert.deepEqual(out, { priceMin: 2500, priceMax: 2500, serviceTypes: ['haircut'], minDurationMin: 30 })
  })
  it('is empty when nothing is active', () => {
    assert.deepEqual(summarizeServices([svc('haircut', 2500, 30, false)]), { priceMin: null, priceMax: null, serviceTypes: [], minDurationMin: null })
    assert.deepEqual(summarizeServices([]), { priceMin: null, priceMax: null, serviceTypes: [], minDurationMin: null })
  })
})
