// FR-13: deposits and the payment provider (decisions A6 addendum). A booking
// that needs a deposit is PENDING_PAYMENT (confirmBooking); this file registers
// the payment with the provider (createDeposit) and applies the provider's
// signed events (paymentWebhook, mockPay) to the deposit and the booking, each
// in one transaction, idempotently. The provider is a mock: no money moves.
const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/https");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const {
  transact, failure, invalid, checkRequestId, liveIntervals, isHoldOf,
  scheduleRefOf, auditRecord, releaseInTx, REQUEST_ID, MINUTE_MS,
} = require("./booking");
const notifications = require("./notifications");

const TOLERANCE_MS = 5 * MINUTE_MS; // older or future-dated events are refused.
const EVENT_TYPES = ["payment.succeeded", "payment.failed"];
const MOCK_SECRET = "mock-webhook-secret-emulator-only"; // emulator fallback.
const ts = (ms) => Timestamp.fromMillis(ms);

/**
 * The webhook secret. Unset means "not configured", except in the Functions
 * emulator, where a fixed mock value is used (limitation L24).
 * @param {string} value The secret's value, possibly empty.
 * @return {string} The secret to sign and verify with, or "".
 */
function resolveSecret(value) {
  if (value) return value;
  return process.env.FUNCTIONS_EMULATOR === "true" ? MOCK_SECRET : "";
}

/**
 * @param {string} secret Shared secret.
 * @param {Buffer|string} rawBody The exact bytes that were sent.
 * @return {string} Hex HMAC-SHA256 of the body.
 */
function sign(secret, rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Constant-time check of a signature header against the raw body.
 * @param {string} secret Shared secret.
 * @param {Buffer|string} rawBody The exact bytes that were sent.
 * @param {*} signature The X-Signature header value.
 * @return {boolean} True if the signature is valid.
 */
function verifySignature(secret, rawBody, signature) {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }
  return crypto.timingSafeEqual(
      Buffer.from(sign(secret, rawBody), "hex"),
      Buffer.from(signature, "hex"));
}

/**
 * The mock payment provider: registers a payment and returns a reference.
 * A real provider would implement the same createPayment.
 * @return {Object} {name, createPayment({depositId, amountCents, reference})}.
 */
function mockProvider() {
  return {
    name: "mock",
    /**
     * @param {Object} p {depositId, amountCents, reference}.
     * @return {Promise<Object>} {providerRef}.
     */
    async createPayment({depositId}) {
      return {providerRef: `mockpay_${depositId}`};
    },
  };
}

/**
 * Applies one verified provider event in a single transaction. Repeats and
 * out-of-order deliveries change nothing.
 * @param {Object} db Firestore instance.
 * @param {Object} event {type, depositId, providerRef}.
 * @param {number} now Current time (ms).
 * @return {Promise<Object>} {result}: confirmed, duplicate, late_payment,
 *   failed_recorded, ignored, not_found or provider_mismatch.
 */
