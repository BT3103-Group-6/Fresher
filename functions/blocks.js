// FR-08: personal time blocks (decisions A12). A block is a "block" interval on
// the barber-day schedule doc (the lock document, so it serialises with
// holdSlot) plus a staff-only blocks doc, written in one transaction. Existing
// bookings and holds are never touched: they are returned as conflicts.
const {HttpsError} = require("firebase-functions/https");
const {FieldValue, Timestamp, getFirestore} =
  require("firebase-admin/firestore");
const {
  transact, liveIntervals, overlaps, scheduleId, sgDateKey, invalid,
  GRID_MS, DAY_MS, HORIZON_DAYS, REQUEST_ID,
} = require("./booking");

const MAX_REASON = 200;

/**
 * @param {*} value Candidate ID.
 * @param {string} field Field name for the error.
 * @return {string} The validated ID.
 */
function checkId(value, field) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    invalid(field, `Invalid ${field}.`);
  }
  return value;
}

/**
 * Validates a createBlock request (decisions A12): single Singapore day,
 * 15-minute grid, not entirely past, inside the booking horizon.
 * @param {*} data Callable request data.
 * @param {number} now Current time (ms).
 * @return {Object} {blockId, start, end, reason}.
 */
function parseBlockInput(data, now) {
  const d = data && typeof data === "object" ? data : {};
  const blockId = checkId(d.blockId, "blockId");
  const {start, end} = d;
  if (!Number.isInteger(start) || start % GRID_MS !== 0) {
    invalid("start", "Choose a start time on a 15-minute step.");
  }
  if (!Number.isInteger(end) || end % GRID_MS !== 0) {
    invalid("end", "Choose an end time on a 15-minute step.");
  }
  if (end <= start) invalid("end", "End time must be after the start time.");
  if (sgDateKey(start) !== sgDateKey(end - 1)) {
    invalid("end", "A block must finish on the same day it starts.");
  }
  if (end <= now) invalid("start", "That time has already passed.");
  const horizon = Date.parse(
      `${sgDateKey(now).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}` +
      "T00:00:00+08:00") + HORIZON_DAYS * DAY_MS;
  if (start >= horizon) {
    invalid("start", `Blocks can be set up to ${HORIZON_DAYS} days ahead.`);
  }
  let reason = "";
  if (d.reason !== undefined && d.reason !== null) {
    if (typeof d.reason !== "string" || d.reason.trim().length > MAX_REASON) {
      invalid("reason", `Reason must be ${MAX_REASON} characters or fewer.`);
    }
    reason = d.reason.trim();
  }
  return {blockId, start, end, reason};
}

/**
 * Checks the caller is staff and resolves whose time is being blocked.
 * A barber acts on their own barberId only; an owner names a barber of their
 * own shop. The shop always comes from the token.
 * @param {?Object} auth request.auth.
 * @param {*} barberId Requested barber (optional for barbers).
 * @return {{shopId: string, barberId: ?string, role: string, uid: string}}
 *   The resolved actor; barberId is null for an owner who named none.
 */
function authorizeStaff(auth, barberId) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const t = auth.token;
  if (typeof t.shopId !== "string" ||
      (t.role !== "owner" && t.role !== "barber")) {
    throw new HttpsError("permission-denied", "Staff only.");
  }
  if (t.role === "barber") {
    if (typeof t.barberId !== "string") {
      throw new HttpsError("permission-denied", "Not a barber account.");
    }
    if (barberId !== undefined && barberId !== null &&
        barberId !== t.barberId) {
      throw new HttpsError("permission-denied",
          "Barbers can only change their own time.");
    }
    return {shopId: t.shopId, barberId: t.barberId, role: "barber",
      uid: auth.uid};
  }
  if (barberId === undefined || barberId === null) {
    return {shopId: t.shopId, barberId: null, role: "owner", uid: auth.uid};
  }
  if (typeof barberId !== "string" || !barberId || barberId.includes("/")) {
    invalid("barberId", "Choose a barber.");
  }
  return {shopId: t.shopId, barberId, role: "owner", uid: auth.uid};
}

/**
 * Bookings and live holds that overlap [start, end). Blocks and expired holds
 * are not conflicts. Half-open, so an adjacent booking is not a conflict.
 * @param {Array<Object>} intervals Stored schedule intervals.
 * @param {number} start Start (ms).
 * @param {number} end End (ms).
 * @param {number} now Current time (ms).
 * @return {Array<Object>} Overlapping booking and hold intervals, by start.
 */
