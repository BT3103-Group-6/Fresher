// A18: validation and sizing for the demo dataset. Works on plain documents (times in ms), so it checks both the
// generated dataset and the data read back from Firestore. Returns a list of problems; empty means valid.
import { createRequire } from 'node:module'
import { distanceBetween, geohashForLocation } from 'geofire-common'
import { GRID_MS, MINUTE_MS, sgDateKey, sgTimeToMs, weekdayOf } from '../../src/lib/slots.js'
import { ACTIVE, maskPhone } from './generate.mjs'

const require = createRequire(import.meta.url)
const { summarizeServices, CATEGORIES } = require('../../functions/discovery.js')
const { planReminders } = require('../../functions/notifications.js')
const { contribution, delta } = require('../../functions/stats.js')
const { SECTORS } = require('../../functions/postalSectors.js')

const STATUSES = ['HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED']
const REQUEST_ID = /^[A-Za-z0-9-]{16,64}$/
const FIELDS = ['completed', 'valueCents', 'noShows', 'bookedMin']
const overlap = (a, b) => a.start < b.end && b.start < a.end
const isMoney = (x) => Number.isInteger(x) && x >= 0
const inRanges = (hours, start, end) => {
  const key = sgDateKey(start)
  return ((hours && hours[weekdayOf(key)]) || []).some((r) => sgTimeToMs(key, r.start) <= start && end <= sgTimeToMs(key, r.end))
}
const CHAINS = {
  CONFIRMED: [['HELD', 'hold', null, 'HELD'], ['CONFIRMED', 'confirm', 'HELD', 'CONFIRMED']],
  COMPLETED: [['HELD', 'hold', null, 'HELD'], ['CONFIRMED', 'confirm', 'HELD', 'CONFIRMED'], ['IN_SERVICE', 'start', 'CONFIRMED', 'IN_SERVICE'], ['COMPLETED', 'finish', 'IN_SERVICE', 'COMPLETED']],
  NO_SHOW: [['HELD', 'hold', null, 'HELD'], ['CONFIRMED', 'confirm', 'HELD', 'CONFIRMED'], ['noShow', 'noShow', 'CONFIRMED', 'NO_SHOW']],
  CANCELLED: [['HELD', 'hold', null, 'HELD'], ['CONFIRMED', 'confirm', 'HELD', 'CONFIRMED'], ['CANCELLED', 'cancel', 'CONFIRMED', 'CANCELLED']],
}

