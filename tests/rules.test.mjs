import { after, before, beforeEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, setLogLevel, updateDoc, where } from 'firebase/firestore'

// Denied writes are expected here; keep the SDK from logging each one.
setLogLevel('silent')

let env

const owner = (shopId) => env.authenticatedContext(`${shopId}-owner`, { shopId, role: 'owner' }).firestore()
const barber = (shopId, barberId = 'b1') =>
  env.authenticatedContext(`${shopId}-barber`, { shopId, role: 'barber', barberId }).firestore()
const admin = () => env.authenticatedContext('admin', { admin: true }).firestore()
const customer = (uid) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()

const service = { name: 'Cut', durationMin: 30, priceCents: 2500, active: true }

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
      await setDoc(doc(db, `shops/${id}/schedules/x_20260101`), { intervals: [] })
    }
    await setDoc(doc(db, 'appointments/apt1'), { shopId: 'a', barberId: 'b1', customerId: 'cust1' })
    await setDoc(doc(db, 'appointments/apt2'), { shopId: 'a', barberId: 'b2', customerId: 'cust2' })
    await setDoc(doc(db, 'auditLog/e1'), { shopId: 'a', bookingId: 'apt1' })
    await setDoc(doc(db, 'notifications/n1'), { shopId: 'a', bookingId: 'apt1' })
    await setDoc(doc(db, 'customers/cust1'), { phoneE164: '+6591234567' })
  })
})

describe('public reads', () => {
  it('lets anyone read verified shops, services and schedules', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'shops/a')))
    await assertSucceeds(getDoc(doc(anon(), 'shops/a/services/s1')))
    await assertSucceeds(getDoc(doc(anon(), 'shops/a/schedules/x_20260101')))
  })
  it('hides pending shops and their data from the public', async () => {
    await assertFails(getDoc(doc(anon(), 'shops/p')))
    await assertFails(getDoc(doc(anon(), 'shops/p/services/s1')))
    await assertSucceeds(getDoc(doc(owner('p'), 'shops/p')))
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
    await assertSucceeds(getDoc(doc(barber('a'), 'notifications/n1')))
    await assertFails(getDoc(doc(customer('cust1'), 'notifications/n1')))
  })
  it('supports listing own appointments by customerId', async () => {
    await assertSucceeds(getDocs(query(collection(customer('cust1'), 'appointments'), where('customerId', '==', 'cust1'))))
    await assertFails(getDocs(collection(customer('cust1'), 'appointments')))
  })
})

describe('no client writes to server-owned data', () => {
  const paths = [
    'appointments/new', 'auditLog/new', 'notifications/new', 'deposits/new', 'waitlist/new',
    'shops/a/schedules/new', 'shops/a/queue/new', 'shops/a/blocks/new', 'shops/a/dailyStats/new',
    'customers/cust1', 'customers/cust1/shopStats/a', 'shops/a/members/x',
  ]
  for (const path of paths) {
    it(`denies writes to ${path}`, async () => {
      for (const db of [anon(), customer('cust1'), owner('a'), barber('a'), admin()]) {
        await assertFails(setDoc(doc(db, path), { shopId: 'a', customerId: 'cust1' }))
      }
    })
  }
  it('denies updating and deleting existing appointments', async () => {
    await assertFails(updateDoc(doc(owner('a'), 'appointments/apt1'), { status: 'CANCELLED' }))
    await assertFails(deleteDoc(doc(customer('cust1'), 'appointments/apt1')))
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
  it('owner edits profile but not status; admin edits only status', async () => {
    await assertSucceeds(updateDoc(doc(owner('a'), 'shops/a'), { noticeMins: 60 }))
    await assertFails(updateDoc(doc(owner('a'), 'shops/a'), { status: 'suspended' }))
    await assertFails(updateDoc(doc(owner('b'), 'shops/a'), { noticeMins: 60 }))
    await assertSucceeds(updateDoc(doc(admin(), 'shops/p'), { status: 'verified' }))
    await assertFails(updateDoc(doc(admin(), 'shops/p'), { status: 'verified', name: 'x' }))
    await assertFails(updateDoc(doc(admin(), 'shops/p'), { name: 'x' }))
  })
  it('does not allow creating shops from the client', async () => {
    await assertFails(setDoc(doc(owner('a'), 'shops/new'), { status: 'verified' }))
    await assertFails(setDoc(doc(admin(), 'shops/new'), { status: 'verified' }))
  })
})
