import { after, before, beforeEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, collection, deleteDoc, doc, endAt, getDoc, getDocs, orderBy, query, setDoc, setLogLevel, startAt, updateDoc, where } from 'firebase/firestore'

// Denied writes are expected here; keep the SDK from logging each one.
setLogLevel('silent')

let env

const owner = (shopId) => env.authenticatedContext(`${shopId}-owner`, { shopId, role: 'owner' }).firestore()
const barber = (shopId, barberId = 'b1') =>
  env.authenticatedContext(`${shopId}-barber`, { shopId, role: 'barber', barberId }).firestore()
const admin = () => env.authenticatedContext('admin', { admin: true }).firestore()
const customer = (uid) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()

const DAY_START = Timestamp.fromMillis(Date.UTC(2030, 0, 7, 2))
const DAY_END = Timestamp.fromMillis(Date.UTC(2030, 0, 7, 10))
const service = { name: 'Cut', category: 'haircut', durationMin: 30, priceCents: 2500, active: true }
const barberDoc = { displayName: 'Ali', active: true, serviceIds: ['s1'], workingHours: { mon: [{ start: '09:00', end: '18:00' }] } }

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'fresher-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
after(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [id, status] of [['a', 'verified'], ['b', 'verified'], ['p', 'pending']]) {
      await setDoc(doc(db, `shops/${id}`), { name: id, status, tz: 'Asia/Singapore' })
      await setDoc(doc(db, `shops/${id}/services/s1`), service)
      await setDoc(doc(db, `shops/${id}/barbers/b1`), barberDoc)
      await setDoc(doc(db, `shops/${id}/schedules/x_20260101`), { intervals: [] })
    }
    await setDoc(doc(db, 'appointments/apt1'), { shopId: 'a', barberId: 'b1', customerId: 'cust1', start: DAY_START })
    await setDoc(doc(db, 'appointments/apt2'), { shopId: 'a', barberId: 'b2', customerId: 'cust2', start: DAY_START })
    await setDoc(doc(db, 'shops/a/blocks/k1'), { barberId: 'b1', start: DAY_START, end: DAY_END, reason: 'Dentist' })
    await setDoc(doc(db, 'shops/a/blocks/k2'), { barberId: 'b2', start: DAY_START, end: DAY_END, reason: 'Private' })
    await setDoc(doc(db, 'shops/b/blocks/k3'), { barberId: 'b1', start: DAY_START, end: DAY_END })
    await setDoc(doc(db, 'auditLog/e1'), { shopId: 'a', bookingId: 'apt1' })
    await setDoc(doc(db, 'notifications/n1'), { shopId: 'a', barberId: 'b1', bookingId: 'apt1' })
    await setDoc(doc(db, 'waitlist/w1'), { shopId: 'a', barberId: 'b1', customerId: 'cust1', serviceId: 's1', date: '20300107', status: 'waiting' })
    await setDoc(doc(db, 'waitlist/w2'), { shopId: 'a', barberId: null, customerId: 'cust2', serviceId: 's1', date: '20300107', status: 'offered', offerRequestId: 'r1' })
    await setDoc(doc(db, 'waitlist/w3'), { shopId: 'a', barberId: 'b2', customerId: 'cust2', serviceId: 's1', date: '20300107', status: 'waiting' })
    await setDoc(doc(db, 'deposits/d1'), { shopId: 'a', barberId: 'b1', customerId: 'cust1', bookingId: 'apt1', amountCents: 1250, status: 'pending' })
    await setDoc(doc(db, 'deposits/d2'), { shopId: 'a', barberId: 'b2', customerId: 'cust2', bookingId: 'apt2', amountCents: 1250, status: 'paid' })
    await setDoc(doc(db, 'notifications/n2'), { shopId: 'a', barberId: 'b2', bookingId: 'apt2' })
    await setDoc(doc(db, 'customers/cust1'), { phoneE164: '+6591234567' })
  })
})