function applyEvent(db, event, now) {
  const depRef = db.doc(`deposits/${event.depositId}`);
  const aptRef = db.doc(`appointments/${event.depositId}`);
  return transact(async (tx) => {
    const [depSnap, aptSnap] = await tx.getAll(depRef, aptRef);
    if (!depSnap.exists || !aptSnap.exists) return {result: "not_found"};
    const dep = depSnap.data();
    const apt = aptSnap.data();
    if (dep.providerRef !== event.providerRef) {
      return {result: "provider_mismatch"};
    }

    if (event.type === "payment.failed") {
      if (dep.status !== "pending") return {result: "ignored"};
      if (apt.status === "PENDING_PAYMENT") {
        await releaseInTx(tx, aptRef, {
          actorUid: null, role: "system", action: "paymentFailed", now,
          allowPending: true});
      } else {
        tx.update(depRef, {status: "failed"});
      }
      return {result: "failed_recorded"};
    }

    // payment.succeeded
    if (["paid", "refundable", "forfeited"].includes(dep.status)) {
      return {result: "duplicate"};
    }
    const inTime = apt.status === "PENDING_PAYMENT" && apt.holdExpiresAt &&
      now < apt.holdExpiresAt.toMillis();
    if (dep.status === "pending" && inTime) {
      const schedRef = scheduleRefOf(apt);
      const schedSnap = await tx.get(schedRef);
      const others = liveIntervals(
          schedSnap.data() && schedSnap.data().intervals, now)
          .filter((iv) => !isHoldOf(apt, iv));
      const confirmed = {...apt, status: "CONFIRMED", holdExpiresAt: null};
      tx.set(schedRef, {
        intervals: [...others, {
          start: apt.start, end: apt.end, kind: "booking",
          refId: apt.requestId}],
        version: FieldValue.increment(1),
      }, {merge: true});
      tx.update(aptRef, {status: "CONFIRMED", holdExpiresAt: null});
      tx.update(depRef, {status: "paid", paidAt: ts(now)});
      tx.set(db.doc(`auditLog/${apt.requestId}_CONFIRMED`), auditRecord({
        apt, actorUid: null, role: "system", action: "confirm",
        from: "PENDING_PAYMENT", to: "CONFIRMED", now}));
      // FR-09: reminders start now, not at the OTP.
      notifications.writeTasks(tx, db, confirmed, null, now);
      return {result: "confirmed"};
    }

    // Paid too late: the slot is not given back, but the money is not lost.
    const late = {status: "refundable", paidAfterExpiry: true, paidAt: ts(now)};
    if (dep.status === "pending" && apt.status === "PENDING_PAYMENT") {
      await releaseInTx(tx, aptRef, {
        actorUid: null, role: "system", action: "expire", now,
        allowPending: true, deposit: late});
      return {result: "late_payment"};
    }
    if (dep.status === "pending" || dep.status === "failed") {
      tx.update(depRef, late);
      return {result: "late_payment"};
    }
    return {result: "ignored"};
  });
}

/**
 * The webhook: verifies the signature over the raw body, validates the event
 * and applies it. Used by the HTTPS function and by mockPay.
 * @param {Object} db Firestore instance.
 * @param {Object} req {method, rawBody, signature}.
 * @param {string} secret The resolved secret ("" = not configured).
 * @param {number} now Current time (ms).
 * @return {Promise<Object>} {status, body} to send back.
 */
async function handleWebhook(db, req, secret, now) {
  const at = now === undefined ? Date.now() : now;
  const fail = (status, error) => ({status, body: {error}});
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (!secret) return fail(503, "WEBHOOK_NOT_CONFIGURED");
  if (!req.rawBody || !verifySignature(secret, req.rawBody, req.signature)) {
    return fail(401, "INVALID_SIGNATURE");
  }
  let event;
  try {
    event = JSON.parse(req.rawBody.toString("utf8"));
  } catch (err) {
    return fail(400, "INVALID_BODY");
  }
  const ok = event && typeof event === "object" &&
    typeof event.eventId === "string" && event.eventId &&
    EVENT_TYPES.includes(event.type) &&
    typeof event.depositId === "string" && REQUEST_ID.test(event.depositId) &&
    typeof event.providerRef === "string" && event.providerRef &&
    Number.isInteger(event.occurredAt);
  if (!ok) return fail(400, "INVALID_EVENT");
  if (Math.abs(at - event.occurredAt) > TOLERANCE_MS) {
    return fail(400, "STALE_EVENT");
  }
  const {result} = await applyEvent(db, event, at);
  if (result === "not_found") return fail(404, "DEPOSIT_NOT_FOUND");
  if (result === "provider_mismatch") return fail(400, "PROVIDER_MISMATCH");
  return {status: 200, body: {result}};
}

