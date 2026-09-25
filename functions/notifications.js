// FR-09: notification tasks (decisions A4 addendum). confirmBooking creates
// them in its own transaction, cancelBooking cancels them and reschedule
// recalculates them. Tasks live in notifications/{bookingId_type}; the
// deterministic ID stops duplicates. Nothing here sends anything: see sweep.js.
// This file does not import booking.js (booking.js imports it).
const {FieldValue, Timestamp} = require("firebase-admin/firestore");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const REMINDERS = [
  {type: "reminder24h", beforeMs: 24 * HOUR_MS},
  {type: "reminder2h", beforeMs: 2 * HOUR_MS},
];
// "delay" (FR-10) is written by queue.js, not by writeTasks; it is listed so
// that cancelBooking cancels a pending delay warning too.
const TYPES = ["confirmation", ...REMINDERS.map((r) => r.type), "delay"];
const CHANNEL = "sms";

/**
 * Which reminders are still worth sending. A reminder due exactly now is kept;
 * one that would already be in the past is skipped (decisions A4).
 * @param {number} start Appointment start (ms).
 * @param {number} now Current time (ms).
 * @return {Array<{type: string, dueAt: number}>} Reminders to schedule.
 */
function planReminders(start, now) {
  return REMINDERS
      .map((r) => ({type: r.type, dueAt: start - r.beforeMs}))
      .filter((r) => r.dueAt >= now);
}

/**
 * @param {Object} db Firestore instance.
 * @param {string} bookingId Appointment ID.
 * @return {Array<DocumentReference>} The booking's task docs, in TYPES order.
 */
function taskRefs(db, bookingId) {
  return TYPES.map((type) => db.doc(`notifications/${bookingId}_${type}`));
}

/**
 * Reads the booking's existing tasks. Call before any write in the
 * transaction.
 * @param {Transaction} tx Firestore transaction.
 * @param {Object} db Firestore instance.
 * @param {string} bookingId Appointment ID.
 * @return {Promise<Object>} {[type]: {ref, data}}; data is null if missing.
 */
async function readTasks(tx, db, bookingId) {
  const refs = taskRefs(db, bookingId);
  const snaps = await tx.getAll(...refs);
  const out = {};
  TYPES.forEach((type, i) => {
    out[type] = {ref: refs[i], data: snaps[i].exists ? snaps[i].data() : null};
  });
  return out;
}

/**
 * Creates (on confirm) or recalculates (on reschedule) the booking's tasks.
 * On confirm `existing` is empty, so the confirmation and the reminders that
 * are still in the future are created. On reschedule (`existing` from
 * readTasks) the confirmation only follows the new start; each reminder is
 * reset to pending with its new due time, created if it never existed, or
 * cancelled if it would now be in the past. `attempts` is never cleared.
 * @param {Transaction} tx Firestore transaction.
 * @param {Object} db Firestore instance.
 * @param {Object} apt Appointment data (requestId, shopId, barberId, start).
 * @param {?Object} existing Result of readTasks, or null on confirm.
 * @param {number} now Current time (ms).
 */
function writeTasks(tx, db, apt, existing, now) {
  const start = apt.start.toMillis();
  const base = {
    bookingId: apt.requestId,
    shopId: apt.shopId,
    barberId: apt.barberId,
    apptStart: apt.start,
    channel: CHANNEL,
  };
  const ref = (type) => existing ? existing[type].ref :
    db.doc(`notifications/${apt.requestId}_${type}`);
  const old = (type) => existing ? existing[type].data : null;

  if (!old("confirmation")) {
    tx.set(ref("confirmation"), {
      ...base, type: "confirmation", dueAt: Timestamp.fromMillis(now),
      status: "pending", nextAttemptAt: Timestamp.fromMillis(now),
      rev: 1, attempts: [], createdAt: Timestamp.fromMillis(now),
      plannedAt: Timestamp.fromMillis(now),
    });
  } else {
    tx.update(ref("confirmation"),
        {apptStart: apt.start, plannedAt: Timestamp.fromMillis(now)});
  }

  const planned = new Map(planReminders(start, now).map((r) => [r.type, r]));
  for (const {type} of REMINDERS) {
    const before = old(type);
    const plan = planned.get(type);
    if (plan) {
      const dueAt = Timestamp.fromMillis(plan.dueAt);
      if (!before) {
        tx.set(ref(type), {
          ...base, type, dueAt, status: "pending", nextAttemptAt: dueAt,
          rev: 1, attempts: [], createdAt: Timestamp.fromMillis(now),
        });
      } else {
        tx.update(ref(type), {
          apptStart: apt.start, dueAt, status: "pending",
          nextAttemptAt: dueAt, rev: before.rev + 1,
          cancelReason: FieldValue.delete(),
        });
      }
    } else if (before && before.status !== "cancelled") {
      tx.update(ref(type), {
        apptStart: apt.start, status: "cancelled",
        nextAttemptAt: FieldValue.delete(), cancelReason: "past_due",
        rev: before.rev + 1,
      });
    }
  }
}

