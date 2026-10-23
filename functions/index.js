const {setGlobalOptions} = require("firebase-functions");
const {initializeApp} = require("firebase-admin/app");
const {HttpsError, onCall} = require("firebase-functions/https");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore} = require("firebase-admin/firestore");

// Cost control: cap concurrent containers per function.
setGlobalOptions({region: "asia-southeast1", maxInstances: 10});

initializeApp();

// Integration (docs/team-plan.md): each story's PR adds its own requires,
// helpers and export blocks verbatim from the prototype. PR-19 restores the
// prototype file exactly.
// Demo mode and App Check (decisions A17): every callable enforces App Check
// outside the emulator; the mock checkout and the postal stub need demo mode.
const demo = require("./demo");
const APP_CHECK = demo.appCheck();

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
exports.addBarber = onCall(APP_CHECK, async (request) => {
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
