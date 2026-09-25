# Fresher — Architecture

Source: BT3103 Midterm Report, Section 6. Requirement IDs refer to `docs/requirements.md`. The design is organised by requirement and screen, not by module.

## Stack and environment
- Vue 3 + Vite single-page app, served by Firebase Hosting (build output: `dist/`, SPA rewrite to `/index.html`).
- Firebase: Authentication, Cloud Firestore, Cloud Functions, Security Rules, App Check, Hosting.
- Region: `asia-southeast1` for Firestore and all Cloud Functions.
- Shop time zone: `Asia/Singapore`.
- Local development uses the Emulator Suite only:
  - Auth 9099 · Functions 5001 · Firestore 8080 · Hosting 5002 · Emulator UI (port shown on start)
  - `src/firebase.js` connects to emulators when `import.meta.env.DEV` is true.
- Secrets (OneMap token, messaging and payment keys) live in Cloud Functions secrets (`defineSecret`), never in the Vue bundle.
- In the prototype, messaging (SMS/WhatsApp) and payment providers are **mocked** behind a small interface, and the UI/report must say so.

## Trust zones
1. **Browser (untrusted):** renders screens, reads public or permitted data, sends commands.
2. **Firebase project (trusted):** Auth proves identity; Security Rules decide reads; Cloud Functions (Admin SDK) perform every booking state change inside a Firestore transaction.
3. **External services:** geocoding (OneMap), messaging, payment. Called only from functions.

### The key rule
The client **never writes directly** to `appointments`, `schedules`, `deposits`, `notifications`, `auditLog`, `waitlist` or `queue`.
Security Rules deny those writes. The only path is a callable function that re-validates on the server.
Hiding a button in Vue never grants or removes access (NFR-04).

Staff configuration (services, barbers, hours, shop profile, blocks) may be written by staff through rule-checked writes, except where a function is listed below.

## Design linkages
How each requirement is delivered: the screen it appears on, and the logic behind it.

| Req ID | Requirement | Screen | Interaction and implementation logic |
|---|---|---|---|
| FR-01 | Shop discovery | UI-C1 Discover shops | Postal code is sent to the `geocode` function (OneMap, token server-side). Shops within 3 km are found by geohash range query (`status == verified`), then filtered by exact distance and service type. Location permission denied → postal code field shown. Next slot is computed client-side for the nearest 10 shops (3 days, decisions A11). Without `ONEMAP_TOKEN`, `geocode` uses a mock lookup in the emulator only and is `unavailable` elsewhere (L12). |
| FR-02 | Real-time availability | UI-C2 Select service and slot | Vue listens to the barber-day `schedules` doc and computes free slots from working hours, service duration and busy intervals. A taken slot returns SLOT_TAKEN and the list refreshes. |
| FR-03 | Guest booking | UI-C3 Verify and confirm | `holdSlot` holds the slot for 10 min; Firebase Phone Auth sends the OTP; `confirmBooking` moves HELD → CONFIRMED. Three failed OTPs or expiry release the hold. |
| FR-04 | Cancellation and rescheduling | UI-C4 My bookings | Fresh OTP, then `cancelBooking` or `reschedule`. Reschedule adds the new interval and removes the old one in one transaction; barber gets a change alert. |
| FR-05 | Cancellation window | UI-C3 (policy shown), UI-C4 | `cancelBooking` compares start − now with shop `noticeMins`; late attempts are blocked or flagged per `latePolicy` and counted in `shopStats.lateCancels`. |
| FR-06 | Service configuration | UI-O1 Shop configuration | Owner saves to `services`; rules check name, 5-minute duration and price. Customers' listeners update within seconds. Appointments keep a price/duration snapshot. |
| FR-07 | Multiple barbers | UI-O1, UI-C2 | `addBarber` creates the barber and sets claims. "Any available" tries eligible barbers by fewest bookings that day; the schedule lock prevents overlaps. Deactivation hides the barber from new bookings only. |
| FR-08 | Personal time blocks | UI-B1 Barber schedule | `createBlock` adds a block interval to the schedule doc and returns any conflicting confirmed bookings instead of cancelling them. |
| FR-09 | Automated reminders | UI-B1 (delivery status) | On confirmation, a trigger creates `notifications` tasks for 24 h and 2 h; a scheduled function sends due tasks via the mock provider and logs each attempt. Cancel deletes tasks; reschedule recreates them. |
| FR-10 | Queue reconciliation | UI-B2 Queue management | Staff start/finish actions record `actualStart`/`actualEnd`; projected delay is computed from them and queued walk-ins; delay > 10 min triggers a customer warning. |
| FR-11 | Booking history and rebooking | UI-C4 My bookings | After OTP, Vue queries `appointments` by `customerId`. Rebook pre-fills shop, barber and service if still active, then uses the normal booking flow. |
| FR-12 | No-show tracking | UI-B1 Barber schedule | `markNoShow` allowed from start + 15 min; increments `shopStats.noShowCount`. `reverseNoShow` within 24 h decrements it. Both write audit records. |
| FR-13 | Escalating no-show policy | UI-C5 Deposit checkout | After OTP, if `noShowCount ≥ 2` the booking goes to PENDING_PAYMENT; `createDeposit` calls the mock payment provider; a signed webhook confirms or expires it. |
| FR-14 | Shop analytics | UI-O2 Shop dashboard | A trigger updates `dailyStats` on each state change; the dashboard reads one doc per day in the chosen range and computes rates. |
| FR-15 | Waitlist | UI-C6 Waitlist offer | When a slot frees, a trigger offers it to the earliest compatible `waitlist` entry for 15 min; `claimOffer` books it; a scheduled function passes on expired offers and expires entries at end of day. |