describe('FR-14 dailyStats', () => {
  beforeEach(() => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'shops/a/dailyStats/20300107'), { barbers: { b1: { completed: 1 } } })
    await setDoc(doc(ctx.firestore(), 'shops/a/statContrib/apt1'), { dateKey: '20300107', barberId: 'b1' })
  }))
  it('the shop owner reads the range, as one query', async () => {
    await assertSucceeds(getDoc(doc(owner('a'), 'shops/a/dailyStats/20300107')))
    await assertSucceeds(getDocs(query(collection(owner('a'), 'shops/a/dailyStats'), where('__name__', '>=', '20300101'), where('__name__', '<=', '20300131'))))
  })
  it('barbers, other shops, customers, admin and the public cannot read it', async () => {
    for (const db of [barber('a'), owner('b'), customer('cust1'), admin(), anon()]) {
      await assertFails(getDoc(doc(db, 'shops/a/dailyStats/20300107')))
    }
  })
  it('nobody can read the trigger ledger', async () => {
    for (const db of [owner('a'), barber('a'), customer('cust1'), admin(), anon()]) {
      await assertFails(getDoc(doc(db, 'shops/a/statContrib/apt1')))
    }
  })
})

describe('public reads', () => {
  it('lets anyone read verified shops, services and schedules', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'shops/a')))
    await assertSucceeds(getDoc(doc(anon(), 'shops/a/services/s1')))
    await assertSucceeds(getDoc(doc(anon(), 'shops/a/barbers/b1')))
    await assertSucceeds(getDoc(doc(anon(), 'shops/a/schedules/x_20260101')))
  })
  it('hides pending shops and their data from the public', async () => {
    await assertFails(getDoc(doc(anon(), 'shops/p')))
    await assertFails(getDoc(doc(anon(), 'shops/p/services/s1')))
    await assertFails(getDoc(doc(anon(), 'shops/p/barbers/b1')))
    await assertSucceeds(getDoc(doc(owner('p'), 'shops/p')))
  })
})

describe('FR-01 discovery query', () => {
  it('lets anyone run the verified-shop geohash query but not an unfiltered one', async () => {
    const shops = collection(anon(), 'shops')
    const q = query(shops, where('status', '==', 'verified'), orderBy('geohash'), startAt('a'), endAt('a~'))
    await assertSucceeds(getDocs(q))
    await assertFails(getDocs(query(shops, orderBy('geohash'), startAt('a'), endAt('a~'))))
  })
  it('lets anyone list a verified shop\'s schedules by date but not a pending shop\'s', async () => {
    await assertSucceeds(getDocs(query(collection(anon(), 'shops/a/schedules'), where('date', '==', '20260101'))))
    await assertFails(getDocs(query(collection(anon(), 'shops/p/schedules'), where('date', '==', '20260101'))))
  })
})

describe('FR-08 blocks and the barber day view', () => {
  const blocksOf = (db, ...clauses) => getDocs(query(collection(db, 'shops/a/blocks'), ...clauses))
  const day = [where('start', '>=', DAY_START), where('start', '<', DAY_END)]
  const apts = (db, ...clauses) => getDocs(query(collection(db, 'appointments'), ...clauses, ...day))

  it('a barber reads only their own blocks', async () => {
    await assertSucceeds(getDoc(doc(barber('a', 'b1'), 'shops/a/blocks/k1')))
    await assertFails(getDoc(doc(barber('a', 'b1'), 'shops/a/blocks/k2')))
    const own = await assertSucceeds(blocksOf(barber('a', 'b1'), where('barberId', '==', 'b1'), ...day))
    assert.deepEqual(own.docs.map((d) => d.id), ['k1'])
    await assertFails(blocksOf(barber('a', 'b1'), where('barberId', '==', 'b2'), ...day))
    await assertFails(blocksOf(barber('a', 'b1'))) // an unconstrained list would expose other barbers' reasons
  })
  it('an owner reads every block in their own shop, and no other shop\'s', async () => {
    await assertSucceeds(getDoc(doc(owner('a'), 'shops/a/blocks/k1')))
    await assertSucceeds(getDoc(doc(owner('a'), 'shops/a/blocks/k2')))
    const all = await assertSucceeds(blocksOf(owner('a')))
    assert.equal(all.size, 2)
    await assertFails(getDoc(doc(owner('b'), 'shops/a/blocks/k1')))
    await assertFails(getDoc(doc(owner('a'), 'shops/b/blocks/k3')))
  })
  it('customers, anonymous users, other shops\' barbers and admins cannot read blocks', async () => {
    for (const db of [customer('cust1'), anon(), barber('b', 'b1'), admin()]) {
      await assertFails(getDoc(doc(db, 'shops/a/blocks/k1')))
    }
  })
  it('a barber\'s day query needs both shopId and barberId; an owner\'s needs shopId', async () => {
    const mine = await assertSucceeds(apts(barber('a', 'b1'), where('shopId', '==', 'a'), where('barberId', '==', 'b1')))
    assert.deepEqual(mine.docs.map((d) => d.id), ['apt1'])
    await assertFails(apts(barber('a', 'b1'), where('shopId', '==', 'a')))
    await assertFails(apts(barber('a', 'b1'), where('shopId', '==', 'a'), where('barberId', '==', 'b2')))
    const both = await assertSucceeds(apts(owner('a'), where('shopId', '==', 'a')))
    assert.equal(both.size, 2)
    const one = await assertSucceeds(apts(owner('a'), where('shopId', '==', 'a'), where('barberId', '==', 'b2')))
    assert.deepEqual(one.docs.map((d) => d.id), ['apt2'])
    await assertFails(apts(owner('b'), where('shopId', '==', 'a')))
  })
  it('nobody writes blocks or schedule intervals from the client', async () => {
    const block = { barberId: 'b1', start: DAY_START, end: DAY_END, reason: 'x' }
    for (const db of [anon(), customer('cust1'), owner('a'), barber('a', 'b1'), admin()]) {
      await assertFails(setDoc(doc(db, 'shops/a/blocks/new'), block))
      await assertFails(updateDoc(doc(db, 'shops/a/blocks/k1'), { reason: 'changed' }))
      await assertFails(deleteDoc(doc(db, 'shops/a/blocks/k1')))
      await assertFails(updateDoc(doc(db, 'shops/a/schedules/x_20260101'), { intervals: [] }))
      await assertFails(deleteDoc(doc(db, 'shops/a/schedules/x_20260101')))
    }
  })
})

