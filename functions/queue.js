// FR-10: walk-in queue and delay warnings (decisions A5 addendum). Walk-ins
// live only in shops/{shopId}/queue and are not schedule intervals. Every
// queue change and every start or finish recalculates the barber's projected
// delays inside the same transaction and, when a booking is over 10 minutes
// late and the warning can still go out 15 minutes ahead, creates its
// `{bookingId}_delay` task (only if absent, so at most one per booking). The
// scheduled job runs the same recalculation for every barber (sweep.js).
const {HttpsError} = require("firebase-functions/https");
const {Timestamp, getFirestore} = require("firebase-admin/firestore");
const {
  transact, failure, invalid, checkRequestId, MINUTE_MS,
} = require("./booking");
const {CHANNEL} = require("./notifications");
const {project, warningDecision, WARN_LEAD_MS, DELAY_THRESHOLD_MS} =
  require("./queueDelay");

const HOUR_MS = 60 * MINUTE_MS;
const WINDOW_BACK_MS = 12 * HOUR_MS; // bookings that started up to 12 h ago
const WINDOW_AHEAD_MS = 24 * HOUR_MS; // and start up to 24 h ahead count.
const NAME_MAX = 60;
const DOC_ID = /^[A-Za-z0-9_-]{1,100}$/; // ids that go into a doc path.
const QUEUE_LIVE = ["waiting", "in_service"];

const ts = (ms) => Timestamp.fromMillis(ms);
const ms = (t) => (t ? t.toMillis() : null);

/**
 * @param {Object} auth The callable's auth.
 * @return {Object} The token when it belongs to staff.
 */
function staffToken(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const t = auth.token;
  if (typeof t.shopId !== "string" ||
      (t.role !== "owner" && t.role !== "barber")) {
    throw new HttpsError("permission-denied", "Staff only.");
  }
  return t;
}

/**
 * @param {string} id Doc ID.
 * @param {Object} d Queue entry data.
 * @return {Object} What the callables return.
 */
function summary(id, d) {
  return {
    requestId: id, barberId: d.barberId, walkInName: d.walkInName,
    serviceId: d.serviceId, durationMin: d.durationMin, status: d.status,
    joinedAt: ms(d.joinedAt), actualStart: ms(d.actualStart),
    actualEnd: ms(d.actualEnd),
  };
}

/**
 * Reads the barber's appointments in the window and live queue entries as
 * plain data. Call before any write in the transaction.
 * @param {Transaction} tx Firestore transaction.
 * @param {Object} db Firestore instance.
 * @param {string} shopId Shop ID.
 * @param {string} barberId Barber ID.
 * @param {number} now Current time (ms).
 * @return {Promise<Object>} {appointments, walkIns}.
 */
async function loadState(tx, db, shopId, barberId, now) {
  const aptSnap = await tx.get(db.collection("appointments")
      .where("shopId", "==", shopId).where("barberId", "==", barberId)
      .where("start", ">=", ts(now - WINDOW_BACK_MS))
      .where("start", "<", ts(now + WINDOW_AHEAD_MS)));
  const queueSnap = await tx.get(db.collection(`shops/${shopId}/queue`)
      .where("barberId", "==", barberId).where("status", "in", QUEUE_LIVE));
  return {
    appointments: aptSnap.docs
        .filter((d) => ["CONFIRMED", "IN_SERVICE"].includes(d.data().status))
        .map((d) => {
          const a = d.data();
          return {
            id: d.id, status: a.status, start: ms(a.start),
            durationMin: a.durationMin ||
              Math.round((ms(a.end) - ms(a.start)) / MINUTE_MS),
            actualStart: ms(a.actualStart),
          };
        }),
    walkIns: queueSnap.docs.map((d) => {
      const w = d.data();
      return {
        id: d.id, status: w.status, joinedAt: ms(w.joinedAt),
        durationMin: w.durationMin, actualStart: ms(w.actualStart),
      };
    }),
  };
}

