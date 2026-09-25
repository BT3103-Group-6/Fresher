# Fresher — Decision register

Mirrors Appendix A of the report. Each decision is **PROPOSED** until the group confirms it.

**Instructions for Claude Code:** use the proposed default when building. Do not invent a rule that isn't here or in
`docs/requirements.md`; if something is missing or ambiguous, ask before implementing. When a decision changes,
update this file first, then the code.

Status key: PROPOSED (default in use, needs group approval) · AGREED (confirmed, add date) · OPEN (no default; ask)

---

## A1 Product scope — PROPOSED
- Multi-shop directory; each shop has its own workspace (`shops/{shopId}`).
- Geographic scope: Singapore only. Postal codes are 6 digits. Language: English.
- A barber is the schedulable resource. Chairs are not modelled (one barber = one chair).
- A solo operator holds the `owner` role, which includes barber permissions.
- Platform admin: shop verification only.
- Shop creation: shops are created by seed data or Cloud Functions only; clients cannot create shops. There is **no requirement for shop self-registration** — OPEN (ask before building any onboarding flow).

## A2 Identity — PROPOSED
- Customers: Firebase Phone Auth with SMS OTP. Singapore mobiles only (`+65`, 8 digits starting 8 or 9).
- OTP: 6 digits; 3 failed attempts ends the attempt and releases the hold.
- Repeat access (history, changes): fresh OTP on the booking's mobile number.
- Mobile number changes: not supported in the prototype (a new number is a new customer).
- Staff: email/password. Google sign-in enabled in Firebase but OPEN whether to offer it in the UI.
- Barber login: `addBarber` creates it from an owner-set temporary password (min 8 chars). UI-O1 is owner-only.
- OTP failures are counted in the browser (Firebase Phone Auth); after 3 the client calls `releaseHold(requestId)`. `holdSlot` and `releaseHold` are unauthenticated; `confirmBooking` needs the verified phone.
- Development: use Firebase test phone numbers; the Auth emulator prints OTP codes in the terminal.

## A3 Booking rules — PROPOSED
- **Notice window:** per shop, `noticeMins` (default 120). A cancellation is free when `start - now >= noticeMins`, so exactly 2 hours before is free.
- **Late policy:** per shop, `latePolicy`:
  - `"block"` (default): the cancellation is refused, and the attempt increments `shopStats.lateCancels`.
  - `"flag"`: the cancellation proceeds, the appointment gets `lateCancel: true`, and `lateCancels` increments.
- **Blocked attempts count once:** under `"block"`, each refused attempt is audited, but `shopStats.lateCancels` increments at most once per booking. The first refusal sets `lateCancelAttempted: true` on the appointment; later refusals leave the counter alone. Under `"flag"` the single cancellation increments it once.
- **Rescheduling:** follows the same notice window as cancellation, measured against the current start. Atomic swap; the original stands if the new slot is taken. A late reschedule is refused under both policies (`LATE_CHANGE`) and does not touch `lateCancels`. A reschedule keeps the same shop, service and barber (no barber or service change in the prototype); price and duration snapshots are kept.
- **Fresh OTP:** history and booking changes need a fresh OTP, meaning the ID token's `auth_time` is within the last 10 minutes, enforced by the server (`REAUTH_REQUIRED`). Staff cancellations are exempt.
- **Staff cancellations:** always allowed, never late, customer notified.
- **Booking horizon:** today to +13 days (14 dates), Asia/Singapore.
- **Slot hold:** 10 minutes (`holdExpiresAt`).
- **Slot grid:** start times every 15 minutes within working hours. No buffer between bookings by default.
- **"Any available barber":** among active barbers offering the service who are free for the whole interval, pick the one with the fewest HELD + CONFIRMED + IN_SERVICE + COMPLETED bookings that day; tie-break by lowest `barberId`.
- **Working hours:** per barber, weekly pattern (e.g. `{ mon: [{ start: "10:00", end: "19:00" }], ... }`), must fall within shop opening hours.