describe('NFR-04 isolation', () => {
  it('customer reads only their own appointments and profile', async () => {
    await assertSucceeds(getDoc(doc(customer('cust1'), 'appointments/apt1')))
    await assertFails(getDoc(doc(customer('cust1'), 'appointments/apt2')))
    await assertFails(getDoc(doc(anon(), 'appointments/apt1')))
    await assertSucceeds(getDoc(doc(customer('cust1'), 'customers/cust1')))
    await assertFails(getDoc(doc(customer('cust2'), 'customers/cust1')))
  })
  it('staff read only their own shop appointments; barbers only their own', async () => {
    await assertSucceeds(getDoc(doc(owner('a'), 'appointments/apt2')))
    await assertFails(getDoc(doc(owner('b'), 'appointments/apt1')))
    await assertSucceeds(getDoc(doc(barber('a'), 'appointments/apt1')))
    await assertFails(getDoc(doc(barber('a'), 'appointments/apt2')))
  })
  it('scopes audit log and notifications to the shop', async () => {
    await assertSucceeds(getDoc(doc(owner('a'), 'auditLog/e1')))
    await assertFails(getDoc(doc(owner('b'), 'auditLog/e1')))
    await assertSucceeds(getDoc(doc(owner('a'), 'notifications/n1')))
    await assertFails(getDoc(doc(owner('b'), 'notifications/n1')))
    await assertSucceeds(getDoc(doc(barber('a'), 'notifications/n1')))
    await assertFails(getDoc(doc(customer('cust1'), 'notifications/n1')))
  })
  it('lets a customer read only their own waitlist entries (FR-15)', async () => {
    await assertSucceeds(getDoc(doc(customer('cust1'), 'waitlist/w1')))
    await assertFails(getDoc(doc(customer('cust1'), 'waitlist/w2')))
    await assertSucceeds(getDoc(doc(customer('cust2'), 'waitlist/w2')))
    await assertSucceeds(getDoc(doc(customer('cust2'), 'waitlist/w3')))
    await assertFails(getDoc(doc(customer('cust3'), 'waitlist/w1')))
    await assertFails(getDoc(doc(anon(), 'waitlist/w1')))
  })
  it('supports listing own entries by customerId, and nobody else\'s (FR-15)', async () => {
    await assertSucceeds(getDocs(query(collection(customer('cust2'), 'waitlist'), where('customerId', '==', 'cust2'))))
    await assertFails(getDocs(query(collection(customer('cust1'), 'waitlist'), where('customerId', '==', 'cust2'))))
    await assertFails(getDocs(collection(customer('cust1'), 'waitlist')))
  })
  it('lets the shop owner read every entry of their shop, and no other shop\'s (FR-15)', async () => {
    for (const id of ['w1', 'w2', 'w3']) await assertSucceeds(getDoc(doc(owner('a'), `waitlist/${id}`)))
    await assertFails(getDoc(doc(owner('b'), 'waitlist/w1')))
    await assertSucceeds(getDocs(query(collection(owner('a'), 'waitlist'), where('shopId', '==', 'a'))))
  })
  it('lets a barber read only entries that name them (FR-15)', async () => {
    await assertSucceeds(getDoc(doc(barber('a', 'b1'), 'waitlist/w1')))
    await assertFails(getDoc(doc(barber('a', 'b1'), 'waitlist/w2'))) // any barber: not this barber's entry
    await assertFails(getDoc(doc(barber('a', 'b1'), 'waitlist/w3'))) // names b2
    await assertSucceeds(getDoc(doc(barber('a', 'b2'), 'waitlist/w3')))
    await assertFails(getDoc(doc(barber('b', 'b1'), 'waitlist/w1')))
    await assertSucceeds(getDocs(query(collection(barber('a', 'b1'), 'waitlist'), where('shopId', '==', 'a'), where('barberId', '==', 'b1'))))
    await assertFails(getDocs(query(collection(barber('a', 'b1'), 'waitlist'), where('shopId', '==', 'a'))))
    await assertFails(getDoc(doc(admin(), 'waitlist/w1')))
  })
  it('lets a customer read only their own deposit (FR-13)', async () => {
    await assertSucceeds(getDoc(doc(customer('cust1'), 'deposits/d1')))
    await assertFails(getDoc(doc(customer('cust1'), 'deposits/d2')))
    await assertFails(getDoc(doc(customer('cust3'), 'deposits/d1')))
    await assertFails(getDoc(doc(anon(), 'deposits/d1')))
  })
  it('lets the shop owner, and only the matching barber, read deposits (FR-13)', async () => {
    await assertSucceeds(getDoc(doc(owner('a'), 'deposits/d1')))
    await assertSucceeds(getDoc(doc(owner('a'), 'deposits/d2')))
    await assertFails(getDoc(doc(owner('b'), 'deposits/d1')))
    await assertSucceeds(getDoc(doc(barber('a', 'b1'), 'deposits/d1')))
    await assertFails(getDoc(doc(barber('a', 'b1'), 'deposits/d2')))
    await assertFails(getDoc(doc(barber('b', 'b1'), 'deposits/d1')))
    await assertFails(getDoc(doc(admin(), 'deposits/d1')))
  })
  it('supports listing own deposits by customerId, and a barber\'s by shop and barber (FR-13)', async () => {
    await assertSucceeds(getDocs(query(collection(customer('cust1'), 'deposits'), where('customerId', '==', 'cust1'))))
    await assertFails(getDocs(collection(customer('cust1'), 'deposits')))
    await assertSucceeds(getDocs(query(collection(barber('a', 'b1'), 'deposits'), where('shopId', '==', 'a'), where('barberId', '==', 'b1'))))
    await assertFails(getDocs(query(collection(barber('a', 'b1'), 'deposits'), where('shopId', '==', 'a'))))
  })
  it('lets a barber read only reminder tasks for their own bookings (FR-09)', async () => {
    await assertFails(getDoc(doc(barber('a'), 'notifications/n2')))
    await assertSucceeds(getDocs(query(collection(barber('a'), 'notifications'), where('shopId', '==', 'a'), where('barberId', '==', 'b1'))))
    await assertFails(getDocs(query(collection(barber('a'), 'notifications'), where('shopId', '==', 'a'))))
    await assertSucceeds(getDocs(query(collection(owner('a'), 'notifications'), where('shopId', '==', 'a'))))
  })
  it('keeps a HELD appointment (no customer yet) unreadable to customers and anonymous users', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'appointments/held1'), { shopId: 'a', barberId: 'b1', customerId: null, status: 'HELD' }))
    await assertFails(getDoc(doc(anon(), 'appointments/held1')))
    await assertFails(getDoc(doc(customer('cust1'), 'appointments/held1')))
    await assertFails(getDoc(doc(owner('b'), 'appointments/held1')))
    await assertSucceeds(getDoc(doc(owner('a'), 'appointments/held1')))
  })
  it('lets a customer read the appointment only after confirmBooking assigns it to them', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'appointments/held2'), { shopId: 'a', barberId: 'b1', customerId: 'cust3', status: 'CONFIRMED' }))
    await assertSucceeds(getDoc(doc(customer('cust3'), 'appointments/held2')))
    await assertFails(getDoc(doc(customer('cust1'), 'appointments/held2')))
  })
  it('supports listing own appointments by customerId', async () => {
    await assertSucceeds(getDocs(query(collection(customer('cust1'), 'appointments'), where('customerId', '==', 'cust1'))))
    await assertFails(getDocs(collection(customer('cust1'), 'appointments')))
  })
})