Non-functional requirements are met across the system:
- NFR-03, NFR-05: idempotent `holdSlot` with `requestId`, schedule-document transactions, SLOT_TAKEN handling, form data kept on failure.
- NFR-04: Security Rules by role and shop; no client writes to booking data; App Check on functions.
- NFR-07: `dailyStats` counters, listeners instead of polling, no repeated fetches of unchanged data.
- NFR-08: audit record written in the same transaction as every state change; 12-month TTL.
- NFR-01, NFR-02, NFR-06: mobile-first Vue layouts, labelled inputs, visible focus, field-level validation, booking summary before confirmation.

## Screens (UI IDs)
- Customer: UI-C1 Discover shops · UI-C2 Select service and slot · UI-C3 Verify and confirm · UI-C4 My bookings · UI-C5 Deposit checkout (ext) · UI-C6 Waitlist offer (ext)
- Staff: UI-B1 Barber schedule · UI-B2 Queue management (ext) · UI-O1 Shop configuration · UI-O2 Shop dashboard
- Design direction: clean, Fresha/GlossGenius-inspired. White background, charcoal text, dark teal action colour, labelled status indicators. Mobile-first (NFR-01, NFR-06).

## Identity and access
- **Customers:** Firebase Phone Auth (SMS OTP). Verifying the OTP creates/finds an Auth user whose `uid` keys `customers/{uid}`. No password. Viewing history (FR-11) and changing a booking (FR-04) require a fresh OTP on the booking's mobile number.
- **Staff:** email/password (Google sign-in optional, pending decision A2). When an owner adds a barber, a function writes `shops/{shopId}/members/{uid}` and sets custom claims `{ shopId, role }` where role is `owner` or `barber`; barbers also get `barberId` (`{ shopId, role, barberId }`), so Security Rules can scope a barber's appointment reads from the token without a `members` lookup. Owner includes barber permissions.
- **Platform admin:** custom claim `admin: true`; may only change `shops/{shopId}.status` (shop verification).
- Do not use Firebase Anonymous auth.
- Public reads (no sign-in): shop profiles with `status == "verified"`, their active services and barbers, and `schedules` (busy intervals only, no customer data).

## Firestore data model

`.../` = sub-collection of `shops/{shopId}`. Money is stored as integer cents (SGD). Times are Firestore Timestamps (UTC).

