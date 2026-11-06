// FR-15: the waitlist (decisions A6 addendum). joinWaitlist adds a customer
// for a shop, date and service (barber optional). A trigger on schedule writes
// finds time that became free and offers it to the earliest compatible entry
// by holding it exclusively for 15 minutes: a HELD appointment plus a hold
// interval, created in one transaction with the entry's `offered` status and
// a notification task. claimOffer confirms it through the same code as
// confirmBooking, so the FR-13 deposit rule applies. Offers are decided on
// the current schedule inside a transaction, never on the trigger event,
// because triggers are at-least-once and unordered.
const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/https");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const {
  transact, failure, invalid, liveIntervals, overlaps, scheduleId, sgDateKey,
  sgTimeToMs, withinHours, auditRecord, confirmHeldInTx, withDeposit,
  requireVerifiedCustomer, MINUTE_MS, DAY_MS, HORIZON_DAYS,
} = require("./booking");
const notifications = require("./notifications");

const OFFER_MS = 15 * MINUTE_MS; // how long an offer holds the slot.
const LEAD_MS = 15 * MINUTE_MS; // a slot must start this long after the offer.
const ts = (ms) => Timestamp.fromMillis(ms);
const ACTIVE = ["waiting", "offered"];

/**
 * @param {string} customerId Customer uid.
 * @param {string} shopId Shop ID.
 * @param {string} serviceId Service ID.
 * @param {string} date Requested date, yyyymmdd.
 * @param {?string} barberId Barber ID, or null for any barber.
 * @return {string} The deterministic entry ID (one active entry per combo).
 */
function entryId(customerId, shopId, serviceId, date, barberId) {
  return `${customerId}_${shopId}_${serviceId}_${date}_${barberId || "any"}`;
}

/**
 * @param {string} date Requested date, yyyymmdd (Singapore).
 * @return {number} The start of the next Singapore day (ms): entries expire
 *   when expiresAt <= now.
 */
function dateEndMs(date) {
  return sgTimeToMs(date, "00:00") + DAY_MS;
}

/**
 * @param {string} date Candidate yyyymmdd.
 * @param {number} now Current time (ms).
 * @return {boolean} True if it is one of the bookable dates (today to +13).
 */
function isBookableDate(date, now) {
  if (typeof date !== "string" || !/^\d{8}$/.test(date)) return false;
  const today = sgTimeToMs(sgDateKey(now), "00:00");
  for (let i = 0; i < HORIZON_DAYS; i++) {
    if (sgDateKey(today + i * DAY_MS) === date) return true;
  }
  return false;
}

/**
 * The agreed lead time: an offer is only made if the offered slot starts at
 * least 15 minutes after the offer is created, so the claim window closes
 * before the appointment starts. Exactly 15 minutes is allowed.
 * @param {number} start Offered slot start (ms).
 * @param {number} now The offer's creation time (ms).
 * @return {boolean} True if the offer may be made.
 */
function offerLeadOk(start, now) {
  return start - now >= LEAD_MS;
}

/**
 * @param {Array<{start: number, end: number}>} ranges Ranges in ms.
 * @return {Array<{start: number, end: number}>} Sorted, touching or
 *   overlapping ranges merged.
 */
