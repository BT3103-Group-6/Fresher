// FR-09: the scheduled job (decisions A4 addendum). One run sends due
// notification tasks through the messaging provider and moves expired HELD
// appointments to EXPIRED. Correctness never depends on it running on time:
// every booking transaction ignores expired holds. Time is passed in so tests
// can control it.
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const {releaseInTx, transact} = require("./booking");
const {messageBody, CHANNEL, MINUTE_MS} = require("./notifications");
const {sweepQueueDelays} = require("./queue");

const BATCH = 200; // per run (limitation L22).
const LEASE_MS = 2 * MINUTE_MS;
const RETRY_MS = MINUTE_MS;
const MAX_ATTEMPTS = 3; // the first try plus up to 2 retries (A4).

const ts = (ms) => Timestamp.fromMillis(ms);

/**
 * Claim step: re-checks the task and its appointment, then takes a lease by
 * pushing nextAttemptAt out, so a concurrent or repeated run skips it.
 * @param {Object} db Firestore instance.
 * @param {DocumentReference} ref The task.
 * @param {number} now Current time (ms).
 * @return {Promise<?Object>} What to send, or null (not ours, or cancelled).
 */
function claim(db, ref, now) {
  return transact(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const task = snap.data();
    if (task.status !== "pending" || !task.nextAttemptAt ||
        task.nextAttemptAt.toMillis() > now) {
      return null; // claimed by another run, or already finished.
    }
    const aptSnap = await tx.get(db.doc(`appointments/${task.bookingId}`));
    const apt = aptSnap.exists ? aptSnap.data() : null;
    // FR-15: an offer is for a HELD appointment whose entry is still offered
    // (the customer is the entry's, not the appointment's).
    const offer = task.type === "waitlistOffer";
    const entrySnap = offer ?
      await tx.get(db.doc(`waitlist/${task.entryId}`)) : null;
    const entry = entrySnap && entrySnap.exists ? entrySnap.data() : null;
    const stale = offer ?
      !apt || apt.status !== "HELD" || !entry || entry.status !== "offered" ||
        entry.offerRequestId !== task.bookingId ||
        entry.offerExpiresAt.toMillis() <= now :
      !apt || apt.status !== "CONFIRMED" ||
        apt.start.toMillis() !== task.apptStart.toMillis() ||
        apt.start.toMillis() <= now;
    if (stale) {
      tx.update(ref, {
        status: "cancelled", nextAttemptAt: FieldValue.delete(),
        cancelReason: "stale",
      });
      return null;
    }
    const custSnap = await tx.get(
        db.doc(`customers/${offer ? entry.customerId : apt.customerId}`));
    tx.update(ref, {nextAttemptAt: ts(now + LEASE_MS)});
    return {
      type: task.type,
      rev: task.rev,
      delayMin: task.delayMin,
      start: apt.start.toMillis(),
      phone: custSnap.exists ? custSnap.data().phoneE164 : null,
      attemptNo: task.attempts.filter((a) => a.rev === task.rev).length + 1,
    };
  });
}

/**
 * Record step: appends the attempt, then sets the task's next state unless it
 * was cancelled or recalculated (rev changed) while the message was going out.
 * @param {DocumentReference} ref The task.
 * @param {Object} c The claim result.
 * @param {Object} result Provider result {ok, error?}.
 * @param {number} now Current time (ms).
 * @return {Promise<string>} "sent", "retry", "failed" or "superseded".
 */
function record(ref, c, result, now) {
  return transact(async (tx) => {
    const task = (await tx.get(ref)).data();
    const entry = {
      at: ts(now), channel: CHANNEL, attempt: c.attemptNo, rev: c.rev,
      outcome: result.ok ? "sent" : "failed",
    };
    if (!result.ok) entry.error = result.error;
    const update = {attempts: [...task.attempts, entry]};
    let outcome = "superseded";
    if (task.status === "pending" && task.rev === c.rev) {
      if (result.ok) {
        outcome = "sent";
        update.status = "sent";
        update.nextAttemptAt = FieldValue.delete();
      } else if (c.attemptNo >= MAX_ATTEMPTS) {
        outcome = "failed";
        update.status = "failed";
        update.nextAttemptAt = FieldValue.delete();
      } else {
        outcome = "retry";
        update.nextAttemptAt = ts(now + RETRY_MS);
      }
    }
    tx.update(ref, update);
    return outcome;
  });
}