describe('no client writes to server-owned data', () => {
  const paths = [
    'appointments/new', 'auditLog/new', 'notifications/new', 'deposits/new', 'waitlist/new',
    'shops/a/schedules/new', 'shops/a/queue/new', 'shops/a/blocks/new', 'shops/a/dailyStats/new', 'shops/a/statContrib/new',
    'customers/cust1', 'customers/cust1/shopStats/a', 'shops/a/members/x',
  ]
  for (const path of paths) {
    it(`denies writes to ${path}`, async () => {
      for (const db of [anon(), customer('cust1'), owner('a'), barber('a'), admin()]) {
        await assertFails(setDoc(doc(db, path), { shopId: 'a', customerId: 'cust1' }))
      }
    })
  }
  it('denies creating, updating and deleting waitlist entries, including a customer claiming or joining directly (FR-15)', async () => {
    const entry = { shopId: 'a', barberId: null, customerId: 'cust1', serviceId: 's1', date: '20300107', status: 'waiting' }
    for (const db of [anon(), customer('cust1'), customer('cust2'), owner('a'), barber('a', 'b1'), admin()]) {
      await assertFails(setDoc(doc(db, 'waitlist/fresh'), entry))
      await assertFails(updateDoc(doc(db, 'waitlist/w1'), { status: 'claimed' }))
      await assertFails(updateDoc(doc(db, 'waitlist/w2'), { status: 'claimed', claimedBookingId: 'r1' }))
      await assertFails(deleteDoc(doc(db, 'waitlist/w1')))
    }
  })
  it('denies updating and deleting deposits, including the customer marking their own as paid (FR-13)', async () => {
    for (const db of [customer('cust1'), owner('a'), barber('a', 'b1'), admin()]) {
      await assertFails(updateDoc(doc(db, 'deposits/d1'), { status: 'paid' }))
      await assertFails(deleteDoc(doc(db, 'deposits/d1')))
    }
  })
  it('denies updating and deleting existing appointments', async () => {
    await assertFails(updateDoc(doc(owner('a'), 'appointments/apt1'), { status: 'CANCELLED' }))
    await assertFails(deleteDoc(doc(customer('cust1'), 'appointments/apt1')))
  })
})