function mergeRanges(ranges) {
  const sorted = ranges.filter((r) => r.end > r.start)
      .map((r) => ({start: r.start, end: r.end}))
      .sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/**
 * Time that was busy before and is not busy after: what a write freed.
 * Bookings, holds and blocks all count, so turning a hold into a booking
 * frees nothing.
 * @param {Array<{start: number, end: number}>} before Intervals before (ms).
 * @param {Array<{start: number, end: number}>} after Intervals after (ms).
 * @return {Array<{start: number, end: number}>} The freed ranges.
 */
function freedRanges(before, after) {
  const kept = mergeRanges(after);
  const freed = [];
  for (const b of mergeRanges(before)) {
    let cursor = b.start;
    for (const a of kept) {
      if (a.end <= cursor) continue;
      if (a.start >= b.end) break;
      if (a.start > cursor) freed.push({start: cursor, end: a.start});
      cursor = Math.max(cursor, a.end);
    }
    if (cursor < b.end) freed.push({start: cursor, end: b.end});
  }
  return freed;
}

/**
 * Strict fit (limitation L27): the freed interval by itself must last at
 * least as long as the service.
 * @param {{start: number, end: number}} range The freed range.
 * @param {number} durationMin Service duration.
 * @return {boolean} True if it fits.
 */
function fitsDuration(range, durationMin) {
  return range.end - range.start >= durationMin * MINUTE_MS;
}

/**
 * @param {Object} data Entry data (Timestamps).
 * @param {string} id Entry ID.
 * @return {Object} The caller-visible entry.
 */
function entrySummary(data, id) {
  const ms = (t) => (t ? t.toMillis() : null);
  return {
    entryId: id, shopId: data.shopId, serviceId: data.serviceId,
    barberId: data.barberId, date: data.date, status: data.status,
    offerExpiresAt: ms(data.offerExpiresAt),
  };
}

/**
 * joinWaitlist: a verified customer joins for one shop, date and service,
 * with an optional barber. Idempotent per combination while the entry is
 * waiting or offered.
 * @param {Object} request The callable request (auth, data {shopId,
 *   serviceId, barberId?, date, displayName}).
 * @param {Object} db Firestore instance.
 * @param {number} now Current time (ms), defaults to the real clock.
 * @return {Promise<Object>} The entry summary plus `alreadyJoined`.
 */
async function joinWaitlist(request, db, now) {
  const at = now === undefined ? Date.now() : now;
  const {uid} = requireVerifiedCustomer(request.auth);
  const data = request.data || {};
  for (const f of ["shopId", "serviceId"]) {
    if (typeof data[f] !== "string" || !data[f] || data[f].includes("/")) {
      invalid(f, `Missing ${f}.`);
    }
  }
  let barberId = data.barberId;
  if (barberId === undefined || barberId === null || barberId === "" ||
      barberId === "any") {
    barberId = null;
  } else if (typeof barberId !== "string" || barberId.includes("/")) {
    invalid("barberId", "Choose a barber or any barber.");
  }
  if (!isBookableDate(data.date, at)) {
    invalid("date",
        `Choose a date from today to ${HORIZON_DAYS - 1} days ahead.`);
  }
  const displayName =
    typeof data.displayName === "string" ? data.displayName.trim() : "";
  if (displayName.length < 1 || displayName.length > 80) {
    invalid("displayName", "Name must be 1 to 80 characters.");
  }

  const {shopId, serviceId, date} = data;
  const shopRef = db.doc(`shops/${shopId}`);
  const [shopSnap, svcSnap, barberSnap] = await Promise.all([
    shopRef.get(), shopRef.collection("services").doc(serviceId).get(),
    barberId ? shopRef.collection("barbers").doc(barberId).get() : null]);
  if (!shopSnap.exists || shopSnap.data().status !== "verified") {
    throw failure("not-found", "SHOP_NOT_FOUND", "Shop not found.");
  }
  if (!svcSnap.exists || svcSnap.data().active !== true) {
    invalid("serviceId", "That service is not available.");
  }
  if (barberId) {
    const b = barberSnap.exists ? barberSnap.data() : null;
    if (!b || b.active !== true || !Array.isArray(b.serviceIds) ||
        !b.serviceIds.includes(serviceId)) {
      invalid("barberId", "That barber is not available for this service.");
    }
  }

  const id = entryId(uid, shopId, serviceId, date, barberId);
  const ref = db.doc(`waitlist/${id}`);
  return transact(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && ACTIVE.includes(snap.data().status)) {
      return {...entrySummary(snap.data(), id), alreadyJoined: true};
    }
    const entry = {
      shopId, serviceId, barberId, date, customerId: uid,
      customerName: displayName, joinedAt: ts(at),
      expiresAt: ts(dateEndMs(date)), status: "waiting",
    };
    tx.set(ref, entry); // a finished entry is replaced, not merged.
    return {...entrySummary(entry, id), alreadyJoined: false};
  });
}

/**
 * Tries to offer [start, end) to one entry, in one transaction that re-reads
 * the entry and the schedule.
 * @param {Object} db Firestore instance.
 * @param {Object} o {shopId, barberId, entryRef, svc, start, end, clock}.
 * @return {Promise<string>} "offered", "entry_gone", "slot_taken" or
 *   "too_late".
 */
