// A18: the demo data generator. Pure tests: no emulator, no network. Checks determinism, the catalogue, and the
// invariants the real functions rely on (every appointment matches one schedule interval, no overlaps, hours, stats).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { DEFAULT_DENSITY, generateDemoData } from '../scripts/demo/generate.mjs'
import { docCounts, validateDataset } from '../scripts/demo/validate.mjs'
import { sgDateKey, weekdayOf } from '../src/lib/slots.js'

const { SECTORS } = createRequire(import.meta.url)('../functions/postalSectors.js')

const NOW = Date.UTC(2026, 8, 25, 6, 30) // Fri 25 Sep 2026, 14:30 in Singapore
const DAY = 24 * 3600e3
const ds = generateDemoData({ now: NOW })
const byShop = (id) => ds.shops.find((s) => s.id === id)
const count = (xs, f) => xs.filter(f).length

describe('determinism', () => {
  it('gives identical data for the same seed and time', () => {
    assert.deepEqual(generateDemoData({ now: NOW }), ds)
  })
  it('changes with the seed', () => {
    const other = generateDemoData({ now: NOW, seed: 'another-seed' })
    assert.notDeepEqual(other.shops.map((s) => s.name + s.postalCode), ds.shops.map((s) => s.name + s.postalCode))
  })
  it('keeps the same shops, barbers, services and customers when the date moves', () => {
    const later = generateDemoData({ now: NOW + 3 * DAY })
    assert.deepEqual(later.shops, ds.shops)
    assert.deepEqual(later.customers, ds.customers)
    assert.deepEqual(later.accounts, ds.accounts)
  })
  it('gives a given date the same bookings on a later run, and fresh bookings for new dates', () => {
    const later = generateDemoData({ now: NOW + DAY })
    const on = (d, key) => d.appointments.filter((a) => sgDateKey(a.start) === key).map((a) => [a.requestId, a.start, a.end, a.serviceId]).sort()
    assert.deepEqual(on(later, '20260920'), on(ds, '20260920'))
    assert.ok(on(ds, '20260920').length > 50, 'a normal day has plenty of bookings')
    const key = sgDateKey(NOW + 8 * DAY + DAY) // only the later run covers this day
    assert.equal(on(ds, key).length, 0)
    assert.ok(on(later, sgDateKey(NOW + 8 * DAY)).length > 0, 'the window slides forward')
  })
})

