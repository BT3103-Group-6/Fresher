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

### A4 addendum: FR-09 reminders and the scheduled job — AGREED (user, 2026-09-25)
- **Task creation:** `confirmBooking` writes the tasks in the same transaction as HELD → CONFIRMED (no trigger): `confirmation` (due now), `reminder24h` if `start - 24 h >= now`, `reminder2h` if `start - 2 h >= now`. A reminder that would already be past is not created (exactly 24 h or 2 h ahead still creates it).
- **Task fields** (`notifications/{bookingId_type}`): `bookingId, shopId, barberId, apptStart, type, channel ("sms"), dueAt, status ("pending" | "sent" | "failed" | "cancelled"), nextAttemptAt, rev, attempts[]`. `barberId` and `apptStart` are denormalised for UI-B1's query. No phone number is stored on a task; the sender reads `customers/{customerId}.phoneE164` when sending. `attempts[]` is never cleared; each entry is `{at, channel, outcome, error?, rev}`.
- **`nextAttemptAt`** is set only while a task is still to be sent (first send, retry, or a claim lease) and removed at a terminal state. The sender queries `nextAttemptAt <= now`, so it needs no composite index.
- **Retries:** "up to 2 retries" means at most 3 attempts, each 1 minute after the previous failure; then `failed`.
- **Idempotent sending:** a claim transaction re-reads the task and the appointment and sets a 2-minute lease in `nextAttemptAt`, so concurrent or repeated runs send once. The appointment must still be CONFIRMED with `start == apptStart` and not yet started, otherwise the task is `cancelled`. The provider gets the idempotency key `{taskId}:{rev}:{attemptNo}`. A crash between the provider call and the outcome write means the lease expires and the task is sent again (at-least-once, L21).
- **Cancellation:** `cancelBooking` sets every task that is not `sent` or `failed` to `cancelled` (in the same transaction). Tasks are kept, not deleted, so the attempt log survives (this changes the "cancel deletes tasks" wording in `docs/architecture.md`).
- **Reschedule:** `reschedule` recomputes tasks for the new start in the same transaction and bumps `rev`. A future reminder goes back to `pending`, even if it was sent for the old time; a reminder now in the past is `cancelled`; a reminder never created before is created. A refused late cancel or reschedule touches no tasks.
- **Mock provider:** `functions/messaging.js` exposes `send({to, body, key}) → {ok, providerRef | error}`. The mock logs the message and succeeds, except that a number ending `0000` always fails, so retries can be exercised by hand. Messages and UI say messaging is mocked.
- **Scheduled job:** one `onSchedule` function, every minute, `Asia/Singapore`, runs the sender and the expiry sweep. Correctness never depends on it (transactions ignore expired holds).
- **Expiry sweep:** `HELD` appointments with `holdExpiresAt <= now` become `EXPIRED`, the hold interval is removed from the schedule and an audit record is written in the same transaction (`{id}_EXPIRED`, action `expire`, role `system`, no actor). It shares its body with `releaseHold` and re-checks state, so it cannot override a concurrent `confirmBooking`. Resolves L2. `PENDING_PAYMENT` expiry belongs to FR-13.
- **Dev trigger:** the emulator does not fire schedules, so an `onRequest` function `devRunSweep` runs both jobs. It is exported only when `FUNCTIONS_EMULATOR === "true"`, so it does not exist in a deployment. `npm run sweep` calls it (`--watch` repeats every 60 s).
- **Rules and indexes:** `notifications` reads are limited to the shop's owner or the barber whose `barberId` matches. Indexes added: `notifications (shopId, barberId, apptStart)` and `appointments (status, holdExpiresAt)`.
- **`plannedAt`** (on the confirmation task) is when the reminders were last planned: set at confirmation and refreshed by `reschedule`. UI-B1 uses it to word a missing reminder: "Not scheduled: booked too close to the start" only when `plannedAt` is later than that reminder's due time (start − 24 h or start − 2 h); otherwise "No reminder recorded" (for example a booking made before FR-09, which has no tasks at all). Tasks without `plannedAt` fall back to `createdAt`.
- **Backfill (emulator only):** `npm run backfill:notifications [-- --shop <id>]` creates the reminders that are missing for future `CONFIRMED` appointments. It never touches existing tasks, never creates a confirmation (no text about an old booking), skips reminders already in the past, and is safe to rerun.
- **Out of scope:** the barber change alert and the customer notice on staff cancellation (`change` tasks) stay open (L8).