function tryOffer(db, o) {
  const {shopId, barberId, entryRef, svc, start, end, clock} = o;
  const requestId = crypto.randomUUID();
  const schedRef = db.doc(
      `shops/${shopId}/schedules/${scheduleId(barberId, start)}`);
  return transact(async (tx) => {
    const [entrySnap, schedSnap] = await tx.getAll(entryRef, schedRef);
    if (!entrySnap.exists || entrySnap.data().status !== "waiting") {
      return "entry_gone";
    }
    const entry = entrySnap.data();
    const at = clock(); // the transaction's own time.
    if (!offerLeadOk(start, at)) return "too_late";
    const live = liveIntervals(
        schedSnap.data() && schedSnap.data().intervals, at);
    if (live.some((iv) => overlaps(iv, start, end))) return "slot_taken";

    const holdExpiresAt = ts(at + OFFER_MS);
    const apt = {
      requestId, shopId, barberId, serviceId: entry.serviceId,
      waitlistEntryId: entryRef.id, customerId: null,
      start: ts(start), end: ts(end), status: "HELD", holdExpiresAt,
      priceCents: svc.priceCents, durationMin: svc.durationMin,
    };
    tx.set(schedRef, {
      barberId, date: sgDateKey(start),
      intervals: [...live, {
        start: apt.start, end: apt.end, kind: "hold", holdExpiresAt}],
      version: FieldValue.increment(1),
    }, {merge: true});
    tx.set(db.doc(`appointments/${requestId}`), apt);
    tx.update(entryRef, {
      status: "offered",
      offerSlot: {barberId, start: apt.start, end: apt.end},
      offerRequestId: requestId,
      offerExpiresAt: holdExpiresAt,
    });
    tx.set(db.doc(`auditLog/${requestId}_HELD`), auditRecord({
      apt, actorUid: null, role: "system", action: "offer", from: null,
      to: "HELD", now: at}));
    tx.set(db.doc(`notifications/${requestId}_waitlistOffer`),
        notifications.offerTask(apt, entryRef.id, at));
    return "offered";
  });
}

/**
 * Offers each freed range on one barber-day to the earliest-joined compatible
 * waiting entry (one offer per range).
 * @param {Object} db Firestore instance.
 * @param {Object} o {shopId, barberId, dateKey, ranges, now?}.
 * @return {Promise<Object>} {offers, skipped}: `skipped` counts ranges that
 *   were not offered because they start less than 15 minutes ahead.
 */
async function offerFreed(db, o) {
  const {shopId, barberId, dateKey, ranges} = o;
  const clock = o.now === undefined ? Date.now : () => o.now;
  const result = {offers: 0, skipped: 0};
  if (!ranges.length) return result;

  const shopRef = db.doc(`shops/${shopId}`);
  const [shopSnap, barberSnap, svcSnap, entrySnap] = await Promise.all([
    shopRef.get(), shopRef.collection("barbers").doc(barberId).get(),
    shopRef.collection("services").get(),
    db.collection("waitlist").where("shopId", "==", shopId)
        .where("date", "==", dateKey).where("status", "==", "waiting")
        .orderBy("joinedAt").get()]);
  if (!shopSnap.exists || shopSnap.data().status !== "verified" ||
      !barberSnap.exists || barberSnap.data().active !== true) {
    return result;
  }
  const shop = shopSnap.data();
  const barber = barberSnap.data();
  const services = {};
  for (const d of svcSnap.docs) {
    if (d.data().active === true) services[d.id] = d.data();
  }
  const entries = entrySnap.docs.slice().sort((a, b) =>
    (a.data().joinedAt.toMillis() - b.data().joinedAt.toMillis()) ||
    (a.id < b.id ? -1 : 1));

  const taken = new Set();
  for (const range of ranges) {
    if (!offerLeadOk(range.start, clock())) {
      result.skipped++;
      continue;
    }
    for (const doc of entries) {
      const entry = doc.data();
      const svc = services[entry.serviceId];
      if (taken.has(doc.id) || !svc) continue;
      if (entry.barberId && entry.barberId !== barberId) continue;
      if (!Array.isArray(barber.serviceIds) ||
          !barber.serviceIds.includes(entry.serviceId)) continue;
      if (!fitsDuration(range, svc.durationMin)) continue;
      const start = range.start;
      const end = start + svc.durationMin * MINUTE_MS;
      if (sgDateKey(start) !== dateKey ||
          !withinHours(shop.openingHours, start, end) ||
          !withinHours(barber.workingHours, start, end)) continue;
      const outcome = await tryOffer(db, {
        shopId, barberId, entryRef: doc.ref, svc, start, end, clock});
      if (outcome === "offered") {
        result.offers++;
        taken.add(doc.id);
        break;
      }
      if (outcome === "slot_taken" || outcome === "too_late") break;
    }
  }
  return result;
}

