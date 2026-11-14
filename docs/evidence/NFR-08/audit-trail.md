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

## 3. Transitions added by PR-15 to PR-17

| PR | Action | From → to | Actor | Where |
|---|---|---|---|---|
| PR-15 deposits | `confirm` (payment webhook) | PENDING_PAYMENT → CONFIRMED | system | `functions/payments.js` |
| PR-15 deposits | `paymentFailed` | PENDING_PAYMENT → EXPIRED | system | `functions/payments.js` |
| PR-15 deposits | `expire` | PENDING_PAYMENT → EXPIRED | system | `functions/payments.js` |
| PR-16 waitlist | `offer` | none → HELD (waitlist offer) | system | `functions/waitlist.js` |
| PR-17 queue | none | walk-in queue entries (`waiting`, `in_service`, `done`, `removed`) | staff | `functions/queue.js` |

Each PR's reviewer checks that its transitions write the record above in the same transaction.

## 4. Open points

1. **Walk-in queue (PR-17).** `queue.js` writes no audit records. Queue entries are not appointments, so this depends on whether a walk-in counts as a booking under NFR-08. PR-17 merged on 8 Nov without audit records; to decide at the Sprint 2 review.
2. **Reschedule records only the status** (CONFIRMED → CONFIRMED). The old and new start times are not in the record, so the record does not show what changed. Proposed: add `fromStart` and `toStart` to the reschedule record.
3. **Holds have no actor ID.** The hold comes before the OTP (order HELD → OTP → CONFIRMED), so `actorUid` is null with role `customer`. To be stated as a known limit, not fixed.
4. **Rules test: done (#31).** `tests/nfr08.rules.test.mjs` (9 tests), kept separate from `tests/rules.test.mjs`.
5. **Coverage test: done (#31).** `tests/nfr08.audit.emulator.test.mjs` (35 tests) runs every transition in sections 2 and 3.
6. **TTL policy.** `expireAt` only deletes records if the TTL policy on `auditLog.expireAt` is turned on in the console. To check on `fresher-6d857` and record in `docs/deployment.md`.
7. **Fixed record IDs** (`{id}_HELD`, `{id}_EXPIRED` and so on) are written with `set`, so a second write to the same ID would replace the first. Each one should happen at most once per booking; the coverage test should confirm it. Confirmed by the coverage test: replays and refused actions write nothing.

## 5. Status and test totals

Rules and coverage tests merged in #31. 44 / 44 passing against the Firestore emulator, 9 Nov 2026 (15 suites):
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/nfr08.rules.test.mjs tests/nfr08.audit.emulator.test.mjs
Still open: walk-in scope (point 1), reschedule start times (point 2), TTL policy check (point 6). Accepted limit: point 3.