export function validateDataset(ds, { now = ds.meta && ds.meta.now } = {}) {
  const problems = []
  const bad = (msg) => problems.push(msg)
  const shops = new Map(ds.shops.map((s) => [s.id, s]))
  const customers = new Map(ds.customers.map((c) => [c.id, c]))
  const apts = new Map(ds.appointments.map((a) => [a.requestId, a]))
  const blocks = new Map(ds.blocks.map((b) => [`${b.shopId}|${b.id}`, b]))

  // --- shops, services, barbers
  const postals = new Set()
  for (const s of ds.shops) {
    const at = `shop ${s.id}`
    if (s.status !== 'verified') bad(`${at}: not verified`)
    if (!/^\d{6}$/.test(s.postalCode)) bad(`${at}: postal code ${s.postalCode}`)
    if (postals.has(s.postalCode)) bad(`${at}: duplicate postal code`)
    postals.add(s.postalCode)
    const sector = SECTORS[s.postalCode.slice(0, 2)]
    if (!sector) bad(`${at}: postal sector ${s.postalCode.slice(0, 2)} does not exist`)
    else if (distanceBetween([s.lat, s.lng], [sector[1], sector[2]]) > 1) bad(`${at}: more than 1 km from its sector centroid`)
    if (s.geohash !== geohashForLocation([s.lat, s.lng])) bad(`${at}: geohash does not match lat/lng`)
    if (!['block', 'flag'].includes(s.latePolicy) || !Number.isInteger(s.noticeMins) || s.noticeMins <= 0) bad(`${at}: latePolicy/noticeMins`)
    const summary = summarizeServices(s.services)
    for (const k of Object.keys(summary)) if (JSON.stringify(summary[k]) !== JSON.stringify(s[k])) bad(`${at}: summary field ${k} is wrong`)
    if (s.services.length < 4 || s.services.length > 8) bad(`${at}: ${s.services.length} services`)
    if (s.barbers.length < 2 || s.barbers.length > 5) bad(`${at}: ${s.barbers.length} barbers`)
    for (const v of s.services) {
      if (!CATEGORIES.includes(v.category)) bad(`${at}: service ${v.id} category ${v.category}`)
      if (!Number.isInteger(v.durationMin) || v.durationMin % 5 || v.durationMin <= 0) bad(`${at}: service ${v.id} duration`)
      if (!isMoney(v.priceCents) || v.priceCents === 0) bad(`${at}: service ${v.id} price`)
    }
    for (const b of s.barbers) {
      if (!b.serviceIds.every((id) => s.services.some((v) => v.id === id))) bad(`${at}: barber ${b.id} offers an unknown service`)
      for (const [d, ranges] of Object.entries(b.workingHours)) {
        for (const r of ranges) {
          const ok = (s.openingHours[d] || []).some((o) => o.start <= r.start && r.end <= o.end)
          if (!ok) bad(`${at}: barber ${b.id} works outside shop hours on ${d}`)
        }
      }
    }
  }

  // --- appointments
  const schedules = new Map(ds.schedules.map((x) => [`${x.shopId}|${x.id}`, x]))
  const auditBy = new Map()
  for (const a of ds.audit) {
    if (!auditBy.has(a.bookingId)) auditBy.set(a.bookingId, new Map())
    auditBy.get(a.bookingId).set(a.id, a)
  }
  const noteBy = new Map()
  for (const n of ds.notifications) noteBy.set(n.id, n)
  const stat = new Map()
  const late = new Map()
  const perCustomer = new Map()
  for (const a of ds.appointments) {
    const at = `appointment ${a.requestId}`
    const shop = shops.get(a.shopId)
    const barber = shop && shop.barbers.find((b) => b.id === a.barberId)
    const service = shop && shop.services.find((v) => v.id === a.serviceId)
    if (!REQUEST_ID.test(a.requestId)) bad(`${at}: id format`)
    if (!STATUSES.includes(a.status)) bad(`${at}: status ${a.status}`)
    if (!shop || !barber || !service) { bad(`${at}: unknown shop, barber or service`); continue }
    if (!barber.serviceIds.includes(a.serviceId)) bad(`${at}: barber does not offer the service`)
    if (![a.start, a.end].every(Number.isInteger) || a.end <= a.start) bad(`${at}: times`)
    if (a.start % GRID_MS) bad(`${at}: start is off the 15-minute grid`)
    if (a.end - a.start !== a.durationMin * MINUTE_MS) bad(`${at}: end is not start + durationMin`)
    if (a.durationMin !== service.durationMin || a.priceCents !== service.priceCents || !isMoney(a.priceCents)) bad(`${at}: price or duration snapshot`)
    if (!inRanges(shop.openingHours, a.start, a.end)) bad(`${at}: outside shop opening hours`)
    if (!inRanges(barber.workingHours, a.start, a.end)) bad(`${at}: outside the barber's working hours`)
    const cust = customers.get(a.customerId)
    if (!cust) bad(`${at}: unknown customer`)
    else if (a.customerName !== cust.displayName || a.customerPhoneMasked !== maskPhone(cust.phoneE164)) bad(`${at}: customer name or masked phone`)

    // schedule interval
    const sched = schedules.get(`${a.shopId}|${a.barberId}_${sgDateKey(a.start)}`)
    const mine = sched ? sched.intervals.filter((i) => i.kind === 'booking' && i.refId === a.requestId) : []
    if (ACTIVE.includes(a.status)) {
      if (mine.length !== 1 || mine[0].start !== a.start || mine[0].end !== a.end) bad(`${at}: needs exactly one matching schedule interval (${a.status})`)
    } else if (mine.length) bad(`${at}: ${a.status} must not keep a schedule interval`)

    // status-specific fields and time placement
    if (a.status === 'CONFIRMED' && !(a.start > now)) bad(`${at}: CONFIRMED but not upcoming`)
    if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(a.status) && !(a.start < now)) bad(`${at}: ${a.status} but not in the past`)
    if (a.status === 'COMPLETED' && !(Number.isInteger(a.actualStart) && Number.isInteger(a.actualEnd) && a.actualEnd > a.actualStart)) bad(`${at}: actualStart/actualEnd`)
    if (a.status === 'NO_SHOW' && !(a.noShowAt >= a.start + 15 * MINUTE_MS)) bad(`${at}: noShowAt`)
    if (a.status === 'CANCELLED') {
      if (typeof a.lateCancel !== 'boolean') bad(`${at}: lateCancel`)
      if (a.lateCancel && shop.latePolicy !== 'flag') bad(`${at}: late cancel at a "block" shop`)
    }

    // audit chain
    const chain = CHAINS[a.status]
    if (chain) {
      const records = auditBy.get(a.requestId) || new Map()
      let last = 0
      for (const [suffix, action, from, to] of chain) {
        const rec = records.get(`${a.requestId}_${suffix}`)
        if (!rec || rec.action !== action || rec.fromStatus !== from || rec.toStatus !== to || rec.shopId !== a.shopId) bad(`${at}: audit record ${suffix} missing or wrong`)
        else {
          if (rec.at < last) bad(`${at}: audit record ${suffix} is out of order`)
          if (!(rec.expireAt > rec.at)) bad(`${at}: audit record ${suffix} has no expireAt`)
          last = rec.at
        }
      }
    }

    // notifications for upcoming bookings
    if (a.status === 'CONFIRMED') {
      const conf = noteBy.get(`${a.requestId}_confirmation`)
      if (!conf) bad(`${at}: confirmation task missing`)
      else {
        for (const { type, dueAt } of planReminders(a.start, conf.plannedAt)) {
          const n = noteBy.get(`${a.requestId}_${type}`)
          if (!n || n.dueAt !== dueAt || n.apptStart !== a.start || n.shopId !== a.shopId) bad(`${at}: ${type} task missing or wrong`)
          else if (n.status === 'pending' && n.nextAttemptAt !== n.dueAt) bad(`${at}: ${type} has no nextAttemptAt`)
          else if (n.status === 'sent' && n.dueAt > now) bad(`${at}: ${type} is sent before it was due`)
        }
      }
    }

    // per-customer bookkeeping
    if (a.status !== 'CANCELLED') {
      const list = perCustomer.get(a.customerId) || []
      for (const o of list) if (overlap(a, o)) bad(`${at}: customer ${a.customerId} is double-booked with ${o.requestId}`)
      list.push(a)
      perCustomer.set(a.customerId, list)
    }
    const k = `${a.customerId}|${a.shopId}`
    if (a.status === 'NO_SHOW') stat.set(k, (stat.get(k) || 0) + 1)
    if (a.status === 'CANCELLED' && a.lateCancel) late.set(k, (late.get(k) || 0) + 1)
  }

  // --- schedules
  for (const s of ds.schedules) {
    const at = `schedule ${s.shopId}/${s.id}`
    const shop = shops.get(s.shopId)
    const barber = shop && shop.barbers.find((b) => b.id === s.barberId)
    if (!barber) { bad(`${at}: unknown barber`); continue }
    if (s.id !== `${s.barberId}_${s.date}`) bad(`${at}: id does not match barber and date`)
    const sorted = [...s.intervals].sort((x, y) => x.start - y.start)
    sorted.forEach((iv, i) => {
      if (sgDateKey(iv.start) !== s.date || sgDateKey(iv.end - 1) !== s.date) bad(`${at}: interval is not on ${s.date} (Singapore)`)
      if (iv.end <= iv.start) bad(`${at}: empty interval`)
      if (i && sorted[i - 1].end > iv.start) bad(`${at}: overlapping intervals`) // half-open: touching is fine
      if (iv.kind === 'booking') {
        const a = apts.get(iv.refId)
        if (!a || !ACTIVE.includes(a.status) || a.barberId !== s.barberId || a.shopId !== s.shopId || a.start !== iv.start || a.end !== iv.end) bad(`${at}: booking interval ${iv.refId} has no matching appointment`)
      } else if (iv.kind === 'block') {
        const b = blocks.get(`${s.shopId}|${iv.refId}`)
        if (!b || b.barberId !== s.barberId || b.start !== iv.start || b.end !== iv.end) bad(`${at}: block interval ${iv.refId} has no matching block`)
        if (!inRanges(barber.workingHours, iv.start, iv.end)) bad(`${at}: block outside working hours`)
      } else bad(`${at}: unexpected interval kind ${iv.kind}`)
    })
  }
  for (const b of ds.blocks) {
    const s = schedules.get(`${b.shopId}|${b.barberId}_${sgDateKey(b.start)}`)
    if (!s || !s.intervals.some((i) => i.kind === 'block' && i.refId === b.id)) bad(`block ${b.id}: no interval on the schedule`)
    if (!(b.end > b.start) || b.start % GRID_MS || b.end % GRID_MS) bad(`block ${b.id}: times`)
  }

  // --- customers and shopStats
  const phones = new Set()
  for (const c of ds.customers) {
    if (!/^\+65[89]\d{7}$/.test(c.phoneE164) || c.phoneE164.endsWith('0000')) bad(`customer ${c.id}: phone ${c.phoneE164}`)
    if (phones.has(c.phoneE164)) bad(`customer ${c.id}: duplicate phone`)
    phones.add(c.phoneE164)
  }
  const stats = new Map(ds.shopStats.map((x) => [`${x.customerId}|${x.shopId}`, x]))
  for (const k of new Set([...stat.keys(), ...late.keys(), ...stats.keys()])) {
    const row = stats.get(k) || { noShowCount: 0, lateCancels: 0 }
    if (row.noShowCount !== (stat.get(k) || 0) || row.lateCancels !== (late.get(k) || 0)) bad(`shopStats ${k}: counts do not match the appointments`)
  }

  // --- dailyStats and ledger: recompute exactly as the trigger would
  const expectLedger = new Map()
  const expectDays = new Map()
  for (const a of ds.appointments) {
    const c = contribution({ ...a, start: { toMillis: () => a.start } })
    if (!c) continue
    expectLedger.set(`${a.shopId}|${a.requestId}`, c)
    for (const e of delta(null, c)) {
      const key = `${a.shopId}|${e.dateKey}`
      const day = expectDays.get(key) || {}
      const b = (day[e.barberId] ||= { completed: 0, valueCents: 0, noShows: 0, bookedMin: 0 })
      for (const f of FIELDS) b[f] += e[f]
      expectDays.set(key, day)
    }
  }
  const gotLedger = new Map(ds.statContrib.map(({ shopId, id, ...c }) => [`${shopId}|${id}`, c]))
  if (gotLedger.size !== expectLedger.size) bad(`statContrib has ${gotLedger.size} documents, expected ${expectLedger.size}`)
  for (const [k, c] of expectLedger) if (JSON.stringify(sortKeys(gotLedger.get(k))) !== JSON.stringify(sortKeys(c))) bad(`statContrib ${k} is wrong`)
  const gotDays = new Map(ds.dailyStats.map((d) => [`${d.shopId}|${d.id}`, d.barbers]))
  if (gotDays.size !== expectDays.size) bad(`dailyStats has ${gotDays.size} documents, expected ${expectDays.size}`)
  for (const [k, want] of expectDays) if (JSON.stringify(sortDeep(gotDays.get(k))) !== JSON.stringify(sortDeep(want))) bad(`dailyStats ${k} is wrong`)

  // --- waitlist and queue
  for (const w of ds.waitlist) {
    const shop = shops.get(w.shopId)
    const expectId = `${w.customerId}_${w.shopId}_${w.serviceId}_${w.date}_${w.barberId || 'any'}`
    if (w.id !== expectId) bad(`waitlist ${w.id}: id pattern`)
    if (!shop || !shop.services.some((v) => v.id === w.serviceId) || !customers.has(w.customerId)) bad(`waitlist ${w.id}: unknown shop, service or customer`)
    if (w.barberId && !shop.barbers.find((b) => b.id === w.barberId && b.serviceIds.includes(w.serviceId))) bad(`waitlist ${w.id}: barber`)
    if (w.expiresAt !== sgTimeToMs(w.date, '00:00') + 24 * 60 * MINUTE_MS || w.status !== 'waiting') bad(`waitlist ${w.id}: expiresAt or status`)
  }
  for (const q of ds.queue) {
    const shop = shops.get(q.shopId)
    if (!shop || !shop.barbers.some((b) => b.id === q.barberId) || !shop.services.some((v) => v.id === q.serviceId)) bad(`queue ${q.id}: unknown shop, barber or service`)
    if (!['waiting', 'in_service', 'done', 'removed'].includes(q.status)) bad(`queue ${q.id}: status`)
    if (q.status === 'done' && !(q.actualEnd > q.actualStart)) bad(`queue ${q.id}: actual times`)
    if (q.status === 'in_service' && !Number.isInteger(q.actualStart)) bad(`queue ${q.id}: actualStart`)
  }
  return problems
}