describe('FR-04/05 cancellation and rescheduling data', () => {
  beforeEach(() => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'customers/cust1/shopStats/a'), { lateCancels: 1 })
    await setDoc(doc(ctx.firestore(), 'customers/cust2/shopStats/a'), { lateCancels: 0 })
  }))
  it('a customer cannot cancel, move or flag their own appointment from the client', async () => {
    const ref = () => doc(customer('cust1'), 'appointments/apt1')
    await assertFails(updateDoc(ref(), { status: 'CANCELLED' }))
    await assertFails(updateDoc(ref(), { status: 'CANCELLED', lateCancel: false }))
    await assertFails(updateDoc(ref(), { start: new Date('2030-01-01T02:00:00Z') }))
    await assertFails(updateDoc(ref(), { lateCancelAttempted: false }))
    await assertFails(deleteDoc(ref()))
  })
  it('a customer cannot list or read another customer\'s appointments', async () => {
    await assertFails(getDocs(query(collection(customer('cust1'), 'appointments'), where('customerId', '==', 'cust2'))))
    await assertFails(getDoc(doc(customer('cust1'), 'appointments/apt2')))
  })
  it('a customer reads only their own shopStats and cannot write them', async () => {
    await assertSucceeds(getDoc(doc(customer('cust1'), 'customers/cust1/shopStats/a')))
    await assertFails(getDoc(doc(customer('cust1'), 'customers/cust2/shopStats/a')))
    await assertFails(setDoc(doc(customer('cust1'), 'customers/cust1/shopStats/a'), { lateCancels: 0 }))
    await assertFails(updateDoc(doc(customer('cust1'), 'customers/cust1/shopStats/a'), { lateCancels: 0 }))
  })
  it('staff cannot read customer shopStats', async () => {
    await assertFails(getDoc(doc(owner('a'), 'customers/cust1/shopStats/a')))
    await assertFails(getDoc(doc(barber('a'), 'customers/cust1/shopStats/a')))
  })
  it('nobody can change an appointment or the schedule from the client, including other shops\' staff', async () => {
    for (const db of [owner('a'), barber('a'), owner('b'), barber('b'), customer('cust1'), anon()]) {
      await assertFails(updateDoc(doc(db, 'appointments/apt1'), { status: 'CANCELLED' }))
      await assertFails(updateDoc(doc(db, 'shops/a/schedules/x_20260101'), { intervals: [] }))
    }
  })
  it('audit records of cancellations are readable by their own shop only, and never writable', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'auditLog/e2'), { shopId: 'a', bookingId: 'apt1', action: 'lateCancelRefused' }))
    await assertSucceeds(getDoc(doc(owner('a'), 'auditLog/e2')))
    await assertFails(getDoc(doc(owner('b'), 'auditLog/e2')))
    await assertFails(getDoc(doc(customer('cust1'), 'auditLog/e2')))
    await assertFails(setDoc(doc(customer('cust1'), 'auditLog/e3'), { shopId: 'a', action: 'cancel' }))
    await assertFails(updateDoc(doc(owner('a'), 'auditLog/e2'), { action: 'cancel' }))
  })
})