/**
 * Sends every due task once. Safe to run repeatedly and concurrently.
 * @param {Object} db Firestore instance.
 * @param {Object} provider Messaging provider (messaging.js).
 * @param {number} now Current time (ms).
 * @return {Promise<Object>} Counts by outcome, plus `skipped` (claim lost or
 *   task cancelled as stale).
 */
async function sendDueTasks(db, provider, now) {
  const due = await db.collection("notifications")
      .where("nextAttemptAt", "<=", ts(now)).limit(BATCH).get();
  const counts = {due: due.size, sent: 0, retry: 0, failed: 0,
    superseded: 0, skipped: 0};
  for (const doc of due.docs) {
    const c = await claim(db, doc.ref, now);
    if (!c) {
      counts.skipped++;
      continue;
    }
    let result;
    try {
      result = c.phone ?
        await provider.send({
          to: c.phone,
          body: messageBody(c.type, c.start, c.delayMin),
          key: `${doc.id}:${c.rev}:${c.attemptNo}`,
        }) :
        {ok: false, error: "NO_PHONE_NUMBER"};
    } catch (err) {
      result = {ok: false, error: "PROVIDER_ERROR"};
    }
    counts[await record(doc.ref, c, result, now)]++;
  }
  return counts;
}

/**
 * Moves expired HELD and PENDING_PAYMENT appointments to EXPIRED (resolves
 * L2; FR-13 releases the slot and fails the deposit). Each one is its own
 * transaction that re-checks the state, so a booking confirmed or paid in
 * the meantime is left alone.
 * @param {Object} db Firestore instance.
 * @param {number} now Current time (ms).
 * @return {Promise<Object>} {found, expired}.
 */
async function sweepExpiredHolds(db, now) {
  const snap = await db.collection("appointments")
      .where("status", "in", ["HELD", "PENDING_PAYMENT"])
      .where("holdExpiresAt", "<=", ts(now)).limit(BATCH).get();
  let expired = 0;
  for (const doc of snap.docs) {
    const done = await transact((tx) => releaseInTx(tx, doc.ref, {
      actorUid: null, role: "system", action: "expire", now,
      onlyExpired: true, allowPending: true,
      allowWaitlist: true}));
    if (done) expired++;
  }
  return {found: snap.size, expired};
}

/**
 * FR-15: marks lapsed waitlist offers and entries past the end of their date
 * (Singapore) expired. A lapsed offer's hold is released by
 * sweepExpiredHolds, which frees the slot for the trigger to offer on.
 * @param {Object} db Firestore instance.
 * @param {number} now Current time (ms).
 * @return {Promise<Object>} {lapsed, ended}.
 */
async function sweepWaitlist(db, now) {
  const expire = async (doc, statuses, field, reason) => {
    return transact(async (tx) => {
      const e = (await tx.get(doc.ref)).data();
      if (!e || !statuses.includes(e.status) ||
          !e[field] || e[field].toMillis() > now) {
        return false;
      }
      tx.update(doc.ref, {status: "expired", expireReason: reason});
      return true;
    });
  };
  const lapsedSnap = await db.collection("waitlist")
      .where("status", "==", "offered")
      .where("offerExpiresAt", "<=", ts(now)).limit(BATCH).get();
  let lapsed = 0;
  for (const doc of lapsedSnap.docs) {
    if (await expire(doc, ["offered"], "offerExpiresAt", "offer_lapsed")) {
      lapsed++;
    }
  }
  const endedSnap = await db.collection("waitlist")
      .where("status", "in", ["waiting", "offered"])
      .where("expiresAt", "<=", ts(now)).limit(BATCH).get();
  let ended = 0;
  for (const doc of endedSnap.docs) {
    if (await expire(doc, ["waiting", "offered"], "expiresAt",
        "date_passed")) {
      ended++;
    }
  }
  return {lapsed, ended};
}

/**
 * @param {Object} db Firestore instance.
 * @param {Object} provider Messaging provider.
 * @param {number} now Current time (ms); defaults to the real clock.
 * @return {Promise<Object>} {queue, notifications, holds, waitlist}.
 */
async function runAll(db, provider, now) {
  const at = now === undefined ? Date.now() : now;
  // Queue first, so a delay warning it writes is sent in this same run.
  return {
    queue: await sweepQueueDelays(db, at, BATCH),
    notifications: await sendDueTasks(db, provider, at),
    holds: await sweepExpiredHolds(db, at),
    waitlist: await sweepWaitlist(db, at),
  };
}

module.exports = {
  sendDueTasks, sweepExpiredHolds, sweepWaitlist, runAll, MAX_ATTEMPTS,
  LEASE_MS, RETRY_MS,
};
