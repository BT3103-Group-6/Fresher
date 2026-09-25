// FR-02/FR-03: holdSlot, confirmBooking, releaseHold.
// Design: docs/architecture.md "holdSlot algorithm". One
// schedules/{barberId_yyyymmdd} doc per barber-day is the lock; every state
// change also writes an auditLog record in the same transaction.
const {HttpsError} = require("firebase-functions/https");
const {FieldValue, Timestamp, getFirestore} =
  require("firebase-admin/firestore");

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SG_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Singapore has no DST.
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const HOLD_MS = 10 * MINUTE_MS;
const FRESH_OTP_MS = 10 * MINUTE_MS; // decisions A3: fresh OTP window.
const DEFAULT_NOTICE_MINS = 120;
const GRID_MS = 15 * MINUTE_MS;
const HORIZON_DAYS = 14; // decisions A3: today to +13 days.
const REQUEST_ID = /^[A-Za-z0-9-]{16,64}$/;
const SG_PHONE = /^\+65[89]\d{7}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Business failure the UI can branch on through `details.reason`.
 * @param {string} code HttpsError code.
 * @param {string} reason Machine-readable reason (e.g. SLOT_TAKEN).
 * @param {string} message Human-readable message.
 * @return {HttpsError} The error to throw.
 */
function failure(code, reason, message) {
  return new HttpsError(code, message, {reason});
}

/**
 * Throws an invalid-argument error naming the offending field.
 * @param {string} field Input field name.
 * @param {string} message Human-readable problem.
 */
function invalid(field, message) {
  throw new HttpsError("invalid-argument", message, {field});
}

/**
 * @param {*} value Candidate request ID.
 * @return {string} The validated ID.
 */
function checkRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    invalid("requestId", "Invalid request ID.");
  }
  return value;
}

/**
 * @param {number} ms Epoch milliseconds.
 * @return {string} Singapore calendar date as yyyymmdd.
 */