describe('FR-12 no-show data', () => {
  beforeEach(() => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'customers/cust1/shopStats/a'), { noShowCount: 1 })
    await setDoc(doc(ctx.firestore(), 'auditLog/ns1'), { shopId: 'a', bookingId: 'apt1', action: 'noShow' })
    await setDoc(doc(ctx.firestore(), 'auditLog/ns2'), { shopId: 'a', bookingId: 'apt1', action: 'noShowReversed' })
  }))
  it('no client can start, finish, mark or reverse: status and FR-12 fields are server-only', async () => {
    const fields = [{ status: 'IN_SERVICE', actualStart: new Date() }, { status: 'COMPLETED', actualEnd: new Date() },
      { status: 'NO_SHOW', noShowAt: new Date() }, { status: 'CONFIRMED', noShowAt: null }]
    for (const db of [owner('a'), barber('a', 'b1'), owner('b'), customer('cust1'), anon()]) {
      for (const f of fields) await assertFails(updateDoc(doc(db, 'appointments/apt1'), f))
    }
  })
  it('a customer can read but not change their own noShowCount; staff cannot read or write it', async () => {
    const path = 'customers/cust1/shopStats/a'
    const stat = (await assertSucceeds(getDoc(doc(customer('cust1'), path)))).data()
    assert.equal(stat.noShowCount, 1)
    await assertFails(updateDoc(doc(customer('cust1'), path), { noShowCount: 0 }))
    await assertFails(setDoc(doc(customer('cust1'), path), { noShowCount: 0 }))
    for (const db of [owner('a'), barber('a', 'b1')]) {
      await assertFails(getDoc(doc(db, path)))
      await assertFails(updateDoc(doc(db, path), { noShowCount: 0 }))
      await assertFails(setDoc(doc(db, 'customers/cust2/shopStats/a'), { noShowCount: 5 }))
    }
    await assertFails(getDoc(doc(customer('cust2'), path)))
  })
  it('no-show audit records are readable by their own shop only and never writable', async () => {
    for (const id of ['ns1', 'ns2']) {
      await assertSucceeds(getDoc(doc(owner('a'), `auditLog/${id}`)))
      await assertSucceeds(getDoc(doc(barber('a', 'b1'), `auditLog/${id}`)))
      await assertFails(getDoc(doc(owner('b'), `auditLog/${id}`)))
      await assertFails(getDoc(doc(customer('cust1'), `auditLog/${id}`)))
      await assertFails(updateDoc(doc(owner('a'), `auditLog/${id}`), { action: 'cancel' }))
      await assertFails(deleteDoc(doc(owner('a'), `auditLog/${id}`)))
    }
    await assertFails(setDoc(doc(owner('a'), 'auditLog/ns3'), { shopId: 'a', action: 'noShow' }))
  })
})