describe('shops', () => {
  it('has 50 verified shops across the five regions and three tiers, with unique names and IDs', () => {
    assert.equal(ds.shops.length, 50)
    assert.ok(ds.shops.every((s) => s.status === 'verified'))
    const tally = (k) => Object.fromEntries([...new Set(ds.shops.map((s) => s[k]))].map((v) => [v, count(ds.shops, (s) => s[k] === v)]))
    assert.deepEqual(tally('region'), { central: 12, east: 10, west: 10, north: 8, 'north-east': 10 })
    assert.deepEqual(tally('tier'), { premium: 10, mid: 18, neighbourhood: 22 })
    assert.equal(new Set(ds.shops.map((s) => s.name)).size, 50)
    assert.equal(new Set(ds.shops.map((s) => s.id)).size, 50)
    assert.ok(ds.shops.every((s) => /^demo-\d\d-[a-z0-9-]+$/.test(s.id)), 'never collides with the shop-* sample shops')
  })
  it('puts postal codes in real sectors and coordinates within 1 km of the sector', () => {
    for (const s of ds.shops) {
      assert.match(s.postalCode, /^\d{6}$/)
      assert.ok(SECTORS[s.postalCode.slice(0, 2)], `${s.id} sector exists`)
      assert.equal(s.postalCode.slice(0, 2), s.sector)
    }
    assert.deepEqual(validateDataset(ds).filter((p) => /sector|geohash|km/.test(p)), [])
  })
  it('varies hours, rest days, notice and late policy', () => {
    const rest = new Set(ds.shops.map((s) => Object.entries(s.openingHours).filter(([, v]) => !v.length).map(([d]) => d).join('+')))
    assert.ok(rest.size >= 4, 'several rest-day patterns')
    assert.ok(new Set(ds.shops.map((s) => s.noticeMins)).size >= 5)
    assert.ok(count(ds.shops, (s) => s.latePolicy === 'flag') >= 10 && count(ds.shops, (s) => s.latePolicy === 'block') >= 10)
    assert.ok(new Set(ds.shops.map((s) => s.openingHours.tue[0]?.start + s.openingHours.tue[0]?.end)).size >= 5)
    const flagship = ds.shops.filter((s) => s.flagship)
    assert.equal(flagship.length, 1)
    assert.ok(WEEKDAYS_OPEN(flagship[0]))
  })
  it('has 2 to 5 barbers and 4 to 8 services per shop, with tier-appropriate prices and correct summaries', () => {
    const cut = (t) => ds.shops.filter((s) => s.tier === t).map((s) => s.services.find((v) => v.id === 'gents-cut').priceCents)
    assert.ok(cut('neighbourhood').every((p) => p >= 1200 && p <= 1800))
    assert.ok(cut('mid').every((p) => p >= 2200 && p <= 3200))
    assert.ok(cut('premium').every((p) => p >= 3500 && p <= 6000))
    for (const s of ds.shops) {
      assert.ok(s.barbers.length >= 2 && s.barbers.length <= 5, s.id)
      assert.ok(s.services.length >= 4 && s.services.length <= 8, s.id)
      assert.ok(s.services.every((v) => Number.isInteger(v.priceCents) && v.durationMin % 5 === 0))
    }
    assert.ok(ds.shops.some((s) => s.barbers.some((b) => b.workingHours.mon.length === 2)), 'some split shifts')
    assert.ok(ds.shops.some((s) => s.barbers.some((b) => Object.values(b.workingHours).some((r) => !r.length))), 'some days off')
    assert.ok(ds.blocks.length >= 20, 'personal blocks exist')
  })
})

const WEEKDAYS_OPEN = (s) => Object.values(s.openingHours).every((r) => r.length === 1)

