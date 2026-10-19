// A18: deterministic generator for the realistic demo dataset. Pure: no Firebase, no clock except the `now` you pass.
// Returns plain documents with times as epoch milliseconds; write.mjs turns them into Timestamps.
// Same seed and same `now` give identical data. The catalogue (shops, barbers, services, customers) never depends
// on the date; bookings are seeded per barber-day, so a given date always gets the same bookings.
import { createRequire } from 'node:module'
import { geohashForLocation } from 'geofire-common'
import { DAY_MS, GRID_MS, MINUTE_MS, sgDateKey, sgTimeToMs, weekdayOf } from '../../src/lib/slots.js'
import { makeRng } from './rng.mjs'
import {
  BARBER_NAMES, BLOCK_REASONS, NAME_GROUPS, SERVICE_TEMPLATES, SERVICE_WEIGHT, SHOP_NAMES, SHOP_SLOTS, SHOWCASE,
  SHOWCASE_PHONE, TIER,
} from './catalogue.mjs'

// Reuse the server code, so the demo data follows the same rules as the real functions.
const require = createRequire(import.meta.url)
const { summarizeServices } = require('../../functions/discovery.js')
const { planReminders } = require('../../functions/notifications.js')
const { contribution, delta } = require('../../functions/stats.js')
const { SECTORS } = require('../../functions/postalSectors.js')

export const DEMO_SEED = 'fresher-demo-v1'
export const DEFAULT_DENSITY = 0.75 // bookings-per-barber-day scale; sized so a fresh seed is about 20,000 writes
export const PAST_DAYS = 14
export const FUTURE_DAYS = 7
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const ACTIVE = ['CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW'] // statuses that keep a schedule interval
const HOUR = 60 * MINUTE_MS
const CUSTOMERS = 350
const PAST_MARGIN = 25 * MINUTE_MS // a booking counts as past when it ended this long before now
const FUTURE_MARGIN = 15 * MINUTE_MS // and as upcoming when it starts this long after now
const FEMALE_MALAY = new Set(NAME_GROUPS.find((g) => g.malay).female)

const pad2 = (n) => String(n).padStart(2, '0')
const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
const round4 = (x) => Math.round(x * 1e4) / 1e4
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const maskPhone = (phone) => `+65 ${phone[3]}••• ••${phone.slice(-2)}` // same as confirmBooking
export const expireAfter12Months = (at) => {
  const d = new Date(at)
  d.setUTCMonth(d.getUTCMonth() + 12)
  return d.getTime()
}

// ---------- shops, services, barbers ----------

const DAY_FACTOR = { mon: 0.8, tue: 0.8, wed: 0.9, thu: 1.0, fri: 1.25, sat: 1.6, sun: 1.4 }
// Relative demand by local hour: evenings busier; weekends flatter through the afternoon.
const HOUR_WEIGHT = [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.6, 0.7, 0.8, 0.9, 0.6, 0.6, 0.8, 1.0, 1.4, 1.7, 1.6, 1.0, 0.6, 0.3, 0.3]

function shopHours(r, tier, flagship) {
  const all = (start, end) => Object.fromEntries(WEEKDAYS.map((d) => [d, [{ start, end }]]))
  if (flagship) return all('09:00', '21:00')
  const start = r.pick(tier === 'neighbourhood' ? ['09:00', '10:00', '10:00'] : tier === 'mid' ? ['10:00', '10:00', '11:00'] : ['10:00', '11:00'])
  const end = r.pick(tier === 'neighbourhood' ? ['19:00', '20:00', '21:00'] : tier === 'mid' ? ['20:00', '21:00'] : ['20:00', '21:00', '22:00'])
  const weekendEnd = r.chance(0.4) ? '19:00' : end
  const roll = r.f()
  const rest = roll < 0.15 ? [] : roll < 0.85 ? [r.pick(['mon', 'tue', 'wed', 'sun'])] : r.sample(['mon', 'tue', 'wed'], 2)
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, rest.includes(d) ? [] : [{ start, end: d === 'sat' || d === 'sun' ? weekendEnd : end }]]),
  )
}