/**
 * Development backfill: creates the reminders that are missing for one
 * future CONFIRMED booking, for bookings made before FR-09 existed. Existing
 * tasks are never touched, and no confirmation is created (it would text a
 * customer about a booking made long ago). Reminders that would already be
 * in the past are skipped, as at booking time.
 * @param {Transaction} tx Firestore transaction.
 * @param {Object} db Firestore instance.
 * @param {Object} apt Appointment data (requestId, shopId, barberId, start).
 * @param {Object} existing Result of readTasks.
 * @param {number} now Current time (ms).
 * @return {Array<string>} The task types created.
 */
function backfillReminders(tx, db, apt, existing, now) {
  const created = [];
  for (const {type, dueAt} of planReminders(apt.start.toMillis(), now)) {
    if (existing[type].data) continue;
    const due = Timestamp.fromMillis(dueAt);
    tx.set(existing[type].ref, {
      bookingId: apt.requestId, shopId: apt.shopId, barberId: apt.barberId,
      apptStart: apt.start, channel: CHANNEL, type, dueAt: due,
      status: "pending", nextAttemptAt: due, rev: 1, attempts: [],
      createdAt: Timestamp.fromMillis(now),
    });
    created.push(type);
  }
  return created;
}

/**
 * Runs backfillReminders for every future CONFIRMED appointment (optionally
 * one shop's). Safe to rerun: a second run finds nothing missing.
 * @param {Object} db Firestore instance.
 * @param {Object} opts {shopId?, now?}.
 * @return {Promise<Object>} {appointments, tasks}.
 */
async function backfillTasks(db, opts) {
  const {shopId, now = Date.now()} = opts || {};
  let q = db.collection("appointments").where("status", "==", "CONFIRMED");
  if (shopId) q = q.where("shopId", "==", shopId);
  const snap = await q.get();
  let appointments = 0;
  let tasks = 0;
  for (const doc of snap.docs) {
    if (doc.data().start.toMillis() <= now) continue;
    appointments++;
    tasks += await db.runTransaction(async (tx) => {
      const aptSnap = await tx.get(doc.ref);
      const apt = aptSnap.data();
      if (apt.status !== "CONFIRMED") return 0;
      const existing = await readTasks(tx, db, apt.requestId);
      return backfillReminders(tx, db, apt, existing, now).length;
    });
  }
  return {appointments, tasks};
}

/**
 * cancelBooking: every task that is still pending is cancelled. Tasks already
 * sent or failed keep their status, and all attempt logs stay.
 * @param {Transaction} tx Firestore transaction.
 * @param {Object} existing Result of readTasks.
 */
function cancelTasks(tx, existing) {
  for (const type of TYPES) {
    const {ref, data} = existing[type];
    if (data && data.status === "pending") {
      tx.update(ref, {
        status: "cancelled", nextAttemptAt: FieldValue.delete(),
        cancelReason: "booking_cancelled",
      });
    }
  }
}

/**
 * The waitlist offer task (FR-15), written by the offer transaction. Its
 * bookingId is the offer's appointment; the sender checks the entry is still
 * offered before sending. It is not one of TYPES, so booking reminders and
 * cancellation never touch it.
 * @param {Object} apt The offer's HELD appointment data.
 * @param {string} entryId The waitlist entry ID.
 * @param {number} now Current time (ms).
 * @return {Object} The task document.
 */
function offerTask(apt, entryId, now) {
  return {
    bookingId: apt.requestId, shopId: apt.shopId, barberId: apt.barberId,
    apptStart: apt.start, channel: CHANNEL, type: "waitlistOffer", entryId,
    dueAt: Timestamp.fromMillis(now), status: "pending",
    nextAttemptAt: Timestamp.fromMillis(now), rev: 1, attempts: [],
    createdAt: Timestamp.fromMillis(now),
  };
}

/**
 * @param {string} type Task type.
 * @param {number} start Appointment start (ms).
 * @param {number} delayMin Projected delay in minutes (delay type only).
 * @return {string} The SMS text (the provider is a mock, see messaging.js).
 */
function messageBody(type, start, delayMin) {
  const when = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore", weekday: "short", day: "numeric",
    month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(start));
  if (type === "confirmation") {
    return `Fresher: your booking is confirmed for ${when}.`;
  }
  if (type === "delay") {
    return `Fresher: your barber is running about ${delayMin} minutes ` +
      `behind, so your appointment on ${when} may start late. Your booking ` +
      "time has not changed; you can cancel or reschedule in the app.";
  }
  if (type === "waitlistOffer") {
    return `Fresher: a slot opened on your waitlist, ${when}. ` +
      "Open the app and claim it within 15 minutes.";
  }
  if (type === "reminder24h") {
    return `Fresher reminder: your appointment is in 24 hours, ${when}.`;
  }
  return `Fresher reminder: your appointment is in 2 hours, ${when}.`;
}

module.exports = {
  planReminders, taskRefs, readTasks, writeTasks, cancelTasks, messageBody,
  backfillReminders, backfillTasks, offerTask,
  TYPES, CHANNEL, MINUTE_MS,
};
