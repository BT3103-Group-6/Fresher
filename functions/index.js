const {setGlobalOptions} = require("firebase-functions");
const {HttpsError, onCall, onRequest} = require("firebase-functions/https");
const {onSchedule} = require("firebase-functions/scheduler");
const {onDocumentWritten} = require("firebase-functions/firestore");
const {defineSecret} = require("firebase-functions/params");
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore} = require("firebase-admin/firestore");

// Cost control: cap concurrent containers per function.
setGlobalOptions({region: "asia-southeast1", maxInstances: 10});

initializeApp();

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Throws an invalid-argument error that names the offending field so the UI
 * can show a field-level message.
 * @param {string} field Input field name.
 * @param {string} message Human-readable problem.
 */
function invalid(field, message) {
  throw new HttpsError("invalid-argument", message, {field});
}

/**
 * Checks workingHours has the shape {mon..sun: [{start, end}]} with
 * "HH:MM" times and start < end.
 * @param {*} hours Value to validate.
 */
function checkWorkingHours(hours) {
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) {
    invalid("workingHours", "Working hours are required.");
  }
  for (const day of DAYS) {
    const ranges = hours[day];
    if (!Array.isArray(ranges)) invalid("workingHours", `Missing ${day}.`);
    for (const r of ranges) {
      if (!r || !TIME.test(r.start) || !TIME.test(r.end) || r.start >= r.end) {
        invalid("workingHours", `Invalid hours for ${day}.`);
      }
    }
  }
}

// FR-07: owner adds a barber. Creates the login, sets claims
// { shopId, role: "barber", barberId }, and writes the barber and member docs.
// The shop comes from the caller's token, never from the input.
exports.addBarber = onCall(async (request) => {
  const token = request.auth && request.auth.token;
  if (!token) throw new HttpsError("unauthenticated", "Sign in first.");
  if (token.role !== "owner" || !token.shopId) {
    throw new HttpsError(
        "permission-denied", "Only shop owners can add barbers.");
  }
  const shopId = token.shopId;
  const data = request.data || {};

  const displayName =
    typeof data.displayName === "string" ? data.displayName.trim() : "";
  if (displayName.length < 1 || displayName.length > 80) {
    invalid("displayName", "Name must be 1 to 80 characters.");
  }
  const email = typeof data.email === "string" ? data.email.trim() : "";
  if (!EMAIL.test(email)) invalid("email", "Enter a valid email address.");
  if (typeof data.password !== "string" || data.password.length < 8) {
    invalid("password", "Temporary password must be at least 8 characters.");
  }
  if (!Array.isArray(data.serviceIds) || data.serviceIds.length === 0 ||
      !data.serviceIds.every((s) => typeof s === "string")) {
    invalid("serviceIds", "Choose at least one service.");
  }
  checkWorkingHours(data.workingHours);

  const db = getFirestore();
  const shopRef = db.doc(`shops/${shopId}`);
  const serviceIds = [...new Set(data.serviceIds)];
  const services = shopRef.collection("services");
  const found = await db.getAll(...serviceIds.map((id) => services.doc(id)));
  if (found.some((snap) => !snap.exists)) {
    invalid("serviceIds", "One or more services do not exist.");
  }

  let user;
  try {
    user = await getAuth().createUser(
        {email, password: data.password, displayName});
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError(
          "already-exists", "That email is already in use.", {field: "email"});
    }
    if (err.code === "auth/invalid-password") {
      invalid("password", "Password is too weak.");
    }
    throw new HttpsError("internal", "Could not create the login.");
  }

  const barberRef = shopRef.collection("barbers").doc();
  try {
    await getAuth().setCustomUserClaims(
        user.uid, {shopId, role: "barber", barberId: barberRef.id});
    const batch = db.batch();
    batch.set(barberRef, {
      displayName,
      active: true,
      serviceIds,
      workingHours: data.workingHours,
    });
    batch.set(shopRef.collection("members").doc(user.uid),
        {role: "barber", barberId: barberRef.id});
    await batch.commit();
  } catch (err) {
    await getAuth().deleteUser(user.uid).catch(() => {});
    throw new HttpsError("internal", "Could not add the barber.");
  }

  return {barberId: barberRef.id};
});

// FR-02/FR-03: customer booking. holdSlot and releaseHold are unauthenticated
// (the OTP comes after the hold); confirmBooking needs Phone Auth.
const booking = require("./booking");
exports.holdSlot = onCall((request) => booking.holdSlot(request.data || {}));
exports.confirmBooking = onCall((request) => booking.confirmBooking(request));
exports.releaseHold =
  onCall((request) => booking.releaseHold(request.data || {}));

// FR-04/FR-05: cancellation and rescheduling. Customers need a fresh OTP;
// cancelBooking also accepts staff tokens (never late).
exports.cancelBooking = onCall((request) => booking.cancelBooking(request));
exports.reschedule = onCall((request) => booking.reschedule(request));

