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
- **Public demo deployment (A17, `docs/deployment.md`):** project `fresher-6d857` (alias `prod`), real web config from `.env.local`, shared through an expiring Hosting preview channel, App Check built but optional (`VITE_APP_CHECK_ENABLED` for the web build and `APP_CHECK_ENFORCE` for functions, both default on and **on for the demo** since 2026-10-27, L1 resolved: reCAPTCHA Enterprise on the web app and `enforceAppCheck` on every callable outside the emulator), and a **demo mode** flag (`DEMO_MODE` for functions, `VITE_DEMO_MODE` for the web build; off by default) that keeps `mockPay` and the postal-code stub available and labels the UI. Function settings that are not secrets (`DEMO_MODE`, `APP_CHECK_ENFORCE`, `APP_BASE_URL`) live in `functions/.env.prod`; secrets (`PAYMENT_WEBHOOK_SECRET`) in Secret Manager; `ONEMAP_TOKEN` is unset.

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
| FR-01 | Shop discovery | UI-C1 Discover shops | Postal code is sent to the `geocode` function (OneMap, token server-side). Shops within 3 km are found by geohash range query (`status == verified`), then filtered by exact distance and service type. Location permission denied → postal code field shown. Next slot is computed client-side for the nearest 10 shops (3 days, decisions A11). Without `ONEMAP_TOKEN`, `geocode` uses a mock lookup where mocks are allowed (the emulator, or demo mode): exact codes first, then the approximate centroid of the postal sector (first two digits, result marked `approximate`), `not-found` only for sectors that do not exist (A18); elsewhere it is `unavailable` (L12). The landing page's map section (A20) runs one `shops` query (`status == verified`, limit 300, cached per page session) and loads the Google Maps JavaScript API (browser key, referrer-restricted) only when scrolled into view; region and area are derived from the postal sector, not stored. |
| FR-02 | Real-time availability | UI-C2 Select service and slot | Vue listens to the barber-day `schedules` doc and computes free slots from working hours, service duration and busy intervals. A taken slot returns SLOT_TAKEN and the list refreshes. |
| FR-03 | Guest booking | UI-C3 Verify and confirm | `holdSlot` holds the slot for 10 min; Firebase Phone Auth sends the OTP; `confirmBooking` moves HELD → CONFIRMED. Three failed OTPs or expiry release the hold. |
| FR-04 | Cancellation and rescheduling | UI-C4 My bookings | Fresh OTP, then `cancelBooking` or `reschedule`. Reschedule adds the new interval and removes the old one in one transaction; barber gets a change alert. |
| FR-05 | Cancellation window | UI-C3 (policy shown), UI-C4 | `cancelBooking` compares start − now with shop `noticeMins`; late attempts are blocked or flagged per `latePolicy` and counted in `shopStats.lateCancels`. |
| FR-06 | Service configuration | UI-O1 Shop configuration | Owner saves to `services`; rules check name, 5-minute duration and price. Customers' listeners update within seconds. Appointments keep a price/duration snapshot. |
| FR-07 | Multiple barbers | UI-O1, UI-C2 | `addBarber` creates the barber and sets claims. "Any available" tries eligible barbers by fewest bookings that day; the schedule lock prevents overlaps. Deactivation hides the barber from new bookings only. |
| FR-08 | Personal time blocks | UI-B1 Barber schedule | `createBlock` adds a block interval to the schedule doc (and a `blocks` doc) in one transaction and returns any overlapping bookings and live holds instead of cancelling them; `removeBlock` undoes it. Barbers block only their own time, owners any barber in their shop; blocks are single-day and may not overlap another block (decisions A12). UI-B1 (`/staff/schedule`) shows the day and treats an expired HELD appointment as expired (L2). |
| FR-09 | Automated reminders | UI-B1 (delivery status) | `confirmBooking` creates `notifications` tasks (confirmation, 24 h, 2 h; past reminders skipped) in its own transaction; a scheduled function (every minute) sends due tasks via the mock provider, logs each attempt and retries up to 2 times (decisions A4 addendum). Cancel marks pending tasks `cancelled`; reschedule recalculates them. The same job moves expired HELD appointments to EXPIRED. UI-B1 shows reminder status per booking. `devRunSweep` (emulator only) runs the job by hand. |
| FR-10 | Queue reconciliation | UI-B2 Queue management (`/staff/queue`) | Staff add walk-ins to a barber's queue (`addWalkIn`) and start, finish or remove them (`startWalkIn`, `finishWalkIn`, `removeWalkIn`); starting and finishing a booking (FR-12) records `actualStart`/`actualEnd` the same way. Walk-ins are **not** schedule intervals (see "Other design decisions"). One pure function computes each unstarted booking's projected delay from the barber's current service chained through the earlier bookings; waiting walk-ins never delay a booking (bookings first) and get a separate estimated wait (decisions A5 addendum). It runs inside the same transaction as every start, finish and queue change, and in the existing sweep for every barber with bookings in the next 24 hours. When the delay exceeds 10 minutes and the warning can still go out at least 15 minutes before the booking's start, the run writes one `notifications/{bookingId}_delay` task (created only if absent, so at most once); the existing sender delivers it through the mock provider. A booking's time is never changed automatically. UI-B2 shows the queue, the service in progress, every upcoming booking's projected delay and its warning status, and each waiting walk-in's estimated wait. |
| FR-11 | Booking history and rebooking | UI-C4 My bookings | After OTP, Vue queries `appointments` by `customerId` (one query; Upcoming and History are split client-side, decisions A13). Rebook resets the draft with the same shop, barber and service, and UI-C2 drops any part that is no longer active, saying why; then the normal booking flow applies. No new callables. |
| FR-12 | No-show tracking | UI-B1 Barber schedule | `markNoShow` allowed from start + 15 min; increments `shopStats.noShowCount`. `reverseNoShow` within 24 h decrements it. Both write audit records. |
| FR-13 | Escalating no-show policy | UI-C5 Deposit checkout | In `confirmBooking`, if the customer's `shopStats.noShowCount ≥ 2` at that shop, the hold becomes PENDING_PAYMENT with a `deposits/{bookingId}` doc (50% of the snapshot price, rounded up to 10 cents) and a 10-minute payment deadline held in `holdExpiresAt`. UI-C5 calls `createDeposit` (registers the payment with the mock provider) and offers mock pay/fail buttons (`mockPay`, exported only in the Functions emulator, callable only by the deposit's customer), which deliver a signed event to the same handler as the HTTPS `paymentWebhook`. Success before the deadline: PENDING_PAYMENT → CONFIRMED and the FR-09 tasks are created. Failure or the deadline (scheduled sweep): EXPIRED and the slot is released. Finish makes the deposit refundable, a further no-show forfeits it (decisions A6 addendum). |
| FR-14 | Shop analytics | UI-O2 Shop dashboard | `onAppointmentWritten` updates `dailyStats` (idempotent, via `statContrib`); the dashboard reads one doc per day in the chosen range (max 92 days) plus the same number of days before it for the previous-period comparison (one document-ID range query), and computes rates, utilisation, trends and chart series in the client (A19). Chart.js loads lazily on this route only. |
| FR-15 | Waitlist | UI-C6 Waitlist offer | `joinWaitlist` (verified customer; service required, barber optional). A trigger on schedule writes finds time that became free (cancellation, expired hold, removed block, moved booking) and offers it to the earliest-joined compatible entry: a `HELD` appointment with `waitlistEntryId` and a 15-minute `hold` interval hold the slot exclusively, and a `waitlistOffer` notification goes out through the mock provider. `claimOffer` confirms it through the `confirmBooking` code (so the FR-13 deposit rule applies). An unclaimed offer lapses through the existing sweep, which frees the slot for the next entry; the sweep also expires entries at the end of the requested date (Singapore). See decisions A6 addendum. |

