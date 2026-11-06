# NFR-04 App Check: preview channel check

Checked on 6 Nov 2026 by Alson, from branch `fix/nfr-04-app-check` at `4d8b9c4` (includes main up to PR-15).
Decision A17, limitation L1. Steps from "Turning App Check on" in `docs/deployment.md`.

## Setup

| Item | Value |
|---|---|
| Project | `fresher-6d857` |
| Preview channel | `https://fresher-6d857--demo-xnw59pvz.web.app` (expires 13 Nov 2026) |
| Web build | `VITE_APP_CHECK_ENABLED` not set (default on), site key from `.env.local` (not committed) |
| Functions | deployed 6 Nov 2026 15:38 SGT with no `APP_CHECK_ENFORCE=false`, so every callable sets `enforceAppCheck: true` |
| Firestore and Auth enforcement | off (unchanged, L1) |

## Results

| Check | Expected | Result | Evidence |
|---|---|---|---|
| Direct call to `holdSlot` without an App Check token | Rejected before the function runs | **Pass.** HTTP 401. Function log: `"verifications":{"app":"MISSING"}`; with `enforceAppCheck: true` the SDK then throws `unauthenticated`. Without enforcement the same empty request would reach `holdSlot` and return 400 `invalid-argument` (missing `requestId`), so the 401 comes from App Check | `appcheck-401.png`, `appcheck-log.png` |
| Callable requests from the app carry `X-Firebase-AppCheck` | Header present | PENDING | `appcheck-holdslot.png` |
| `holdSlot` from the app (book a slot) | Works | PENDING | `appcheck-holdslot.png` |
| `releaseHold` from the app | Works | PENDING | |
| `addBarber` as a shop owner | Works | PENDING | `appcheck-addbarber.png` |
| `createBlock` as a barber | Works | PENDING | `appcheck-createblock.png` |

Screenshots show no token or key values.

## Outcome

Enforcement is confirmed: a client without an App Check token is rejected. L1 is resolved once the app's own calls are confirmed to work on the preview channel (the rows above marked PENDING).