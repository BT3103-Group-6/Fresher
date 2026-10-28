// Landing page shop map (decisions A20): the one Firestore read behind it. Loaded only by ShopMapSection, so it
// costs the landing page nothing until the section scrolls into view. Like discoveryData.js, Firebase itself is
// imported on demand.
import { MAP_SHOP_LIMIT, shapeShops } from './shopMap.js'

let loading

/**
 * Every verified shop, shaped for the map and list, from a single query and cached for the page session (no
 * expiry, no per-shop reads). The status clause is what the Security Rules require. A failed load is not
 * cached, so "Try again" asks again.
 */
export function loadMapShops() {
  loading ??= (async () => {
    const [{ collection, getDocs, limit, query, where }, db] = await Promise.all([
      import('firebase/firestore'),
      import('@/firebaseDb').then((m) => m.db),
    ])
    const snap = await getDocs(query(collection(db, 'shops'), where('status', '==', 'verified'), limit(MAP_SHOP_LIMIT)))
    return shapeShops(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  })().catch((err) => { loading = undefined; throw err })
  return loading
}
