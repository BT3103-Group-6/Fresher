// FR-14: shop analytics counters (decisions A7). The onAppointmentWritten
// trigger keeps shops/{shopId}/dailyStats/{yyyymmdd} up to date. Triggers are
// delivered at least once and can arrive out of order, so it never adds
// event deltas. Each appointment's current contribution is kept in a ledger
// doc (statContrib/{appointmentId}); a run re-reads the appointment, works out
// new minus old and applies only that difference, all in one transaction.
const {FieldValue, getFirestore} = require("firebase-admin/firestore");
const {sgDateKey} = require("./booking");

/**
 * What one appointment adds to the stats. Only COMPLETED and NO_SHOW count;
 * the day is the Singapore date of the appointment start.
 * @param {?Object} apt Appointment data, or null when it does not exist.
 * @return {?Object} {dateKey, barberId, completed, valueCents, noShows,
 *   bookedMin}, or null when it contributes nothing.
 */
function contribution(apt) {
  if (!apt || (apt.status !== "COMPLETED" && apt.status !== "NO_SHOW")) {
    return null;
  }
  const done = apt.status === "COMPLETED";
  return {
    dateKey: sgDateKey(apt.start.toMillis()),
    barberId: apt.barberId,
    completed: done ? 1 : 0,
    valueCents: done ? apt.priceCents : 0,
    noShows: done ? 0 : 1,
    bookedMin: done ? apt.durationMin : 0,
  };
}

const FIELDS = ["completed", "valueCents", "noShows", "bookedMin"];

/**
 * @param {?Object} a A contribution or null.
 * @param {?Object} b A contribution or null.
 * @return {boolean} True when both are the same contribution.
 */
function same(a, b) {
  if (!a || !b) return a === b || (!a && !b);
  return a.dateKey === b.dateKey && a.barberId === b.barberId &&
    FIELDS.every((f) => a[f] === b[f]);
}

/**
 * New contribution minus old, per barber-day. Days and barbers that end up
 * unchanged are left out.
 * @param {?Object} prev Old contribution (the ledger), or null.
 * @param {?Object} next New contribution, or null.
 * @return {Object[]} [{dateKey, barberId, completed, valueCents, noShows,
 *   bookedMin}] with the differences.
 */
function delta(prev, next) {
  const byKey = new Map();
  const add = (c, sign) => {
    if (!c) return;
    const key = `${c.dateKey}|${c.barberId}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        dateKey: c.dateKey, barberId: c.barberId,
        completed: 0, valueCents: 0, noShows: 0, bookedMin: 0,
      });
    }
    const entry = byKey.get(key);
    for (const f of FIELDS) entry[f] += sign * c[f];
  };
  add(prev, -1);
  add(next, 1);
  return [...byKey.values()].filter((e) => FIELDS.some((f) => e[f] !== 0));
}

/**
 * Brings the stats in line with the appointment's current state. Safe to call
 * any number of times, in any order, concurrently.
 * @param {Object} db Firestore instance.
 * @param {string} shopId Shop the appointment belongs to.
 * @param {string} id Appointment ID.
 * @return {Promise<boolean>} True when anything changed.
 */
function applyAppointment(db, shopId, id) {
  const aptRef = db.doc(`appointments/${id}`);
  const ledgerRef = db.doc(`shops/${shopId}/statContrib/${id}`);
  return db.runTransaction(async (tx) => {
    const [aptSnap, ledgerSnap] =
      await Promise.all([tx.get(aptRef), tx.get(ledgerRef)]);
    const next = aptSnap.exists ? contribution(aptSnap.data()) : null;
    const prev = ledgerSnap.exists ? ledgerSnap.data() : null;
    const changes = delta(prev, next);
    if (same(prev, next)) return false;
    if (next) tx.set(ledgerRef, next);
    else if (ledgerSnap.exists) tx.delete(ledgerRef);
    for (const c of changes) {
      const inc = {};
      for (const f of FIELDS) inc[f] = FieldValue.increment(c[f]);
      tx.set(db.doc(`shops/${shopId}/dailyStats/${c.dateKey}`),
          {barbers: {[c.barberId]: inc}}, {merge: true});
    }
    return changes.length > 0;
  });
}

/**
 * Trigger handler for appointments/{appointmentId} writes.
 * @param {Object} event Firestore document-written event.
 * @param {Object} [db] Firestore instance (tests pass their own).
 * @return {Promise<boolean>} True when the stats changed.
 */
async function onAppointmentWritten(event, db = getFirestore()) {
  const change = event.data;
  const before = change && change.before && change.before.exists ?
    change.before.data() : null;
  const after = change && change.after && change.after.exists ?
    change.after.data() : null;
  // Most writes (hold, confirm, reschedule, start) change nothing here.
  const a = contribution(before);
  const b = contribution(after);
  if (same(a, b)) return false;
  const shopId = (after || before).shopId;
  return applyAppointment(db, shopId, event.params.appointmentId);
}

/**
 * Rebuilds the stats from existing appointments (for data that was written
 * before the trigger existed). Runs applyAppointment for every COMPLETED or
 * NO_SHOW appointment and for every ledger entry, so it is safe to rerun and
 * safe next to live triggers. `reset` first deletes the shop's stats and
 * ledger to repair wrong counters; do not use it while bookings are changing.
 * @param {Object} db Firestore instance.
 * @param {Object} [options] {shopId: limit to one shop, reset: boolean}.
 * @return {Promise<Object>} {appointments, changed} counts.
 */
async function backfill(db, {shopId, reset} = {}) {
  if (reset) {
    const shops = shopId ? [db.doc(`shops/${shopId}`)] :
      await db.collection("shops").listDocuments();
    for (const shop of shops) {
      await db.recursiveDelete(shop.collection("dailyStats"));
      await db.recursiveDelete(shop.collection("statContrib"));
    }
  }
  const targets = new Map(); // appointment ID -> shopId.
  const counted = db.collection("appointments")
      .where("status", "in", ["COMPLETED", "NO_SHOW"]);
  for (const doc of (await (shopId ?
    counted.where("shopId", "==", shopId) : counted).get()).docs) {
    targets.set(doc.id, doc.data().shopId);
  }
  for (const doc of (await db.collectionGroup("statContrib").get()).docs) {
    const shop = doc.ref.parent.parent.id;
    if (!shopId || shop === shopId) targets.set(doc.id, shop);
  }
  const entries = [...targets];
  let changed = 0;
  for (let i = 0; i < entries.length; i += 10) {
    const results = await Promise.all(entries.slice(i, i + 10).map(
        ([id, shop]) => applyAppointment(db, shop, id)));
    changed += results.filter(Boolean).length;
  }
  return {appointments: entries.length, changed};
}

module.exports = {
  contribution, delta, applyAppointment, onAppointmentWritten, backfill,
};
