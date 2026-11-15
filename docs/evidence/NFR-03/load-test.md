# NFR-03 Booking integrity under load

Requirement (docs/requirements.md, NFR-03): 50 simultaneous valid requests for the same barber and slot,
exactly one succeeds; across 1,000 test booking transactions, zero double bookings for the same barber and
overlapping period; repeated submission of the same request does not create duplicates.

| Criterion | Test | Result |
|---|---|---|
| 50 simultaneous holds on one barber and slot: exactly one succeeds | `tests/concurrency.test.mjs` (PR-19) | See PR-19 |
| 1,000 booking transactions: zero double bookings | `tests/nfr03.load.test.mjs` (this PR) | **Pass: 1,400 transactions, 0 double bookings** |
| Repeated submissions create no duplicates | `tests/concurrency.test.mjs`, 100 submissions of one requestId (NFR-05, PR-19 / #40) | See PR-19 / #40 |
## Method (`tests/nfr03.load.test.mjs`)

Runs against the Auth, Functions and Firestore emulators, calling the real `holdSlot` and `releaseHold`
callables over HTTP, in a throwaway shop that is deleted afterwards.

- Shop with 10 barbers and a 30-minute service; requests over 3 days, starts 09:00 to 17:45 every 15 minutes,
  so neighbouring requests overlap and many race for the same time.
- Phase 1: 1,000 holds, 25 in flight at once, 10% of them "any available barber".
- Phase 2: 100 releases of won holds racing 300 new holds into the same days.
- After each phase it reads every barber-day schedule and checks: no overlapping intervals for any barber
  (half-open); one interval and one HELD appointment per successful hold; every refusal is SLOT_TAKEN.
- Emulator connection drops are retried with the same requestId and never counted as results.
## Run (10 Nov 2026, 01:16 SGT, Windows laptop, Node 24, emulators)

- Phase 1: 1,000 requests; 402 succeeded, 598 refused (all SLOT_TAKEN); 61.5 s at 25 in flight; 0 double bookings.
- Phase 2: 100 releases; 300 new holds requested, 39 succeeded; 0 double bookings.
- Total: 1,400 booking transactions. tests 2, pass 2, fail 0, skipped 0 (82.3 s).

## Result

Pass. Zero double bookings across 1,400 booking transactions; every successful hold had exactly one schedule
interval and one HELD appointment, and every refused request was a clean SLOT_TAKEN.

## Limits

The emulators run on one laptop, so this shows correctness under contention, not production throughput.
Production Firestore uses the same transaction semantics.