function barberHours(r, open, flagship) {
  const openDays = WEEKDAYS.filter((d) => open[d].length)
  const offCount = flagship ? r.int(0, 1) : r.int(0, Math.max(0, Math.min(2, openDays.length - 4)))
  const off = new Set(r.sample(openDays, offCount))
  const late = r.pick([0, 0, 60, 120])
  const early = r.pick([0, 0, 60, 120])
  const split = r.chance(0.2)
  return Object.fromEntries(
    WEEKDAYS.map((d) => {
      if (!open[d].length || off.has(d)) return [d, []]
      const os = mins(open[d][0].start)
      const oe = mins(open[d][0].end)
      let s = os + late
      let e = oe - early
      if (e - s < 300) [s, e] = [os, oe]
      if (split && s <= 12 * 60 && e >= 16 * 60) {
        return [d, [{ start: hhmm(s), end: '13:00' }, { start: '14:00', end: hhmm(e) }]]
      }
      return [d, [{ start: hhmm(s), end: hhmm(e) }]]
    }),
  )
}

function buildShops(seed) {
  const names = makeRng(`${seed}|names`)
  const pool = Object.fromEntries(Object.entries(SHOP_NAMES).map(([t, list]) => [t, names.shuffle(list)]))
  const taken = { neighbourhood: 0, mid: 0, premium: 0 }
  const postals = new Set()
  let flagshipDone = false
  return SHOP_SLOTS.map(([key, area, sector, regionName, street, tier], i) => {
    const no = pad2(i + 1)
    const id = `demo-${no}-${key}`
    const r = makeRng(`${seed}|shop|${id}`)
    const cfg = TIER[tier]
    const flagship = tier === 'premium' && !flagshipDone
    flagshipDone = flagshipDone || flagship
    const [, sLat, sLng] = SECTORS[sector]
    const lat = round4(sLat + (r.f() - 0.5) * 0.008)
    const lng = round4(sLng + (r.f() - 0.5) * 0.008)
    let postalCode
    do postalCode = `${sector}${String(r.int(0, 9999)).padStart(4, '0')}`
    while (postals.has(postalCode))
    postals.add(postalCode)
    const address = `${r.int(1, 690)} ${street}${tier === 'neighbourhood' ? '' : ` #01-${pad2(r.int(1, 60))}`}, Singapore`
    const open = shopHours(r, tier, flagship)

    // Services: the basic cut plus a random selection this tier offers.
    const offerable = cfg.offer.filter((k) => SERVICE_TEMPLATES[k].price[cfg.idx])
    const keys = ['gents-cut', ...r.sample(offerable, r.int(...cfg.services) - 1)]
    const services = Object.keys(SERVICE_TEMPLATES).filter((k) => keys.includes(k)).map((k) => {
      const t = SERVICE_TEMPLATES[k]
      const [lo, hi] = t.price[cfg.idx]
      return {
        id: k, name: t.name, category: t.category, durationMin: t.dur[cfg.idx],
        priceCents: Math.min(hi, Math.max(lo, Math.round(r.int(lo, hi) / 50) * 50)), active: true,
      }
    })

    // Barbers: every barber cuts; specialist services go to some of them; every service has at least one barber.
    const chosen = r.sample(BARBER_NAMES, r.int(...cfg.barbers))
    const barbers = chosen.map((displayName) => {
      const barberId = slug(displayName)
      const serviceIds = services
        .filter((s) => s.id === 'gents-cut' || r.chance(s.category === 'colour' || s.category === 'perm' ? 0.5 : 0.75))
        .map((s) => s.id)
      return {
        id: barberId, uid: `${id}-${barberId}`, email: `${barberId}@${id}.example.com`, displayName, active: true,
        serviceIds, popularity: 0.7 + r.f() * 0.6, workingHours: barberHours(r, open, flagship),
      }
    })
    for (const s of services) {
      if (!barbers.some((b) => b.serviceIds.includes(s.id))) r.pick(barbers).serviceIds.push(s.id)
    }
    for (const b of barbers) b.serviceIds = services.filter((s) => b.serviceIds.includes(s.id)).map((s) => s.id)

    return {
      id, no, name: pool[tier][taken[tier]++], tier, region: regionName, area, sector, address, postalCode, lat, lng,
      geohash: geohashForLocation([lat, lng]), status: 'verified', flagship,
      latePolicy: r.chance(cfg.flagChance) ? 'flag' : 'block', noticeMins: r.pick(cfg.notice),
      ...summarizeServices(services), openingHours: open, tz: 'Asia/Singapore',
      services, barbers, ownerUid: `${id}-owner`, ownerEmail: `owner@${id}.example.com`,
    }
  })
}