/**
 * createDeposit: registers the payment with the provider once and returns
 * what UI-C5 shows. Only the customer who owns the deposit may call it;
 * anyone else gets DEPOSIT_NOT_FOUND.
 * @param {Object} request The callable request (auth, data {requestId}).
 * @param {Object} db Firestore instance.
 * @param {Object} provider Payment provider.
 * @return {Promise<Object>} Deposit and booking state for the checkout page.
 */
async function createDeposit(request, db, provider) {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Verify your mobile first.");
  }
  const requestId = checkRequestId((request.data || {}).requestId);
  const depRef = db.doc(`deposits/${requestId}`);
  const [depSnap, aptSnap] =
    await db.getAll(depRef, db.doc(`appointments/${requestId}`));
  if (!depSnap.exists || !aptSnap.exists ||
      depSnap.data().customerId !== auth.uid) {
    throw failure("not-found", "DEPOSIT_NOT_FOUND", "Deposit not found.");
  }
  const dep = depSnap.data();
  const apt = aptSnap.data();
  let providerRef = dep.providerRef;
  if (!providerRef && apt.status === "PENDING_PAYMENT" &&
      dep.status === "pending") {
    const made = await provider.createPayment({
      depositId: requestId, amountCents: dep.amountCents,
      reference: requestId});
    providerRef = await transact(async (tx) => {
      const current = (await tx.get(depRef)).data();
      if (current.providerRef) return current.providerRef;
      tx.update(depRef, {providerRef: made.providerRef});
      return made.providerRef;
    });
  }
  const stats = (await db.doc(
      `customers/${auth.uid}/shopStats/${apt.shopId}`).get()).data();
  return {
    requestId,
    shopId: apt.shopId,
    bookingStatus: apt.status,
    depositStatus: dep.status,
    paidAfterExpiry: dep.paidAfterExpiry === true,
    amountCents: dep.amountCents,
    providerRef: providerRef || null,
    deadline: apt.holdExpiresAt ? apt.holdExpiresAt.toMillis() : null,
    noShowCount: (stats && stats.noShowCount) || 0,
    provider: provider.name,
  };
}

/**
 * mockPay: the mock checkout's "pay" and "fail" buttons. The mock provider
 * signs an event and delivers it to the same handler the webhook uses. Only
 * the customer who owns the deposit may call it, and index.js exports it only
 * inside the Functions emulator (decisions A6 addendum, L23).
 * @param {Object} request The callable request (auth, data {requestId,
 *   outcome: "success" | "failure"}).
 * @param {Object} db Firestore instance.
 * @param {Object} provider Payment provider.
 * @param {string} secret The resolved webhook secret.
 * @return {Promise<Object>} {result} from the handler.
 */
async function mockPay(request, db, provider, secret) {
  const data = request.data || {};
  const outcome = data.outcome;
  if (outcome !== "success" && outcome !== "failure") {
    invalid("outcome", "Outcome must be success or failure.");
  }
  // Ownership is checked here, before anything is signed.
  const dep = await createDeposit(request, db, provider);
  if (!dep.providerRef) {
    throw failure("failed-precondition", "NOT_PAYABLE",
        "This deposit can no longer be paid.");
  }
  const event = {
    eventId: crypto.randomUUID(),
    type: outcome === "success" ? "payment.succeeded" : "payment.failed",
    depositId: dep.requestId,
    providerRef: dep.providerRef,
    occurredAt: Date.now(),
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const out = await handleWebhook(
      db, {method: "POST", rawBody, signature: sign(secret, rawBody)}, secret);
  if (out.status !== 200) {
    throw new HttpsError("internal", "The mock payment was not accepted.",
        {reason: out.body.error});
  }
  return out.body;
}

module.exports = {
  resolveSecret, sign, verifySignature, mockProvider, applyEvent,
  handleWebhook, createDeposit, mockPay, TOLERANCE_MS, MOCK_SECRET,
};
