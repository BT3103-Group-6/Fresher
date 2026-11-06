# NFR-08 audit trail: coverage

Status: **draft, 5 Nov 2026.** Branch `feat/nfr-08-audit-trail`. Owner Haziq, reviewer K-Rei (Alson for the rules test).

**Target (NFR-08):** 100% of booking state changes create an immutable audit record with booking ID, actor, timestamp, previous state and resulting state, kept for 12 months.

## 1. The record

Every record is built by `auditRecord()` in `functions/booking.js` and written in the same transaction as the state change, so a change cannot commit without its record.

| NFR-08 field | Field in `auditLog/{eventId}` |
|---|---|
| Booking ID | `bookingId` (the appointment's `requestId`), plus `shopId` |
| Actor | `actorUid` and `role` (`customer`, staff role, or `system`) |
| Timestamp | `at` |
| Previous state | `fromStatus` |
| Resulting state | `toStatus` |
| Retention | `expireAt` = `at` + 12 months (TTL field) |
| What happened | `action` |

**Immutability:** `firestore.rules` only allows reads of `auditLog` (shop staff, `isStaffOf(shopId)`). No client can create, change or delete a record; only the functions (Admin SDK) write them.

## 2. Transitions on main (5 Nov 2026)

| # | Action | From → to | Actor | Where | Record ID |
|---|---|---|---|---|---|
| 1 | `hold` | none → HELD | customer (not signed in yet, `actorUid` null) | `holdSlot` | `{id}_HELD` |
| 2 | `release` | HELD → EXPIRED | customer | `releaseHold` (`releaseInTx`) | `{id}_EXPIRED` |
| 3 | `expire` | HELD (or unpaid PENDING_PAYMENT) → EXPIRED | system | scheduled sweep, `functions/sweep.js` (`releaseInTx`) | `{id}_EXPIRED` |
| 4 | `requireDeposit` | HELD → PENDING_PAYMENT | customer | `confirmBooking` (FR-13 branch) | `{id}_PENDING_PAYMENT` |
| 5 | `confirm` | HELD → CONFIRMED | customer | `confirmBooking` | `{id}_CONFIRMED` |
| 6 | `cancel` | CONFIRMED → CANCELLED | customer or staff | `cancelBooking` | `{id}_CANCELLED` |
| 7 | `lateCancelRefused` | CONFIRMED → CONFIRMED (refused, no change) | customer | `cancelBooking`, "block" policy | auto ID |
| 8 | `reschedule` | CONFIRMED → CONFIRMED (new time) | customer | `reschedule` | auto ID |
| 9 | `start` | CONFIRMED → IN_SERVICE | staff | `functions/service.js` | `{id}_IN_SERVICE` |
| 10 | `finish` | IN_SERVICE → COMPLETED | staff | `functions/service.js` | `{id}_COMPLETED` |
| 11 | `noShow` | CONFIRMED → NO_SHOW | staff | `functions/service.js` | auto ID |
| 12 | `noShowReversed` | NO_SHOW → CONFIRMED | staff | `functions/service.js` | auto ID |

## 3. Transitions arriving with the chain PRs (from the `prototype` tag)

| PR | Action | From → to | Actor | Where |
|---|---|---|---|---|
| PR-15 deposits | `confirm` (payment webhook) | PENDING_PAYMENT → CONFIRMED | system | `functions/payments.js` |
| PR-15 deposits | `paymentFailed` | PENDING_PAYMENT → EXPIRED | system | `functions/payments.js` |
| PR-15 deposits | `expire` | PENDING_PAYMENT → EXPIRED | system | `functions/payments.js` |
| PR-16 waitlist | `offer` | none → HELD (waitlist offer) | system | `functions/waitlist.js` |
| PR-17 queue | none | walk-in queue entries (`waiting`, `in_service`, `done`, `removed`) | staff | `functions/queue.js` |

Each PR's reviewer checks that its transitions write the record above in the same transaction.

## 4. Open points

1. **Walk-in queue (PR-17).** `queue.js` writes no audit records. Queue entries are not appointments, so this depends on whether a walk-in counts as a booking under NFR-08. To decide before PR-17 merges.
2. **Reschedule records only the status** (CONFIRMED → CONFIRMED). The old and new start times are not in the record, so the record does not show what changed. Proposed: add `fromStart` and `toStart` to the reschedule record.
3. **Holds have no actor ID.** The hold comes before the OTP (order HELD → OTP → CONFIRMED), so `actorUid` is null with role `customer`. To be stated as a known limit, not fixed.
4. **Rules test (with Alson).** Add to `tests/rules.test.mjs`: a customer, a barber of another shop and an anonymous client cannot read, create, update or delete `auditLog`; a barber or owner of the shop can read only.
5. **Coverage test.** An emulator test that runs each transition in section 2 and checks exactly one new record with the right `fromStatus`, `toStatus`, `actorUid` and `role`, and `expireAt` 12 months after `at`.
6. **TTL policy.** `expireAt` only deletes records if the TTL policy on `auditLog.expireAt` is turned on in the console. To check on `fresher-6d857` and record in `docs/deployment.md`.
7. **Fixed record IDs** (`{id}_HELD`, `{id}_EXPIRED` and so on) are written with `set`, so a second write to the same ID would replace the first. Each one should happen at most once per booking; the coverage test should confirm it.
