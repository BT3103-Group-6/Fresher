// Landing page shop map (decisions A20): region derivation, pin data shaping and region grouping. Pure logic,
// no emulator or browser needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { REGIONS, SECTOR_TABLE, placeOfPostalCode } from '../src/lib/regions.js'
import {
  MAP_SHOP_LIMIT, MIN_ZOOM, OTHER_REGION, SG_BOUNDS, SG_RESTRICTION, groupByRegion, inSingapore, mapSummary,
  lowestPriceText, matchSet, pinLabel, pinTitle, pinsOf, shapeShop, shapeShops,
} from '../src/lib/shopMap.js'
import { SHOP_SLOTS } from '../scripts/demo/catalogue.mjs'

const { SECTORS } = createRequire(import.meta.url)('../functions/postalSectors.js')

const shop = (over = {}) => ({
  id: 's1', name: 'Alpha Cuts', status: 'verified', postalCode: '160055', lat: 1.2855, lng: 103.8267,
  priceMin: 1500, priceMax: 6000, serviceTypes: ['haircut', 'beard'], ...over,
})

describe('region table', () => {
  it('has exactly the sectors the geocode stub knows, with the same area names', () => {
    assert.deepEqual(Object.keys(SECTOR_TABLE).sort(), Object.keys(SECTORS).sort())
    for (const [k, [name]] of Object.entries(SECTORS)) assert.equal(SECTOR_TABLE[k][0], name, `sector ${k}`)
  })
  it('only uses the five regions', () => {
    const keys = new Set(REGIONS.map((r) => r.key))
    assert.deepEqual(REGIONS.map((r) => r.label), ['Central', 'East', 'West', 'North', 'North-East'])
    for (const [k, [, region]] of Object.entries(SECTOR_TABLE)) assert.ok(keys.has(region), `sector ${k}: ${region}`)
  })
  it('agrees with the region of every demo catalogue shop (A18)', () => {
    assert.ok(SHOP_SLOTS.length >= 50)
    for (const [slug, , sector, region] of SHOP_SLOTS) assert.equal(SECTOR_TABLE[sector]?.[1], region, slug)
  })
  it('maps well-known postal codes', () => {
    assert.deepEqual(placeOfPostalCode('160055'), { area: 'Tiong Bahru', region: 'central' })
    assert.equal(placeOfPostalCode('520478').region, 'east')
    assert.equal(placeOfPostalCode('609731').region, 'west')
    assert.equal(placeOfPostalCode('760123').region, 'north')
    assert.equal(placeOfPostalCode('570123').region, 'north-east')
  })
  it('returns null for malformed codes and sectors that do not exist', () => {
    for (const bad of [null, undefined, '', '12345', '1234567', 'abcdef', '740000', '990000']) assert.equal(placeOfPostalCode(bad), null, String(bad))
    assert.equal(placeOfPostalCode(' 160055 ').region, 'central') // surrounding space is trimmed
  })
  it('keeps every sector centroid inside the map bounds', () => {
    for (const [k, [, lat, lng]] of Object.entries(SECTORS)) assert.ok(inSingapore(lat, lng), `sector ${k}`)
  })
})