## A5 Queue and no-shows — PROPOSED
- Who can mark a no-show: the owner, or the barber assigned to the appointment.
- Mark allowed only when `now >= start + 15 min`.
- Reversal: within 24 h of marking, by the same roles. Both actions write audit records.
- Counts are per shop: `customers/{uid}/shopStats/{shopId}.noShowCount`.
- **FR-12 callables** (AGREED, user): `startService` (CONFIRMED → IN_SERVICE, sets `actualStart`), `finishService` (IN_SERVICE → COMPLETED, sets `actualEnd`), `markNoShow`, `reverseNoShow`. Same roles for all four: the owner, or the assigned barber. Anyone else gets `BOOKING_NOT_FOUND`. Time is always server time, read inside the transaction.
- **Start guard:** `startService` is allowed from 60 min before the scheduled start (`now >= start - 60 min`); earlier returns `TOO_EARLY` with the allowed time in `details`. No upper limit. `markNoShow` returns `TOO_EARLY` before `start + 15 min` the same way.
- **`noShowAt`:** `markNoShow` sets `appointments.noShowAt`; `reverseNoShow` clears it and is allowed while `now <= noShowAt + 24 h`, else `REVERSAL_WINDOW_CLOSED`.
- **Counter:** mark increments and reverse decrements `noShowCount` in the same transaction as the state change; the decrement never goes below 0.
- **A no-show keeps its interval on the schedule**, so the slot stays unavailable and a reversal never needs a clash check.
- **Idempotent replays:** repeating a call whose target state is already reached returns the current summary and changes nothing (no second increment, no second audit record). Any other wrong state returns `INVALID_STATE`.
- **Audit:** `action` values `start`, `finish`, `noShow`, `noShowReversed`. `start` and `finish` use the deterministic IDs `{bookingId}_IN_SERVICE` and `{bookingId}_COMPLETED`; `noShow` and `noShowReversed` use auto IDs because they can repeat and reverse targets CONFIRMED, which `confirm` already uses.
- Queue delay (FR-10, stretch): projected delay = expected finish of the current service (actualStart + durationMin) plus remaining queued durations, minus the next booking's start. Details OPEN.

## A6 Deposits and waitlist — PROPOSED
- Deposit required when `noShowCount >= 2` at that shop.
- Amount: 50% of the snapshot `priceCents`, rounded up to the nearest 10 cents.
- Payment: **mock provider** in test mode. Failure or 10 minutes without payment → EXPIRED.
- Attended → deposit `refundable`; another no-show → `forfeited`.