### shops/{shopId}
`name, address, postalCode, lat, lng, geohash (FR-01), openingHours, tz = "Asia/Singapore", noticeMins, latePolicy ("block" | "flag") (FR-05), status ("pending" | "verified" | "suspended")`
Trigger-owned summary (FR-01, decisions A11): `priceMin, priceMax` (cents), `serviceTypes[]`, `minDurationMin`, recomputed from active services by `summarizeShopServices` on every service write. Security Rules deny client writes to them.

### .../members/{uid}
`role ("owner" | "barber"), barberId (if barber)`

### .../services/{serviceId}
`name, category ("haircut" | "beard" | "shave" | "colour" | "perm" | "kids" | "other"), durationMin (multiple of 5), priceCents, active`

### .../barbers/{barberId}
`displayName, active, serviceIds[], workingHours`

### .../schedules/{barberId_yyyymmdd}  — concurrency lock document
`barberId, date, intervals[]: { start, end, kind ("booking" | "hold" | "block"), refId?, holdExpiresAt? }, version`
`refId` (the appointment ID) is set on `booking` intervals only. Hold intervals carry no `refId`: schedules are public and the appointment ID of a hold is the `requestId`, which acts as the capability for `confirmBooking`/`releaseHold`.

### .../blocks/{blockId}
`barberId, start, end, reason`

### .../dailyStats/{yyyymmdd}
Per barber: `completed, valueCents, noShows, bookedMin, openMin`

### .../queue/{entryId}  (extension, FR-10)
`walkInName, serviceId, barberId, joinedAt, startedAt, endedAt`

### appointments/{bookingId}  (top level; bookingId = client requestId)
`shopId, barberId, serviceId, customerId (null while HELD; set by `confirmBooking`), customerName, customerPhoneMasked, start, end, status, holdExpiresAt, priceCents, durationMin (snapshots, FR-06), requestId, lateCancel, lateCancelAttempted (set on the first refused late cancel; limits the `lateCancels` increment to once per booking), depositId, actualStart, actualEnd (FR-10)`
`customerName` and `customerPhoneMasked` are copied onto the appointment by `confirmBooking` so staff never need to read `customers/{uid}`. The number is masked only (e.g. `+65 9••• ••12`); the full number is never stored on the appointment.

### customers/{uid}
`phoneE164, displayName`
Sub-collection `shopStats/{shopId}`: `noShowCount, lateCancels, depositRequired (FR-13)`

### notifications/{taskId}
`bookingId, shopId (for staff-scoped rules), type ("confirmation" | "reminder24h" | "reminder2h" | "delay" | "waitlistOffer" | "change"), channel, dueAt, status, attempts[]: { at, outcome }`
taskId is deterministic (`{bookingId}_{type}`) to prevent duplicates.

### auditLog/{eventId}
`bookingId, shopId, actorUid, role, action, fromStatus, toStatus, at, expireAt (= at + 12 months, Firestore TTL policy, NFR-08)`
`action` says what happened, because some records have the same from and to status: `hold` (none→HELD), `confirm` (HELD→CONFIRMED), `release` (HELD→EXPIRED, by `releaseHold` or lazily when a confirm finds the hold expired), `cancel` (CONFIRMED→CANCELLED, by customer or staff), `reschedule` (CONFIRMED→CONFIRMED, the slot moved) and `lateCancelRefused` (CONFIRMED→CONFIRMED, a customer cancel refused under the `block` policy). Records for transitions use the deterministic ID `{bookingId}_{TO}`; `reschedule` and `lateCancelRefused` can repeat, so they use auto IDs.
No client can write or update. Written only inside the same transaction as the state change (a refused late attempt is written in its own transaction, together with the once-per-booking `lateCancels` increment, and the error is returned after it commits).

### deposits/{depositId}  (extension, FR-13)
`bookingId, shopId (for staff-scoped rules), amountCents, status ("pending" | "paid" | "refundable" | "forfeited" | "failed"), providerRef`

### waitlist/{entryId}  (extension, FR-15)
`shopId, serviceId, barberId?, date, customerId, joinedAt, status ("waiting" | "offered" | "claimed" | "expired"), offerSlot, offerExpiresAt`

## Appointment state model