describe('shapeShop', () => {
  it('keeps the summary fields and derives area, region and price text', () => {
    assert.deepEqual(shapeShop(shop()), {
      id: 's1', name: 'Alpha Cuts', lat: 1.2855, lng: 103.8267, hasPin: true, area: 'Tiong Bahru', region: 'central',
      priceMin: 1500, priceMax: 6000, priceText: 'S$15 to S$60', serviceTypes: ['haircut', 'beard'],
    })
  })
  it('does not carry over fields the map does not need', () => {
    const shaped = shapeShop(shop({ openingHours: { mon: [] }, address: 'x', geohash: 'abc', noticeMins: 60 }))
    for (const k of ['openingHours', 'address', 'geohash', 'noticeMins', 'status', 'postalCode']) assert.ok(!(k in shaped), k)
  })
  it('shows "Not listed" and no price numbers when the shop has no active service', () => {
    const s = shapeShop(shop({ priceMin: null, priceMax: null, serviceTypes: [] }))
    assert.equal(s.priceText, 'Not listed')
    assert.equal(s.priceMin, null)
    assert.deepEqual(s.serviceTypes, [])
  })
  it('shows one price when min equals max', () => assert.equal(shapeShop(shop({ priceMin: 2500, priceMax: 2500 })).priceText, 'S$25'))
  it('tolerates missing or wrongly typed fields', () => {
    const s = shapeShop({ id: 'x', name: 'X', lat: '1.3', lng: null, priceMin: 12.5, priceMax: 'a', serviceTypes: 'haircut' })
    assert.equal(s.lat, null)
    assert.equal(s.lng, null)
    assert.equal(s.hasPin, false)
    assert.equal(s.priceText, 'Not listed')
    assert.deepEqual(s.serviceTypes, [])
  })
  it('drops non-string service types', () => assert.deepEqual(shapeShop(shop({ serviceTypes: ['haircut', 3, null, 'kids'] })).serviceTypes, ['haircut', 'kids']))
  it('puts a shop with an unknown postal sector in "other" with no area, but still pins it', () => {
    const s = shapeShop(shop({ postalCode: '740000' }))
    assert.equal(s.region, OTHER_REGION.key)
    assert.equal(s.area, null)
    assert.equal(s.hasPin, true)
  })
  it('gives no pin to coordinates outside Singapore or that are not finite', () => {
    for (const [lat, lng] of [[0, 0], [1.3, 110], [51.5, -0.12], [NaN, 103.8], [Infinity, 103.8], [1.3, undefined]]) {
      assert.equal(shapeShop(shop({ lat, lng })).hasPin, false, `${lat},${lng}`)
    }
  })
  it('includes shops on the edge of the bounds', () => {
    assert.equal(inSingapore(SG_BOUNDS[0][0], SG_BOUNDS[0][1]), true)
    assert.equal(inSingapore(SG_BOUNDS[1][0], SG_BOUNDS[1][1]), true)
  })
})

describe('shapeShops and pinsOf', () => {
  it('sorts by name and drops shops that are unnamed or not verified', () => {
    const out = shapeShops([
      shop({ id: 'b', name: 'Bravo' }), shop({ id: 'a', name: 'alpha' }),
      shop({ id: 'p', name: 'Pending', status: 'pending' }), shop({ id: 'n', name: '  ' }), shop({ id: 'z', name: undefined }),
      null, { name: 'no id' },
    ])
    assert.deepEqual(out.map((s) => s.id), ['a', 'b'])
  })
  it('keeps a shop with no status field (the query already filters on it)', () => {
    const { status, ...noStatus } = shop()
    assert.equal(shapeShops([noStatus]).length, 1)
  })
  it('breaks name ties by id, so the order is stable', () => {
    const out = shapeShops([shop({ id: 'y', name: 'Same' }), shop({ id: 'x', name: 'Same' })])
    assert.deepEqual(out.map((s) => s.id), ['x', 'y'])
  })
  it('pinsOf keeps only shops that have a pin', () => {
    const out = pinsOf(shapeShops([shop({ id: 'a' }), shop({ id: 'b', name: 'B', lat: null })]))
    assert.deepEqual(out.map((s) => s.id), ['a'])
  })
})

describe('groupByRegion', () => {
  const sample = shapeShops([
    shop({ id: 'c1', name: 'Zed', postalCode: '160055' }), shop({ id: 'c2', name: 'Abe', postalCode: '220001' }),
    shop({ id: 'e1', name: 'East One', postalCode: '520478' }),
    shop({ id: 'w1', name: 'West One', postalCode: '609731' }),
  ])
  it('always lists the five regions in fixed order, with counts, even when a region is empty', () => {
    const g = groupByRegion(sample)
    assert.deepEqual(g.map((x) => x.label), ['Central', 'East', 'West', 'North', 'North-East'])
    assert.deepEqual(g.map((x) => x.count), [2, 1, 1, 0, 0])
    assert.deepEqual(g[3].shops, [])
  })
  it('sorts the shops in a group by name', () => assert.deepEqual(groupByRegion(sample)[0].shops.map((s) => s.name), ['Abe', 'Zed']))
  it('adds "Other" only when some shop has no known region', () => {
    assert.equal(groupByRegion(sample).length, 5)
    const g = groupByRegion([...sample, ...shapeShops([shop({ id: 'o', name: 'Odd', postalCode: '' })])])
    assert.equal(g.length, 6)
    assert.deepEqual([g[5].label, g[5].count], ['Other', 1])
  })
  it('never loses a shop: the counts add up to the number of shops', () => {
    const many = SHOP_SLOTS.map(([slug, , sector], i) => shape(slug, sector, i))
    const g = groupByRegion(many)
    assert.equal(g.reduce((n, x) => n + x.count, 0), many.length)
    assert.deepEqual(g.map((x) => x.count), [12, 10, 10, 8, 10]) // the A18 split: Central, East, West, North, North-East
  })
  it('handles no shops', () => {
    const g = groupByRegion([])
    assert.deepEqual(g.map((x) => x.count), [0, 0, 0, 0, 0])
  })
  it('does not change the shops it is given', () => {
    const copy = structuredClone(sample)
    groupByRegion(sample)
    assert.deepEqual(sample, copy)
  })
})
function shape(slug, sector, i) {
  return shapeShop(shop({ id: slug, name: slug, postalCode: `${sector}0${String(100 + i).slice(-3)}` }))
}

