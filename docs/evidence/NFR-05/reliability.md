# NFR-05 reliability and failure handling

Owner: K-Rei. Reviewer: Haziq.
Status: checks completed; ready for Haziq's review.
Recorded: 10 Nov 2026. PR: #40. Integration prerequisite: PR-19 / #43 (merged).

## Results

| Check | Method | Result |
|---|---|---|
| 100 repeated submissions create at most one appointment | Existing integration test against Auth, Functions and Firestore emulators | PASS: 100 calls using one request ID; exactly one appointment, audit record and schedule interval; identical successful responses |
| 100 simulated failed booking writes never appear successful | Actual VerifyView script and template rendered in memory with rejected confirmBooking calls | PASS: 100 injected failures; zero success screens; error displayed; draft name, phone and request ID retained; retry enabled |
| Successful confirmation and retry controls | Same Vue view with a successful mock response, and failure followed by success | PASS: success screen is rendered only on success; retry retains the request ID and does not repeat OTP verification |
| Connection-loss message within 3 seconds; form input retained | K-Rei's manual local-browser check | PASS as manually observed: offline message within approximately 3 seconds; entered name and phone remained |

## 1. Repeated-submission integration check

Test: `tests/concurrency.test.mjs`, suite `NFR-05 repeated submissions`.
Run on Windows PowerShell after merging #43 into the NFR-05 branch.

The test submits 100 simultaneous `holdSlot` calls with the same request ID and asserts all responses succeed and agree, with exactly one appointment, one audit record and one interval. This checks idempotent slot holds, not 100 completed OTP confirmations.

Result: 1 test passed, 0 failed, 0 cancelled, 0 skipped. Total run time: 86,425.143 ms.
Raw output: `docs/evidence/NFR-05/repeated-submissions.txt`.

Emulator startup for the successful run (a larger startup allowance was needed locally):

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
npx firebase-tools emulators:start --only auth,functions,firestore --project fresher-6d857
```

In a second PowerShell window:

```powershell
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
$env:GCLOUD_PROJECT = "fresher-6d857"
node --test --test-reporter=tap --test-name-pattern="NFR-05" tests/concurrency.test.mjs
```

Earlier attempts with no running emulators were cancelled during setup. Another attempt reported function-loading errors while workers started. Neither was counted as a pass. The final successful run still emitted a metadata lookup warning, but completed all assertions without failure or cancellation. No production function timeout or booking logic was changed.

## 2. Failed-write presentation simulation

Test: `tests/nfr05.failure.test.mjs`.

The test compiles the actual `src/views/customer/VerifyView.vue` script and template using Vue's bundled compiler and mounts it with Vue's in-memory renderer. Firebase, OTP and router boundaries are supplied by test doubles; production handlers and template conditions are not copied into the test.

The main test injects 100 rejected `confirmBooking` calls representing failed writes: 25 each of `functions/internal`, `functions/unavailable`, `functions/deadline-exceeded` and `functions/resource-exhausted`. It checks both the pending and rejected states: no premature success, an error after rejection, retained input and request ID, an enabled retry, no navigation and no unhandled render error.

Two additional tests provide controls: a successful response must render "Booking confirmed", and a rejected request followed by a successful retry must reuse the request ID and verified OTP. The recovery control injects one extra failure outside the main 100-case set.

Windows result reported by K-Rei: 3 tests passed, 0 failed, 0 cancelled, 0 skipped; total 916.524 ms. The same three tests also passed independently during test preparation.
Raw Windows output: `docs/evidence/NFR-05/failed-writes.txt`.

```powershell
node --test --test-reporter=tap tests/nfr05.failure.test.mjs
```

Scope: this is failure injection at the callable boundary to verify UI behaviour. It does not cause 100 real Firestore commit failures, verify database rollback or exercise a browser's real network stack. The repeated-submission check above uses the actual emulators. No emulator or additional dependency is required for this simulation.

## 3. Manual connection-loss observation

On the local Verify and confirm details page, K-Rei entered a name and test mobile number, disconnected Wi-Fi before sending the OTP, and observed the offline message within approximately 3 seconds. The name and phone remained populated, including after reconnection. The offline confirmation button was disabled, as expected.

This was a manual observation, not an instrumented timing measurement. No screen recording is attached. It does not establish behaviour when connectivity disappears during an in-flight write; the automated rejected-call simulation covers the presentation of failed confirmation calls.