Non-functional requirements are met across the system:
- NFR-03, NFR-05: idempotent `holdSlot` with `requestId`, schedule-document transactions, SLOT_TAKEN handling, form data kept on failure.
- NFR-04: Security Rules by role and shop; no client writes to booking data; App Check on functions.
- NFR-07: `dailyStats` counters, listeners instead of polling, no repeated fetches of unchanged data.
- NFR-08: audit record written in the same transaction as every state change; 12-month TTL.
- NFR-01, NFR-02, NFR-06: mobile-first Vue layouts, labelled inputs, visible focus, field-level validation, booking summary before confirmation.

## Screens (UI IDs)
- Customer: UI-C1 Discover shops · UI-C2 Select service and slot · UI-C3 Verify and confirm · UI-C4 My bookings · UI-C5 Deposit checkout (ext) · UI-C6 Waitlist offer (ext)
- Staff: UI-B1 Barber schedule · UI-B2 Queue management (ext) · UI-O1 Shop configuration · UI-O2 Shop dashboard
- Design direction: clean, Fresha/GlossGenius-inspired. Off-white background (`#F6F8F7`), charcoal text (`#1E2B2A`), dark teal action colour (`#1D5E5A`), Manrope type, labelled status indicators; tokens and contrast ratios in `src/assets/design-system.css` (decision A14). Mobile-first (NFR-01, NFR-06).

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
`refId` is set on `booking` intervals (the appointment ID) and `block` intervals (the `blockId`, so removal is exact; the reason stays in the staff-only `blocks` doc). Hold intervals carry no `refId`: schedules are public and the appointment ID of a hold is the `requestId`, which acts as the capability for `confirmBooking`/`releaseHold`.