describe('invariants', () => {
  it('passes the validation pass at several times of day, including just after midnight', () => {
    for (const now of [NOW, Date.UTC(2026, 8, 25, 16, 10), Date.UTC(2026, 8, 25, 23, 55), Date.UTC(2026, 8, 26, 0, 5), Date.UTC(2026, 11, 31, 15, 59)]) {
      const data = generateDemoData({ now })
      assert.deepEqual(validateDataset(data), [], `now = ${new Date(now).toISOString()}`)
    }
    assert.deepEqual(validateDataset(generateDemoData({ now: NOW, density: 1.3 })), [])
  })
  it('matches every active appointment to exactly one interval, and none of the cancelled ones', () => {
    const intervals = new Map()
    for (const s of ds.schedules) for (const iv of s.intervals) if (iv.kind === 'booking') intervals.set(iv.refId, (intervals.get(iv.refId) || 0) + 1)
    for (const a of ds.appointments) {
      const want = a.status === 'CANCELLED' ? 0 : 1
      assert.equal(intervals.get(a.requestId) || 0, want, `${a.requestId} ${a.status}`)
    }
    assert.equal(intervals.size, count(ds.appointments, (a) => a.status !== 'CANCELLED'))
  })
  it('never overlaps intervals on a barber-day (half-open) and keeps them in the barber-day document', () => {
    let touching = 0
    for (const s of ds.schedules) {
      const sorted = [...s.intervals].sort((a, b) => a.start - b.start)
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i - 1].end <= sorted[i].start, s.id)
        if (sorted[i - 1].end === sorted[i].start) touching++
      }
      assert.equal(s.id, `${s.barberId}_${s.date}`)
      assert.ok(s.intervals.every((iv) => sgDateKey(iv.start) === s.date))
    }
    assert.ok(touching > 0, 'back-to-back bookings occur and are allowed')
  })
  it('uses whole cents, the 15-minute grid, and the service snapshot', () => {
    for (const a of ds.appointments) {
      const svc = byShop(a.shopId).services.find((v) => v.id === a.serviceId)
      assert.ok(Number.isInteger(a.priceCents) && a.priceCents === svc.priceCents)
      assert.equal(a.start % (15 * 60e3), 0)
      assert.equal(a.end - a.start, svc.durationMin * 60e3)
    }
  })
  it('splits the past 14 days into mostly completed, some cancelled (a few late) and a few no-shows; the future is confirmed', () => {
    const past = ds.appointments.filter((a) => a.start < NOW)
    const future = ds.appointments.filter((a) => a.start >= NOW)
    assert.ok(count(past, (a) => a.status === 'COMPLETED') / past.length > 0.8)
    assert.ok(count(past, (a) => a.status === 'CANCELLED') >= 50)
    assert.ok(count(past, (a) => a.status === 'NO_SHOW') >= 20 && count(past, (a) => a.status === 'NO_SHOW') / past.length < 0.08)
    const late = ds.appointments.filter((a) => a.lateCancel)
    assert.ok(late.length >= 5 && late.length < 60)
    assert.ok(late.every((a) => byShop(a.shopId).latePolicy === 'flag'), 'late cancels only where the policy allows them')
    assert.ok(future.every((a) => a.status === 'CONFIRMED'))
    assert.ok(past.every((a) => a.status !== 'CONFIRMED'))
    assert.ok(Math.min(...past.map((a) => a.start)) >= NOW - 15 * DAY && Math.max(...future.map((a) => a.start)) < NOW + 9 * DAY)
    for (const a of past.filter((x) => x.status === 'COMPLETED')) assert.ok(a.actualEnd > a.actualStart && a.actualEnd <= NOW)
  })
  it('is busier in the evening and at the weekend', () => {
    const active = ds.appointments.filter((a) => a.status !== 'CANCELLED')
    const hour = (a) => Math.floor(((a.start + 8 * 3600e3) % DAY) / 3600e3)
    assert.ok(count(active, (a) => hour(a) >= 17 && hour(a) <= 18) > 1.5 * count(active, (a) => hour(a) >= 13 && hour(a) <= 14))
    const perDay = {}
    for (const a of active) perDay[weekdayOf(sgDateKey(a.start))] = (perDay[weekdayOf(sgDateKey(a.start))] || 0) + 1
    assert.ok(perDay.sat > perDay.tue * 1.3, JSON.stringify(perDay))
  })
  it('has an audit chain for every appointment and notification tasks for every upcoming one', () => {
    const chains = new Map()
    for (const a of ds.audit) chains.set(a.bookingId, [...(chains.get(a.bookingId) || []), a.action])
    const want = { CONFIRMED: ['hold', 'confirm'], COMPLETED: ['hold', 'confirm', 'start', 'finish'], NO_SHOW: ['hold', 'confirm', 'noShow'], CANCELLED: ['hold', 'confirm', 'cancel'] }
    for (const a of ds.appointments) assert.deepEqual(chains.get(a.requestId), want[a.status], a.requestId)
    assert.ok(ds.audit.every((a) => a.expireAt > a.at))
    const tasks = new Set(ds.notifications.map((n) => n.id))
    for (const a of ds.appointments.filter((x) => x.status === 'CONFIRMED')) assert.ok(tasks.has(`${a.requestId}_confirmation`))
    assert.ok(ds.notifications.some((n) => n.status === 'pending' && n.nextAttemptAt === n.dueAt && n.dueAt > NOW))
    assert.ok(ds.notifications.every((n) => n.status !== 'sent' || n.dueAt <= NOW))
    assert.ok(ds.notifications.every((n) => /^dm-/.test(n.bookingId) && n.id.startsWith(`${n.bookingId}_`) && n.channel === 'sms'))
  })
  it('keeps dailyStats, the ledger and shopStats consistent with the appointments', () => {
    const completed = ds.appointments.filter((a) => a.status === 'COMPLETED')
    const value = completed.reduce((n, a) => n + a.priceCents, 0)
    const stats = ds.dailyStats.flatMap((d) => Object.values(d.barbers))
    assert.equal(stats.reduce((n, b) => n + b.valueCents, 0), value)
    assert.equal(stats.reduce((n, b) => n + b.completed, 0), completed.length)
    assert.equal(stats.reduce((n, b) => n + b.noShows, 0), count(ds.appointments, (a) => a.status === 'NO_SHOW'))
    assert.equal(ds.statContrib.length, completed.length + count(ds.appointments, (a) => a.status === 'NO_SHOW'))
    assert.equal(ds.shopStats.reduce((n, x) => n + x.noShowCount, 0), count(ds.appointments, (a) => a.status === 'NO_SHOW'))
  })
  it('detects broken data (the validator is not vacuous)', () => {
    const broken = (mutate, pattern) => {
      const copy = structuredClone(ds)
      mutate(copy)
      assert.ok(validateDataset(copy).some((p) => pattern.test(p)), `expected a problem matching ${pattern}`)
    }
    const first = (d, status) => d.appointments.find((a) => a.status === status)
    const sched = (d, a) => d.schedules.find((s) => s.shopId === a.shopId && s.id === `${a.barberId}_${sgDateKey(a.start)}`)
    broken((d) => { const s = d.schedules.find((x) => x.intervals.length > 1); s.intervals[1].start = s.intervals[0].start + 60e3 }, /overlapping|matching/)
    broken((d) => { const a = first(d, 'COMPLETED'); const s = sched(d, a); s.intervals = s.intervals.filter((i) => i.refId !== a.requestId) }, /exactly one matching/)
    broken((d) => { first(d, 'CANCELLED').status = 'COMPLETED' }, /./)
    broken((d) => { first(d, 'COMPLETED').priceCents += 100 }, /snapshot/)
    broken((d) => { first(d, 'COMPLETED').priceCents = 12.5 }, /snapshot/)
    broken((d) => { const a = first(d, 'COMPLETED'); a.start += 15 * 60e3 * 60 * 20; a.end += 15 * 60e3 * 60 * 20 }, /hours|interval/)
    broken((d) => { first(d, 'COMPLETED').start += 60e3 }, /grid|end is not/)
    broken((d) => { d.dailyStats[0].barbers[Object.keys(d.dailyStats[0].barbers)[0]].completed += 1 }, /dailyStats/)
    broken((d) => { d.statContrib.pop() }, /statContrib/)
    broken((d) => { d.shopStats[0].noShowCount += 1 }, /shopStats/)
    broken((d) => { d.audit = d.audit.filter((a) => a.action !== 'finish') }, /audit record/)
    broken((d) => { d.notifications = d.notifications.filter((n) => !n.id.endsWith('_confirmation')) }, /confirmation task missing/)
    broken((d) => { // a booking moved onto a personal block, with its interval, so only the block clash is left
      for (const b of d.blocks) {
        const a = d.appointments.find((x) => x.status === 'CONFIRMED' && x.shopId === b.shopId && x.barberId === b.barberId && sgDateKey(x.start) !== sgDateKey(b.start))
        if (!a) continue
        const old = sched(d, a)
        old.intervals = old.intervals.filter((i) => i.refId !== a.requestId)
        a.start = b.start
        a.end = b.start + a.durationMin * 60e3
        d.schedules.find((s) => s.shopId === b.shopId && s.id === `${b.barberId}_${sgDateKey(b.start)}`).intervals.push({ start: a.start, end: a.end, kind: 'booking', refId: a.requestId })
        return
      }
      assert.fail('no block with a confirmed booking to move')
    }, /overlapping intervals/)
    broken((d) => { d.shops[0].priceMin += 100 }, /summary/)
    broken((d) => { d.shops[0].postalCode = '990000' }, /sector/)
    broken((d) => { d.customers[10].phoneE164 = d.customers[11].phoneE164 }, /duplicate phone/)
    broken((d) => { d.appointments.find((x) => x.status === 'CANCELLED' && byShop(x.shopId).latePolicy === 'block').lateCancel = true }, /late cancel at a "block" shop/)
    broken((d) => { // the same customer booked twice at the same time (two shops)
      const act = d.appointments.filter((x) => x.status !== 'CANCELLED').sort((x, y) => x.start - y.start)
      for (let i = 0; i < act.length; i++) {
        for (let j = i + 1; j < act.length && act[j].start < act[i].end; j++) {
          if (act[j].customerId === act[i].customerId) continue
          Object.assign(act[j], { customerId: act[i].customerId, customerName: act[i].customerName, customerPhoneMasked: act[i].customerPhoneMasked })
          return
        }
      }
      assert.fail('no two bookings overlap in time')
    }, /double-booked/)
  })
})