describe('shop configuration writes', () => {
  it('owner writes valid services in own shop only', async () => {
    await assertSucceeds(setDoc(doc(owner('a'), 'shops/a/services/s2'), service))
    await assertFails(setDoc(doc(owner('a'), 'shops/b/services/s2'), service))
    await assertFails(setDoc(doc(barber('a'), 'shops/a/services/s2'), service))
    await assertFails(setDoc(doc(customer('cust1'), 'shops/a/services/s2'), service))
  })
  it('rejects invalid services', async () => {
    const db = owner('a')
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, durationMin: 32 }))
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, durationMin: 0 }))
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, priceCents: 25.5 }))
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, priceCents: -1 }))
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, name: '' }))
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, extra: true }))
  })
  it('requires a known service category (FR-01)', async () => {
    const db = owner('a')
    const { category, ...noCategory } = service
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), noCategory))
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, category: 'spa' }))
    await assertFails(setDoc(doc(db, 'shops/a/services/s2'), { ...service, category: 7 }))
    for (const c of ['haircut', 'beard', 'shave', 'colour', 'perm', 'kids', 'other']) {
      await assertSucceeds(setDoc(doc(db, 'shops/a/services/s2'), { ...service, category: c }))
    }
    await assertSucceeds(updateDoc(doc(db, 'shops/a/services/s1'), { category: 'beard' }))
    await assertFails(updateDoc(doc(db, 'shops/a/services/s1'), { category: 'spa' }))
  })
  it('owner deactivates and reactivates a service', async () => {
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a/services/s1'), { active: false }))
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a/services/s1'), { active: true }))
    await assertFails(updateDoc(doc(owner('b'), 'shops/a/services/s1'), { active: false }))
  })
  it('owner edits and deactivates barbers in own shop only', async () => {
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a/barbers/b1'), { active: false }))
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a/barbers/b1'), { active: true }))
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a/barbers/b1'), { displayName: 'Ali B', serviceIds: [] }))
    await assertFails(updateDoc(doc(owner('b'), 'shops/a/barbers/b1'), { active: false }))
    await assertFails(updateDoc(doc(barber('a'), 'shops/a/barbers/b1'), { active: false }))
    await assertFails(updateDoc(doc(customer('cust1'), 'shops/a/barbers/b1'), { active: false }))
    await assertFails(updateDoc(doc(anon(), 'shops/a/barbers/b1'), { active: false }))
  })
  it('rejects invalid barber updates', async () => {
    const ref = () => doc(owner('a'), 'shops/a/barbers/b1')
    await assertFails(updateDoc(ref(), { active: 'no' }))
    await assertFails(updateDoc(ref(), { serviceIds: 's1' }))
    await assertFails(updateDoc(ref(), { workingHours: 'always' }))
    await assertFails(updateDoc(ref(), { displayName: 42 }))
    await assertFails(updateDoc(ref(), { extra: true }))
  })
  it('clients cannot create or delete barbers (addBarber does that)', async () => {
    await assertFails(setDoc(doc(owner('a'), 'shops/a/barbers/b2'), barberDoc))
    await assertFails(deleteDoc(doc(owner('a'), 'shops/a/barbers/b1')))
  })
  it('owner edits profile but not status; admin edits only status', async () => {
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a'), { noticeMins: 60 }))
    await assertFails(updateDoc(doc(owner('a'), 'shops/a'), { status: 'suspended' }))
    await assertFails(updateDoc(doc(owner('b'), 'shops/a'), { noticeMins: 60 }))
    await assertSucceeds(updateDoc(doc(admin(), 'shops/p'), { status: 'verified' }))
    await assertFails(updateDoc(doc(admin(), 'shops/p'), { status: 'verified', name: 'x' }))
    await assertFails(updateDoc(doc(admin(), 'shops/p'), { name: 'x' }))
  })
  it('no client writes the trigger-owned shop summary fields (FR-01)', async () => {
    const summary = { priceMin: 100, priceMax: 200, serviceTypes: ['haircut'], minDurationMin: 15 }
    for (const [field, value] of Object.entries(summary)) {
      await assertFails(updateDoc(doc(owner('a'), 'shops/a'), { [field]: value }))
      await assertFails(updateDoc(doc(owner('b'), 'shops/a'), { [field]: value }))
      await assertFails(updateDoc(doc(barber('a'), 'shops/a'), { [field]: value }))
      await assertFails(updateDoc(doc(admin(), 'shops/a'), { [field]: value }))
      await assertFails(updateDoc(doc(customer('cust1'), 'shops/a'), { [field]: value }))
    }
    await assertFails(updateDoc(doc(owner('a'), 'shops/a'), { noticeMins: 60, ...summary }))
    await assertFails(setDoc(doc(owner('a'), 'shops/a'), { name: 'a', status: 'verified', tz: 'Asia/Singapore', ...summary }))
    // Ordinary profile edits still work alongside.
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a'), { name: 'Renamed', noticeMins: 90 }))
  })
  it('does not allow creating shops from the client', async () => {
    await assertFails(setDoc(doc(owner('a'), 'shops/new'), { status: 'verified' }))
    await assertFails(setDoc(doc(admin(), 'shops/new'), { status: 'verified' }))
  })
})