## A4 Notifications — PROPOSED
- Channel in prototype: SMS via a **mock provider** that logs the message and returns a simulated delivery outcome.
- Reminders at 24 h and 2 h before start. If a booking is made less than 24 h ahead, skip the 24 h reminder; less than 2 h ahead, skip both.
- Retries: up to 2 retries on failure, 1 minute apart. Every attempt is logged in `notifications/{taskId}.attempts`.
- Duplicate prevention: deterministic `taskId = {bookingId}_{type}`.
- The barber receives a change alert on any cancellation or reschedule.

## A5 Queue and no-shows — PROPOSED
- Who can mark a no-show: the owner, or the barber assigned to the appointment.
- Mark allowed only when `now >= start + 15 min`.
- Reversal: within 24 h of marking, by the same roles. Both actions write audit records.
- Counts are per shop: `customers/{uid}/shopStats/{shopId}.noShowCount`.
- Queue delay (FR-10, stretch): projected delay = expected finish of the current service (actualStart + durationMin) plus remaining queued durations, minus the next booking's start. Details OPEN.

## A6 Deposits and waitlist — PROPOSED
- Deposit required when `noShowCount >= 2` at that shop.
- Amount: 50% of the snapshot `priceCents`, rounded up to the nearest 10 cents.
- Payment: **mock provider** in test mode. Failure or 10 minutes without payment → EXPIRED.
- Attended → deposit `refundable`; another no-show → `forfeited`.
- Waitlist order: earliest `joinedAt` first.
- Compatible entry: same shop, service and date; same barber if one was chosen; freed interval fits the service duration.
- Offer holds the freed slot for 15 minutes, then passes to the next entry.
- All entries expire at 23:59:59 Asia/Singapore on the requested date.

## A7 Analytics — PROPOSED
- Booked value: sum of `priceCents` for COMPLETED appointments.
- No-show rate: NO_SHOW / (COMPLETED + NO_SHOW). Show "—" when the denominator is 0.
- Utilisation per barber: bookedMin / openMin, where openMin = working minutes minus blocked minutes.
- Bookings are counted by appointment start time within the selected range (Asia/Singapore dates).

## A8 Quality targets — PROPOSED
- Use the NFR targets in `docs/requirements.md` as written.
- NFR-03 and NFR-05 tests run against the Firestore emulator with scripted concurrent calls.
- NFR-02's 95% target needs a stated test sample size (OPEN; e.g. 10–20 participants).

## A9 Data and cost — PROPOSED
- All shops, barbers, customers and appointments in the prototype are fictional seed data.
- Audit records: TTL on `expireAt` (12 months).
- Expired holds and waitlist entries: cleaned up by the scheduled function.
- Cost worksheet for NFR-07: OPEN (needs current Firebase and SMS pricing).

## A10 Release plan — PROPOSED
- Core: FR-01 to FR-08.
- Extension: FR-09, FR-11, FR-12, FR-14.
- Stretch (external services mocked): FR-10, FR-13, FR-15.
- Build order: schema + seed + rules → FR-06, FR-07 → FR-02, FR-03 (holdSlot, confirmBooking) → FR-04, FR-05 → FR-01, FR-08 → extensions.

