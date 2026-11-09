# NFR-01 performance evidence

Story owner Firas. Every measurement below was made on **Sun 8 Nov 2026** on `main` at **`2af028d`**, unless the row says otherwise. The results after the fixes in PR #39 were measured on **Mon 9 Nov 2026** (see [After the fixes](#after-the-fixes-9-nov-2026)). Scripts and raw results are in `~/fresher-audit` (outside the repo): `nfr01-map.mjs`, `nfr01-lighthouse.sh`, `nfr01-layout-flow.mjs`, and `results/`.

NFR-01 asks for four things:
- the customer booking flow loads within 3 seconds on 4G;
- customer-facing pages score at least 85 on Lighthouse mobile performance;
- no page in the core booking flow scrolls sideways or has overlapping or unreachable controls, at any width;
- every booking function available on desktop is usable on mobile.

The team plan adds: no frames over 50 ms while scrolling.

## Summary

| Check | Result |
|---|---|
| a. Scroll lag | **Met on this setup** (median 0 frames over 50 ms; 1 of 3 runs had one 66.7 ms frame). Smooth on a real iPhone 13 Pro; touch swipes starting on a loaded map not measured |
| b. Lighthouse at least 85 | **Met on all four pages with #39.** Shop page 92 (was 79), landing 99, My bookings 92, waitlist 92 |
| c. Loads within 3 s on 4G | **FCP and Speed Index met on all four pages. LCP not met** on the shop page (3.21 s after #39), My bookings (3.17 s) and waitlist (3.17 s), under Lighthouse's simulated slow 4G with 4x CPU. Recorded as a limitation |
| d. No sideways scrolling or covered controls | **Met at all widths with #39.** The 320 px sideways scroll on the landing page and results is fixed; every other page and width already passed |
| e. Every booking function usable on mobile | **Met:** all 10 functions passed at 390 px |

Issues 1 and 2 are fixed in PR #39; see [After the fixes](#after-the-fixes-9-nov-2026). Issue 3 (LCP) remains a limitation. All three are listed under [Issues](#issues).

---

## a. Scroll lag (known issue)

**Page and steps.** The landing page (`/`) after searching postal code 160055 (8 shops). Then a wheel scroll from the top to the bottom and back: 120 px steps about every 16 ms, which passes the results, the "Barbers across Singapore" map section as it loads, and "Why Fresher".

**Setup.**
- Vite dev server on port 5173 (not a production build), against the Firebase emulators seeded with `npm run seed`, with the real Google map rendering (35 markers).
- Headless Chromium (Playwright) at 390x844, with Chrome DevTools tracing and 4x CPU throttling.
- 3 runs; medians reported.
- Frame times come from `requestAnimationFrame` timestamps, and long tasks from the trace.

### Before (current behaviour, `2af028d`)

| Measure (median of 3) | Result |
|---|---|
| Long tasks over 50 ms during the scroll | 1, about 60 ms (59–63 ms; 1, 1 and 2 per run), when Google's script is evaluated |
| Frames over 50 ms | 0 (1, 0 and 0 per run) |
| Average frame time | 17.5 ms |
| Longest frame | 50 ms |
| When the map loads | `ShopMapSection` requested 618 ms and Google's script 655 ms into a 3.2 s scroll, while the page is moving |

On the same day, the shop page (with services, barbers and the slot list) and My bookings (after OTP) had **0 long tasks, 0 forced layouts and every frame at 16.7 ms**. That was in the same setup on port 5180, where the map does not load. No app code adds non-passive scroll, wheel or touch listeners, and nothing expensive is painted while scrolling: no `backdrop-filter`, sticky or fixed elements apart from the dev-only Vue DevTools overlay, and no large images.

### Fix tried and dropped: load the map only after scrolling has been idle for 150 ms

The map section's load was made to wait until the placeholder was on screen and scrolling had been idle for about 150 ms (passive `scroll` and `scrollend` listeners, and a timer). Same setup, 3 runs, median:

| Measure | Before | Deferred load (dropped) |
|---|---|---|
| Long tasks over 50 ms during the scroll | 1 (59–63 ms) | 1 (61–67 ms) |
| Frames over 50 ms | 0 | 1 |
| Average frame time | 17.5 ms | 17.8 ms |
| Longest frame | 50 ms | **66.6 ms** |
| `ShopMapSection` requested | 618 ms, mid-scroll | 1,207 ms, 150 ms into the pause at the bottom |

The map still loaded correctly:
- when scrolled to and stopped (410 ms after the stop);
- with no scrolling, when already on screen in a 390x2400 window (406 ms);
- when reached with Tab only.

Lighthouse on `/` stayed at 99, and the DiscoverView chunk grew from 17.68 kB to 18.06 kB.

**Why it was dropped:**
- The deferred request goes out after the short pause at the bottom.
- Google's script work then runs about 250 ms later, once the download finishes, which is when scrolling back up has already started.
- In all three runs the task still landed mid-scroll or just as scrolling resumed, and the longest frame rose to 66.6 ms.

**Preload alternative, not taken.** Downloading Google's script and the map chunk earlier, while the user is idle after the results appear, was considered and not taken, because:
- it changes decision A20 ("the Google script is never requested before the section is on screen");
- it moves the same task to the time the results are being scrolled;
- its gain is uncertain.

**Conclusion.** The landing page **meets "no frames over 50 ms while scrolling" on this setup**: median 0, although 1 of 3 runs had one 66.7 ms frame. The shop page and My bookings show no jank.

**Residual risk (not measured).** Touch swipes that start on the map, on real phones. Google Maps registers non-passive `touchstart` and `touchmove` listeners on the map, so a swipe starting on the 22rem-tall map waits for the main thread, which is busy while the map loads.

**Real-phone check, 8 Nov, iPhone 13 Pro, Chrome, on the preview channel:** scrolling the landing page and search results was smooth with no visible stutter. That build has no Maps key, so the map section showed its list fallback and the map-loading moment could not be tested on a phone. Touch swipes starting on a loaded map remain an unmeasured risk. Chrome on iOS uses WebKit, so this also stands in for Safari on iPhone.

---

## b. Lighthouse mobile performance (target at least 85)

**Setup.**
- Lighthouse 12.8.2, mobile form factor, performance only, simulated throttling: 150 ms RTT, 1.6 Mbps, 4x CPU, which is Lighthouse's "slow 4G".
- Headless Chromium, 5 runs per page, median, as in the team plan and the A20 measurement.

**What was measured, and why.**
- **The local production build** (`npm run build`, then `vite preview` on port 4180) was used for all four pages. With the A17 demo flags it reads the live project's seeded data (for example Kopi & Clippers with 4 services) without App Check errors.
- **The preview channel** (`https://fresher-6d857--demo-xnw59pvz.web.app/`) was checked first but not used:
  - it is an older deploy than `main`: `/waitlist` there shows the "Staff sign in" placeholder;
  - every page logged App Check 403 errors;
  - its postal search returned no results;
  - its shop page never finished loading (the page load timed out after 45 s).

| Page | Runs (5) | Median score | Result | Notes |
|---|---|---|---|---|
| `/` (landing) | 99, 99, 99, 99, 99 | **99** | Pass | TBT 0 ms, CLS 0.004 |
| `/shops/shop-tiong-bahru` | 79, 78, 79, 79, 78 | **79** | **Fail** | CLS 0.259, mostly one shift (0.228) of the first step fieldset when the services arrive from Firestore. The LCP element is the shop name `<h1>`, with 2.75 s of render delay while the shop document loads |
| `/my-bookings` | 93, 91, 92, 91, 92 | **92** | Pass | LCP element is the prototype note, about 2.7 s of render delay |
| `/waitlist?shop=…&service=…&date=…` | 92, 93, 92, 91, 93 | **92** | Pass | LCP element is the intro line, about 2.7 s of render delay |

**Not measured:** verify, Booking confirmed and deposit. They need state that can't be reached by URL (a live hold, a just-confirmed booking, a pending deposit with its signed-in customer), so no score is given for them.

An earlier 3-run set on the same build gave 99, 78, 92 and 92. The shop page's CLS (0.259) is the same in both sets. See issue 2 under [Issues](#issues).

---

## c. Loads within 3 s on 4G

These are from the same Lighthouse runs, as medians of 5.

**Throttling profile.** Lighthouse 12's default mobile profile, simulated rather than applied to the network:
- 150 ms round-trip time;
- 1.6 Mbps down (1,638.4 kbps) and 675 kbps up;
- 4x CPU slowdown.

Lighthouse calls this "slow 4G". It is harsher than typical 4G, which usually has lower latency and much more bandwidth. The verdicts below are as measured under this profile.

| Page | FCP | LCP | Speed Index | Within 3 s? |
|---|---|---|---|---|
| `/` | 1.54 s | 1.69 s | 1.54 s | Yes |
| Shop page | 1.68 s | **3.20 s** | 1.68 s | **No (LCP)** |
| `/my-bookings` | 1.83 s | **3.17 s** | 1.83 s | **No (LCP)** |
| `/waitlist` | 1.68 s | **3.17 s** | 1.68 s | **No (LCP)** |

Every page shows content (FCP) and is visually complete (Speed Index) within 2 s. LCP is just over 3 s on three pages, in each case because the largest text waits about 2.7 s to render. Lighthouse also reports render-blocking resources (about 300 ms) and about 150–180 KiB of unused JavaScript on those pages. These are simulated, not measured on a phone over 4G.

---

## d. No sideways scrolling and no covered controls

**Setup.**
- Vite dev server on port 5173 with the emulators.
- Each screen reached through the real flow:
  - booking with test number +65 9000 0201;
  - waitlist with +65 9000 0202;
  - deposit with +65 8000 0101, the seeded showcase customer with two no-shows at Sharp Edge Studio (`demo-15-pasir-ris`). The deposit step only appears for such a customer, so a +65 9000 02xx number could not reach it.
- On each screen the window was resized to each width, with a height of 844, or 900 at 1280.

**Checks.**
- **Sideways scrolling:** `document.documentElement.scrollWidth <= clientWidth`.
- **Covered controls:** every visible button, input, select, textarea and `a.btn` (for visually hidden radios and checkboxes, their label) was scrolled to the centre of the window, and `elementFromPoint` at its centre had to return the control or something inside it.

| Page | 320 | 375 | 390 | 768 | 1280 |
|---|---|---|---|---|---|
| Landing (before search) | **Fail** | Pass | Pass | Pass | Pass |
| Results (160055) | **Fail** | Pass | Pass | Pass | Pass |
| Shop page (service, barber, date, slots) | Pass | Pass | Pass | Pass | Pass |
| Verify (details step) | Pass | Pass | Pass | Pass | Pass |
| Booking confirmed | Pass | Pass | Pass | Pass | Pass |
| My bookings (after OTP) | Pass | Pass | Pass | Pass | Pass |
| Waitlist (join form) | Pass | Pass | Pass | Pass | Pass |
| Deposit (mock checkout) | Pass | Pass | Pass | Pass | Pass |

No control was covered on any page at any width.

**The 320 px failure** is sideways scrolling only. The page is 338 px wide in a 320 px window. The customer header's nav, which shows "My bookings" and "For barbers" on the landing page, ends at 338 px: the "For barbers" link spans 251–338 px. A fresh load at 320 px gives the same result. Other pages show fewer header links and pass. See issue 1 under [Issues](#issues).

---

## e. Every booking function usable on mobile (390 px)

Same run as section d, on the dev server with the emulators.

| Function | Result | Notes |
|---|---|---|
| Search | Pass | Postal code 160055, "8 shops found." |
| Open shop | Pass | Kopi & Clippers from the results |
| Choose service, barber and slot | Pass | Gents haircut, barber Meng, Tue 10 Nov, 10:30 AM |
| OTP | Pass | Code sent to +65 9000 0201 and entered (the code is read from the Auth emulator; no SMS) |
| Confirm | Pass | "Booking confirmed", Tue 10 Nov, 10:30 AM |
| Reschedule | Pass | In My bookings after a new OTP: "Your booking was moved." |
| Cancel | Pass | "Your booking was cancelled and the time was released." |
| Join the waitlist | Pass | From the shop page's "Join the waitlist for this date" link on a closed Monday (9 Nov), after OTP on +65 9000 0202: "You are on the waitlist for Mon, 9 Nov…"; entry stored as `waiting` |
| Deposit step | Pass | +65 8000 0101 booking at Sharp Edge Studio went to PENDING_PAYMENT and `/deposit/…` with "Mock checkout". "Pay S$13.00 (mock)" then showed "✓ Confirmed. Payment received. Your booking is confirmed." |

No console errors from app code during the run.

---

## After the fixes (9 Nov 2026)

Issues 1 and 2 were fixed in PR #39 (`fix/nfr-01-mobile-layout`, commit `33f0873`):
- **Header (`src/assets/main.css`).** The customer header may now wrap. At 320 px the links move to a second row under the logo. At 375 px and wider it never wraps, and the header and link positions are identical to before.
- **Shop page (`ShopView.vue`).** While the services load, the list shows 4 placeholder rows built from the same row markup, so they are the same height as loaded rows (72 px). The address line under the shop name is also reserved until the shop loads; on its own it caused a 0.031 shift. The loaded design is unchanged.

**Lighthouse setup.** Same as section b: Lighthouse 12.8.2 mobile, simulated slow 4G with 4x CPU, 5 runs per page, median. "Before" is a production build of `main` at `6c69309`, re-measured on the same day; "after" is a production build of `33f0873`. Both were served with `vite preview` on port 4180.

| Page | Measure | Before (`6c69309`) | After (#39) |
|---|---|---|---|
| `/shops/shop-tiong-bahru` | Performance (5 runs) | 79, 92, 76, 79, 79 → **79** | 91, 91, 92, 92, 92 → **92** |
| | CLS (median) | **0.259** (one run 0.032) | **0.000** (all 5 runs) |
| | LCP / FCP (median) | 3.20 s / 1.76 s | 3.21 s / 1.61 s |
| `/` (landing) | Performance (5 runs) | 99 ×5 → **99** | 99 ×5 → **99** |
| | CLS / LCP (median) | 0.004 / 1.69 s | 0.004 / 1.69 s |

**Sideways scrolling.** Measured as in section d (`scrollWidth <= clientWidth`, and the covered-controls check), on the dev server with the emulators, on the landing page and results:

| Width | Before | After (#39) |
|---|---|---|
| 320 | **Fail** (338 px wide) | Pass (320 px) |
| 375, 390, 768, 1280 | Pass | Pass, header unchanged |

No control was covered at any width.

**Limits of the fixes.**
- **Shops with more than 4 services still shift a little.** The shop document does not record how many services a shop has, so the page reserves 4 rows. On a 6-service shop (`demo-01-raffles-place`) the dev server measured CLS 0.048, under the 0.1 "good" threshold. The shop page measured above has exactly 4 services.
- **LCP stays about 3.2 s** on the shop page (3.21 s after the fix), as before. It remains a recorded limitation (issue 3).
- My bookings and the waitlist were not re-run. #39 does not change those pages; their scores (92 and 92) are from section b.

---

## Issues

| # | Issue | Proposed fix | Owner | Status |
|---|---|---|---|---|
| 1 | 320 px sideways scroll on the landing page and results: the customer header's nav ("My bookings", "For barbers") ends at 338 px in a 320 px window (section d) | Let the header nav fit at 320 px, for example a smaller gap or wrapping below 360 px, with no visible change at 375 px and up | Firas (`CustomerHeader.vue`, `src/assets/main.css`) | **Fixed in PR #39**: the header wraps at 320 px |
| 2 | Shop page Lighthouse 79: CLS 0.259, almost all one shift (0.228) of the services fieldset when the services arrive from Firestore (section b) | Reserve the fieldset's space before the data arrives, for example a minimum height or placeholder rows while the services load | Haziq's file (`ShopView.vue`, FR-02): Firas to propose, Haziq to approve | **Fixed in PR #39**: 4 placeholder rows and a reserved address line; score 92, CLS 0.000 (0.048 on a 6-service shop) |
| 3 | LCP about 3.2 s on the shop page, My bookings and waitlist: the largest text waits about 2.7 s for Firestore data or the route's chunk (section c) | None this sprint. Recorded as a limitation | — | Open, limitation |

## Limits

- **Simulated, not real devices.** Everything ran in headless Chromium on a Mac: CPU throttling and Lighthouse's simulated 4G, not a phone on a 4G network.
- **Scroll test.** The scroll test uses mouse-wheel events, not touch.
- **Build types.** The scroll traces used the dev server; Lighthouse used a production build.
- **Lighthouse data.** The Lighthouse pages read the live project's seeded data through the production config. Sections d and e used the emulators.
- **Pages without Lighthouse scores.** Verify, Booking confirmed and deposit have none (see b).