### A6 addendum: FR-13 deposits — AGREED (user, 2026-09-25), including the items first marked proposed
- **Trigger:** inside `confirmBooking`'s transaction, read `customers/{uid}/shopStats/{shopId}`. If `noShowCount >= 2` (this shop only; another shop's count is irrelevant) the HELD hold becomes `PENDING_PAYMENT` instead of `CONFIRMED`, and a deposit is created in the same transaction. The rule is evaluated on the server at that moment; `shopStats.depositRequired` is not used (the count is the single source). The customer is told only after the OTP (UI-C3 hands off to UI-C5).
- **Amount:** `ceil(priceCents / 20) * 10` cents (50% of the snapshot price, rounded up to the nearest 10 cents), integer maths only. A price of 0 gives no deposit and the booking confirms normally.
- **Payment deadline:** 10 minutes from the OTP confirmation. For a `PENDING_PAYMENT` appointment `holdExpiresAt` is the payment deadline (the same field, so every existing check keeps working), and its interval on the schedule stays `kind: "hold"` with that expiry. The slot therefore frees itself at the deadline without the scheduler, exactly like a HELD hold. `customerId`, `customerName` and the masked phone are set at this point.
- **Deposit document:** `deposits/{bookingId}` (one per booking; the ID makes creation idempotent and is stored on the appointment as `depositId`). Fields: `bookingId, shopId, barberId, customerId, amountCents, status, providerRef, createdAt, paidAt?, paidAfterExpiry?`. `barberId` and `customerId` are there so Security Rules can scope reads. Statuses: `pending → paid → refundable | forfeited`, or `pending → failed`.
- **Payment provider:** `functions/payments.js` exposes `createPayment({depositId, amountCents, reference}) → {providerRef}`. The prototype has a **mock** only (deterministic `mockpay_{depositId}`; no money moves). `createDeposit` (callable, customer who owns the booking) registers the payment with the provider once and returns the amount, deadline and reason for UI-C5; it is idempotent.
- **Mock checkout:** UI-C5 shows two clearly labelled mock buttons ("Pay (mock)", "Simulate a failed payment") that call `mockPay`. `mockPay` makes the mock provider deliver a **signed** event to the same handler `paymentWebhook` uses (server-side, in-process), so the real verification path is exercised. **`mockPay` is exported only when `FUNCTIONS_EMULATOR === "true"`** (like `devRunSweep`), so it does not exist in a deployment, and it may be called only by the signed-in customer who owns the deposit (`deposits/{id}.customerId == auth.uid`); anyone else gets `DEPOSIT_NOT_FOUND`, never a hint that the deposit exists.
- **Webhook (an HTTPS function, `onRequest`, not a callable):** a payment provider posts JSON to a URL and signs the raw body; a callable's protocol cannot carry that. Signature: header `X-Signature` = hex HMAC-SHA256 of the raw body with `PAYMENT_WEBHOOK_SECRET` (a Functions secret; in the emulator only, a fixed mock secret is used when unset, like `ONEMAP_TOKEN`), compared in constant time; the body carries `occurredAt`, and events older than 5 minutes are refused (replay limit). Bad or missing signature → 401 and nothing changes. Body: `{eventId, type: "payment.succeeded" | "payment.failed", depositId, providerRef, occurredAt}`.
- **Webhook semantics** (one transaction reading the deposit, appointment and schedule; server time):
  - `payment.succeeded`, deposit `pending`, appointment `PENDING_PAYMENT` and `now < holdExpiresAt`: deposit → `paid`; appointment → `CONFIRMED`; the hold interval becomes a `booking` interval; audit `confirm` (`{id}_CONFIRMED`, role `system`, no actor); **notification tasks are created now** (`plannedAt` = this moment), never before.
  - Deposit already `paid` (or beyond): a duplicate; 200 and no change, no second audit record, no second set of tasks.
  - `payment.succeeded` after the appointment has expired (the expiry won the race, or `now >= holdExpiresAt`): the slot stays released; the deposit becomes `refundable` with `paidAfterExpiry: true` so the money is not lost.
  - `payment.failed`, deposit `pending`: deposit → `failed`; appointment → `EXPIRED`, hold interval removed; audit `paymentFailed` (PENDING_PAYMENT → EXPIRED, role `system`). After a success it is ignored (out-of-order delivery).
  - Success racing expiry is settled by the appointment document's transaction: exactly one of {`CONFIRMED` + deposit `paid` + booking interval} or {`EXPIRED` + slot released + deposit `failed`/`refundable`} results.
- **Expiry sweep (extends the FR-09 job):** the query takes `HELD` and `PENDING_PAYMENT` appointments with `holdExpiresAt <= now`. For `PENDING_PAYMENT` the same transaction also sets the deposit `pending → failed`. Audit `expire` (role `system`) covers both.
- **Attendance and no-show:** `finishService` (IN_SERVICE → COMPLETED) sets a `paid` deposit to `refundable`; `markNoShow` sets it to `forfeited`; `reverseNoShow` puts it back to `paid`, in the same transactions as the state change. Repeated calls change nothing. "Refundable" is a status only: no refund is executed (mock).
- **Cancellation with a paid deposit (AGREED default):** a staff cancellation or a customer cancellation with enough notice sets the deposit `refundable`; a customer cancellation inside the notice window under `latePolicy: "flag"` sets it `forfeited`; a refused late cancel changes nothing. A reschedule keeps the deposit. A `PENDING_PAYMENT` booking cannot be cancelled by `cancelBooking` (`NOT_CANCELLABLE`); it ends by payment, failure or expiry.
- **UI:** UI-C5 (`/deposit/:requestId`) shows the reason (missed appointments at this shop), the amount, the booking summary and a countdown to `holdExpiresAt`, labels the checkout as mock/test mode, and follows the appointment and deposit live; at zero it says the slot was released and links back to the shop. UI-C3 redirects there when `confirmBooking` returns `PENDING_PAYMENT`. UI-C4 lists a `PENDING_PAYMENT` booking under Upcoming as "Awaiting payment" with a Continue link (this changes A13, which hid `PENDING_PAYMENT`). UI-B1 shows a `PENDING_PAYMENT` appointment past its deadline as expired, like an expired hold (L2), and never counts it as a booking.
- **Rules:** `deposits` are readable by the customer they belong to, the shop's owner, and the barber whose `barberId` matches; no client writes.
- **Notifications:** a `PENDING_PAYMENT` booking has no tasks; they are written by whichever transaction makes it `CONFIRMED` (the webhook), so FR-09 reminders are planned from that moment.
- **Out of scope:** real payment gateway, real refunds, customer-initiated abandon of a pending payment (it ends at the deadline or by a failed payment).
- Waitlist order: earliest `joinedAt` first.
- Compatible entry: same shop, service and date; same barber if one was chosen; freed interval fits the service duration.
- Offer holds the freed slot for 15 minutes, then passes to the next entry.
- All entries expire at 23:59:59 Asia/Singapore on the requested date.