// ---------- customers ----------

function buildCustomers(seed, shops) {
  const r = makeRng(`${seed}|customers`)
  const regions = shops.map((s) => s.region)
  const phones = new Set(['+6591230010', '+6591230013'])
  const nameOf = () => {
    const g = r.weighted(NAME_GROUPS, (x) => x.weight)
    const given = r.pick(g.given)
    const family = r.pick(g.family)
    return g.malay ? `${given} ${FEMALE_MALAY.has(given) ? 'binte' : 'bin'} ${family}` : `${given} ${family}`
  }
  const showcase = SHOWCASE.map((s, i) => ({
    id: `demo-cust-${s.key}`, phoneE164: SHOWCASE_PHONE(i), displayName: s.name, showcase: s.key, role: s.role, region: null,
  }))
  for (const c of showcase) phones.add(c.phoneE164)
  const ordinary = []
  for (let i = 1; i <= CUSTOMERS; i++) {
    let phone
    do phone = `+659${String(r.int(0, 9999999)).padStart(7, '0')}`
    while (phones.has(phone) || phone.endsWith('0000'))
    phones.add(phone)
    ordinary.push({ id: `demo-cust-${String(i).padStart(4, '0')}`, phoneE164: phone, displayName: nameOf(), region: r.pick(regions), showcase: null })
  }
  return [...showcase, ...ordinary]
}

// ---------- bookings ----------

const rangesMs = (hours, dateKey) => (hours[weekdayOf(dateKey)] || []).map((x) => [sgTimeToMs(dateKey, x.start), sgTimeToMs(dateKey, x.end)])
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1]

/** Free 15-minute-grid starts for a service of `durationMs`, weighted by time of day. */
function candidateStarts(ranges, durationMs, busy, dayStart, weekend, now, off) {
  const out = []
  for (const [rs, re] of ranges) {
    for (let t = Math.ceil(rs / GRID_MS) * GRID_MS; t + durationMs <= re; t += GRID_MS) {
      if (busy.some((b) => overlaps([t, t + durationMs], b))) continue
      if (off === 0 && !(t + durationMs + PAST_MARGIN <= now || t >= now + FUTURE_MARGIN)) continue // not around "now"
      const hour = Math.floor((t - dayStart) / HOUR)
      out.push({ t, w: HOUR_WEIGHT[hour] * (weekend && hour >= 10 && hour <= 17 ? 1.5 : 1) })
    }
  }
  return out
}

function placeBlocks(seed, shop, barber, dateKey, now) {
  const r = makeRng(`${seed}|block|${shop.id}|${barber.id}|${dateKey}`)
  if (!r.chance(0.06)) return []
  const ranges = rangesMs(barber.workingHours, dateKey)
  if (!ranges.length) return []
  const [rs, re] = r.pick(ranges)
  const len = r.pick([60, 60, 90, 120, 180, 240]) * MINUTE_MS
  const slots = []
  for (let t = Math.ceil(rs / GRID_MS) * GRID_MS; t + len <= re; t += GRID_MS) slots.push(t)
  if (!slots.length) return []
  const start = r.pick(slots)
  return [{
    shopId: shop.id, id: `blk-${shop.no}-${barber.id}-${dateKey}`, barberId: barber.id, start, end: start + len,
    reason: r.pick(BLOCK_REASONS), createdBy: barber.uid, createdAt: now - r.int(2, 96) * HOUR, dateKey,
  }]
}