function sgDateKey(ms) {
  const d = new Date(ms + SG_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}`;
}

/**
 * @param {number} ms Epoch milliseconds.
 * @return {string} Singapore weekday key (mon..sun).
 */
function sgWeekday(ms) {
  return DAYS[(new Date(ms + SG_OFFSET_MS).getUTCDay() + 6) % 7];
}

/**
 * @param {string} dateKey Singapore date as yyyymmdd.
 * @param {string} hhmm Local time "HH:MM".
 * @return {number} Epoch milliseconds.
 */
function sgTimeToMs(dateKey, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(
      Number(dateKey.slice(0, 4)), Number(dateKey.slice(4, 6)) - 1,
      Number(dateKey.slice(6, 8)), h, m) - SG_OFFSET_MS;
}

/**
 * @param {Object} hours Weekly pattern {mon: [{start, end}], ...}.
 * @param {number} start Interval start (ms).
 * @param {number} end Interval end (ms).
 * @return {boolean} True if [start, end) sits inside one range that day.
 */
function withinHours(hours, start, end) {
  const ranges = hours && hours[sgWeekday(start)];
  if (!Array.isArray(ranges)) return false;
  const key = sgDateKey(start);
  return ranges.some((r) => HHMM.test(r.start) && HHMM.test(r.end) &&
    sgTimeToMs(key, r.start) <= start && end <= sgTimeToMs(key, r.end));
}

/**
 * Half-open overlap: back-to-back intervals do not overlap.
 * @param {Object} interval A stored schedule interval.
 * @param {number} start Start (ms).
 * @param {number} end End (ms).
 * @return {boolean} True if they overlap.
 */
function overlaps(interval, start, end) {
  return interval.start.toMillis() < end && start < interval.end.toMillis();
}

/**
 * Drops holds that have expired, so correctness never depends on a scheduler.
 * @param {Array<Object>} intervals Stored intervals.
 * @param {number} now Current time (ms).
 * @return {Array<Object>} Intervals still in force.
 */
function liveIntervals(intervals, now) {
  return (intervals || []).filter((i) =>
    !(i.kind === "hold" && i.holdExpiresAt.toMillis() <= now));
}

/**
 * @param {Object} apt Appointment data.
 * @return {Object} What the caller may see about a hold or booking.
 */
function summary(apt) {
  return {
    requestId: apt.requestId,
    status: apt.status,
    barberId: apt.barberId,
    start: apt.start.toMillis(),
    end: apt.end.toMillis(),
    holdExpiresAt: apt.holdExpiresAt ? apt.holdExpiresAt.toMillis() : null,
    priceCents: apt.priceCents,
    durationMin: apt.durationMin,
  };
}

/**
 * Builds an auditLog record (NFR-08): 12-month TTL on expireAt.
 * @param {Object} a Fields: apt, actorUid, role, action, from, to, now.
 * @return {Object} The document data.
 */
function auditRecord(a) {
  const expire = new Date(a.now);
  expire.setUTCMonth(expire.getUTCMonth() + 12);
  return {
    bookingId: a.apt.requestId,
    shopId: a.apt.shopId,
    actorUid: a.actorUid,
    role: a.role,
    action: a.action,
    fromStatus: a.from,
    toStatus: a.to,
    at: Timestamp.fromMillis(a.now),
    expireAt: Timestamp.fromDate(expire),
  };
}

/**
 * Runs a transaction and turns lock contention that outlasted the retries
 * into a retryable error, never into a success.
 * @param {Function} body Transaction body.
 * @return {Promise<*>} The body's result.
 */
async function transact(body) {
  try {
    return await getFirestore().runTransaction(body, {maxAttempts: 25});
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err.code === 10 || err.code === 4) {
      throw failure("aborted", "BUSY", "Busy right now. Please try again.");
    }
    throw err;
  }
}

/**
 * @param {string} barberId Barber ID.
 * @param {number} start Interval start (ms).
 * @return {string} Schedule doc ID.
 */
function scheduleId(barberId, start) {
  return `${barberId}_${sgDateKey(start)}`;
}

/**
 * @param {Object} apt Appointment data.
 * @return {DocumentReference} The barber-day schedule doc holding its interval.
 */
function scheduleRefOf(apt) {
  return getFirestore().doc(`shops/${apt.shopId}/schedules/` +
    scheduleId(apt.barberId, apt.start.toMillis()));
}

/**
 * holdSlot: HELD interval for 10 minutes. Unauthenticated (OTP comes later);
 * requestId doubles as the appointment ID for idempotency.
 * @param {Object} data {shopId, serviceId, barberId|"any", start, requestId}.
 * @return {Promise<Object>} Hold summary.
 */
async function holdSlot(data) {
  const requestId = checkRequestId(data.requestId);
  for (const f of ["shopId", "serviceId", "barberId"]) {
    if (typeof data[f] !== "string" || !data[f] || data[f].includes("/")) {
      invalid(f, `Missing ${f}.`);
    }
  }
  const {shopId, serviceId, barberId} = data;
  const start = data.start;
  if (!Number.isInteger(start) || start % GRID_MS !== 0) {
    invalid("start", "Choose a start time on a 15-minute slot.");
  }
  const now = Date.now();
  const horizon = sgTimeToMs(sgDateKey(now), "00:00") + HORIZON_DAYS * DAY_MS;
  if (start <= now) invalid("start", "That time has already passed.");
  if (start >= horizon) {
    invalid("start", `Bookings open up to ${HORIZON_DAYS} days ahead.`);
  }

  const db = getFirestore();
  const shopRef = db.doc(`shops/${shopId}`);
  const [shopSnap, svcSnap] = await Promise.all([
    shopRef.get(), shopRef.collection("services").doc(serviceId).get()]);
  if (!shopSnap.exists || shopSnap.data().status !== "verified") {
    throw failure("not-found", "SHOP_NOT_FOUND", "Shop not found.");
  }
  if (!svcSnap.exists || svcSnap.data().active !== true) {
    invalid("serviceId", "That service is not available.");
  }
  const shop = shopSnap.data();
  const service = svcSnap.data();
  const end = start + service.durationMin * MINUTE_MS; // never from the client.
  if (!withinHours(shop.openingHours, start, end)) {
    invalid("start", "That time is outside the shop's opening hours.");
  }

  let barbers;
  if (barberId === "any") {
    const snap = await shopRef.collection("barbers")
        .where("active", "==", true).get();
    barbers = snap.docs.map((d) => ({id: d.id, ...d.data()}));
  } else {
    const snap = await shopRef.collection("barbers").doc(barberId).get();
    barbers = snap.exists ? [{id: snap.id, ...snap.data()}] : [];
    if (!barbers.length || barbers[0].active !== true) {
      invalid("barberId", "That barber is not available.");
    }
  }
  const candidates = barbers
      .filter((b) => Array.isArray(b.serviceIds) &&
        b.serviceIds.includes(serviceId) &&
        withinHours(b.workingHours, start, end))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!candidates.length) {
    invalid("start", "No barber is working at that time for this service.");
  }

  const aptRef = db.doc(`appointments/${requestId}`);
  const schedRefs = candidates.map((b) =>
    shopRef.collection("schedules").doc(scheduleId(b.id, start)));

  return transact(async (tx) => {
    const [aptSnap, ...schedSnaps] = await tx.getAll(aptRef, ...schedRefs);
    if (aptSnap.exists) return summary(aptSnap.data()); // idempotent replay.

    const at = Date.now();
    const options = candidates.map((b, i) => {
      const doc = schedSnaps[i].data();
      const live = liveIntervals(doc && doc.intervals, at);
      return {barber: b, ref: schedRefs[i], live};
    }).filter((o) => !o.live.some((iv) => overlaps(iv, start, end)));
    if (!options.length) {
      throw failure("failed-precondition", "SLOT_TAKEN",
          "That slot was just taken. Please pick another.");
    }
    // Fewest bookings/holds that day; candidates are already ordered by ID.
    const load = (o) => o.live.filter((iv) => iv.kind !== "block").length;
    const chosen = options.reduce(
        (best, o) => (load(o) < load(best) ? o : best));

    const holdExpiresAt = Timestamp.fromMillis(at + HOLD_MS);
    const apt = {
      requestId,
      shopId,
      barberId: chosen.barber.id,
      serviceId,
      customerId: null,
      start: Timestamp.fromMillis(start),
      end: Timestamp.fromMillis(end),
      status: "HELD",
      holdExpiresAt,
      priceCents: service.priceCents,
      durationMin: service.durationMin,
    };
    // No refId on holds: schedules are public and requestId is a capability.
    tx.set(chosen.ref, {
      barberId: chosen.barber.id,
      date: sgDateKey(start),
      intervals: [...chosen.live, {
        start: apt.start, end: apt.end, kind: "hold", holdExpiresAt}],
      version: FieldValue.increment(1),
    }, {merge: true});
    tx.set(aptRef, apt);
    tx.set(db.doc(`auditLog/${requestId}_HELD`), auditRecord({
      apt, actorUid: null, role: "customer", action: "hold", from: null,
      to: "HELD", now: at}));
    return summary(apt);
  });
}

/**
 * @param {Object} apt Appointment data.
 * @param {Object} interval Stored interval.
 * @return {boolean} True if the interval is this appointment's hold.
 */
function isHoldOf(apt, interval) {
  return interval.kind === "hold" &&
    interval.start.toMillis() === apt.start.toMillis() &&
    interval.end.toMillis() === apt.end.toMillis();
}

/**
 * confirmBooking: HELD -> CONFIRMED once the customer has verified an OTP.
 * The mobile number comes from the verified token, never from the client.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} Booking summary.
 */
async function confirmBooking(request) {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Verify your mobile first.");
  }
  const phone = auth.token.phone_number;
  if (typeof phone !== "string" || !SG_PHONE.test(phone)) {
    throw new HttpsError("permission-denied",
        "A Singapore mobile number is required.");
  }
  const data = request.data || {};
  const requestId = checkRequestId(data.requestId);
  const displayName =
    typeof data.displayName === "string" ? data.displayName.trim() : "";
  if (displayName.length < 1 || displayName.length > 80) {
    invalid("displayName", "Name must be 1 to 80 characters.");
  }
  const uid = auth.uid;
  const db = getFirestore();
  const aptRef = db.doc(`appointments/${requestId}`);

  const result = await transact(async (tx) => {
    const aptSnap = await tx.get(aptRef);
    if (!aptSnap.exists) {
      throw failure("not-found", "HOLD_NOT_FOUND", "Booking not found.");
    }
    const apt = aptSnap.data();
    if (apt.status === "CONFIRMED" && apt.customerId === uid) {
      return {summary: summary(apt)}; // idempotent retry.
    }
    if (apt.status === "EXPIRED") {
      throw failure("failed-precondition", "HOLD_EXPIRED",
          "Your hold expired. Please choose the slot again.");
    }
    if (apt.status !== "HELD" || apt.customerId !== null) {
      throw failure("failed-precondition", "HOLD_ALREADY_USED",
          "This booking can no longer be confirmed.");
    }
    const schedRef = scheduleRefOf(apt);
    const schedSnap = await tx.get(schedRef);
    const at = Date.now();
    const others = liveIntervals(
        schedSnap.data() && schedSnap.data().intervals, at)
        .filter((iv) => !isHoldOf(apt, iv));
    const audit = {apt, actorUid: uid, role: "customer", from: "HELD", now: at};

    if (apt.holdExpiresAt.toMillis() <= at) {
      tx.set(schedRef, {intervals: others, version: FieldValue.increment(1)},
          {merge: true});
      tx.update(aptRef, {status: "EXPIRED", holdExpiresAt: null});
      tx.set(db.doc(`auditLog/${requestId}_EXPIRED`),
          auditRecord({...audit, action: "release", to: "EXPIRED"}));
      return {expired: true};
    }

    const confirmed = {
      ...apt,
      status: "CONFIRMED",
      customerId: uid,
      customerName: displayName,
      customerPhoneMasked: `+65 ${phone[3]}••• ••${phone.slice(-2)}`,
      holdExpiresAt: null,
    };
    tx.set(schedRef, {
      intervals: [...others, {
        start: apt.start, end: apt.end, kind: "booking", refId: requestId}],
      version: FieldValue.increment(1),
    }, {merge: true});
    tx.set(aptRef, confirmed);
    tx.set(db.doc(`customers/${uid}`),
        {phoneE164: phone, displayName}, {merge: true});
    tx.set(db.doc(`auditLog/${requestId}_CONFIRMED`),
        auditRecord({...audit, action: "confirm", to: "CONFIRMED"}));
    return {summary: summary(confirmed)};
  });
  if (result.expired) {
    throw failure("failed-precondition", "HOLD_EXPIRED",
        "Your hold expired. Please choose the slot again.");
  }
  return result.summary;
}

/**
 * releaseHold: HELD (no customer yet) -> EXPIRED; frees the slot. Used after
 * three failed OTPs or when the customer abandons the flow. Anything else is
 * a no-op.
 * @param {Object} data Input {requestId}.
 * @return {Promise<Object>} {released: boolean}.
 */
async function releaseHold(data) {
  const requestId = checkRequestId(data.requestId);
  const db = getFirestore();
  const aptRef = db.doc(`appointments/${requestId}`);
  return transact(async (tx) => {
    const aptSnap = await tx.get(aptRef);
    if (!aptSnap.exists) return {released: false};
    const apt = aptSnap.data();
    if (apt.status !== "HELD" || apt.customerId !== null) {
      return {released: false};
    }
    const schedRef = scheduleRefOf(apt);
    const schedSnap = await tx.get(schedRef);
    const at = Date.now();
    const others = liveIntervals(
        schedSnap.data() && schedSnap.data().intervals, at)
        .filter((iv) => !isHoldOf(apt, iv));
    tx.set(schedRef, {intervals: others, version: FieldValue.increment(1)},
        {merge: true});
    tx.update(aptRef, {status: "EXPIRED", holdExpiresAt: null});
    tx.set(db.doc(`auditLog/${requestId}_EXPIRED`), auditRecord({
      apt, actorUid: null, role: "customer", action: "release", from: "HELD",
      to: "EXPIRED", now: at}));
    return {released: true};
  });
}

/**
 * decisions A3: a change is free when start - now >= noticeMins.
 * @param {number} start Appointment start (ms).
 * @param {number} now Current time (ms).
 * @param {number} noticeMins Shop notice window in minutes.
 * @return {boolean} True if inside the notice window.
 */
function isLate(start, now, noticeMins) {
  return start - now < noticeMins * MINUTE_MS;
}

/**
 * Customer changes need a Singapore phone token that signed in within the
 * last 10 minutes (fresh OTP, decisions A3).
 * @param {Object} auth The callable's auth context.
 * @param {number} now Current time (ms).
 * @return {string} The customer uid.
 */
function requireFreshCustomer(auth, now) {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Verify your mobile first.");
  }
  const phone = auth.token.phone_number;
  if (typeof phone !== "string" || !SG_PHONE.test(phone)) {
    throw new HttpsError("permission-denied",
        "A Singapore mobile number is required.");
  }
  const authTime = auth.token.auth_time;
  if (typeof authTime !== "number" || now - authTime * 1000 > FRESH_OTP_MS) {
    throw failure("unauthenticated", "REAUTH_REQUIRED",
        "Please verify your mobile again.");
  }
  return auth.uid;
}

/**
 * @param {Object} auth The callable's auth context.
 * @param {Object} apt Appointment data.
 * @return {boolean} True if the caller is the shop's owner or the assigned
 *   barber.
 */
function isStaffFor(auth, apt) {
  const t = auth.token;
  const assignedBarber = t.role === "barber" && t.barberId === apt.barberId;
  return t.shopId === apt.shopId && (t.role === "owner" || assignedBarber);
}

/**
 * cancelBooking: CONFIRMED -> CANCELLED. Customers (fresh OTP) are subject to
 * the shop's notice window and latePolicy; staff cancellations are never late.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} Booking summary.
 */
async function cancelBooking(request) {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const requestId = checkRequestId((request.data || {}).requestId);
  const staff = auth.token.role === "owner" || auth.token.role === "barber";
  const uid = staff ? auth.uid : requireFreshCustomer(auth, Date.now());
  const role = staff ? auth.token.role : "customer";

  const db = getFirestore();
  const aptRef = db.doc(`appointments/${requestId}`);
  const notFound = () =>
    failure("not-found", "BOOKING_NOT_FOUND", "Booking not found.");

  const result = await transact(async (tx) => {
    const aptSnap = await tx.get(aptRef);
    if (!aptSnap.exists) throw notFound();
    const apt = aptSnap.data();
    if (staff ? !isStaffFor(auth, apt) : apt.customerId !== uid) {
      throw notFound(); // never reveal another customer's or shop's booking.
    }
    if (apt.status === "CANCELLED") return {summary: summary(apt)}; // replay.
    if (apt.status !== "CONFIRMED") {
      throw failure("failed-precondition", "NOT_CANCELLABLE",
          "This booking can no longer be cancelled.");
    }
    const schedRef = scheduleRefOf(apt);
    const refs = [schedRef];
    if (!staff) refs.push(db.doc(`shops/${apt.shopId}`));
    const [schedSnap, shopSnap] = await tx.getAll(...refs);
    const at = Date.now();
    const start = apt.start.toMillis();

    let late = false;
    if (!staff) {
      if (start <= at) {
        throw failure("failed-precondition", "ALREADY_STARTED",
            "This appointment has already started.");
      }
      const shop = shopSnap.data() || {};
      const notice = Number.isInteger(shop.noticeMins) ?
        shop.noticeMins : DEFAULT_NOTICE_MINS;
      late = isLate(start, at, notice);
      if (late && shop.latePolicy !== "flag") { // "block" is the default.
        // A refusal changes no booking state, but it is audited and counted
        // (once per booking). Written now; the error is thrown after commit.
        if (!apt.lateCancelAttempted) {
          tx.update(aptRef, {lateCancelAttempted: true});
          tx.set(db.doc(`customers/${uid}/shopStats/${apt.shopId}`),
              {lateCancels: FieldValue.increment(1)}, {merge: true});
        }
        tx.set(db.collection("auditLog").doc(), auditRecord({
          apt, actorUid: uid, role, action: "lateCancelRefused",
          from: "CONFIRMED", to: "CONFIRMED", now: at}));
        return {refused: true};
      }
    }

    const remaining = liveIntervals(
        schedSnap.data() && schedSnap.data().intervals, at)
        .filter((iv) => !(iv.kind === "booking" && iv.refId === requestId));
    tx.set(schedRef, {intervals: remaining, version: FieldValue.increment(1)},
        {merge: true});
    tx.update(aptRef, {status: "CANCELLED", lateCancel: late});
    if (late) { // "flag" policy: cancellation proceeds and is counted.
      tx.set(db.doc(`customers/${uid}/shopStats/${apt.shopId}`),
          {lateCancels: FieldValue.increment(1)}, {merge: true});
    }
    tx.set(db.doc(`auditLog/${requestId}_CANCELLED`), auditRecord({
      apt, actorUid: uid, role, action: "cancel", from: "CONFIRMED",
      to: "CANCELLED", now: at}));
    return {summary: summary({...apt, status: "CANCELLED"})};
  });
  if (result.refused) {
    throw failure("failed-precondition", "LATE_CANCEL_BLOCKED",
        "This booking is inside the cancellation window and cannot be " +
        "cancelled online.");
  }
  return result.summary;
}

/**
 * reschedule: CONFIRMED -> CONFIRMED at a new start, an atomic swap in one
 * transaction. Same shop, service and barber. If the new slot is taken,
 * nothing changes (SLOT_TAKEN).
 * @param {Object} request The callable request (auth, data {requestId,
 *   newStart}).
 * @return {Promise<Object>} Booking summary.
 */
async function reschedule(request) {
  const uid = requireFreshCustomer(request.auth, Date.now());
  const data = request.data || {};
  const requestId = checkRequestId(data.requestId);
  const newStart = data.newStart;
  if (!Number.isInteger(newStart) || newStart % GRID_MS !== 0) {
    invalid("newStart", "Choose a start time on a 15-minute slot.");
  }
  const now = Date.now();
  const horizon = sgTimeToMs(sgDateKey(now), "00:00") + HORIZON_DAYS * DAY_MS;
  if (newStart <= now) invalid("newStart", "That time has already passed.");
  if (newStart >= horizon) {
    invalid("newStart", `Bookings open up to ${HORIZON_DAYS} days ahead.`);
  }

  const db = getFirestore();
  const aptRef = db.doc(`appointments/${requestId}`);
  const notFound = () =>
    failure("not-found", "BOOKING_NOT_FOUND", "Booking not found.");
  const seen = await aptRef.get();
  if (!seen.exists || seen.data().customerId !== uid) throw notFound();
  const seenApt = seen.data();
  const shopRef = db.doc(`shops/${seenApt.shopId}`);
  const [shopSnap, barberSnap] = await Promise.all([
    shopRef.get(), shopRef.collection("barbers").doc(seenApt.barberId).get()]);
  const shop = shopSnap.data() || {};
  const barber = barberSnap.data() || {};
  const newEnd = newStart + seenApt.durationMin * MINUTE_MS;
  const stillOffered = barberSnap.exists && barber.active === true &&
    Array.isArray(barber.serviceIds) &&
    barber.serviceIds.includes(seenApt.serviceId);
  if (seenApt.status === "CONFIRMED" && seenApt.start.toMillis() !== newStart) {
    if (!withinHours(shop.openingHours, newStart, newEnd)) {
      invalid("newStart", "That time is outside the shop's opening hours.");
    }
    if (!stillOffered || !withinHours(barber.workingHours, newStart, newEnd)) {
      invalid("newStart", "Your barber is not working at that time.");
    }
  }
  const notice = Number.isInteger(shop.noticeMins) ?
    shop.noticeMins : DEFAULT_NOTICE_MINS;

  const newRef = shopRef.collection("schedules")
      .doc(scheduleId(seenApt.barberId, newStart));
  const oldRef = scheduleRefOf(seenApt);
  const sameDoc = oldRef.path === newRef.path;

  return transact(async (tx) => {
    const [aptSnap, oldSnap, newSnap] =
      await tx.getAll(aptRef, oldRef, ...(sameDoc ? [] : [newRef]));
    if (!aptSnap.exists) throw notFound();
    const apt = aptSnap.data();
    if (apt.customerId !== uid) throw notFound();
    if (apt.status === "CONFIRMED" && apt.start.toMillis() === newStart) {
      return summary(apt); // idempotent replay.
    }
    if (apt.status !== "CONFIRMED") {
      throw failure("failed-precondition", "NOT_RESCHEDULABLE",
          "This booking can no longer be changed.");
    }
    if (apt.start.toMillis() !== seenApt.start.toMillis()) {
      throw failure("aborted", "BOOKING_CHANGED",
          "This booking just changed. Please refresh.");
    }
    const at = Date.now();
    const oldStart = apt.start.toMillis();
    if (oldStart <= at) {
      throw failure("failed-precondition", "ALREADY_STARTED",
          "This appointment has already started.");
    }
    if (isLate(oldStart, at, notice)) {
      throw failure("failed-precondition", "LATE_CHANGE",
          "This booking is inside the notice window and cannot be moved " +
          "online.");
    }

    const own = (iv) => iv.kind === "booking" && iv.refId === requestId;
    const oldLive = liveIntervals(oldSnap.data() && oldSnap.data().intervals,
        at).filter((iv) => !own(iv));
    const newLive = sameDoc ? oldLive : liveIntervals(
        newSnap.data() && newSnap.data().intervals, at);
    if (newLive.some((iv) => overlaps(iv, newStart, newEnd))) {
      throw failure("failed-precondition", "SLOT_TAKEN",
          "That slot was just taken. Your original booking is unchanged.");
    }
    const moved = {
      start: Timestamp.fromMillis(newStart),
      end: Timestamp.fromMillis(newEnd),
      kind: "booking",
      refId: requestId,
    };
    const bump = {version: FieldValue.increment(1)};
    if (sameDoc) {
      tx.set(oldRef, {intervals: [...oldLive, moved], ...bump}, {merge: true});
    } else {
      tx.set(oldRef, {intervals: oldLive, ...bump}, {merge: true});
      tx.set(newRef, {
        barberId: apt.barberId,
        date: sgDateKey(newStart),
        intervals: [...newLive, moved],
        ...bump,
      }, {merge: true});
    }
    tx.update(aptRef, {start: moved.start, end: moved.end});
    tx.set(db.collection("auditLog").doc(), auditRecord({
      apt, actorUid: uid, role: "customer", action: "reschedule",
      from: "CONFIRMED", to: "CONFIRMED", now: at}));
    return summary({...apt, start: moved.start, end: moved.end});
  });
}

module.exports = {
  holdSlot, confirmBooking, releaseHold, cancelBooking, reschedule,
  isLate, requireFreshCustomer,
  // Shared with service.js (FR-12).
  isStaffFor, summary, auditRecord, checkRequestId, MINUTE_MS,
  // Shared with blocks.js (FR-08).
  transact, liveIntervals, overlaps, scheduleId, sgDateKey, failure, invalid,
  GRID_MS, DAY_MS, HORIZON_DAYS, REQUEST_ID,
};