### .../blocks/{blockId}
`barberId, start, end, reason, createdBy, createdAt`
Written only by `createBlock`/`removeBlock`. Read by the owner, or by the barber it belongs to (a barber's query must include `barberId == own`). No `auditLog` (decisions A12).

### .../dailyStats/{yyyymmdd}  (FR-14, decisions A7)
`barbers: { [barberId]: { completed, valueCents, noShows, bookedMin } }`, keyed by the Singapore date of the appointment `start`. Owner read only; written only by the `onAppointmentWritten` trigger. `openMin` is not stored: the dashboard computes it from current working hours, shop hours and blocks (limitation L19).

### .../statContrib/{appointmentId}  (FR-14 ledger)
`dateKey, barberId, completed, valueCents, noShows, bookedMin`: what the appointment currently contributes to `dailyStats`. The trigger applies (new − old) in one transaction, so redelivered events change nothing. No client access.

### .../queue/{entryId}  (extension, FR-10)
`shopId, barberId, walkInName, serviceId, durationMin (snapshot, like appointments), status ("waiting" | "in_service" | "done" | "removed"), joinedAt, actualStart, actualEnd, createdBy (uid)`
The doc ID is the client-generated `requestId`, which makes `addWalkIn` idempotent. Written only by `addWalkIn`, `startWalkIn`, `finishWalkIn` and `removeWalkIn`. Read by the shop's owner, or by the barber it belongs to (a barber's query must include `barberId == own`). No customer account, phone number or `auditLog` (like blocks, decisions A12); walk-ins are not counted in `dailyStats` (L30).

### appointments/{bookingId}  (top level; bookingId = client requestId)
`shopId, barberId, serviceId, waitlistEntryId (a waitlist offer's HELD appointment, FR-15), customerId (null while HELD; set by `confirmBooking`, also when it goes to PENDING_PAYMENT), customerName, customerPhoneMasked, start, end, status, holdExpiresAt, priceCents, durationMin (snapshots, FR-06), requestId, lateCancel, lateCancelAttempted (set on the first refused late cancel; limits the `lateCancels` increment to once per booking), depositId, actualStart, actualEnd (FR-10, FR-12), noShowAt (FR-12; set by `markNoShow`, cleared by `reverseNoShow`)`
`customerName` and `customerPhoneMasked` are copied onto the appointment by `confirmBooking` so staff never need to read `customers/{uid}`. The number is masked only (e.g. `+65 9••• ••12`); the full number is never stored on the appointment.

### customers/{uid}
`phoneE164, displayName`
Sub-collection `shopStats/{shopId}`: `noShowCount, lateCancels, depositRequired (FR-13)`