function placeDay(seed, shop, barber, dateKey, off, blocks, now, density) {
  const r = makeRng(`${seed}|day|${shop.id}|${barber.id}|${dateKey}`)
  const ranges = rangesMs(barber.workingHours, dateKey)
  if (!ranges.length) return []
  const wd = weekdayOf(dateKey)
  const dayStart = sgTimeToMs(dateKey, '00:00')
  const hoursWorked = ranges.reduce((s, [a, b]) => s + (b - a), 0) / HOUR
  const horizon = off > 2 ? 0.75 : off > 0 ? 0.95 : 1
  const mean = TIER[shop.tier].baseDensity * DAY_FACTOR[wd] * barber.popularity * (hoursWorked / 9) * horizon * density
  const count = Math.floor(mean) + (r.f() < mean % 1 ? 1 : 0)
  const busy = blocks.map((b) => [b.start, b.end])
  const offered = shop.services.filter((s) => barber.serviceIds.includes(s.id))
  const out = []
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const svc = r.weighted(offered, (s) => SERVICE_WEIGHT[s.id] || 1)
      const slots = candidateStarts(ranges, svc.durationMin * MINUTE_MS, busy, dayStart, wd === 'sat' || wd === 'sun', now, off)
      if (!slots.length) continue
      const { t } = r.weighted(slots, (x) => x.w)
      const end = t + svc.durationMin * MINUTE_MS
      busy.push([t, end])
      const roll = r.f()
      out.push({
        id: `dm-${shop.no}-${dateKey}-${barber.id}-${hhmm(Math.round((t - dayStart) / MINUTE_MS)).replace(':', '')}`,
        shopId: shop.id, shop, barber, service: svc, dateKey, start: t, end,
        status: t >= now + FUTURE_MARGIN ? 'CONFIRMED' : roll < 0.04 ? 'NO_SHOW' : roll < 0.13 ? 'CANCELLED' : 'COMPLETED',
        customer: null,
      })
      break
    }
  }
  return out
}

// ---------- the whole dataset ----------

export function generateDemoData({ now = Date.now(), seed = DEMO_SEED, density = DEFAULT_DENSITY } = {}) {
  const todayKey = sgDateKey(now)
  const todayStart = sgTimeToMs(todayKey, '00:00')
  const shops = buildShops(seed)
  const customers = buildCustomers(seed, shops)

  // Blocks first (next 6 days), then bookings around them.
  const blocks = []
  const drafts = []
  for (const shop of shops) {
    for (const barber of shop.barbers) {
      for (let off = -PAST_DAYS; off <= FUTURE_DAYS; off++) {
        const dayStart = todayStart + off * DAY_MS
        const dateKey = sgDateKey(dayStart)
        const dayBlocks = off >= 1 && off <= 6 ? placeBlocks(seed, shop, barber, dateKey, now) : []
        blocks.push(...dayBlocks)
        drafts.push(...placeDay(seed, shop, barber, dateKey, off, dayBlocks, now, density))
      }
    }
  }
  drafts.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))

  // Customers never overlap themselves (cancelled bookings free their time).
  const busyOf = new Map()
  const isFree = (cid, d) => !(busyOf.get(cid) || []).some((x) => overlaps([d.start, d.end], x))
  const give = (d, c) => {
    d.customer = c
    if (d.status !== 'CANCELLED') busyOf.set(c.id, [...(busyOf.get(c.id) || []), [d.start, d.end]])
  }
  const release = (d) => {
    if (d.customer && d.status !== 'CANCELLED') {
      const list = busyOf.get(d.customer.id).filter((x) => !(x[0] === d.start && x[1] === d.end))
      busyOf.set(d.customer.id, list)
    }
    d.customer = null
  }
  const setStatus = (d, status) => {
    const c = d.customer
    release(d)
    d.status = status
    if (c) give(d, c)
  }

  assignShowcase({ seed, shops, customers, drafts, give, isFree, setStatus, release, now })

  const r = makeRng(`${seed}|assign`)
  const ordinary = customers.filter((c) => !c.showcase)
  const byRegion = Object.fromEntries([...new Set(ordinary.map((c) => c.region))].map((g) => [g, ordinary.filter((c) => c.region === g)]))
  for (const d of drafts) {
    if (d.customer) continue
    const local = byRegion[d.shop.region]
    const list = r.chance(0.85) ? local : ordinary
    let picked = null
    for (let k = 0; k < 12 && !picked; k++) {
      const c = list[Math.floor(list.length * r.f() ** 1.7)] // low indexes book more often: repeat customers
      if (isFree(c.id, d)) picked = c
    }
    picked ||= ordinary.find((c) => isFree(c.id, d))
    give(d, picked)
  }

  const out = finalize({ seed, now, drafts, blocks })
  const { waitlist, queue } = extras({ seed, now, todayKey, shops, customers })
  return {
    meta: { seed, now, todayKey, density, pastDays: PAST_DAYS, futureDays: FUTURE_DAYS },
    shops, customers, ...out, waitlist, queue,
    accounts: buildAccounts(shops),
    showcase: customers.filter((c) => c.showcase).map((c) => ({ uid: c.id, phoneE164: c.phoneE164, displayName: c.displayName, role: c.role })),
  }
}