## A7 Analytics — PROPOSED
- Booked value: sum of `priceCents` for COMPLETED appointments.
- No-show rate: NO_SHOW / (COMPLETED + NO_SHOW). Show "—" when the denominator is 0.
- Utilisation per barber: bookedMin / openMin, where openMin = working minutes minus blocked minutes.
- Bookings are counted by appointment start time within the selected range (Asia/Singapore dates).

### A7 details (FR-14) — AGREED (user, 2026-09-25)
- **`bookedMin`:** sum of the snapshot `durationMin` of COMPLETED appointments only (consistent with booked value). Utilisation = completed minutes / open minutes.
- **`openMin` is not stored.** `dailyStats` holds only `completed, valueCents, noShows, bookedMin` per barber, because a trigger on appointment writes never fires for days with no bookings. The dashboard computes open minutes in the client from each barber's current `workingHours` intersected with the shop `openingHours`, minus the overlap of `blocks` (one owner-readable query for the range). Open time is clipped to `now`, so future time is not counted. Deactivated barbers have no open time, and a barber who is no longer listed but has stats shows as "Former barber" (counted in totals, left out of utilisation). Editing working hours therefore changes past utilisation (limitation L19).
- **`dailyStats` is maintained by the `onAppointmentWritten` trigger** through a per-appointment ledger `shops/{shopId}/statContrib/{appointmentId}` (what that appointment currently contributes). Each run re-reads the current appointment, computes new minus old contribution and applies only the difference, so redelivered or out-of-order events cannot double-count, a no-show reversal reverses itself and a reschedule moves counts between days. Only COMPLETED and NO_SHOW contribute. Clients cannot read or write `statContrib`.
- **Read scope:** `dailyStats` is readable by the shop owner only (was any staff), so barbers cannot see each other's revenue.
- **Range:** at most 92 days per query; default last 30 days.

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