### notifications/{taskId}
`bookingId, shopId (for staff-scoped rules), barberId, apptStart (both for UI-B1's query), type ("confirmation" | "reminder24h" | "reminder2h" | "delay" | "waitlistOffer" | "change"), entryId (waitlistOffer only; its bookingId is the offer's appointment ID), delayMin (delay only: the projected delay, rounded up, when the warning was written; FR-10), channel, dueAt, status ("pending" | "sent" | "failed" | "cancelled"), nextAttemptAt (only while still to be sent; also the claim lease), plannedAt (on the confirmation task: when the reminders were last planned), rev, attempts[]: { at, channel, outcome, error?, rev }`
taskId is deterministic (`{bookingId}_{type}`) to prevent duplicates. Written only by functions; read by the shop owner or the matching barber. No phone number is stored; the sender reads `customers/{customerId}`.

### auditLog/{eventId}
`bookingId, shopId, actorUid, role, action, fromStatus, toStatus, at, expireAt (= at + 12 months, Firestore TTL policy, NFR-08)`
`action` says what happened, because some records have the same from and to status: `hold` (none→HELD), `confirm` (HELD→CONFIRMED), `release` (HELD→EXPIRED, by `releaseHold` or lazily when a confirm finds the hold expired), `offer` (none→HELD, a waitlist offer's exclusive hold; role `system`), `expire` (HELD or PENDING_PAYMENT→EXPIRED, by the scheduled sweep; this also ends an unclaimed waitlist offer; role `system`, no actor), `paymentFailed` (PENDING_PAYMENT→EXPIRED on a failed payment; role `system`), a webhook `confirm` (PENDING_PAYMENT→CONFIRMED; role `system`, no actor), `cancel` (CONFIRMED→CANCELLED, by customer or staff), `reschedule` (CONFIRMED→CONFIRMED, the slot moved) `lateCancelRefused` (CONFIRMED→CONFIRMED, a customer cancel refused under the `block` policy), `start` (CONFIRMED→IN_SERVICE), `finish` (IN_SERVICE→COMPLETED), `noShow` (CONFIRMED→NO_SHOW) and `noShowReversed` (NO_SHOW→CONFIRMED). Records for transitions use the deterministic ID `{bookingId}_{TO}`; `reschedule`, `lateCancelRefused`, `noShow` and `noShowReversed` can repeat (or would collide with `confirm`), so they use auto IDs.
No client can write or update. Written only inside the same transaction as the state change (a refused late attempt is written in its own transaction, together with the once-per-booking `lateCancels` increment, and the error is returned after it commits).

### deposits/{depositId}  (extension, FR-13)
`bookingId (= the doc ID), shopId, barberId, customerId (for scoped rules), amountCents, status ("pending" | "paid" | "refundable" | "forfeited" | "failed"), providerRef, createdAt, paidAt?, paidAfterExpiry?`
Written only by functions. Read by the customer it belongs to, the shop's owner, and the barber whose `barberId` matches. Lifecycle: `pending → paid → refundable` (attended) or `forfeited` (no-show; reversal restores `paid`), or `pending → failed`; a payment arriving after the booking expired ends `refundable` with `paidAfterExpiry`. The appointment stores `depositId`. While PENDING_PAYMENT, the appointment's `holdExpiresAt` is the payment deadline.

### waitlist/{entryId}  (extension, FR-15)
`shopId, serviceId, barberId (null = any barber), date (yyyymmdd), customerId, customerName, joinedAt, expiresAt (start of the next Singapore day), status ("waiting" | "offered" | "claimed" | "expired"), offerSlot {barberId, start, end}, offerRequestId, offerExpiresAt, claimedBookingId, expireReason ("date_passed" | "offer_lapsed")`
Deterministic ID `{customerId}_{shopId}_{serviceId}_{date}_{barberId or "any"}`. Written only by functions. Read by the customer it belongs to, the shop's owner, and a barber only for entries naming that barber. No phone number is stored. The offered slot is a `HELD` appointment (`waitlistEntryId` set, `customerId` null until claimed) that only `claimOffer` can confirm.

## Appointment state model

States: `HELD, PENDING_PAYMENT, CONFIRMED, IN_SERVICE, COMPLETED, CANCELLED, NO_SHOW, EXPIRED`
Terminal: `COMPLETED, CANCELLED, EXPIRED`. `NO_SHOW` can be reversed to `CONFIRMED` within 24 h.

| From | To | Actor | Guard |
|---|---|---|---|
| (none) | HELD | Customer: `holdSlot` | Interval free |
| HELD | CONFIRMED | System after OTP | OTP verified before `holdExpiresAt`, no deposit due (`noShowCount < 2` at this shop) |
| HELD | PENDING_PAYMENT | System after OTP | Deposit due (`noShowCount ≥ 2` at this shop); deadline = now + 10 min |
| PENDING_PAYMENT | CONFIRMED | Payment provider (signed `paymentWebhook`) | Valid signature, `payment.succeeded`, now < `holdExpiresAt`; idempotent; creates FR-09 tasks |
| HELD / PENDING_PAYMENT | EXPIRED | Scheduler or webhook | `holdExpiresAt` passed (sweep; the deposit becomes `failed`), 3 failed OTPs (HELD), or `payment.failed` (webhook) |
| CONFIRMED | CONFIRMED | Customer: `reschedule` (OTP) | New interval free; atomic swap |
| CONFIRMED | CANCELLED | Customer (OTP) or staff | Notice rule (decisions A3); late → block or flag |
| CONFIRMED | IN_SERVICE | Staff: `startService` | now ≥ start − 60 min; sets `actualStart` |
| IN_SERVICE | COMPLETED | Staff: `finishService` | sets `actualEnd` |
| CONFIRMED | NO_SHOW | Staff: `markNoShow` | now ≥ start + 15 min; increments `noShowCount` |
| NO_SHOW | CONFIRMED | Staff: `reverseNoShow` | within 24 h of `noShowAt`; decrements `noShowCount` |

## Callable functions (all in asia-southeast1)
`geocode, holdSlot, confirmBooking, releaseHold, cancelBooking, reschedule, markNoShow, reverseNoShow, startService, finishService, createBlock, addBarber (sets claims), createDeposit, mockPay (mock checkout; emulator and demo mode only, deposit owner only), paymentWebhook (HTTPS, signed, not a callable), joinWaitlist, claimOffer, addWalkIn, startWalkIn, finishWalkIn, removeWalkIn, verifyShop (admin)`

All callables set `enforceAppCheck` unless in the Functions emulator or `APP_CHECK_ENFORCE=false` (A17, off for the demo); `paymentWebhook` is signed HTTPS and is exempt.

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
A scheduled function releases expired holds and lapsed waitlist offers (FR-09, FR-15), expires waitlist entries and recalculates queue delays (FR-10) every minute, but transactions also ignore expired holds, so correctness never depends on the scheduler running on time.

## Other design decisions
- **Half-open intervals** `[start, end)`: back-to-back bookings do not overlap.
- **Walk-ins do not occupy schedule intervals (FR-10):** the queue is not a slot. A walk-in has no start time until staff start it, `schedules` is public and locks bookings, and a walk-in that is still waiting must never make a customer's slot look taken. So the `schedules` doc and `holdSlot` are untouched, and an online customer can book time a walk-in is using; the projected delay and warning are what reconcile the two, and staff never have a booking moved for them.
- **Demo data (A18):** `scripts/seed.mjs` can add a deterministic, fictional dataset of 50 shops with barbers, services, blocks, 14 days of history and 7 days of upcoming bookings. It writes documents directly in the shapes the callables produce (schedule intervals, audit chain, notification tasks, `statContrib` and `dailyStats` from the same `contribution`/`delta` code as the trigger), then reads them back and validates the invariants above. Code: `scripts/demo/` (pure generator and validator, plus the writer); postal-sector table: `functions/postalSectors.js`.
- **Snapshots:** appointments copy price and duration at booking time (FR-06).
- **Minimal personal data:** only `customers/{uid}` holds phone and name. Staff see the name and a masked number (e.g. `+65 9••• ••12`) from the denormalized appointment fields; staff cannot read `customers`.
- **Cheap analytics:** a trigger updates `dailyStats` on each state change; the dashboard reads one document per day (FR-14, NFR-07).
- **Failure handling in the UI:** every failure (SLOT_TAKEN, OTP failed/expired, late-policy block, network loss) returns the user to the same screen with entered data kept (NFR-05).
