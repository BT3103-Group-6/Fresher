// Landing page shop map (decisions A20): pure data shaping, region grouping and map constants. No Firebase or
// Google Maps imports, so node tests can load it and the landing page never pays for it (the map section imports it).
import { formatPriceRange } from './discovery.js'
import { REGIONS, placeOfPostalCode } from './regions.js'

/** Shops read for the map in one query (L44). */
export const MAP_SHOP_LIMIT = 300

/** The map cannot be panned outside Singapore: [[south, west], [north, east]] (also what `inSingapore` checks). */
export const SG_BOUNDS = [[1.144, 103.535], [1.494, 104.0]]
/** The same box in the shape the Google Maps `restriction` option takes. */
export const SG_RESTRICTION = { south: SG_BOUNDS[0][0], west: SG_BOUNDS[0][1], north: SG_BOUNDS[1][0], east: SG_BOUNDS[1][1] }
export const MIN_ZOOM = 10
export const LABEL_ZOOM = 14 // from this zoom every pin shows its name

export const OTHER_REGION = { key: 'other', label: 'Other' }

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
export const inSingapore = (lat, lng) =>
  isNum(lat) && isNum(lng) && lat >= SG_BOUNDS[0][0] && lat <= SG_BOUNDS[1][0] && lng >= SG_BOUNDS[0][1] && lng <= SG_BOUNDS[1][1]

/**
 * One shop document -> what the map and the list need. Region and area are derived from the postal code
 * (A20); a shop with an unknown postal sector gets region "other" and no area. `hasPin` is false when the
 * coordinates are missing or outside Singapore: the shop is then only in the list.
 */
export function shapeShop(doc) {
  const place = placeOfPostalCode(doc.postalCode)
  const lat = isNum(doc.lat) ? doc.lat : null
  const lng = isNum(doc.lng) ? doc.lng : null
  const priceMin = Number.isInteger(doc.priceMin) ? doc.priceMin : null
  const priceMax = Number.isInteger(doc.priceMax) ? doc.priceMax : null
  return {
    id: doc.id,
    name: doc.name,
    lat,
    lng,
    hasPin: inSingapore(lat, lng),
    area: place?.area ?? null,
    region: place?.region ?? OTHER_REGION.key,
    priceMin,
    priceMax,
    priceText: formatPriceRange(priceMin, priceMax) ?? 'Not listed',
    serviceTypes: Array.isArray(doc.serviceTypes) ? doc.serviceTypes.filter((t) => typeof t === 'string') : [],
  }
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** Shop documents (`{ id, ...data }`) -> shaped shops sorted by name. Drops anything unnamed or not verified. */
export function shapeShops(docs) {
  return docs
    .filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string' && d.name.trim() && (d.status === undefined || d.status === 'verified'))
    .map(shapeShop)
    .sort(byName)
}

/** The shops that get a pin. */
export const pinsOf = (shops) => shops.filter((s) => s.hasPin)

/**
 * Groups shops by region for the list view: always the five regions in fixed order (a region with no shop
 * has count 0), then "Other" only when some shop has no known region. Shops are sorted by name in a group.
 * @returns {{key: string, label: string, count: number, shops: object[]}[]}
 */
export function groupByRegion(shops) {
  const groups = REGIONS.map((r) => ({ ...r, shops: [] }))
  const other = { ...OTHER_REGION, shops: [] }
  for (const s of shops) (groups.find((g) => g.key === s.region) ?? other).shops.push(s)
  if (other.shops.length) groups.push(other)
  return groups.map((g) => ({ ...g, shops: [...g.shops].sort(byName), count: g.shops.length }))
}

/** "1 verified shop" / "50 verified shops across all five regions" text for the section summary. */
export function mapSummary(shops) {
  const n = shops.length
  if (!n) return 'No verified shops yet.'
  const filled = new Set(shops.map((s) => s.region).filter((r) => r !== OTHER_REGION.key)).size
  const where = filled === 1 ? 'in 1 region' : filled ? `across ${filled} regions` : ''
  return `${n} verified ${n === 1 ? 'shop' : 'shops'}${where ? ` ${where}` : ''}.`
}

/** Accessible name of a pin: the shop, then its area when known. */
export const pinLabel = (shop) => (shop.area ? `${shop.name}, ${shop.area}` : shop.name)

/** "S$18" (the shop's lowest price) for a price pin, or null when no price is listed. */
export const lowestPriceText = (shop) => (Number.isInteger(shop.priceMin) ? formatPriceRange(shop.priceMin, shop.priceMin) : null)

/** Name of a pin, with the lowest price added when the price pins are on and the shop has one. */
export function pinTitle(shop, showPrices = false) {
  const price = showPrices ? lowestPriceText(shop) : null
  return price ? `${pinLabel(shop)}, from ${price}` : pinLabel(shop)
}

/**
 * Which shops the current search matches: a Set of ids, or null when there is no search or nothing matched
 * (then nothing is dimmed). `ids` are the ids of the results on the page (within 3 km and of the chosen type).
 */
export function matchSet(searched, ids) {
  if (!searched || !ids?.length) return null
  return new Set(ids)
}