## A11 Shop discovery (FR-01) — AGREED (user, 2026-09-25)
- **Service categories:** every service has a `category` from a fixed list: `haircut, beard, shave, colour, perm, kids, other`. The owner picks it in UI-O1. The UI-C1 service-type filter uses this list.
- **Shop summary fields:** `priceMin`, `priceMax` (cents, over active services), `serviceTypes[]` (categories of active services) and `minDurationMin` are **trigger-only**. An `onDocumentWritten` trigger on `shops/{shopId}/services/{serviceId}` recomputes them. Security Rules deny client writes to them, including by the shop owner. With no active service they are `null`/`[]`.
- **Search:** postal code goes to the `geocode` callable; "use my location" falls back to the postal code field when permission is denied. Radius 3 km. Verified shops are found by geohash range query (`status == "verified"` plus `geohash` range, one query per geohash bound), then filtered by exact distance, then by service type (client-side, no extra reads). Sorted by distance.
- **Next available slot:** computed client-side, only for the nearest 10 results, using the same `slotsForBarbers`/`freeSlots` logic as UI-C2 (active barbers and services only, past times excluded, expired holds ignored). Checks today and the next 2 days (3 days in all) with one `schedules` query per shop per day (`date == yyyymmdd`); shows "No slots in the next 3 days" otherwise. Shop barbers, services and schedule queries are cached in memory for a short time (NFR-07). With a service-type filter, the slot is for the shortest active service of that type.
- **Geocode without a token:** when `ONEMAP_TOKEN` is unset and `FUNCTIONS_EMULATOR === "true"`, `geocode` uses a small built-in lookup of Singapore postal codes and returns `not-found` for any other code. Outside the emulator with no token it returns `unavailable`. With the token it calls the real OneMap API. Postal code input: exactly 6 digits after trimming.
- `/` is the customer home page (UI-C1); staff sign in at `/login`.