## A13 Booking history and rebooking (FR-11) — AGREED (user, 2026-09-25)
- **No new callables, indexes or rules.** UI-C4 keeps its single `appointments` query filtered by `customerId`; Upcoming and History are both derived from it in the client. Rules already let a customer read and list only their own appointments; HELD and EXPIRED docs have `customerId == null`, so they never match.
- **Upcoming:** `CONFIRMED` with `end > now` (half-open, so an in-progress booking stays visible until it ends), oldest first.
- **History:** `COMPLETED`, `CANCELLED`, `NO_SHOW`, plus `CONFIRMED` with `end <= now` (never finalised by staff), newest first by `start` (ties by ID). The last group is labelled neutrally **"Past booking"**: the app does not claim it was attended or missed. Never shown in either list: `HELD`, `EXPIRED`, `PENDING_PAYMENT` and `IN_SERVICE`.
- **Rebook** is on every History item (including "Past booking" and cancelled ones). It opens UI-C2 for the same shop with the same service and barber pre-selected. It holds nothing and picks no time; the normal slot logic and `holdSlot` decide what is bookable. The draft is always reset first (a stale draft for the same shop is never reused); only the phone number is carried over.
- **Suppressed pre-fill, with a visible reason:** shop not readable or not verified → Rebook disabled ("no longer available"); service missing or inactive → service and barber not pre-filled; barber missing or inactive, or no longer offering the service → barber becomes "any barber". UI-C2 makes the final decision against its live active lists; UI-C4 shows the same reasons beforehand from the docs it has fetched.
- **Reads (NFR-07):** History shows 20 items, then "Show more"; shop, service and barber docs are fetched only for items shown.
- **Fresh OTP:** as for FR-04, the page runs the OTP step before listing anything. Rules cannot check that the OTP is fresh, so this is a client-side gate (L17). No `auth_time` rule.

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
| 2026-09-25 | A5/architecture | FR-12: `startService`/`finishService`/`markNoShow`/`reverseNoShow`; `appointments.noShowAt`; start allowed from 60 min before the slot (`TOO_EARLY`); no-show keeps its schedule interval; counter clamped at 0; idempotent replays; audit actions `start`, `finish`, `noShow`, `noShowReversed` (last two with auto IDs) | AGREED (user) |
| 2026-09-25 | A13 | FR-11 history and rebooking: no new callables or rules; Upcoming = CONFIRMED with `end > now`; History = COMPLETED, CANCELLED, NO_SHOW and past CONFIRMED ("Past booking"), newest first; per-item Rebook with suppressed pre-fill and reasons; client-side OTP gate logged as a limitation | AGREED (user) |
| 2026-09-25 | A7 | FR-14: `bookedMin` = COMPLETED durationMin; `openMin` computed in the client (not stored) from current working hours, shop hours and blocks, clipped to now; `dailyStats` maintained by `onAppointmentWritten` via a `statContrib` per-appointment ledger (idempotent); `dailyStats` read owner-only; range capped at 92 days | AGREED (user) |
| 2026-09-25 | A6/architecture | FR-13 deposits: `confirmBooking` → PENDING_PAYMENT when `noShowCount >= 2`; deposit `ceil(price/20)*10`; 10-minute payment deadline held in `holdExpiresAt`; `deposits/{bookingId}`; mock payment provider; signed HMAC webhook applying idempotent transitions; expiry sweep extended to PENDING_PAYMENT; deposit follows finish, no-show and reversal; reminders created only at CONFIRMED; UI-C5; UI-C4 shows PENDING_PAYMENT. Also agreed: webhook as `onRequest`, late payment → `refundable`, price 0 → no deposit, cancellation outcomes; `mockPay` exists only in the Functions emulator and only for the deposit's own customer | AGREED (user) |
| 2026-09-25 | A4 | FR-09 follow-up: `plannedAt` on the confirmation task; UI-B1 says "too close" only when planning happened after the reminder's due time, else "No reminder recorded"; `backfill:notifications` for pre-FR-09 bookings | AGREED (user) |
| 2026-09-25 | A4/architecture | FR-09: tasks created inside `confirmBooking`'s transaction (no trigger); cancel marks tasks `cancelled` instead of deleting; at most 3 attempts, 1 minute apart; `nextAttemptAt` claim lease; mock provider fails for numbers ending `0000`; scheduled job also sweeps expired HELD to EXPIRED (audit action `expire`, role `system`); `devRunSweep` emulator-only trigger; `notifications` reads scoped to owner or the matching barber | AGREED (user) |

---

## Known limitations and backlog
Living list. Add an entry when a shortcut is taken or something is deferred; remove or mark **Resolved** when fixed. This section feeds the "Limitations" section of the final report.

