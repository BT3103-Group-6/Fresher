// FR-12: start/finish service and no-show tracking (decisions A5). Each
// callable checks staff access, loads the appointment in a transaction,
// verifies the transition, and writes the new state and an auditLog record
// together. Guards use server time read inside the transaction.
const {HttpsError} = require("firebase-functions/https");
const {FieldValue, Timestamp, getFirestore} =
  require("firebase-admin/firestore");
const {
  transact, failure, isStaffFor, summary, auditRecord, checkRequestId,
  MINUTE_MS,
} = require("./booking");
const queue = require("./queue");

const START_EARLY_MS = 60 * MINUTE_MS; // start allowed from start - 60 min.
const NO_SHOW_AFTER_MS = 15 * MINUTE_MS; // mark allowed from start + 15 min.
const REVERSAL_MS = 24 * 60 * MINUTE_MS; // reverse within 24 h of marking.

/**
 * @param {number} start Scheduled start (ms).
 * @return {number} Earliest time startService is allowed (ms).
 */
function startAllowedAt(start) {
  return start - START_EARLY_MS;
}

/**
 * @param {number} start Scheduled start (ms).
 * @return {number} Earliest time markNoShow is allowed (ms).
 */
function noShowAllowedAt(start) {
  return start + NO_SHOW_AFTER_MS;
}

/**
 * @param {number} noShowAt When the no-show was marked (ms).
 * @return {number} Last moment reverseNoShow is allowed (ms, inclusive).
 */
function reversalDeadline(noShowAt) {
  return noShowAt + REVERSAL_MS;
}

/**
 * @param {Object} apt Appointment data.
 * @return {Object} Booking summary plus the FR-12 fields.
 */
function detail(apt) {
  const ms = (t) => (t ? t.toMillis() : null);
  return {
    ...summary(apt),
    actualStart: ms(apt.actualStart),
    actualEnd: ms(apt.actualEnd),
    noShowAt: ms(apt.noShowAt),
  };
}

/**
 * Runs one FR-12 transition. `step` receives the appointment, current time
 * and returns an empty object for an idempotent replay or the change.
 * @param {Object} request The callable request (auth, data).
 * @param {Function} step (apt, at) => {} for a replay, or {change: {from,
 *   to, action, update, auditId (omit for an auto ID), stat (+1 or -1),
 *   deposit ({from, to} status move for the FR-13 deposit)}}.
 * @return {Promise<Object>} Appointment detail.
 */
async function transition(request, step) {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const t = auth.token;
  if (typeof t.shopId !== "string" ||
      (t.role !== "owner" && t.role !== "barber")) {
    throw new HttpsError("permission-denied", "Staff only.");
  }
  const requestId = checkRequestId((request.data || {}).requestId);
  const db = getFirestore();
  const aptRef = db.doc(`appointments/${requestId}`);

  return transact(async (tx) => {
    const snap = await tx.get(aptRef);
    if (!snap.exists || !isStaffFor(auth, snap.data())) {
      // Never reveal another shop's or barber's booking.
      throw failure("not-found", "BOOKING_NOT_FOUND", "Booking not found.");
    }
    const apt = snap.data();
    const at = Date.now();
    const plan = step(apt, at);
    if (!plan.change) return detail(apt);

    const {change} = plan;
    let statsRef = null;
    let count = 0;
    if (change.stat) { // all reads before any write.
      statsRef = db.doc(
          `customers/${apt.customerId}/shopStats/${apt.shopId}`);
      const stats = (await tx.get(statsRef)).data();
      count = (stats && stats.noShowCount) || 0;
    }
    let depRef = null;
    let deposit = null;
    if (change.deposit && apt.depositId) { // FR-13; read before any write.
      depRef = db.doc(`deposits/${apt.depositId}`);
      deposit = (await tx.get(depRef)).data();
    }
    // FR-10: a start or finish changes the barber's projected delays. Read
    // them now (before any write), with this change applied in memory.
    let recalc = null;
    if (change.action === "start" || change.action === "finish") {
      const state = await queue.loadState(
          tx, db, apt.shopId, apt.barberId, at);
      const actualStart = change.update.actualStart ?
        at : (apt.actualStart ? apt.actualStart.toMillis() : null);
      recalc = await queue.planRecalc(
          tx, db, {shopId: apt.shopId, barberId: apt.barberId},
          queue.upsertAppointment(state, {
            id: requestId, status: change.to, start: apt.start.toMillis(),
            durationMin: apt.durationMin, actualStart,
          }), at);
    }
    tx.update(aptRef, change.update);
    if (recalc) queue.applyRecalc(tx, recalc);
    if (deposit && deposit.status === change.deposit.from) {
      tx.update(depRef, {status: change.deposit.to});
    }
    if (statsRef) {
      tx.set(statsRef, {noShowCount: Math.max(0, count + change.stat)},
          {merge: true});
    }
    const auditRef = change.auditId ?
      db.doc(`auditLog/${requestId}_${change.auditId}`) :
      db.collection("auditLog").doc();
    tx.set(auditRef, auditRecord({
      apt, actorUid: auth.uid, role: t.role, action: change.action,
      from: change.from, to: change.to, now: at}));
    const next = {...apt, status: change.to};
    for (const [k, v] of Object.entries(change.update)) {
      next[k] = v instanceof FieldValue ? null : v;
    }
    return detail(next);
  });
}