describe('summary, labels and matches', () => {
  it('mapSummary counts shops and regions', () => {
    assert.equal(mapSummary([]), 'No verified shops yet.')
    assert.equal(mapSummary(shapeShops([shop()])), '1 verified shop in 1 region.')
    assert.equal(mapSummary(shapeShops([shop(), shop({ id: 'e', name: 'E', postalCode: '520478' })])), '2 verified shops across 2 regions.')
    assert.equal(mapSummary(shapeShops([shop({ postalCode: '' })])), '1 verified shop.')
  })
  it('pinLabel names the shop and, when known, the area', () => {
    assert.equal(pinLabel(shapeShop(shop())), 'Alpha Cuts, Tiong Bahru')
    assert.equal(pinLabel(shapeShop(shop({ postalCode: '' }))), 'Alpha Cuts')
  })
  it('matchSet is null unless a search matched something', () => {
    assert.equal(matchSet(false, ['a']), null)
    assert.equal(matchSet(true, []), null)
    assert.equal(matchSet(true, null), null)
    assert.deepEqual([...matchSet(true, ['a', 'b'])], ['a', 'b'])
  })
})

describe('price pins', () => {
  it('shows the lowest price, or null when none is listed', () => {
    assert.equal(lowestPriceText(shapeShop(shop())), 'S$15')
    assert.equal(lowestPriceText(shapeShop(shop({ priceMin: 1850, priceMax: 4000 }))), 'S$18.50')
    assert.equal(lowestPriceText(shapeShop(shop({ priceMin: null, priceMax: null }))), null)
  })
  it('adds the price to the pin name only when the price pins are on and a price exists', () => {
    const s = shapeShop(shop())
    assert.equal(pinTitle(s, false), 'Alpha Cuts, Tiong Bahru')
    assert.equal(pinTitle(s, true), 'Alpha Cuts, Tiong Bahru, from S$15')
    assert.equal(pinTitle(shapeShop(shop({ priceMin: null, priceMax: null })), true), 'Alpha Cuts, Tiong Bahru')
  })
})

describe('map constants', () => {
  it('bounds Singapore, in the shape Google Maps takes, and limits the shop read', () => {
    assert.ok(SG_BOUNDS[0][0] < SG_BOUNDS[1][0] && SG_BOUNDS[0][1] < SG_BOUNDS[1][1])
    assert.deepEqual(SG_RESTRICTION, { south: SG_BOUNDS[0][0], west: SG_BOUNDS[0][1], north: SG_BOUNDS[1][0], east: SG_BOUNDS[1][1] })
    assert.ok(inSingapore(1.3521, 103.8198))
    assert.ok(!inSingapore(3.139, 101.6869)) // Kuala Lumpur
    assert.equal(MAP_SHOP_LIMIT, 300)
    assert.ok(MIN_ZOOM >= 3 && MIN_ZOOM <= 12) // low enough to show the whole island on a phone
  })
  it('does not use the OneMap or Leaflet code any more', async () => {
    const shopMap = await import('../src/lib/shopMap.js')
    for (const k of ['TILE_URL', 'ATTRIBUTION', 'MAX_ZOOM']) assert.ok(!(k in shopMap), k)
  })
})
