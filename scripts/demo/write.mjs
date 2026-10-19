// A18: writes the demo dataset to Firestore and Auth (emulator, or the live demo project through seed.mjs, which owns
// all the safety checks), then reads it back and validates it. Never call this without those checks.
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { docCounts, formatReport, validateDataset } from './validate.mjs'

// Fields that hold times: plain milliseconds in the dataset, Timestamps in Firestore.
const TIME_KEYS = new Set([
  'start', 'end', 'holdExpiresAt', 'actualStart', 'actualEnd', 'noShowAt', 'at', 'expireAt', 'createdAt', 'dueAt',
  'nextAttemptAt', 'apptStart', 'joinedAt', 'expiresAt', 'plannedAt',
])
const toFs = (v, key) => {
  if (Array.isArray(v)) return v.map((x) => toFs(x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x, k)]))
  return typeof v === 'number' && TIME_KEYS.has(key) ? Timestamp.fromMillis(v) : v
}
const fromFs = (v) => {
  if (Array.isArray(v)) return v.map(fromFs)
  if (v && typeof v.toMillis === 'function') return v.toMillis()
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromFs(x)]))
  return v
}
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]))

async function pool(items, size, fn) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

/** Removes what an earlier run generated, so a rerun replaces it cleanly (emulator, or live with --overwrite). */
async function cleanup(db, ds, log) {
  const bw = db.bulkWriter()
  bw.onWriteError((err) => err.failedAttempts < 5)
  const ids = ds.shops.map((s) => s.id)
  await pool(ids, 6, async (shopId) => {
    // Waitlist first, so nothing can be offered while schedules are removed.
    for (const coll of ['waitlist', 'deposits', 'notifications', 'auditLog', 'appointments']) {
      for (const d of (await db.collection(coll).where('shopId', '==', shopId).get()).docs) bw.delete(d.ref)
    }
  })
  await bw.flush()
  await pool(ids, 6, async (shopId) => {
    for (const sub of ['statContrib', 'dailyStats', 'schedules', 'blocks', 'queue']) {
      await db.recursiveDelete(db.collection(`shops/${shopId}/${sub}`), bw)
    }
    // Configuration is rewritten by id; drop anything an older catalogue had that this one does not.
    const shop = ds.shops.find((s) => s.id === shopId)
    const keep = {
      services: new Set(shop.services.map((s) => s.id)),
      barbers: new Set(shop.barbers.map((b) => b.id)),
      members: new Set([shop.ownerUid, ...shop.barbers.map((b) => b.uid)]),
    }
    for (const [sub, set] of Object.entries(keep)) {
      for (const d of (await db.collection(`shops/${shopId}/${sub}`).get()).docs) if (!set.has(d.id)) bw.delete(d.ref)
    }
  })
  await pool(ds.customers, 8, (c) => db.recursiveDelete(db.doc(`customers/${c.id}`), bw))
  await bw.close()
  log('  removed the previous demo data')
}

async function upsertUser(auth, uid, props, claims) {
  try {
    await auth.updateUser(uid, props)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    await auth.createUser({ uid, ...props })
  }
  if (claims) await auth.setCustomUserClaims(uid, claims)
}

async function createAccounts(auth, ds, password, log) {
  await pool(ds.accounts, 8, (a) => upsertUser(auth, a.uid, { email: a.email, password, emailVerified: true }, a.claims))
  log(`  ${ds.accounts.length} staff accounts`)
  const skipped = []
  for (const c of ds.showcase) {
    try {
      await upsertUser(auth, c.uid, { phoneNumber: c.phoneE164, displayName: c.displayName }, null)
    } catch (err) {
      if (err.code !== 'auth/phone-number-already-exists') throw err
      skipped.push(c.phoneE164) // someone already signed in with this test number; never delete their account
    }
  }
  log(`  ${ds.showcase.length - skipped.length} showcase customer accounts` + (skipped.length ? ` (skipped ${skipped.join(', ')}: that number already has an Auth user under another uid; delete it in the console and rerun)` : ''))
}

