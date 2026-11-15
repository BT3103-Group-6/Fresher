# NFR-04 App Check: deployed check

Enforcement first checked on 6 Nov 2026 on the preview channel; the in-app checks done on 10 Nov 2026 by Alson on
the live site, which runs the same build settings as the preview channel. Decision A17, limitation L1 (resolved).
Steps from "Turning App Check on" in `docs/deployment.md`.

## Setup

| Item | Value |
|---|---|
| Project | `fresher-6d857` |
| Live site | `https://fresher-6d857.web.app`, deployed 10 Nov 2026 from `fix/nfr-04-app-check` at `8218bae` (main + App Check on) |
| Preview channel | `https://fresher-6d857--demo-xnw59pvz.web.app`, same build settings |
| Web build | `VITE_APP_CHECK_ENABLED` not set (default on), site key from `.env.local` (not committed) |
| Functions | deployed 10 Nov 2026 with no `APP_CHECK_ENFORCE=false`, so every callable sets `enforceAppCheck: true` |
| reCAPTCHA key domains | `fresher-6d857.web.app`, `fresher-6d857.firebaseapp.com` and the preview channel host |
| Firestore and Auth enforcement | off (unchanged; see L1 remaining limits) |

## Results

| Check | Expected | Result | Evidence |
|---|---|---|---|
| Direct call to `holdSlot` without an App Check token | Rejected before the function runs | **Pass.** HTTP 401 (6 Nov on the preview channel; again 10 Nov on the live site). The function log shows `"verifications":{"app":"MISSING"}`; without enforcement the same empty request would reach `holdSlot` and return 400 `invalid-argument`, so the 401 comes from App Check | `appcheck-401.png` |
| App Check token exchange (`exchangeRecaptchaEnterpriseToken`) | 200 | **Pass.** 200 | `appcheck-exchange.png` |
| Callable requests from the app carry `X-Firebase-AppCheck` | Header present | **Pass.** Present on `holdSlot` | `appcheck-holdslot.png` |
| `holdSlot` from the app (book a slot) | Works | **Pass.** 200, slot held | `appcheck-holdslot.png` |
| `releaseHold` from the app | Works | **Pass.** 200, hold released | `appcheck-releasehold.png` |
| `addBarber` as a shop owner | Works | **Pass.** 200, barber added (then deactivated) | `appcheck-addbarber.png` |
| `createBlock` as a barber | Works | **Pass.** 200, block saved (then removed) | `appcheck-createblock.png` |

Screenshots show no token or key values.

## Outcome

App Check is on in the demo deployment: a client without a token is rejected, and the app's own calls work with
enforcement on. L1 is marked resolved in `docs/decisions.md` on 10 Nov 2026, with the remaining limits kept (no
per-client hold cap, Firestore and Auth enforcement off, no replay protection, and a new preview channel host must
be added to the key).

**History.** On 6 Nov the app's token exchange first returned 400 because the build's `VITE_FIREBASE_API_KEY` was
wrong (first snippet text, then the key pasted twice; both gave `API_KEY_INVALID`). Enforcement was rolled back
(`APP_CHECK_ENFORCE=false`) while debugging. Once the key was corrected and checked, the app was rebuilt, the
exchange returned 200, enforcement was switched back on and the functions redeployed; the 401 check was repeated
after that.