function findConflicts(intervals, start, end, now) {
  return liveIntervals(intervals, now)
      .filter((i) => i.kind !== "block" && overlaps(i, start, end))
      .sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

/**
 * Turns conflicting intervals into what staff see. Bookings are resolved
 * through their appointment; holds carry no refId, so only their time.
 * @param {Array<Object>} conflicts Result of findConflicts.
 * @param {Map<string, Object>} appointments Appointment data by ID.
 * @return {Array<Object>} Conflict descriptions.
 */
function describeConflicts(conflicts, appointments) {
  return conflicts.map((i) => {
    const base = {start: i.start.toMillis(), end: i.end.toMillis()};
    if (i.kind === "hold") {
      return {kind: "hold", ...base, holdExpiresAt: i.holdExpiresAt.toMillis()};
    }
    const apt = appointments.get(i.refId) || {};
    return {
      kind: "booking", ...base, bookingId: i.refId,
      status: apt.status || null,
      customerName: apt.customerName || null,
      customerPhoneMasked: apt.customerPhoneMasked || null,
      serviceId: apt.serviceId || null,
    };
  });
}

/**
 * createBlock: adds a block interval and blocks doc for one barber-day.
 * Overlapping bookings and holds are returned, never cancelled.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} {blockId, barberId, start, end, reason,
 *   conflicts}.
 */
async function createBlock(request) {
  const data = request.data || {};
  const actor = authorizeStaff(request.auth, data.barberId);
  const input = parseBlockInput(data, Date.now());
  if (!actor.barberId) invalid("barberId", "Choose a barber.");
  const {shopId, barberId} = actor;
  const {blockId, start, end, reason} = input;

  const db = getFirestore();
  const shopRef = db.doc(`shops/${shopId}`);
  const barberSnap = await shopRef.collection("barbers").doc(barberId).get();
  if (!barberSnap.exists) invalid("barberId", "That barber does not exist.");

  const blockRef = shopRef.collection("blocks").doc(blockId);
  const schedRef = shopRef.collection("schedules")
      .doc(scheduleId(barberId, start));

  return transact(async (tx) => {
    const [blockSnap, schedSnap] = await tx.getAll(blockRef, schedRef);
    const at = Date.now();
    const live = liveIntervals(schedSnap.data() && schedSnap.data().intervals,
        at);

    const replay = blockSnap.exists ? blockSnap.data() : null;
    if (replay && (replay.barberId !== barberId ||
        replay.start.toMillis() !== start || replay.end.toMillis() !== end ||
        replay.reason !== reason)) {
      invalid("blockId", "That block ID was used for a different block.");
    }
    if (!replay) {
      const clash = live.find((i) => i.kind === "block" &&
        overlaps(i, start, end));
      if (clash) {
        throw new HttpsError("failed-precondition",
            "That overlaps another block. Remove it or choose a free time.",
            {reason: "BLOCK_OVERLAP", start: clash.start.toMillis(),
              end: clash.end.toMillis()});
      }
    }

    const conflicts = findConflicts(live, start, end, at);
    const refs = conflicts.filter((i) => i.kind === "booking")
        .map((i) => db.doc(`appointments/${i.refId}`));
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    const appointments = new Map(
        snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
    const result = {
      blockId, barberId, start, end, reason,
      conflicts: describeConflicts(conflicts, appointments),
    };
    if (replay) return result;

    tx.set(schedRef, {
      barberId,
      date: sgDateKey(start),
      intervals: [...live, {
        start: Timestamp.fromMillis(start), end: Timestamp.fromMillis(end),
        kind: "block", refId: blockId}],
      version: FieldValue.increment(1),
    }, {merge: true});
    tx.set(blockRef, {
      barberId, start: Timestamp.fromMillis(start),
      end: Timestamp.fromMillis(end), reason, createdBy: actor.uid,
      createdAt: Timestamp.fromMillis(at),
    });
    return result;
  });
}

/**
 * removeBlock: removes a block's interval and doc. A barber may remove only
 * their own blocks. Missing blocks return {removed: false}, so retries are
 * safe. Bookings are never affected.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} {blockId, removed}.
 */
async function removeBlock(request) {
  const actor = authorizeStaff(request.auth, undefined);
  const blockId = checkId((request.data || {}).blockId, "blockId");
  const db = getFirestore();
  const blockRef = db.doc(`shops/${actor.shopId}/blocks/${blockId}`);

  return transact(async (tx) => {
    const blockSnap = await tx.get(blockRef);
    if (!blockSnap.exists) return {blockId, removed: false};
    const block = blockSnap.data();
    if (actor.role === "barber" && block.barberId !== actor.barberId) {
      throw new HttpsError("permission-denied",
          "Barbers can only remove their own blocks.");
    }
    const schedRef = db.doc(`shops/${actor.shopId}/schedules/` +
      scheduleId(block.barberId, block.start.toMillis()));
    const schedSnap = await tx.get(schedRef);
    const intervals = liveIntervals(
        schedSnap.data() && schedSnap.data().intervals, Date.now())
        .filter((i) => !(i.kind === "block" && i.refId === blockId));
    tx.set(schedRef, {intervals, version: FieldValue.increment(1)},
        {merge: true});
    tx.delete(blockRef);
    return {blockId, removed: true};
  });
}

module.exports = {
  createBlock, removeBlock, parseBlockInput, authorizeStaff, findConflicts,
  describeConflicts,
};