## A12 Personal time blocks (FR-08) — AGREED (user, 2026-09-25)
- **Callables:** `createBlock` and `removeBlock` are the only writers of blocks. `createBlock` writes a `block` interval on the barber-day `schedules` doc and a `shops/{shopId}/blocks/{blockId}` doc in one transaction. `removeBlock` removes both in one transaction. The shop always comes from the caller's token, never from the input.
- **Who:** a barber blocks only their own time (token `barberId`). An owner names any barber in their own shop. Barbers may remove only their own blocks; owners any block in the shop.
- **Idempotency:** the client generates `blockId` (same format as `requestId`), which is the `blocks` doc ID. Repeating a call with the same parameters returns the same block; the same ID with different parameters is `invalid-argument`. `removeBlock` on a missing block returns `{removed: false}`.
- **Limits:** single-day only (start and end on the same Singapore date; midnight counts as the end of that day). Start and end on the 15-minute grid. Not entirely in the past. Within the booking horizon (today to +13 days). Reason optional, at most 200 characters. Blocks need not sit inside working hours.
- **Overlapping blocks are rejected** (`BLOCK_OVERLAP`, naming the existing block).
- **Conflicts:** a block may overlap existing bookings and live holds. Nothing is ever cancelled or changed. `createBlock` returns them: bookings (`booking` intervals, with status, customer name, masked phone and service, from the appointment) and live holds (time and `holdExpiresAt` only, since hold intervals carry no `refId`). Expired holds are not conflicts. A customer may still confirm a live hold into blocked time; the schedule shows it as a conflict.
- **Schedule doc:** block intervals carry `refId = blockId` so removal is exact. Schedules are public, but a block ID reveals nothing; the reason lives only in the staff-only `blocks` doc. Booking intervals keep `refId = appointment ID`; hold intervals still carry none.
- **`blocks` doc:** `barberId, start, end, reason, createdBy (uid), createdAt`. Read by the owner, or by the barber it belongs to (a barber's query must include `barberId == own`). Never written by clients.
- **No `auditLog`** for blocks: `auditLog` is for booking state changes (NFR-08), as with `addBarber`.
- **UI-B1** (`/staff/schedule`): barbers see their own day; owners pick any barber. A `HELD` appointment whose `holdExpiresAt` has passed is shown as expired, never as a live booking (L2). Expired holds and cancelled or expired appointments are hidden unless "Show expired and cancelled" is chosen, and never counted. Appointments overlapping a block are flagged.
- **Sign-in landing:** barbers go to `/staff/schedule`, owners to `/staff/config`. A barber opening an owner-only page is sent to the schedule. Owners get navigation between the two.
- **Out of scope:** staff cancellation UI (L10 stays open); conflicts are information only.

---

## Change log
| Date | Decision | Change | Approved by |
|---|---|---|---|
| 2026-09-25 | A1 | Shop self-registration recorded as OPEN; shops created by seed/functions only | pending |
| 2026-09-25 | A2 | Barber custom claims include `barberId`: `{ shopId, role, barberId }` | pending |
| 2026-09-25 | architecture | `shopId` added to `notifications` and `deposits`; `confirmBooking` copies `customerName` and masked phone onto appointments | pending |
| 2026-09-25 | A2 | `addBarber` takes an owner-set temporary password (min 8 chars) and creates the barber's email/password login; no email is sent in the prototype | pending |
| 2026-09-25 | A2 | UI-O1 Shop configuration is owner-only; barbers are shown "not authorised" | pending |
| 2026-09-25 | architecture | `addBarber` does not write `auditLog`; `auditLog` is for booking state changes only (NFR-08) | pending |
| 2026-09-25 | A3 | Booking horizon 14 days | pending |
| 2026-09-25 | A2/architecture | `releaseHold` callable; hold intervals carry no `refId`; `customerId` null while HELD | pending |
| 2026-09-25 | A2/A3 | Fresh OTP = token `auth_time` within 10 minutes, checked server-side; staff cancels exempt | AGREED (user) |
| 2026-09-25 | A3 | Late reschedule refused under both policies, does not count toward `lateCancels` | AGREED (user) |
| 2026-09-25 | A3 | Reschedule keeps the same shop, service and barber | AGREED (user) |
| 2026-09-25 | A3 | A blocked late cancel increments `lateCancels` at most once per booking, tracked by `appointments.lateCancelAttempted` | AGREED (user) |
| 2026-09-25 | A11 | FR-01 discovery: service `category`, trigger-only shop summary fields, geohash search, client-side next slot (10 shops, 3 days), mock geocode lookup when `ONEMAP_TOKEN` is unset | AGREED (user) |
| 2026-09-25 | A12 | FR-08 personal time blocks: `createBlock`/`removeBlock`, overlapping blocks rejected, barbers see only own blocks, live holds and bookings reported as conflicts and left alone, block intervals carry `refId`, no `auditLog` | AGREED (user) |
| 2026-09-25 | architecture | `auditLog` gains `action` ("hold", "confirm", "release", "cancel", "reschedule", "lateCancelRefused") so same-state records are distinguishable; refused late attempts and reschedules are recorded as CONFIRMED→CONFIRMED with auto IDs | AGREED (user) |

---

## Known limitations and backlog
Living list. Add an entry when a shortcut is taken or something is deferred; remove or mark **Resolved** when fixed. This section feeds the "Limitations" section of the final report.

| # | Limitation | Why it exists | Must be fixed | Affects |
|---|---|---|---|---|
| L1 | `holdSlot` and `releaseHold` are unauthenticated (the hold comes before the OTP) and App Check is not wired, so they can be spammed to block slots. | Architecture order is HELD → OTP → CONFIRMED; App Check was not in scope for FR-02/03. | **Before any public demo or deployment.** Wire App Check on all callables; consider a per-client hold cap. | FR-03, NFR-04 |
| L2 | Expired holds remain as `HELD` appointment documents (and are pruned from `schedules` only when that barber-day is next written). Slots are correctly free because every transaction ignores expired holds. **UI-B1 now shows them as expired, never as bookings (resolved for the UI, FR-08).** | The scheduled cleanup function is not built yet. | The scheduled cleanup job (release expired holds, mark EXPIRED, write audit) goes in with FR-09 reminders. Still open for it, and for FR-14 counts. | FR-09, FR-14 |
| L3 | A confirmed booking always goes HELD → CONFIRMED; the deposit branch (`noShowCount ≥ 2` → PENDING_PAYMENT) is not implemented. | FR-13 is Stretch. | With FR-13. | FR-13 |
| L4 | No confirmation or reminder SMS is sent; messaging is mocked and not yet built. | FR-09 is Extension. | With FR-09; UI must keep saying it is mocked. | FR-09 |
| L5 | The booking draft (UI-C2/C3) is held in memory only, so a page reload loses it; the hold then lapses after 10 minutes. | Kept simple for the prototype. | Optional: persist the draft in `sessionStorage`. | NFR-05 |
| L6 | Concurrency tests cover 50 simultaneous holds and 100 repeated submissions. The 1000-transaction zero-double-booking run (NFR-03) and the 100 simulated failed-write runs (NFR-05) are not yet scripted. Tests run against the emulator only. | Time. | Before the final report's test results. | NFR-03, NFR-05 |
| L7 | There is no booking history. "My bookings" (upcoming only), cancellation and rescheduling exist (UI-C4). Discovery (UI-C1) exists at `/`. | Build order (A10). | FR-11. | FR-11 |
| L8 | The barber change alert (A4) and the customer notice on a staff cancellation are not sent; no `notifications` docs are written for cancel or reschedule. | Messaging is not built (L4). | With FR-09. | FR-04, FR-09 |
| L9 | Reschedule keeps the same barber and service; there is no move to another barber or "any available". | Scope kept small (A3). | Optional extension. | FR-04 |
| L10 | Staff cancellation exists only as a callable (`cancelBooking` with a staff token); there is no staff UI. | UI-B1 is not built yet. | With UI-B1. | FR-04, FR-08 |
| L11 | Under heavy contention (e.g. 50 concurrent `holdSlot` calls across several barber-days) the Firestore and Functions emulators occasionally reset connections (`ECONNRESET` after about 60 s, with `Transaction lock timeout` in the Firestore emulator log). The concurrency harness (`call()` in `tests/concurrency.test.mjs`) treats such responses as transport failures, never as results, retries the idempotent call with the same `requestId`, reports how many retries happened, and asserts on the stored data (appointments, schedule intervals, audit records). Production Firestore behaviour under load is untested. | The emulator uses lock timeouts where production Firestore aborts and retries, and a worker process is started per concurrent request. | Before the final report's test results (with L6): run the NFR-03 load against a real project or quantify the retry rate. | NFR-03, NFR-05 |
| L12 | `geocode` uses a small built-in lookup of Singapore postal codes (the seed shop areas plus a few landmarks, approximate coordinates) **only in the Functions emulator** (`FUNCTIONS_EMULATOR === "true"`) when `ONEMAP_TOKEN` is unset, and returns `not-found` for every other code. Outside the emulator with no token it returns `unavailable`, never mock data. The real OneMap call (`functions/geocode.js`) is written but untested against the live API. | No OneMap token yet. | Before any public demo: create the secret (`firebase functions:secrets:set ONEMAP_TOKEN`) and check the OneMap search endpoint and response shape against their current docs. | FR-01 |
| L13 | `geocode` is unauthenticated (discovery precedes sign-in) and each call can reach OneMap, so it can be spammed. It only has an in-memory cache per instance. | App Check is not wired (L1). | With L1: App Check on all callables; consider a per-client rate limit. | FR-01, NFR-04, NFR-07 |
| L14 | Next available slot on UI-C1 covers today and the next 2 days for the nearest 10 shops only. Beyond that a card says "No slots in the next 3 days" or "Open shop to see times". The shop summary fields (`priceMin`, `priceMax`, `serviceTypes`, `minDurationMin`) are written by the `summarizeShopServices` trigger, so a shop edited while Functions are not running shows stale values until the next service write. Shops without `lat`/`lng`/`geohash` are never found. Services created before A11 have no `category` until the owner re-saves them (rules require it on save). | Keeps reads low (NFR-07). | Optional: longer horizon; a backfill script for existing shops. | FR-01, NFR-07 |
| L15 | A block does not stop a customer who already holds a slot in it from confirming: the hold stays and the booking can become CONFIRMED inside blocked time. `createBlock` returns such holds (and confirmed bookings) as conflicts and UI-B1 flags overlapping appointments, but staff cannot cancel or move them from the UI (L10), and no customer is notified (L4, L8). | By decision (A12): blocks never cancel or move bookings. | With UI-B1 staff cancellation (L10) and FR-09 messaging. | FR-08 |
