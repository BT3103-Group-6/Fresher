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
- **Rescheduling:** follows the same notice window as cancellation. Atomic swap; the original stands if the new slot is taken.
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
