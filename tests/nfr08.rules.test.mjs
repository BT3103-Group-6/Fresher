// NFR-08: Security Rules cases for auditLog that tests/rules.test.mjs does not cover yet
// (docs/evidence/NFR-08/audit-trail.md, open point 4). The audit trail is read-only to clients:
// only the shop's own staff may read it, and nobody may create, change or delete a record.
// Needs the Firestore emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/nfr08.rules.test.mjs
import { after, before, beforeEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  Timestamp, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, setLogLevel, updateDoc, where,
} from 'firebase/firestore'

// Denied reads and writes are expected here; keep the SDK from logging each one.
setLogLevel('silent')

let env

const owner = (shopId) => env.authenticatedContext(`${shopId}-owner`, { shopId, role: 'owner' }).firestore()
const barber = (shopId, barberId = 'b1') =>
  env.authenticatedContext(`${shopId}-barber-${barberId}`, { shopId, role: 'barber', barberId }).firestore()
const admin = () => env.authenticatedContext('admin', { admin: true }).firestore()
const customer = (uid) =>
  env.authenticatedContext(uid, { phone_number: '+6591234567' }).firestore()
const anon = () => env.unauthenticatedContext().firestore()

const AT = Timestamp.fromMillis(Date.UTC(2030, 0, 7, 2))
const EXPIRE = Timestamp.fromMillis(Date.UTC(2031, 0, 7, 2))
// A full record, shaped exactly as functions/booking.js auditRecord() writes it.
const record = (over = {}) => ({
  bookingId: 'apt1', shopId: 'a', actorUid: 'cust1', role: 'customer', action: 'confirm',
  fromStatus: 'HELD', toStatus: 'CONFIRMED', at: AT, expireAt: EXPIRE, ...over,
})

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'fresher-nfr08-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
after(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'shops/a'), { name: 'a', status: 'verified', tz: 'Asia/Singapore' })
    await setDoc(doc(db, 'shops/b'), { name: 'b', status: 'verified', tz: 'Asia/Singapore' })
    await setDoc(doc(db, 'appointments/apt1'), { shopId: 'a', barberId: 'b1', customerId: 'cust1', start: AT })
    // Booking apt1 belongs to cust1 and barber b1 of shop a.
    await setDoc(doc(db, 'auditLog/apt1_CONFIRMED'), record())
    await setDoc(doc(db, 'auditLog/apt1_HELD'),
      record({ actorUid: null, action: 'hold', fromStatus: null, toStatus: 'HELD' }))
    await setDoc(doc(db, 'auditLog/other'), record({ bookingId: 'apt9', shopId: 'b' }))
  })
})

describe('NFR-08 who may read audit records', () => {
  it('the shop owner and every barber of that shop can read them', async () => {
    for (const db of [owner('a'), barber('a', 'b1'), barber('a', 'b2')]) {
      await assertSucceeds(getDoc(doc(db, 'auditLog/apt1_CONFIRMED')))
      await assertSucceeds(getDoc(doc(db, 'auditLog/apt1_HELD')))
    }
  })
  it('the public, the platform admin and staff of another shop cannot read them', async () => {
    for (const db of [anon(), admin(), owner('b'), barber('b', 'b1')]) {
      await assertFails(getDoc(doc(db, 'auditLog/apt1_CONFIRMED')))
    }
  })
  it('the customer cannot read the record of their own booking', async () => {
    await assertFails(getDoc(doc(customer('cust1'), 'auditLog/apt1_CONFIRMED')))
    await assertFails(getDoc(doc(customer('cust1'), 'auditLog/apt1_HELD')))
  })
  it('staff can list only their own shop\'s records, and only with a shopId filter', async () => {
    const log = (db) => collection(db, 'auditLog')
    await assertSucceeds(getDocs(query(log(owner('a')), where('shopId', '==', 'a'))))
    await assertSucceeds(getDocs(query(log(barber('a')), where('shopId', '==', 'a'), where('bookingId', '==', 'apt1'))))
    await assertFails(getDocs(log(owner('a'))))
    await assertFails(getDocs(query(log(owner('a')), where('shopId', '==', 'b'))))
    await assertFails(getDocs(query(log(owner('a')), where('bookingId', '==', 'apt1'))))
  })
  it('nobody else can list records, even filtered to a booking or shop', async () => {
    for (const db of [anon(), admin(), customer('cust1')]) {
      await assertFails(getDocs(collection(db, 'auditLog')))
      await assertFails(getDocs(query(collection(db, 'auditLog'), where('shopId', '==', 'a'))))
      await assertFails(getDocs(query(collection(db, 'auditLog'), where('bookingId', '==', 'apt1'))))
    }
  })
})

describe('NFR-08 audit records are immutable to every client', () => {
  const everyone = () => [
    ['anonymous', anon()], ['customer', customer('cust1')], ['admin', admin()],
    ['owner', owner('a')], ['barber', barber('a', 'b1')], ['other shop owner', owner('b')],
  ]
  it('no client can create a record, even a fully valid one', async () => {
    for (const [, db] of everyone()) {
      await assertFails(setDoc(doc(db, 'auditLog/forged'), record()))
      await assertFails(setDoc(doc(db, 'auditLog/apt1_CANCELLED'),
        record({ action: 'cancel', fromStatus: 'CONFIRMED', toStatus: 'CANCELLED' })))
    }
  })
  it('no client can change any field of an existing record', async () => {
    for (const [, db] of everyone()) {
      const ref = doc(db, 'auditLog/apt1_CONFIRMED')
      await assertFails(updateDoc(ref, { toStatus: 'CANCELLED' }))
      await assertFails(updateDoc(ref, { actorUid: 'someone-else' }))
      await assertFails(updateDoc(ref, { at: Timestamp.now() }))
      await assertFails(updateDoc(ref, { expireAt: Timestamp.fromMillis(Date.UTC(2099, 0, 1)) }))
      await assertFails(setDoc(ref, record({ toStatus: 'CANCELLED' })))
      await assertFails(setDoc(ref, { note: 'x' }, { merge: true }))
    }
  })
  it('no client can delete a record, including the shop owner', async () => {
    for (const [, db] of everyone()) {
      await assertFails(deleteDoc(doc(db, 'auditLog/apt1_CONFIRMED')))
      await assertFails(deleteDoc(doc(db, 'auditLog/apt1_HELD')))
    }
  })
  it('a record is unchanged after every client has tried to change or delete it', async () => {
    for (const [, db] of everyone()) {
      await updateDoc(doc(db, 'auditLog/apt1_CONFIRMED'), { toStatus: 'CANCELLED' }).catch(() => {})
      await deleteDoc(doc(db, 'auditLog/apt1_CONFIRMED')).catch(() => {})
    }
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = (await getDoc(doc(ctx.firestore(), 'auditLog/apt1_CONFIRMED'))).data()
      if (!d || d.toStatus !== 'CONFIRMED' || d.actorUid !== 'cust1' || d.expireAt.toMillis() !== EXPIRE.toMillis()) {
        throw new Error(`record changed: ${JSON.stringify(d)}`)
      }
    })
  })
})