/**
 * @param {string} reason Machine-readable reason.
 * @param {string} message Human-readable message.
 * @param {number} allowedAt When the action becomes allowed (ms).
 * @return {HttpsError} TOO_EARLY with the allowed time in details.
 */
function tooEarly(reason, message, allowedAt) {
  return new HttpsError("failed-precondition", message,
      {reason, allowedAt});
}

/**
 * @param {string} status Current status.
 * @return {HttpsError} INVALID_STATE for a transition that is not allowed.
 */
function invalidState(status) {
  return failure("failed-precondition", "INVALID_STATE",
      `This appointment is ${status} and cannot be changed that way.`);
}

/**
 * startService: CONFIRMED -> IN_SERVICE, from 60 min before the start.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} Appointment detail.
 */
function startService(request) {
  return transition(request, (apt, at) => {
    if (apt.status === "IN_SERVICE") return {}; // replay.
    if (apt.status !== "CONFIRMED") throw invalidState(apt.status);
    const allowedAt = startAllowedAt(apt.start.toMillis());
    if (at < allowedAt) {
      throw tooEarly("TOO_EARLY",
          "It is too early to start this appointment.", allowedAt);
    }
    return {change: {
      from: "CONFIRMED", to: "IN_SERVICE", action: "start",
      auditId: "IN_SERVICE", update: {
        status: "IN_SERVICE", actualStart: Timestamp.fromMillis(at)},
    }};
  });
}

/**
 * finishService: IN_SERVICE -> COMPLETED.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} Appointment detail.
 */
function finishService(request) {
  return transition(request, (apt, at) => {
    if (apt.status === "COMPLETED") return {}; // replay.
    if (apt.status !== "IN_SERVICE") throw invalidState(apt.status);
    return {change: {
      from: "IN_SERVICE", to: "COMPLETED", action: "finish",
      auditId: "COMPLETED", update: {
        status: "COMPLETED", actualEnd: Timestamp.fromMillis(at)},
      deposit: {from: "paid", to: "refundable"}, // decisions A6: attended.
    }};
  });
}

/**
 * markNoShow: CONFIRMED -> NO_SHOW from start + 15 min; counts against the
 * customer at this shop. The booking interval stays on the schedule.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} Appointment detail.
 */
function markNoShow(request) {
  return transition(request, (apt, at) => {
    if (apt.status === "NO_SHOW") return {}; // replay: no second increment.
    if (apt.status !== "CONFIRMED") throw invalidState(apt.status);
    const allowedAt = noShowAllowedAt(apt.start.toMillis());
    if (at < allowedAt) {
      throw tooEarly("TOO_EARLY",
          "A no-show can be marked 15 minutes after the start time.",
          allowedAt);
    }
    return {change: {
      from: "CONFIRMED", to: "NO_SHOW", action: "noShow", stat: 1,
      update: {status: "NO_SHOW", noShowAt: Timestamp.fromMillis(at)},
      deposit: {from: "paid", to: "forfeited"}, // decisions A6.
    }};
  });
}

/**
 * reverseNoShow: NO_SHOW -> CONFIRMED within 24 h of marking; decrements the
 * count (never below 0).
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} Appointment detail.
 */
function reverseNoShow(request) {
  return transition(request, (apt, at) => {
    if (apt.status === "CONFIRMED") return {}; // replay.
    if (apt.status !== "NO_SHOW") throw invalidState(apt.status);
    if (at > reversalDeadline((apt.noShowAt ? apt.noShowAt.toMillis() : 0))) {
      throw failure("failed-precondition", "REVERSAL_WINDOW_CLOSED",
          "A no-show can only be reversed within 24 hours of marking it.");
    }
    return {change: {
      from: "NO_SHOW", to: "CONFIRMED", action: "noShowReversed", stat: -1,
      update: {status: "CONFIRMED", noShowAt: FieldValue.delete()},
      deposit: {from: "forfeited", to: "paid"},
    }};
  });
}

module.exports = {
  startService, finishService, markNoShow, reverseNoShow,
  startAllowedAt, noShowAllowedAt, reversalDeadline,
};