States: `HELD, PENDING_PAYMENT, CONFIRMED, IN_SERVICE, COMPLETED, CANCELLED, NO_SHOW, EXPIRED`
Terminal: `COMPLETED, CANCELLED, EXPIRED`. `NO_SHOW` can be reversed to `CONFIRMED` within 24 h.

| From | To | Actor | Guard |
|---|---|---|---|
| (none) | HELD | Customer: `holdSlot` | Interval free |
| HELD | CONFIRMED | System after OTP | OTP verified before `holdExpiresAt`, no deposit due |
| HELD | PENDING_PAYMENT | System after OTP | Deposit due (FR-13) |
| PENDING_PAYMENT | CONFIRMED | Payment provider (signed webhook) | Payment success |
| HELD / PENDING_PAYMENT | EXPIRED | Scheduler | 10 min elapsed, 3 failed OTPs, or payment failed |
| CONFIRMED | CONFIRMED | Customer: `reschedule` (OTP) | New interval free; atomic swap |
| CONFIRMED | CANCELLED | Customer (OTP) or staff | Notice rule (decisions A3); late → block or flag |
| CONFIRMED | IN_SERVICE | Staff: start | sets `actualStart` |
| IN_SERVICE | COMPLETED | Staff: finish | sets `actualEnd` |
| CONFIRMED | NO_SHOW | Staff: `markNoShow` | now ≥ start + 15 min |
| NO_SHOW | CONFIRMED | Staff: reverse | within 24 h of marking |

## Callable functions (all in asia-southeast1)
`geocode, holdSlot, confirmBooking, releaseHold, cancelBooking, reschedule, markNoShow, reverseNoShow, startService, finishService, createBlock, addBarber (sets claims), createDeposit, paymentWebhook, joinWaitlist, claimOffer, verifyShop (admin)`

Every state-changing function: check auth and role → load current state in a transaction → check the transition and guard from the table above → write new state **and** an `auditLog` record in the same transaction.

## holdSlot algorithm (NFR-03, NFR-05)
The client generates a random `requestId` per booking attempt and reuses it on retry.
1. Load the service and barber working hours on the server. Compute `end` from the stored `durationMin`, never from the client.
2. If `appointments/{requestId}` exists, return it unchanged (idempotent: repeated submissions create at most one record).
3. In one transaction: read the barber-day schedule; ignore holds whose `holdExpiresAt` has passed; check overlap with bookings, live holds and blocks. On overlap, abort with `SLOT_TAKEN`. Otherwise add a hold interval, create the appointment as `HELD`, bump `version`, and write the audit record.
4. Concurrent requests: Firestore commits one transaction and retries the others; retries see the overlap and return `SLOT_TAKEN`. Exactly one succeeds.

`holdSlot` and `releaseHold` are unauthenticated (the customer has not yet verified an OTP); `confirmBooking` requires Phone Auth and reads the mobile number from the token, never from the client. Start times must be within the booking horizon (today to +13 days, Asia/Singapore). The 3-failed-OTP release is counted in the browser, which then calls `releaseHold(requestId)` (HELD with no customer → EXPIRED, interval removed, audit written).

Reschedule adds the new interval and removes the old one in the same transaction; if the new slot is taken, nothing changes.
"Any available" tries eligible barbers in order of fewest bookings that day (tie-break: decisions A3).
A scheduled function releases expired holds and offers every minute, but transactions also ignore expired holds, so correctness never depends on the scheduler running on time.

## Other design decisions
- **Half-open intervals** `[start, end)`: back-to-back bookings do not overlap.
- **Snapshots:** appointments copy price and duration at booking time (FR-06).
- **Minimal personal data:** only `customers/{uid}` holds phone and name. Staff see the name and a masked number (e.g. `+65 9••• ••12`) from the denormalized appointment fields; staff cannot read `customers`.
- **Cheap analytics:** a trigger updates `dailyStats` on each state change; the dashboard reads one document per day (FR-14, NFR-07).
- **Failure handling in the UI:** every failure (SLOT_TAKEN, OTP failed/expired, late-policy block, network loss) returns the user to the same screen with entered data kept (NFR-05).