// FR-01: shop discovery. geocode is unauthenticated (discovery comes before
// sign-in); the OneMap token is a secret and never leaves the function. With
// no token it uses a small mock lookup in the emulator only (decisions A11,
// L12); elsewhere it returns "unavailable".
const onemapToken = defineSecret("ONEMAP_TOKEN");
const geocoder = require("./geocode");
exports.geocode = onCall({secrets: [onemapToken]}, (request) =>
  geocoder.geocode(request.data, onemapToken.value()));

// FR-01: keep the trigger-owned shop summary (priceMin, priceMax, serviceTypes,
// minDurationMin) in step with the shop's services. Security Rules stop
// clients writing these fields.
const discovery = require("./discovery");
exports.summarizeShopServices = onDocumentWritten(
    "shops/{shopId}/services/{serviceId}", async (event) => {
      const db = getFirestore();
      const shopRef = db.doc(`shops/${event.params.shopId}`);
      const [shop, services] = await Promise.all([
        shopRef.get(), shopRef.collection("services").get()]);
      if (!shop.exists) return;
      await shopRef.update(
          discovery.summarizeServices(services.docs.map((d) => d.data())));
    });

// FR-08: personal time blocks (staff only; decisions A12). Existing bookings
// are never cancelled; createBlock returns them as conflicts.
const blocks = require("./blocks");
exports.createBlock = onCall((request) => blocks.createBlock(request));
exports.removeBlock = onCall((request) => blocks.removeBlock(request));

const service = require("./service");
exports.startService = onCall((request) => service.startService(request));
exports.finishService = onCall((request) => service.finishService(request));
exports.markNoShow = onCall((request) => service.markNoShow(request));
exports.reverseNoShow = onCall((request) => service.reverseNoShow(request));

// FR-14: keep shops/{shopId}/dailyStats current (idempotent; decisions A7).
const stats = require("./stats");
exports.onAppointmentWritten = onDocumentWritten(
    "appointments/{appointmentId}",
    (event) => stats.onAppointmentWritten(event));

// FR-09: every minute, send due notification tasks (mock provider) and move
// expired HELD appointments to EXPIRED (decisions A4 addendum; resolves L2).
const sweep = require("./sweep");
const messaging = require("./messaging");
exports.processNotifications = onSchedule(
    {schedule: "every 1 minutes", timeZone: "Asia/Singapore"},
    () => sweep.runAll(getFirestore(), messaging.mockProvider()));

// Dev only: the emulator does not fire schedules, so this runs one sweep on
// demand (`npm run sweep`). It is not exported outside the Functions emulator,
// so it never exists in a deployment.
if (process.env.FUNCTIONS_EMULATOR === "true") {
  exports.devRunSweep = onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({error: "Use POST."});
      return;
    }
    res.json(await sweep.runAll(getFirestore(), messaging.mockProvider()));
  });
}

// FR-13: deposits (decisions A6 addendum). createDeposit registers the payment
// with the mock provider; paymentWebhook applies the provider's signed events
// (HTTPS, not a callable: the provider signs the raw body). The secret falls
// back to a fixed mock value in the Functions emulator only (L24).
const payments = require("./payments");
const paymentSecret = defineSecret("PAYMENT_WEBHOOK_SECRET");
exports.createDeposit = onCall((request) =>
  payments.createDeposit(request, getFirestore(), payments.mockProvider()));
exports.paymentWebhook = onRequest({secrets: [paymentSecret]},
    async (req, res) => {
      const out = await payments.handleWebhook(getFirestore(), {
        method: req.method,
        rawBody: req.rawBody,
        signature: req.get("x-signature"),
      }, payments.resolveSecret(paymentSecret.value()));
      res.status(out.status).json(out.body);
    });

// Dev only, like devRunSweep: the mock checkout's pay and fail buttons. Not
// exported outside the Functions emulator, so a deployment has no way to
// complete a mock payment (L23). The caller must own the deposit.
if (process.env.FUNCTIONS_EMULATOR === "true") {
  exports.mockPay = onCall({secrets: [paymentSecret]}, (request) =>
    payments.mockPay(request, getFirestore(), payments.mockProvider(),
        payments.resolveSecret(paymentSecret.value())));
}

// FR-15: the waitlist (decisions A6 addendum). joinWaitlist and claimOffer are
// callables; offerFreedTime runs on every schedule write, works out what was
// freed (cancellation, expiry, block removal, moved booking) and offers it to
// the earliest compatible waiting entry. The sweep expires lapsed offers and
// entries past their date.
const waitlist = require("./waitlist");
exports.joinWaitlist = onCall((request) =>
  waitlist.joinWaitlist(request, getFirestore()));
exports.claimOffer = onCall((request) =>
  waitlist.claimOffer(request, getFirestore()));
exports.offerFreedTime = onDocumentWritten(
    "shops/{shopId}/schedules/{scheduleId}",
    (event) => waitlist.onScheduleWritten(event, getFirestore()));
