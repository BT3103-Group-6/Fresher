// FR-01: pure discovery logic (no Firebase imports, so node tests can load it).
import { distanceBetween, geohashQueryBounds } from 'geofire-common'
import { dateOptions, slotsForBarbers } from './slots.js'

export const RADIUS_M = 3000 // requirements FR-01: 3 km
export const NEXT_SLOT_DAYS = 3 // decisions A11
export const NEXT_SLOT_SHOPS = 10 // decisions A11

/** Geohash ranges [start, end] that cover the search circle; each becomes one Firestore range query. */
export const boundsFor = (center, radiusM = RADIUS_M) => geohashQueryBounds(center, radiusM)

/**
 * Exact-distance filter: drops the geohash false positives (and shops without coordinates), adds
 * `distanceM`, and sorts nearest first. A shop exactly on the radius is included.
 * @param {{lat: number, lng: number}[]} shops
 * @param {[number, number]} center [lat, lng]
 */
export function withinRadius(shops, center, radiusM = RADIUS_M) {
  return shops
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({ ...s, distanceM: distanceBetween([s.lat, s.lng], center) * 1000 }))
    .filter((s) => s.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
}

/** Service-type filter over the shop summary; an empty type means "all". */
export const filterByType = (shops, type) =>
  type ? shops.filter((s) => Array.isArray(s.serviceTypes) && s.serviceTypes.includes(type)) : shops

export const formatDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`)

/** "S$25", "S$15 to S$60"; null when the shop has no active service. */
export function formatPriceRange(min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null
  const money = (c) => `S$${c % 100 === 0 ? c / 100 : (c / 100).toFixed(2)}`
  return min === max ? money(min) : `${money(min)} to ${money(max)}`
}

/**
 * Earliest bookable start for a shop, using the same slot logic as UI-C2. Only active barbers and
 * services count. With a type, only services of that type are considered. Each barber is checked for
 * the shortest service they offer, since the earliest slot fits the shortest one.
 * @param {{barbers: object[], services: object[], shopHours?: object, type?: string, now?: number,
 *   schedulesFor: (dateKey: string) => Promise<Record<string, object[]>>}} a
 * @returns {Promise<number | null>} start in ms, or null when none in NEXT_SLOT_DAYS days
 */
export async function nextSlot({ barbers, services, shopHours, type, now = Date.now(), schedulesFor }) {
  const offered = services.filter((s) => s.active !== false && (!type || s.category === type))
  const usable = barbers
    .filter((b) => b.active !== false)
    .map((b) => {
      const mine = offered.filter((s) => (b.serviceIds || []).includes(s.id))
      return mine.length ? { barber: b, durationMin: Math.min(...mine.map((s) => s.durationMin)) } : null
    })
    .filter(Boolean)
  if (!usable.length) return null
  for (const { key } of dateOptions(now, NEXT_SLOT_DAYS)) {
    const schedules = await schedulesFor(key)
    const starts = usable.flatMap(({ barber, durationMin }) =>
      slotsForBarbers({ barbers: [barber], shopHours, dateKey: key, durationMin, schedules, now }))
    if (starts.length) return Math.min(...starts)
  }
  return null
}