/**
 * The Firestore trigger on schedule writes: works out what the write freed
 * and offers it. Idempotent: a repeated event finds the slot already held.
 * @param {Object} event {params: {shopId}, data: {before, after}}.
 * @param {Object} db Firestore instance.
 * @param {number} now Current time (ms), defaults to the real clock.
 * @return {Promise<Object>} {offers, skipped}.
 */
async function onScheduleWritten(event, db, now) {
  const {before, after} = event.data;
  if (!before || !before.exists) return {offers: 0, skipped: 0};
  const toRanges = (snap) => (snap && snap.exists ?
    (snap.data().intervals || []) : []).map((iv) =>
    ({start: iv.start.toMillis(), end: iv.end.toMillis()}));
  const ranges = freedRanges(toRanges(before), toRanges(after));
  const {barberId, date} = before.data();
  return offerFreed(db, {
    shopId: event.params.shopId, barberId, dateKey: date, ranges, now});
}

/**
 * claimOffer: the entry's customer confirms the offered slot through the same
 * code as confirmBooking (so a customer with two no-shows gets a deposit).
 * @param {Object} request The callable request (auth, data {entryId}).
 * @param {Object} db Firestore instance.
 * @return {Promise<Object>} The booking summary (status CONFIRMED, or
 *   PENDING_PAYMENT with depositCents).
 */
async function claimOffer(request, db) {
  const {uid, phone} = requireVerifiedCustomer(request.auth);
  const id = (request.data || {}).entryId;
  if (typeof id !== "string" || !id || id.length > 300 || id.includes("/")) {
    invalid("entryId", "Missing entry.");
  }
  const entryRef = db.doc(`waitlist/${id}`);
  const notFound = () =>
    failure("not-found", "OFFER_NOT_FOUND", "Offer not found.");
  const expired = () => failure("failed-precondition", "OFFER_EXPIRED",
      "This offer has expired.");

  let result;
  try {
    result = await transact(async (tx) => {
      const snap = await tx.get(entryRef);
      if (!snap.exists || snap.data().customerId !== uid) throw notFound();
      const entry = snap.data();
      if (entry.status === "claimed") { // idempotent replay.
        const apt = await tx.get(db.doc(
            `appointments/${entry.claimedBookingId}`));
        return {summary: withDeposit(apt.data())};
      }
      if (entry.status === "expired") throw expired();
      if (entry.status !== "offered") throw notFound();
      if (Date.now() >= entry.offerExpiresAt.toMillis()) throw expired();
      const res = await confirmHeldInTx(tx, db, {
        requestId: entry.offerRequestId, uid, phone,
        displayName: entry.customerName, viaOffer: true});
      if (res.expired) {
        tx.update(entryRef,
            {status: "expired", expireReason: "offer_lapsed"});
        return res;
      }
      tx.update(entryRef, {
        status: "claimed", claimedBookingId: entry.offerRequestId,
        claimedAt: ts(Date.now())});
      return res;
    });
  } catch (err) {
    const reason = err instanceof HttpsError && err.details &&
      err.details.reason;
    if (reason === "HOLD_EXPIRED" || reason === "HOLD_NOT_FOUND" ||
        reason === "HOLD_ALREADY_USED") {
      throw expired(); // the offer's hold is gone.
    }
    throw err;
  }
  if (result.expired) throw expired();
  return result.summary;
}

module.exports = {
  entryId, dateEndMs, isBookableDate, offerLeadOk, mergeRanges, freedRanges,
  fitsDuration, joinWaitlist, tryOffer, offerFreed, onScheduleWritten,
  claimOffer, OFFER_MS, LEAD_MS,
};
