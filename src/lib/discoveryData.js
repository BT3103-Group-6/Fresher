// FR-01: Firestore and callable access for UI-C1. Reads are kept low (NFR-07): one range query per
// geohash bound, shop details and schedules only for the nearest results, and short in-memory caches.
import { boundsFor, nextSlot, withinRadius } from './discovery'
import { toIntervals } from './slots'

// The landing page loads none of Firebase up front (NFR-01): Firestore and Functions are fetched on the first
// search (or earlier through `preload`, e.g. when the postal code field gets focus). Auth is never needed here.
const fbFirestore = () => import('firebase/firestore')
const fbDb = () => import('@/firebaseDb').then((m) => m.db)
export function preload() {
  for (const load of [fbFirestore, fbDb, () => import('firebase/functions'), () => import('@/firebaseFunctions')]) load().catch(() => {})
}

const SEARCH_TTL = 2 * 60e3
const DETAIL_TTL = 5 * 60e3
const SCHEDULE_TTL = 60e3
const cache = new Map()

/** Runs `load` once per key within `ttl`; failures are not cached. */
function cached(key, ttl, load) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value
  const value = load().catch((err) => { cache.delete(key); throw err })
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Postal code -> { lat, lng, label } via the geocode callable (OneMap runs server-side). */
export async function geocode(postalCode) {
  const [{ httpsCallable }, { functions }] = await Promise.all([import('firebase/functions'), import('@/firebaseFunctions')])
  const { data } = await httpsCallable(functions, 'geocode')({ postalCode })
  return data
}

/**
 * Verified shops within the radius: geohash range queries, then the exact distance filter.
 * The status clause is required by the Security Rules, which only expose verified shops.
 */
export function searchShops(center) {
  return cached(`search:${center[0].toFixed(4)},${center[1].toFixed(4)}`, SEARCH_TTL, async () => {
    const [{ collection, endAt, getDocs, orderBy, query, startAt, where }, db] = await Promise.all([fbFirestore(), fbDb()])
    const snaps = await Promise.all(
      boundsFor(center).map(([start, end]) =>
        getDocs(query(collection(db, 'shops'), where('status', '==', 'verified'), orderBy('geohash'), startAt(start), endAt(end)))),
    )
    const byId = new Map()
    for (const snap of snaps) for (const d of snap.docs) byId.set(d.id, { id: d.id, ...d.data() })
    return withinRadius([...byId.values()], center)
  })
}

const activeDocs = async (path) => {
  const [{ collection, getDocs, query, where }, db] = await Promise.all([fbFirestore(), fbDb()])
  const snap = await getDocs(query(collection(db, path), where('active', '==', true)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

const shopDetail = (shopId) =>
  cached(`detail:${shopId}`, DETAIL_TTL, async () => {
    const [services, barbers] = await Promise.all([
      activeDocs(`shops/${shopId}/services`),
      activeDocs(`shops/${shopId}/barbers`),
    ])
    return { services, barbers }
  })

// One query returns every barber's schedule doc for the day (barber-days nobody booked have no doc).
const daySchedules = (shopId, dateKey) =>
  cached(`sched:${shopId}:${dateKey}`, SCHEDULE_TTL, async () => {
    const [{ collection, getDocs, query, where }, db] = await Promise.all([fbFirestore(), fbDb()])
    const snap = await getDocs(query(collection(db, `shops/${shopId}/schedules`), where('date', '==', dateKey)))
    return Object.fromEntries(snap.docs.map((d) => [d.data().barberId, toIntervals(d.data().intervals)]))
  })

/** Earliest free slot (ms) for one shop, or null. Rejects on network/permission errors. */
export async function nextSlotFor(shop, type) {
  const { services, barbers } = await shopDetail(shop.id)
  return nextSlot({
    barbers,
    services,
    shopHours: shop.openingHours,
    type,
    schedulesFor: (dateKey) => daySchedules(shop.id, dateKey),
  })
}