/** Fixed customers for the demo: deposit (2+ no-shows at a shop) and history across shops. */
function assignShowcase({ seed, shops, customers, drafts, give, isFree, setStatus, now }) {
  const r = makeRng(`${seed}|showcase`)
  const pastOf = (d) => d.start < now
  const take = (shopId, pred, n, customer, { distinctDays = true } = {}) => {
    const pool = r.shuffle(drafts.filter((d) => d.shopId === shopId && !d.customer && pred(d) && isFree(customer.id, d)))
    const days = new Set()
    const got = []
    for (const d of pool) {
      if (got.length >= n) break
      if (distinctDays && days.has(d.dateKey)) continue
      days.add(d.dateKey)
      got.push(d)
    }
    return got
  }
  const shopsIn = (g, tier) => shops.filter((s) => s.region === g && (!tier || s.tier === tier))
  const cust = (key) => customers.find((c) => c.showcase === key)

  // Deposit demo: two or more recorded no-shows at one shop.
  const deposit = [['s1', 'east', 2], ['s2', 'central', 3], ['s3', 'west', 2]]
  for (const [key, g, n] of deposit) {
    const c = cust(key)
    const shop = shopsIn(g, 'mid')[0]
    for (const d of take(shop.id, (x) => pastOf(x) && x.status !== 'CANCELLED', n, c)) {
      give(d, c)
      setStatus(d, 'NO_SHOW')
    }
  }
  // History demo: completed visits at three shops in one region, one upcoming booking, one cancelled.
  const history = [['s4', 'central'], ['s5', 'east'], ['s6', 'west'], ['s7', 'north-east'], ['s8', 'north']]
  for (const [key, g] of history) {
    const c = cust(key)
    const choices = r.sample(shopsIn(g), 3)
    choices.forEach((shop, i) => {
      for (const d of take(shop.id, (x) => pastOf(x) && x.status === 'COMPLETED', key === 's8' ? 1 : 2, c)) give(d, c)
      if (i === 0) for (const d of take(shop.id, (x) => !pastOf(x) && x.status === 'CONFIRMED', 1, c)) give(d, c)
      if (i === 1 && (key === 's5' || key === 's7')) {
        for (const d of take(shop.id, (x) => pastOf(x) && x.status === 'CANCELLED', 1, c)) give(d, c)
      }
    })
    if (key === 's8') {
      // One no-show at a shop: below the deposit threshold.
      const [d] = take(choices[2].id, (x) => pastOf(x) && x.status === 'COMPLETED' && !x.customer, 1, c)
      if (d) {
        give(d, c)
        setStatus(d, 'NO_SHOW')
      }
    }
  }
}