describe('showcase customers, waitlist and walk-ins', () => {
  const stat = (id) => ds.shopStats.filter((x) => x.customerId === id)
  it('has three customers with two or more no-shows at one shop, so a booking there needs a deposit', () => {
    for (const key of ['s1', 's2', 's3']) {
      assert.ok(stat(`demo-cust-${key}`).some((x) => x.noShowCount >= 2), key)
    }
    const stored = ds.customers.filter((c) => c.showcase)
    assert.equal(stored.length, 8)
    assert.deepEqual(stored.map((c) => c.phoneE164), ['+6580000101', '+6580000102', '+6580000103', '+6580000104', '+6580000105', '+6580000106', '+6580000107', '+6580000108'])
    assert.equal(ds.showcase.length, 8)
  })
  it('has customers with history across three or more shops and an upcoming booking', () => {
    for (const key of ['s4', 's5', 's6', 's7']) {
      const mine = ds.appointments.filter((a) => a.customerId === `demo-cust-${key}`)
      assert.ok(new Set(mine.map((a) => a.shopId)).size >= 3, key)
      assert.ok(count(mine, (a) => a.status === 'COMPLETED') >= 4, key)
      assert.ok(mine.some((a) => a.status === 'CONFIRMED'), `${key} has an upcoming booking`)
    }
  })
  it('has six waiting waitlist entries in the booking window and today\'s walk-ins at one shop', () => {
    assert.equal(ds.waitlist.length, 6)
    assert.ok(ds.waitlist.every((w) => w.status === 'waiting' && w.date >= sgDateKey(NOW) && w.date <= sgDateKey(NOW + 3 * DAY)))
    assert.deepEqual([...new Set(ds.queue.map((q) => q.shopId))], [ds.shops.find((s) => s.flagship).id])
    assert.deepEqual(ds.queue.map((q) => q.status).sort(), ['done', 'done', 'in_service', 'waiting', 'waiting', 'waiting'])
    assert.ok(ds.queue.every((q) => q.joinedAt <= NOW))
  })
  it('gives fictional customers +65 numbers that are unique, never end in 0000 and avoid the other seeds', () => {
    const phones = ds.customers.map((c) => c.phoneE164)
    assert.equal(new Set(phones).size, phones.length)
    assert.ok(phones.every((p) => /^\+65[89]\d{7}$/.test(p) && !p.endsWith('0000') && p !== '+6591230010' && p !== '+6591230013'))
    assert.ok(ds.customers.length >= 300)
    assert.ok(ds.appointments.every((a) => !JSON.stringify(a).includes(ds.customers.find((c) => c.id === a.customerId).phoneE164.slice(3))), 'only the masked number is on appointments')
  })
})

describe('accounts and size', () => {
  it('gives every shop an owner and every barber a login, with unique emails and no passwords in the data', () => {
    const owners = count(ds.accounts, (a) => a.claims.role === 'owner')
    assert.equal(owners, 50)
    assert.equal(count(ds.accounts, (a) => a.claims.role === 'barber'), ds.shops.reduce((n, s) => n + s.barbers.length, 0))
    assert.equal(new Set(ds.accounts.map((a) => a.email)).size, ds.accounts.length)
    for (const a of ds.accounts.filter((x) => x.claims.role === 'barber')) assert.equal(a.claims.barberId, a.uid.slice(a.claims.shopId.length + 1))
    assert.ok(ds.accounts.every((a) => /^[a-z0-9-]+@demo-[a-z0-9-]+\.example\.com$/.test(a.email) && !('password' in a)))
  })
  it('stays within the write budget for a live seed', () => {
    const { total, estimatedUsd } = docCounts(ds)
    assert.ok(total >= 5000 && total <= 25000, `total writes ${total}`)
    assert.ok(estimatedUsd < 0.1)
    assert.equal(DEFAULT_DENSITY, 0.75)
  })
})