| # | Limitation | Why it exists | Must be fixed | Affects |
|---|---|---|---|---|
| L1 | `holdSlot` and `releaseHold` are unauthenticated (the hold comes before the OTP) and App Check is not wired, so they can be spammed to block slots. | Architecture order is HELD → OTP → CONFIRMED; App Check was not in scope for FR-02/03. | **Before any public demo or deployment.** Wire App Check on all callables; consider a per-client hold cap. | FR-03, NFR-04 |
| L2 | **Resolved (FR-09, A4 addendum).** The scheduled sweep now marks expired holds EXPIRED, removes them from `schedules` and writes an `expire` audit record. Previously: expired holds remained as `HELD` appointment documents (and are pruned from `schedules` only when that barber-day is next written). Slots are correctly free because every transaction ignores expired holds. **UI-B1 now shows them as expired, never as bookings (resolved for the UI, FR-08).** | The scheduled cleanup function is not built yet. | The scheduled cleanup job (release expired holds, mark EXPIRED, write audit) goes in with FR-09 reminders. Still open for it. FR-14 is unaffected: only COMPLETED and NO_SHOW appointments are counted. | FR-09, FR-14 |
| L3 | **Resolved (FR-13, A6 addendum).** `confirmBooking` now takes the deposit branch (`noShowCount ≥ 2` at that shop → PENDING_PAYMENT). Previously a confirmed booking always went HELD → CONFIRMED. | FR-13 is Stretch. | Done. | FR-13 |
| L4 | Confirmation and reminder SMS go through a **mock provider** only (`functions/messaging.js`); nothing reaches a real phone. The UI must keep saying so. | No SMS provider or budget in the prototype. | Before any real use: a real provider behind the same interface, with its secret in Functions secrets. | FR-09 |
| L5 | The booking draft (UI-C2/C3) is held in memory only, so a page reload loses it; the hold then lapses after 10 minutes. | Kept simple for the prototype. | Optional: persist the draft in `sessionStorage`. | NFR-05 |
| L6 | Concurrency tests cover 50 simultaneous holds and 100 repeated submissions. The 1000-transaction zero-double-booking run (NFR-03) and the 100 simulated failed-write runs (NFR-05) are not yet scripted. Tests run against the emulator only. | Time. | Before the final report's test results. | NFR-03, NFR-05 |
| L7 | **Resolved (FR-11, A13).** There was no booking history; UI-C4 now has a History tab with Rebook. | Build order (A10). | Done. | FR-11 |
| L8 | The barber change alert (A4) and the customer notice on a staff cancellation are not sent; no `change` tasks are written for cancel or reschedule (FR-09 sends only confirmation and reminders). | Out of scope for the first FR-09 build. | Optional: `change` tasks written in the same transactions as cancel and reschedule. | FR-04, FR-09 |
| L9 | Reschedule keeps the same barber and service; there is no move to another barber or "any available". | Scope kept small (A3). | Optional extension. | FR-04 |
| L10 | Staff cancellation exists only as a callable (`cancelBooking` with a staff token); there is no staff UI. | UI-B1 is not built yet. | With UI-B1. | FR-04, FR-08 |
| L11 | Under heavy contention (e.g. 50 concurrent `holdSlot` calls across several barber-days) the Firestore and Functions emulators occasionally reset connections (`ECONNRESET` after about 60 s, with `Transaction lock timeout` in the Firestore emulator log). The concurrency harness (`call()` in `tests/concurrency.test.mjs`) treats such responses as transport failures, never as results, retries the idempotent call with the same `requestId`, reports how many retries happened, and asserts on the stored data (appointments, schedule intervals, audit records). Production Firestore behaviour under load is untested. | The emulator uses lock timeouts where production Firestore aborts and retries, and a worker process is started per concurrent request. | Before the final report's test results (with L6): run the NFR-03 load against a real project or quantify the retry rate. | NFR-03, NFR-05 |
| L12 | `geocode` uses a small built-in lookup of Singapore postal codes (the seed shop areas plus a few landmarks, approximate coordinates) **only in the Functions emulator** (`FUNCTIONS_EMULATOR === "true"`) when `ONEMAP_TOKEN` is unset, and returns `not-found` for every other code. Outside the emulator with no token it returns `unavailable`, never mock data. The real OneMap call (`functions/geocode.js`) is written but untested against the live API. | No OneMap token yet. | Before any public demo: create the secret (`firebase functions:secrets:set ONEMAP_TOKEN`) and check the OneMap search endpoint and response shape against their current docs. | FR-01 |
| L13 | `geocode` is unauthenticated (discovery precedes sign-in) and each call can reach OneMap, so it can be spammed. It only has an in-memory cache per instance. | App Check is not wired (L1). | With L1: App Check on all callables; consider a per-client rate limit. | FR-01, NFR-04, NFR-07 |
| L14 | Next available slot on UI-C1 covers today and the next 2 days for the nearest 10 shops only. Beyond that a card says "No slots in the next 3 days" or "Open shop to see times". The shop summary fields (`priceMin`, `priceMax`, `serviceTypes`, `minDurationMin`) are written by the `summarizeShopServices` trigger, so a shop edited while Functions are not running shows stale values until the next service write. Shops without `lat`/`lng`/`geohash` are never found. Services created before A11 have no `category` until the owner re-saves them (rules require it on save). | Keeps reads low (NFR-07). | Optional: longer horizon; a backfill script for existing shops. | FR-01, NFR-07 |
| L15 | A block does not stop a customer who already holds a slot in it from confirming: the hold stays and the booking can become CONFIRMED inside blocked time. `createBlock` returns such holds (and confirmed bookings) as conflicts and UI-B1 flags overlapping appointments, but staff cannot cancel or move them from the UI (L10), and no customer is notified (L4, L8). | By decision (A12): blocks never cancel or move bookings. | With UI-B1 staff cancellation (L10) and FR-09 messaging. | FR-08 |
| L16 | Marking a no-show does not notify the customer and does not free the slot; the booking interval stays on the schedule. **No-shows are counted in `dailyStats` (FR-14, resolved).** | Messaging is mocked and not built (L4); freeing the slot was ruled out (A5) to keep reversal simple. | With FR-09 (notice) and FR-14 (stats). | FR-09, FR-12, FR-14 |
| L17 | The OTP before UI-C4 (upcoming bookings and History) is a client-side gate: Security Rules only check that the caller is the appointment's customer, not that the OTP is fresh, so someone holding a persisted customer session could query their own history directly. Changes (cancel, reschedule) are still checked server-side (fresh `auth_time`). | Rules-level `auth_time` checks were ruled out (A13) to keep reads simple. | Optional: an `auth_time` condition on `appointments` reads, or a callable for history. | FR-11, NFR-04 |
| L18 | History shows appointments only for the shop's current state: appointments snapshot price and duration but not names, so once a shop is no longer verified its shop, service and barber docs are unreadable to customers and those items show no names (Rebook is disabled). History is filtered and paged in the client after one `customerId` query, so a customer with a very large history reads all of it. `IN_SERVICE` bookings appear in neither tab until finished; a `CONFIRMED` booking never finalised by staff appears as "Past booking". | Reuses the existing query and rules (A13); no index or callable. | Optional: `customerId` + `start` index with paging; snapshot names on the appointment. | FR-11, NFR-07 |
| L19 | FR-14 utilisation uses each barber's **current** working hours, shop hours and blocks, so editing them changes utilisation for past days. Removed blocks disappear from past days too. Barbers with no stats but open time still show 0%. | `openMin` is not stored (A7 details): a trigger on appointment writes cannot cover days with no bookings. | Optional: snapshot open minutes per barber-day with a scheduled job. | FR-14 |
| L20 | The scheduled function (`onSchedule`) has been exercised only through the emulator-only `devRunSweep` trigger and direct calls in tests; it has not run under Cloud Scheduler. The new composite indexes (`notifications`, `appointments`) are not enforced by the emulator, so they are unverified until deployed. | No deployment (CLAUDE.md); the emulator does not fire schedules or check indexes. | Before any deployment: deploy to a test project, confirm the schedule fires and the indexes build. | FR-09 |
| L21 | Sending is at-least-once: a crash between the provider call and the outcome write means the task is sent again after its 2-minute lease. The idempotency key `{taskId}:{rev}:{attemptNo}` lets a real provider de-duplicate, but the mock does not. | The provider call cannot share a transaction with Firestore. | With a real provider (L4): confirm it honours the key. | FR-09 |
| L22 | The scheduler and sweeps handle at most 200 tasks or expired holds per run (one minute), so a large backlog drains over several runs. Reminders are sent up to a minute or so after `dueAt`. | Keeps each run short and cheap (NFR-07). | Optional: paging within a run. | FR-09 |
| L23 | Payments and refunds are **mocked**: the provider (`functions/payments.js`) moves no money, `refundable` and `forfeited` are statuses only, and no refund is ever executed. The UI must keep saying so. `mockPay` (the mock checkout's pay and fail buttons) is exported **only in the Functions emulator** (`FUNCTIONS_EMULATOR === "true"`) and only for the deposit's own customer, so a deployment has no way to complete a mock payment: the mock checkout works in the emulator only. | No payment gateway or budget in the prototype. | Before real use: a real provider behind the same interface, refunds, and a real checkout page in place of the emulator-only `mockPay`. | FR-13 |
| L24 | The webhook secret `PAYMENT_WEBHOOK_SECRET` falls back to a fixed mock value **only in the Functions emulator**; elsewhere an unset secret makes the webhook refuse every call. The webhook has not been exercised by a real provider, so its signature format and event names are our own. | No provider account. | Before any deployment: create the secret and match the provider's documented signature scheme. | FR-13 |
| L25 | A customer cannot abandon a pending payment: the slot stays held until the deadline (10 minutes) or a failed payment. `PENDING_PAYMENT` bookings cannot be cancelled by staff either. | Keeps the state machine small (A6 addendum). | Optional: a customer "cancel payment" and staff cancel for `PENDING_PAYMENT`. | FR-13 |