function finalize({ seed, now, drafts, blocks }) {
  const appointments = []
  const audit = []
  const notifications = []
  const statContrib = []
  const dailyStats = new Map() // `${shopId}|${dateKey}` -> {shopId, id, barbers}
  const shopStats = new Map() // `${customerId}|${shopId}` -> {customerId, shopId, noShowCount, lateCancels}
  const rec = (a, actorUid, role, action, from, to, at, id) =>
    audit.push({ id, bookingId: a.requestId, shopId: a.shopId, actorUid, role, action, fromStatus: from, toStatus: to, at, expireAt: expireAfter12Months(at) })

  for (const d of drafts) {
    const r = makeRng(`${seed}|apt|${d.id}`)
    const c = d.customer
    const a = {
      requestId: d.id, shopId: d.shopId, barberId: d.barber.id, serviceId: d.service.id, customerId: c.id,
      customerName: c.displayName, customerPhoneMasked: maskPhone(c.phoneE164), start: d.start, end: d.end,
      status: d.status, holdExpiresAt: null, priceCents: d.service.priceCents, durationMin: d.service.durationMin,
    }
    const staff = d.barber.uid
    const bump = (field) => {
      const k = `${c.id}|${d.shopId}`
      const row = shopStats.get(k) || { customerId: c.id, shopId: d.shopId, noShowCount: 0, lateCancels: 0 }
      row[field]++
      shopStats.set(k, row)
    }
    let bookedAt
    if (d.status === 'CANCELLED') {
      const late = d.shop.latePolicy === 'flag' && r.chance(0.3)
      const notice = d.shop.noticeMins * MINUTE_MS
      const cancelAt = late ? d.start - r.int(10 * MINUTE_MS, notice - MINUTE_MS) : d.start - notice - r.int(30 * MINUTE_MS, 48 * HOUR)
      bookedAt = cancelAt - r.int(30 * MINUTE_MS, 5 * DAY_MS)
      a.lateCancel = late
      if (late) bump('lateCancels')
      rec(a, null, 'customer', 'hold', null, 'HELD', bookedAt - 2 * MINUTE_MS, `${d.id}_HELD`)
      rec(a, c.id, 'customer', 'confirm', 'HELD', 'CONFIRMED', bookedAt, `${d.id}_CONFIRMED`)
      rec(a, c.id, 'customer', 'cancel', 'CONFIRMED', 'CANCELLED', cancelAt, `${d.id}_CANCELLED`)
    } else {
      bookedAt = d.start - r.int(HOUR, 9 * DAY_MS)
      if (d.status === 'CONFIRMED') bookedAt = Math.min(bookedAt, now - r.int(2 * MINUTE_MS, 6 * HOUR), d.start - 5 * MINUTE_MS)
      rec(a, null, 'customer', 'hold', null, 'HELD', bookedAt - 2 * MINUTE_MS, `${d.id}_HELD`)
      rec(a, c.id, 'customer', 'confirm', 'HELD', 'CONFIRMED', bookedAt, `${d.id}_CONFIRMED`)
      if (d.status === 'COMPLETED') {
        a.actualStart = d.start + r.int(-5, 12) * MINUTE_MS
        a.actualEnd = a.actualStart + Math.max(10, d.service.durationMin + r.int(-5, 10)) * MINUTE_MS
        rec(a, staff, 'barber', 'start', 'CONFIRMED', 'IN_SERVICE', a.actualStart, `${d.id}_IN_SERVICE`)
        rec(a, staff, 'barber', 'finish', 'IN_SERVICE', 'COMPLETED', a.actualEnd, `${d.id}_COMPLETED`)
      } else if (d.status === 'NO_SHOW') {
        a.noShowAt = d.start + r.int(15, 40) * MINUTE_MS
        bump('noShowCount')
        rec(a, staff, 'barber', 'noShow', 'CONFIRMED', 'NO_SHOW', a.noShowAt, `${d.id}_noShow`)
      } else {
        addTasks(notifications, a, bookedAt, now)
      }
    }
    appointments.push(a)

    const contrib = contribution({ ...a, start: { toMillis: () => a.start } })
    if (contrib) {
      statContrib.push({ shopId: a.shopId, id: a.requestId, ...contrib })
      for (const e of delta(null, contrib)) {
        const key = `${a.shopId}|${e.dateKey}`
        const day = dailyStats.get(key) || { shopId: a.shopId, id: e.dateKey, barbers: {} }
        const b = (day.barbers[e.barberId] ||= { completed: 0, valueCents: 0, noShows: 0, bookedMin: 0 })
        for (const f of ['completed', 'valueCents', 'noShows', 'bookedMin']) b[f] += e[f]
        dailyStats.set(key, day)
      }
    }
  }

  // Schedule documents: one per barber-day, holding the bookings that keep an interval and the personal blocks.
  const sched = new Map()
  const doc = (shopId, barberId, dateKey) => {
    const id = `${barberId}_${dateKey}`
    const key = `${shopId}|${id}`
    if (!sched.has(key)) sched.set(key, { shopId, id, barberId, date: dateKey, intervals: [] })
    return sched.get(key)
  }
  for (const a of appointments) {
    if (ACTIVE.includes(a.status)) doc(a.shopId, a.barberId, sgDateKey(a.start)).intervals.push({ start: a.start, end: a.end, kind: 'booking', refId: a.requestId })
  }
  for (const b of blocks) doc(b.shopId, b.barberId, b.dateKey).intervals.push({ start: b.start, end: b.end, kind: 'block', refId: b.id })
  const schedules = [...sched.values()].map((s) => {
    s.intervals.sort((x, y) => x.start - y.start)
    return { ...s, version: s.intervals.length }
  })
  const cleanBlocks = blocks.map(({ dateKey, ...b }) => b)

  return {
    appointments, audit, notifications, schedules, blocks: cleanBlocks, statContrib,
    dailyStats: [...dailyStats.values()], shopStats: [...shopStats.values()],
  }
}