const sortKeys = (o) => (o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))) : o)
const sortDeep = (o) => (o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sortKeys(v)])) : o)

// ---------- sizing ----------

const WRITE_USD_PER_100K = 0.2 // assumed list price per 100,000 document writes; check the current pricing page
export const FREE_WRITES_PER_DAY = 20000

/** Documents per collection (each is one write when seeded fresh) and the total. */
export function docCounts(ds) {
  const by = {
    shops: ds.shops.length,
    'shops/services': ds.shops.reduce((n, s) => n + s.services.length, 0),
    'shops/barbers': ds.shops.reduce((n, s) => n + s.barbers.length, 0),
    'shops/members': ds.shops.reduce((n, s) => n + 1 + s.barbers.length, 0),
    'shops/schedules': ds.schedules.length,
    'shops/blocks': ds.blocks.length,
    'shops/dailyStats': ds.dailyStats.length,
    'shops/statContrib': ds.statContrib.length,
    'shops/queue': ds.queue.length,
    appointments: ds.appointments.length,
    auditLog: ds.audit.length,
    notifications: ds.notifications.length,
    customers: ds.customers.length,
    'customers/shopStats': ds.shopStats.length,
    waitlist: ds.waitlist.length,
  }
  const total = Object.values(by).reduce((a, b) => a + b, 0)
  const status = {}
  for (const a of ds.appointments) status[a.status] = (status[a.status] || 0) + 1
  return {
    by, total, status,
    authUsers: ds.accounts.length + ds.showcase.length,
    estimatedUsd: (total / 100000) * WRITE_USD_PER_100K,
  }
}

export function formatReport(c) {
  const lines = ['Demo dataset (documents = writes for a fresh seed):']
  for (const [k, n] of Object.entries(c.by)) lines.push(`  ${k.padEnd(20)} ${String(n).padStart(7)}`)
  lines.push(`  ${'TOTAL'.padEnd(20)} ${String(c.total).padStart(7)}`)
  lines.push(`Appointments by status: ${Object.entries(c.status).map(([k, n]) => `${k} ${n}`).join(', ')}`)
  lines.push(`Auth users to create: ${c.authUsers} (no Firestore writes)`)
  const days = (c.total / FREE_WRITES_PER_DAY).toFixed(1)
  lines.push(
    `Estimated write cost: about US$${c.estimatedUsd.toFixed(2)} at an assumed US$${WRITE_USD_PER_100K.toFixed(2)} per 100,000 writes ` +
      `(check current pricing). The free quota is ${FREE_WRITES_PER_DAY.toLocaleString('en')} writes a day, so this is ${days} days of it. ` +
      'Reads for the validation pass and deleting old demo data on --overwrite cost a little extra.',
  )
  return lines.join('\n')
}