/**
 * @param {Object} state Result of loadState.
 * @param {Object} apt Plain appointment {id, status, start, durationMin,
 *   actualStart} to replace (by ID) or add.
 * @return {Object} New state.
 */
function upsertAppointment(state, apt) {
  return {
    ...state,
    appointments: [...state.appointments.filter((a) => a.id !== apt.id), apt],
  };
}

/**
 * @param {Object} state Result of loadState.
 * @param {Object} walkIn Plain walk-in {id, status, joinedAt, durationMin,
 *   actualStart} to replace (by ID) or add.
 * @return {Object} New state.
 */
function upsertWalkIn(state, walkIn) {
  return {
    ...state,
    walkIns: [...state.walkIns.filter((w) => w.id !== walkIn.id), walkIn],
  };
}

/**
 * Projects the state and decides which warnings to write. Reads the delay
 * tasks it needs, so call it before any write in the transaction.
 * @param {Transaction} tx Firestore transaction.
 * @param {Object} db Firestore instance.
 * @param {Object} ctx {shopId, barberId}.
 * @param {Object} state Plain state (after the caller's change).
 * @param {number} now Current time (ms).
 * @return {Promise<Object>} {projection, creates: [{ref, data}], warned}.
 */
async function planRecalc(tx, db, ctx, state, now) {
  const projection = project({
    now,
    inService: [...state.appointments, ...state.walkIns]
        .filter((x) => x.status === "IN_SERVICE" ||
          x.status === "in_service")
        .filter((x) => x.actualStart != null),
    bookings: state.appointments.filter((a) => a.status === "CONFIRMED"),
    walkIns: state.walkIns.filter((w) => w.status === "waiting"),
  });
  const candidates = projection.bookings.filter((b) =>
    warningDecision({
      delayMs: b.delayMs, start: b.start, now, taskExists: false,
    }).warn);
  const refs = candidates.map((b) => db.doc(`notifications/${b.id}_delay`));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  const creates = [];
  candidates.forEach((b, i) => {
    if (snaps[i].exists) return; // sent, failed or cancelled: never again.
    creates.push({
      ref: refs[i],
      data: {
        bookingId: b.id, shopId: ctx.shopId, barberId: ctx.barberId,
        apptStart: ts(b.start), channel: CHANNEL, type: "delay",
        delayMin: b.delayMin, dueAt: ts(now), status: "pending",
        nextAttemptAt: ts(now), rev: 1, attempts: [], createdAt: ts(now),
      },
    });
  });
  return {projection, creates, warned: creates.map((c) => c.data.bookingId)};
}

/**
 * @param {Transaction} tx Firestore transaction.
 * @param {Object} plan Result of planRecalc.
 */
function applyRecalc(tx, plan) {
  for (const {ref, data} of plan.creates) tx.create(ref, data);
}

/**
 * Recalculates one barber in its own transaction.
 * @param {Object} db Firestore instance.
 * @param {string} shopId Shop ID.
 * @param {string} barberId Barber ID.
 * @param {number} now Current time (ms); defaults to the real clock.
 * @return {Promise<Object>} {freeAt, bookings, walkIns, warned}.
 */
function recalcBarber(db, shopId, barberId, now) {
  const at = now === undefined ? Date.now() : now;
  return transact(async (tx) => {
    const state = await loadState(tx, db, shopId, barberId, at);
    const plan = await planRecalc(tx, db, {shopId, barberId}, state, at);
    applyRecalc(tx, plan);
    return {...plan.projection, warned: plan.warned};
  });
}

/**
 * The scheduled recalculation: every barber with a CONFIRMED or IN_SERVICE
 * appointment in the window. Catches what fires no event (bookings made,
 * cancelled or moved between events).
 * @param {Object} db Firestore instance.
 * @param {number} now Current time (ms).
 * @param {number} limit Most appointments to look at.
 * @return {Promise<Object>} {barbers, warned}.
 */