export async function seedDemo({ db, auth, ds, password, clean, log = console.log }) {
  log(`Seeding the demo dataset (${ds.shops.length} shops, seed ${ds.meta.seed}, density ${ds.meta.density})...`)
  if (clean) await cleanup(db, ds, log)
  const bw = db.bulkWriter()
  bw.onWriteError((err) => {
    if (err.failedAttempts < 5) return true
    console.error(`Write failed for ${err.documentRef.path}: ${err.message}`)
    return false
  })
  const set = (path, data) => bw.set(db.doc(path), toFs(data))

  // 1. Shops with services, barbers and members.
  for (const s of ds.shops) {
    set(`shops/${s.id}`, pick(s, ['name', 'address', 'postalCode', 'lat', 'lng', 'geohash', 'status', 'latePolicy', 'noticeMins', 'tz', 'openingHours', 'priceMin', 'priceMax', 'serviceTypes', 'minDurationMin']))
    for (const v of s.services) set(`shops/${s.id}/services/${v.id}`, omit(v, ['id']))
    for (const b of s.barbers) {
      set(`shops/${s.id}/barbers/${b.id}`, pick(b, ['displayName', 'active', 'serviceIds', 'workingHours']))
      set(`shops/${s.id}/members/${b.uid}`, { role: 'barber', barberId: b.id })
    }
    set(`shops/${s.id}/members/${s.ownerUid}`, { role: 'owner' })
  }
  await bw.flush()
  // 2. Stats before appointments: a running onAppointmentWritten trigger then finds each ledger already equal.
  for (const x of ds.statContrib) set(`shops/${x.shopId}/statContrib/${x.id}`, omit(x, ['shopId', 'id']))
  for (const d of ds.dailyStats) set(`shops/${d.shopId}/dailyStats/${d.id}`, { barbers: d.barbers })
  for (const c of ds.customers) set(`customers/${c.id}`, pick(c, ['phoneE164', 'displayName']))
  for (const x of ds.shopStats) set(`customers/${x.customerId}/shopStats/${x.shopId}`, pick(x, ['noShowCount', 'lateCancels']))
  await bw.flush()
  // 3. Schedules and blocks, then 4. appointments with their audit records and notification tasks.
  for (const x of ds.schedules) set(`shops/${x.shopId}/schedules/${x.id}`, pick(x, ['barberId', 'date', 'intervals', 'version']))
  for (const b of ds.blocks) set(`shops/${b.shopId}/blocks/${b.id}`, omit(b, ['shopId', 'id']))
  await bw.flush()
  for (const a of ds.appointments) set(`appointments/${a.requestId}`, a)
  for (const a of ds.audit) set(`auditLog/${a.id}`, omit(a, ['id']))
  for (const n of ds.notifications) set(`notifications/${n.id}`, omit(n, ['id']))
  await bw.flush()
  // 5. Waitlist and walk-ins last, after the schedules they could react to.
  for (const w of ds.waitlist) set(`waitlist/${w.id}`, omit(w, ['id']))
  for (const q of ds.queue) set(`shops/${q.shopId}/queue/${q.id}`, omit(q, ['id']))
  await bw.close()
  log('  documents written')

  await createAccounts(auth, ds, password, log)

  // Read back and validate what is really stored.
  log('Validating what was written...')
  const back = await readBack(db, ds)
  const problems = validateDataset(back, { now: Date.now() })
  const want = docCounts(ds).by
  const got = docCounts(back).by
  const mismatched = Object.keys(want).filter((k) => want[k] !== got[k])
  for (const k of mismatched) problems.push(`${k}: wrote ${want[k]} documents, read back ${got[k]}`)
  log(formatReport(docCounts(ds)))
  if (problems.length) {
    console.error(`\nValidation found ${problems.length} problem(s):`)
    for (const p of problems.slice(0, 30)) console.error(`  - ${p}`)
    return { ok: false, problems }
  }
  log('\nValidation passed on the stored data: no overlaps, every appointment matches an interval, stats and counters are consistent.')
  return { ok: true, problems: [] }
}

/** Reads the demo documents back into the dataset shape (times in ms). Only documents this generator owns. */
export async function readBack(db, ds) {
  const ids = ds.shops.map((s) => s.id)
  const out = { meta: { ...ds.meta }, shops: [], customers: [], appointments: [], audit: [], notifications: [], schedules: [], blocks: [], statContrib: [], dailyStats: [], shopStats: [], waitlist: [], queue: [], accounts: [], showcase: [] }
  const list = async (path) => (await db.collection(path).get()).docs.map((d) => ({ id: d.id, ...fromFs(d.data()) }))
  const query = async (coll, shopId) => (await db.collection(coll).where('shopId', '==', shopId).get()).docs.map((d) => ({ id: d.id, ...fromFs(d.data()) }))
  await pool(ids, 6, async (shopId) => {
    const [shop, services, barbers, schedules, blocks, dailyStats, statContrib, queue, apts, audit, notes, waitlist] = await Promise.all([
      db.doc(`shops/${shopId}`).get(), list(`shops/${shopId}/services`), list(`shops/${shopId}/barbers`),
      list(`shops/${shopId}/schedules`), list(`shops/${shopId}/blocks`), list(`shops/${shopId}/dailyStats`),
      list(`shops/${shopId}/statContrib`), list(`shops/${shopId}/queue`), query('appointments', shopId),
      query('auditLog', shopId), query('notifications', shopId), query('waitlist', shopId),
    ])
    const members = await list(`shops/${shopId}/members`)
    out.shops.push({
      id: shopId, ...fromFs(shop.data()), services,
      barbers: barbers.map((b) => ({ ...b })),
      ownerUid: (members.find((m) => m.role === 'owner') || {}).id,
    })
    for (const s of schedules) out.schedules.push({ shopId, ...s })
    for (const b of blocks) out.blocks.push({ shopId, ...b })
    for (const d of dailyStats) out.dailyStats.push({ shopId, id: d.id, barbers: d.barbers })
    for (const x of statContrib) out.statContrib.push({ shopId, ...x })
    for (const q of queue) out.queue.push({ shopId, ...q })
    // Appointments, audit and tasks made by this generator (real bookings made since would not be ours).
    const ours = new Set(apts.filter((a) => a.id.startsWith('dm-')).map((a) => a.id))
    for (const a of apts) if (ours.has(a.id)) out.appointments.push({ ...omit(a, ['id']) })
    for (const a of audit) if (ours.has(a.bookingId)) out.audit.push(a)
    for (const n of notes) if (ours.has(n.bookingId)) out.notifications.push(n)
    for (const w of waitlist) if (w.customerId.startsWith('demo-cust-')) out.waitlist.push(w)
  })
  const custs = await db.collection('customers').where(FieldPath.documentId(), '>=', 'demo-cust-').where(FieldPath.documentId(), '<', 'demo-cust.').get()
  for (const d of custs.docs) out.customers.push({ id: d.id, ...d.data() })
  for (const d of (await db.collectionGroup('shopStats').get()).docs) {
    const customerId = d.ref.parent.parent.id
    if (customerId.startsWith('demo-cust-')) out.shopStats.push({ customerId, shopId: d.id, ...d.data() })
  }
  // The dataset order does not matter to the validator; sort only so its messages are stable.
  for (const k of ['shops', 'customers', 'appointments', 'schedules']) out[k].sort((a, b) => ((a.id || a.requestId) < (b.id || b.requestId) ? -1 : 1))
  return out
}
