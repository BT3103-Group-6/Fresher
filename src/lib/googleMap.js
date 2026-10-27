// Landing page shop map (decisions A20): the Google Maps glue. This module is only ever loaded with `import()` from
// ShopMapSection, after the section scrolled into view, so the Google script never reaches the first load.
// The browser key is public by design; restrict it to HTTP referrers and the Maps JavaScript API (L46).
import { LABEL_ZOOM, MIN_ZOOM, SG_RESTRICTION, lowestPriceText, pinLabel, pinTitle } from './shopMap.js'
import { RADIUS_M } from './discovery.js'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID' // Advanced Markers need a Map ID
const CALLBACK = '__fresherMapsReady'

export const hasMapsKey = () => Boolean(KEY)

// Google calls window.gm_authFailure when it rejects the key (wrong key, referrer not allowed, API not enabled).
const authListeners = new Set()
export function onAuthFailure(fn) {
  window.gm_authFailure = () => authListeners.forEach((f) => f())
  authListeners.add(fn)
  return () => authListeners.delete(fn)
}

let loading
/** Injects the Maps script once and resolves with the libraries used here. A failed load can be retried. */
export function loadGoogleMaps() {
  if (!KEY) return Promise.reject(new Error('no-key'))
  loading ??= new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) return resolve()
    window[CALLBACK] = resolve
    const script = document.createElement('script')
    script.async = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&language=en&region=SG&callback=${CALLBACK}`
    script.onerror = () => { script.remove(); reject(new Error('script')) }
    document.head.append(script)
  })
    .then(() => Promise.all(['maps', 'marker', 'core'].map((lib) => window.google.maps.importLibrary(lib))))
    .then(([maps, marker, core]) => ({ maps, marker, core }))
    .catch((err) => { loading = undefined; throw err })
  return loading
}

const SVG_NS = 'http://www.w3.org/2000/svg'
// A scissors icon (two crossing blades, two finger rings; original artwork) inside a teardrop pin, in a 30 x 38 box.
function pinSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 30 38')
  svg.setAttribute('width', '30')
  svg.setAttribute('height', '38')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.innerHTML =
    '<path class="pin-body" d="M15 37C15 37 3 25 3 14a12 12 0 0 1 24 0C27 25 15 37 15 37Z"/>'
    + '<g class="pin-scissors"><path d="M10.6 6.6L17.6 17.6M19.4 6.6L12.4 17.6"/>'
    + '<circle cx="18.6" cy="19.6" r="2.3"/><circle cx="11.4" cy="19.6" r="2.3"/></g>'
  return svg
}

function pinContent(shop, matched, dim, showPrices) {
  const price = showPrices ? lowestPriceText(shop) : null
  const el = document.createElement('div')
  el.className = ['shop-pin', price ? 'is-price' : '', matched ? 'is-match' : '', dim ? 'is-dim' : ''].filter(Boolean).join(' ')
  const label = document.createElement('span')
  label.className = 'shop-pin-label'
  label.textContent = pinLabel(shop) // textContent: shop names are owner-entered
  if (price) {
    const pill = document.createElement('span')
    pill.className = 'shop-pin-price'
    pill.textContent = price
    el.append(pill, label)
  } else {
    el.append(pinSvg(), label)
  }
  return el
}

function clusterContent(count, matched, dim) {
  const el = document.createElement('div')
  el.className = ['shop-cluster', matched ? 'has-match' : '', dim ? 'is-dim' : ''].filter(Boolean).join(' ')
  el.textContent = String(count)
  return el
}

const clusterTitle = (count, matched) =>
  `${count} shops${matched ? `, ${matched} match your search` : ''}, press Enter to zoom in`

/**
 * Builds the map inside `el`. Returns a small controller so the Vue component never touches Google types.
 * @param {{maps: object, marker: object, core: object}} libs the result of loadGoogleMaps
 * @param {HTMLElement} el
 * @param {{onSelect: (id: string) => void}} hooks
 */
export async function createShopMap({ maps, marker, core }, el, { onSelect }) {
  const { MarkerClusterer } = await import('@googlemaps/markerclusterer')
  const { Map, Circle } = maps
  const { LatLngBounds } = core
  const { AdvancedMarkerElement } = marker
  const gEvent = window.google.maps.event

  const map = new Map(el, {
    mapId: MAP_ID,
    center: { lat: 1.3521, lng: 103.8198 },
    zoom: 11,
    minZoom: MIN_ZOOM,
    restriction: { latLngBounds: SG_RESTRICTION, strictBounds: true },
    // The wheel never zooms the map (Ctrl/Cmd plus wheel does) and on touch one finger scrolls the page while two
    // fingers move the map; Google shows the matching hint itself.
    gestureHandling: 'cooperative',
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    keyboardShortcuts: true,
  })
  map.fitBounds(SG_RESTRICTION)

  const showLabels = () => el.classList.toggle('show-labels', map.getZoom() >= LABEL_ZOOM)
  map.addListener('zoom_changed', showLabels)

  const entries = new window.Map() // id -> { marker, content }
  const shopOf = new WeakMap() // marker -> { matched }
  let selectedId = null
  let ring = null

  const clusterer = new MarkerClusterer({
    map,
    markers: [],
    renderer: {
      render: ({ count, position, markers }) => {
        const flags = markers.map((m) => shopOf.get(m))
        const matched = flags.filter((f) => f?.matched).length
        const dim = flags.length > 0 && flags.every((f) => f?.dim)
        return new AdvancedMarkerElement({
          position,
          content: clusterContent(count, matched, dim),
          title: clusterTitle(count, matched),
          gmpClickable: true, // focusable, and Enter or Space clicks it (the clusterer zooms in)
          zIndex: 1000 + count,
        })
      },
    },
  })

  return {
    /** Replaces all pins. `matches` (a Set of ids or null) enlarges those pins and dims the rest; `showPrices` swaps them for price pills. */
    setPins(pins, matches, showPrices = false) {
      clusterer.clearMarkers()
      entries.clear()
      const made = pins.map((shop) => {
        const matched = !!matches?.has(shop.id)
        const dim = !!matches && !matched
        const content = pinContent(shop, matched, dim, showPrices)
        if (shop.id === selectedId) content.classList.add('is-selected')
        const m = new AdvancedMarkerElement({
          position: { lat: shop.lat, lng: shop.lng },
          content,
          title: pinTitle(shop, showPrices), // the accessible name
          gmpClickable: true,
          zIndex: shop.id === selectedId ? 2000 : undefined,
        })
        m.addListener('click', () => onSelect(shop.id))
        shopOf.set(m, { matched, dim })
        entries.set(shop.id, { marker: m, content })
        return m
      })
      clusterer.addMarkers(made)
      showLabels()
    },
    /** Shows or clears the search circle; a new circle also becomes the view. */
    setSearch(center) {
      ring?.setMap(null)
      ring = null
      if (!center) return
      ring = new Circle({
        map, center: { lat: center[0], lng: center[1] }, radius: RADIUS_M, clickable: false,
        strokeColor: '#1d5e5a', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#1d5e5a', fillOpacity: 0.08,
      })
      map.fitBounds(ring.getBounds(), 24)
    },
    /** Marks one pin as selected (or none) without rebuilding. */
    select(id) {
      selectedId = id
      for (const [pid, e] of entries) {
        e.content.classList.toggle('is-selected', pid === id)
        e.marker.zIndex = pid === id ? 2000 : null // the selected pin rises above its neighbours
      }
    },
    focusPin(id) {
      const e = entries.get(id)
      if (!e) return
      if (e.marker.map) return e.marker.focus()
      // Clustered right now: zoom to it so there is a pin to focus.
      map.setCenter(e.marker.position)
      map.setZoom(16)
      gEvent.addListenerOnce(map, 'idle', () => setTimeout(() => e.marker.focus(), 250))
    },
    /** The container may have been hidden (list view) or resized. */
    invalidate: () => gEvent.trigger(map, 'resize'),
    fitPins(pins) {
      if (pins.length === 1) {
        map.setCenter({ lat: pins[0].lat, lng: pins[0].lng })
        map.setZoom(14)
      } else if (pins.length) {
        const bounds = new LatLngBounds()
        for (const p of pins) bounds.extend({ lat: p.lat, lng: p.lng })
        map.fitBounds(bounds, 32)
      }
    },
    destroy() {
      clusterer.clearMarkers()
      ring?.setMap(null)
      gEvent.clearInstanceListeners(map)
      el.replaceChildren()
    },
  }
}