async function sweepQueueDelays(db, now, limit) {
  const snap = await db.collection("appointments")
      .where("status", "in", ["CONFIRMED", "IN_SERVICE"])
      .where("start", ">=", ts(now - WINDOW_BACK_MS))
      .where("start", "<", ts(now + WINDOW_AHEAD_MS)).limit(limit).get();
  const barbers = new Map();
  for (const d of snap.docs) {
    const {shopId, barberId} = d.data();
    barbers.set(`${shopId}|${barberId}`, {shopId, barberId});
  }
  let warned = 0;
  for (const {shopId, barberId} of barbers.values()) {
    warned += (await recalcBarber(db, shopId, barberId, now)).warned.length;
  }
  return {barbers: barbers.size, warned};
}

/**
 * Runs one walk-in state change. `step` gets the entry, the barber's state
 * (before the change) and the time, and returns {} for an idempotent replay
 * or {update, next} (fields to write, and the plain walk-in after the change).
 * @param {Object} request The callable request (auth, data).
 * @param {Function} step (entry, state, at) => {} | {update, next}.
 * @return {Promise<Object>} The entry summary.
 */
async function walkInTransition(request, step) {
  const t = staffToken(request.auth);
  const requestId = checkRequestId((request.data || {}).requestId);
  const db = getFirestore();
  const ref = db.doc(`shops/${t.shopId}/queue/${requestId}`);
  return transact(async (tx) => {
    const snap = await tx.get(ref);
    const entry = snap.exists ? snap.data() : null;
    if (!entry || (t.role === "barber" && t.barberId !== entry.barberId)) {
      // Never reveal another barber's or shop's queue.
      throw failure("not-found", "WALKIN_NOT_FOUND", "Walk-in not found.");
    }
    const at = Date.now();
    const state = await loadState(tx, db, t.shopId, entry.barberId, at);
    const plan = step(entry, state, at);
    if (!plan.update) return summary(requestId, entry);
    const next = upsertWalkIn(state, plan.next);
    const recalc = await planRecalc(
        tx, db, {shopId: t.shopId, barberId: entry.barberId}, next, at);
    tx.update(ref, plan.update);
    applyRecalc(tx, recalc);
    return summary(requestId, {...entry, ...plan.update});
  });
}

/**
 * @param {string} status Current status.
 * @return {HttpsError} INVALID_STATE.
 */
function invalidState(status) {
  return failure("failed-precondition", "INVALID_STATE",
      `This walk-in is ${status} and cannot be changed that way.`);
}

/**
 * addWalkIn: puts a walk-in at the back of a barber's queue. Idempotent on
 * requestId.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} The entry summary.
 */
