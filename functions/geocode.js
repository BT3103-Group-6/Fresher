// FR-01: postal code -> coordinates. The OneMap token stays in this file's
// caller (a Functions secret) and is never returned. Without a token a small
// mock lookup is used in the emulator only; elsewhere the call is unavailable
// (decisions A11, L12).
const {HttpsError} = require("firebase-functions/https");

const POSTAL = /^\d{6}$/;
const ONEMAP_URL = "https://www.onemap.gov.sg/api/common/elastic/search";

// Approximate coordinates: the seed shops' postal codes plus a few landmarks.
const MOCK_POSTAL_CODES = {
  "160055": {lat: 1.2855, lng: 103.8267, label: "55 Tiong Bahru Road"},
  "520478": {lat: 1.3545, lng: 103.9436, label: "478 Tampines Street 44"},
  "600135": {lat: 1.3331, lng: 103.7423, label: "135 Jurong Gateway Road"},
  "579804": {lat: 1.3526, lng: 103.8352, label: "10 Bishan Street 15"},
  "238801": {lat: 1.3040, lng: 103.8318, label: "Orchard Road"},
  "018956": {lat: 1.2834, lng: 103.8607, label: "Marina Bay"},
  "529510": {lat: 1.3525, lng: 103.9447, label: "Tampines Mall"},
  "609731": {lat: 1.3331, lng: 103.7436, label: "Jurong East"},
  "819663": {lat: 1.3592, lng: 103.9894, label: "Changi Airport"},
};

/**
 * Validates the callable input and returns the postal code.
 * @param {*} data Callable request data.
 * @return {string} Six-digit Singapore postal code.
 */
function parsePostalCode(data) {
  const raw = data && typeof data === "object" ? data.postalCode : undefined;
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "Enter a postal code.",
        {field: "postalCode"});
  }
  const code = raw.trim();
  if (!POSTAL.test(code)) {
    throw new HttpsError("invalid-argument",
        "Enter a 6-digit Singapore postal code.", {field: "postalCode"});
  }
  return code;
}

/**
 * Picks the OneMap result whose postal code matches, if any.
 * @param {*} body Parsed OneMap search response.
 * @param {string} code Postal code that was searched.
 * @return {?{lat: number, lng: number, label: string}} Location or null.
 */
function pickResult(body, code) {
  const results = body && Array.isArray(body.results) ? body.results : [];
  const hit = results.find((r) => r && r.POSTAL === code) || results[0];
  const lat = hit && Number(hit.LATITUDE);
  const lng = hit && Number(hit.LONGITUDE);
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {lat, lng, label: String(hit.ADDRESS || code)};
}

const notFound = () => new HttpsError("not-found",
    "We couldn't find that postal code.", {field: "postalCode"});

/**
 * Looks up a postal code. Uses OneMap when a token is set. With no token the
 * mock table is used in the emulator only; otherwise the lookup is unavailable.
 * @param {*} data Callable request data.
 * @param {string} token OneMap token; empty means "no token".
 * @param {Function} fetchFn fetch implementation (injected for tests).
 * @param {boolean} emulator Whether running in the Functions emulator.
 * @return {Promise<{lat: number, lng: number, label: string}>} Location.
 */
async function geocode(data, token, fetchFn = fetch,
    emulator = process.env.FUNCTIONS_EMULATOR === "true") {
  const code = parsePostalCode(data);
  if (!token) {
    if (!emulator) {
      console.error("ONEMAP_TOKEN is not set; geocode is unavailable.");
      throw new HttpsError("unavailable",
          "Postal code search is unavailable. Please try again.");
    }
    const hit = MOCK_POSTAL_CODES[code];
    if (!hit) throw notFound();
    return {...hit};
  }
  let body;
  try {
    const url = `${ONEMAP_URL}?searchVal=${code}&returnGeom=Y` +
      "&getAddrDetails=N&pageNum=1";
    const res = await fetchFn(url, {
      headers: {Authorization: token},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`OneMap ${res.status}`);
    body = await res.json();
  } catch (err) {
    console.error("OneMap lookup failed:", err.message);
    throw new HttpsError("unavailable",
        "Postal code search is unavailable. Please try again.");
  }
  const found = pickResult(body, code);
  if (!found) throw notFound();
  return found;
}

module.exports = {parsePostalCode, pickResult, geocode, MOCK_POSTAL_CODES};