/** The FR-09 tasks confirmBooking would have made at `bookedAt`; reminders already due are marked sent. */
function addTasks(out, a, bookedAt, now) {
  const base = { bookingId: a.requestId, shopId: a.shopId, barberId: a.barberId, apptStart: a.start, channel: 'sms', rev: 1 }
  out.push({
    id: `${a.requestId}_confirmation`, ...base, type: 'confirmation', dueAt: bookedAt, status: 'sent',
    attempts: [{ at: bookedAt + 15e3, channel: 'sms', attempt: 1, rev: 1, outcome: 'sent' }], createdAt: bookedAt, plannedAt: bookedAt,
  })
  for (const { type, dueAt } of planReminders(a.start, bookedAt)) {
    const due = dueAt <= now
    out.push({
      id: `${a.requestId}_${type}`, ...base, type, dueAt, status: due ? 'sent' : 'pending',
      ...(due ? {} : { nextAttemptAt: dueAt }),
      attempts: due ? [{ at: Math.min(dueAt + 40e3, now), channel: 'sms', attempt: 1, rev: 1, outcome: 'sent' }] : [],
      createdAt: bookedAt,
    })
  }
}

function extras({ seed, now, todayKey, shops, customers }) {
  const r = makeRng(`${seed}|extras`)
  const dateEnd = (key) => sgTimeToMs(key, '00:00') + DAY_MS
  const dayKey = (offset) => sgDateKey(sgTimeToMs(todayKey, '00:00') + offset * DAY_MS)

  // Waitlist: six waiting entries at busy premium shops, today to +3 days.
  const premium = shops.filter((s) => s.tier === 'premium')
  const waiters = [customers.find((c) => c.showcase === 's5'), customers.find((c) => c.showcase === 's6'), ...r.sample(customers.filter((c) => !c.showcase), 4)]
  const waitlist = waiters.map((c, i) => {
    const shop = premium[i % premium.length]
    const barber = i % 2 === 0 ? null : r.pick(shop.barbers.filter((b) => b.serviceIds.includes('gents-cut')))
    const date = dayKey(r.int(0, 3))
    return {
      id: `${c.id}_${shop.id}_gents-cut_${date}_${barber ? barber.id : 'any'}`, shopId: shop.id, serviceId: 'gents-cut',
      barberId: barber ? barber.id : null, date, customerId: c.id, customerName: c.displayName,
      joinedAt: now - r.int(1, 30) * HOUR, expiresAt: dateEnd(date), status: 'waiting',
    }
  })

  // Walk-ins today at the flagship shop (open seven days): two done, one in service, three waiting.
  const shop = shops.find((s) => s.flagship)
  const cut = shop.services.find((s) => s.id === 'gents-cut')
  const [b1, b2] = shop.barbers
  const walkIn = (i, barber, status, joinedAgo, extra) => ({
    shopId: shop.id, id: `dmq-${shop.no}-${todayKey}-${i}`, barberId: barber.id, walkInName: `Walk-in ${r.pick(['Kumar', 'Wei', 'Hakim', 'Jason', 'Farid', 'Ryan'])}`,
    serviceId: cut.id, durationMin: cut.durationMin, status, joinedAt: now - joinedAgo * MINUTE_MS, createdBy: shop.ownerUid, ...extra,
  })
  const queue = [
    walkIn(1, b1, 'done', 150, { actualStart: now - 135 * MINUTE_MS, actualEnd: now - 135 * MINUTE_MS + cut.durationMin * MINUTE_MS }),
    walkIn(2, b2, 'done', 100, { actualStart: now - 90 * MINUTE_MS, actualEnd: now - 90 * MINUTE_MS + cut.durationMin * MINUTE_MS }),
    walkIn(3, b1, 'in_service', 30, { actualStart: now - 10 * MINUTE_MS }),
    walkIn(4, b2, 'waiting', 20, {}),
    walkIn(5, b1, 'waiting', 12, {}),
    walkIn(6, b2, 'waiting', 5, {}),
  ]
  return { waitlist, queue }
}

function buildAccounts(shops) {
  const accounts = []
  for (const s of shops) {
    accounts.push({ uid: s.ownerUid, email: s.ownerEmail, claims: { shopId: s.id, role: 'owner' }, shopId: s.id })
    for (const b of s.barbers) accounts.push({ uid: b.uid, email: b.email, claims: { shopId: s.id, role: 'barber', barberId: b.id }, shopId: s.id })
  }
  return accounts
}