async function addWalkIn(request) {
  const t = staffToken(request.auth);
  const d = request.data || {};
  const requestId = checkRequestId(d.requestId);
  const name = typeof d.walkInName === "string" ? d.walkInName.trim() : "";
  if (name.length < 1 || name.length > NAME_MAX) {
    invalid("walkInName", `Enter a name of 1 to ${NAME_MAX} characters.`);
  }
  if (typeof d.serviceId !== "string" || !DOC_ID.test(d.serviceId)) {
    invalid("serviceId", "Choose a service.");
  }
  let barberId;
  if (t.role === "barber") {
    if (d.barberId != null && d.barberId !== t.barberId) {
      throw new HttpsError("permission-denied",
          "You can only add to your own queue.");
    }
    barberId = t.barberId;
  } else {
    if (typeof d.barberId !== "string" || !DOC_ID.test(d.barberId)) {
      invalid("barberId", "Choose a barber.");
    }
    barberId = d.barberId;
  }
  const db = getFirestore();
  const ref = db.doc(`shops/${t.shopId}/queue/${requestId}`);
  return transact(async (tx) => {
    const [entrySnap, barberSnap, serviceSnap] = await tx.getAll(
        ref, db.doc(`shops/${t.shopId}/barbers/${barberId}`),
        db.doc(`shops/${t.shopId}/services/${d.serviceId}`));
    if (entrySnap.exists) {
      const e = entrySnap.data();
      if (e.barberId !== barberId || e.walkInName !== name ||
          e.serviceId !== d.serviceId) {
        invalid("requestId", "That request ID was used for another walk-in.");
      }
      return summary(requestId, e);
    }
    if (!barberSnap.exists) {
      throw failure("not-found", "BARBER_NOT_FOUND", "Barber not found.");
    }
    const barber = barberSnap.data();
    if (barber.active !== true) {
      throw failure("failed-precondition", "BARBER_UNAVAILABLE",
          "That barber is not available.");
    }
    const service = serviceSnap.exists ? serviceSnap.data() : null;
    if (!service || service.active !== true ||
        !(barber.serviceIds || []).includes(d.serviceId)) {
      throw failure("failed-precondition", "SERVICE_UNAVAILABLE",
          "That barber does not offer that service.");
    }
    const at = Date.now();
    const state = await loadState(tx, db, t.shopId, barberId, at);
    const entry = {
      shopId: t.shopId, barberId, walkInName: name, serviceId: d.serviceId,
      durationMin: service.durationMin, status: "waiting", joinedAt: ts(at),
      createdBy: request.auth.uid,
    };
    const next = upsertWalkIn(state, {
      id: requestId, status: "waiting", joinedAt: at,
      durationMin: entry.durationMin, actualStart: null,
    });
    const recalc = await planRecalc(
        tx, db, {shopId: t.shopId, barberId}, next, at);
    tx.create(ref, entry);
    applyRecalc(tx, recalc);
    return summary(requestId, entry);
  });
}

/**
 * startWalkIn: waiting -> in_service. No time guard. Refused with
 * BARBER_BUSY while the barber already has something in service.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} The entry summary.
 */
function startWalkIn(request) {
  return walkInTransition(request, (entry, state, at) => {
    if (entry.status === "in_service") return {}; // replay.
    if (entry.status !== "waiting") throw invalidState(entry.status);
    const busy = state.appointments.some((a) => a.status === "IN_SERVICE") ||
      state.walkIns.some((w) => w.status === "in_service");
    if (busy) {
      throw failure("failed-precondition", "BARBER_BUSY",
          "This barber already has someone in service.");
    }
    return {
      update: {status: "in_service", actualStart: ts(at)},
      next: {
        id: request.data.requestId, status: "in_service",
        joinedAt: ms(entry.joinedAt), durationMin: entry.durationMin,
        actualStart: at,
      },
    };
  });
}

/**
 * finishWalkIn: in_service -> done.
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} The entry summary.
 */
function finishWalkIn(request) {
  return walkInTransition(request, (entry, state, at) => {
    if (entry.status === "done") return {}; // replay.
    if (entry.status !== "in_service") throw invalidState(entry.status);
    return {
      update: {status: "done", actualEnd: ts(at)},
      next: {
        id: request.data.requestId, status: "done",
        joinedAt: ms(entry.joinedAt), durationMin: entry.durationMin,
        actualStart: ms(entry.actualStart),
      },
    };
  });
}

/**
 * removeWalkIn: waiting -> removed (the walk-in left).
 * @param {Object} request The callable request (auth, data).
 * @return {Promise<Object>} The entry summary.
 */
function removeWalkIn(request) {
  return walkInTransition(request, (entry) => {
    if (entry.status === "removed") return {}; // replay.
    if (entry.status !== "waiting") throw invalidState(entry.status);
    return {
      update: {status: "removed"},
      next: {
        id: request.data.requestId, status: "removed",
        joinedAt: ms(entry.joinedAt), durationMin: entry.durationMin,
        actualStart: null,
      },
    };
  });
}

module.exports = {
  addWalkIn, startWalkIn, finishWalkIn, removeWalkIn,
  loadState, upsertAppointment, planRecalc, applyRecalc, recalcBarber,
  sweepQueueDelays, WARN_LEAD_MS, DELAY_THRESHOLD_MS,
};