describe('FR-11 booking history', () => {
  const mine = (uid, ...clauses) => getDocs(query(collection(customer(uid), 'appointments'), where('customerId', '==', uid), ...clauses))
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const base = { shopId: 'a', barberId: 'b1', serviceId: 's1', start: DAY_START, end: DAY_END }
      for (const [id, status, customerId] of [
        ['h1', 'COMPLETED', 'cust9'], ['h2', 'CANCELLED', 'cust9'], ['h3', 'NO_SHOW', 'cust9'], ['h4', 'CONFIRMED', 'cust9'],
        ['h5', 'EXPIRED', null], ['h6', 'HELD', null], ['h7', 'COMPLETED', 'cust8'],
      ]) await setDoc(doc(db, `appointments/${id}`), { ...base, status, customerId })
      // A booking at a shop that has since been suspended, with an inactive service and barber.
      await setDoc(doc(db, 'shops/s'), { name: 's', status: 'suspended', tz: 'Asia/Singapore' })
      await setDoc(doc(db, 'shops/s/services/s1'), { ...service, active: false })
      await setDoc(doc(db, 'shops/s/barbers/b1'), { ...barberDoc, active: false })
      await setDoc(doc(db, 'shops/a/services/s2'), { ...service, active: false })
      await setDoc(doc(db, 'shops/a/barbers/b3'), { ...barberDoc, active: false })
    })
  })

  it('lists a customer\'s own history across statuses in one customerId query, and only theirs', async () => {
    const snap = await assertSucceeds(mine('cust9'))
    assert.deepEqual(snap.docs.map((d) => d.id).sort(), ['h1', 'h2', 'h3', 'h4'])
    const other = await assertSucceeds(mine('cust8'))
    assert.deepEqual(other.docs.map((d) => d.id), ['h7'])
  })
  it('never returns expired or held appointments to a customer, since they have no customerId', async () => {
    const snap = await assertSucceeds(mine('cust9'))
    assert.ok(!snap.docs.some((d) => ['EXPIRED', 'HELD'].includes(d.data().status)))
    await assertFails(getDoc(doc(customer('cust9'), 'appointments/h5')))
    await assertFails(getDoc(doc(customer('cust9'), 'appointments/h6')))
  })
  it('denies another customer\'s history, an unfiltered listing, and a status-only listing', async () => {
    await assertFails(getDocs(query(collection(customer('cust1'), 'appointments'), where('customerId', '==', 'cust9'))))
    await assertFails(getDocs(collection(customer('cust9'), 'appointments')))
    await assertFails(getDocs(query(collection(customer('cust9'), 'appointments'), where('status', '==', 'COMPLETED'))))
    await assertFails(getDoc(doc(customer('cust9'), 'appointments/h7')))
  })
  it('gives anonymous users and other shops\' staff nothing from the history query', async () => {
    await assertFails(getDocs(query(collection(anon(), 'appointments'), where('customerId', '==', 'cust9'))))
    await assertFails(getDocs(query(collection(owner('b'), 'appointments'), where('customerId', '==', 'cust9'))))
  })
  it('lets a customer read an inactive service or barber of a verified shop, so Rebook can explain', async () => {
    await assertSucceeds(getDoc(doc(customer('cust9'), 'shops/a/services/s2')))
    await assertSucceeds(getDoc(doc(customer('cust9'), 'shops/a/barbers/b3')))
  })
  it('hides a suspended shop and its service and barber docs from customers (Rebook is disabled)', async () => {
    await assertFails(getDoc(doc(customer('cust9'), 'shops/s')))
    await assertFails(getDoc(doc(customer('cust9'), 'shops/s/services/s1')))
    await assertFails(getDoc(doc(customer('cust9'), 'shops/s/barbers/b1')))
  })
  it('history is read-only: a customer cannot edit or delete a finished appointment', async () => {
    await assertFails(updateDoc(doc(customer('cust9'), 'appointments/h1'), { status: 'CANCELLED' }))
    await assertFails(deleteDoc(doc(customer('cust9'), 'appointments/h1')))
  })
})
