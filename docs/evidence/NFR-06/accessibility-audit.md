# NFR-06 accessibility evidence

Story owner Firas. Audit run Mon 26 Oct 2026 on `main` at `2a37612`. Fixes merged in PR #14 on Wed 28 Oct 2026 (commit `abdaa83`) and in PRs #21, #23 and #24. Re-run Fri 6 Nov 2026 on `main` at `c485d23` (see [Re-run, 6 Nov 2026](#re-run-6-nov-2026)).

## Summary

The first audit covered sign-in, shop configuration, the service form, the barber form and the customer shop page. axe-core found no violations in the app's own code on any of them. Manual checks found 6 issues, none critical or serious (3 moderate, 3 minor), and all of them concern error messages and ARIA references rather than focus, labels or contrast. Issues 1, 2 and 5 were in the barber form and have been fixed and checked in the browser. Issues 3 and 4 were fixed in #21, #23 and #24 and re-checked on 6 Nov. Issue 6 is optional. The 6 Nov re-run found 4 new issues (7 to 10) on screens merged since, none critical or serious. A VoiceOver pass on the guest booking flow on 9 Nov read every field label but announced none of the verify errors and not the booking confirmation, which confirms issues 7 and 10 (see [Screen reader pass](#screen-reader-pass-voiceover-safari-macos-9-nov-2026)).

## Method

- axe-core (`@axe-core/playwright` 4.11.0, tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa and best-practice) on each screen, before and after triggering validation errors, at 390x844 and 1280x900.
- A Tab walk on every screen to record each focus stop, with a focus ring counted as visible when a screenshot of the element changes between focused and blurred. A Tab-only walk looked for traps, and arrow keys were checked in the radio groups.
- The accessible name of every visible input, select and textarea.
- Every form submitted empty, to check each error's text, whether it is linked to its field with `aria-describedby`, and where focus ends up.
- Text contrast through axe, and input and indicator borders computed from styles against a 3:1 target.

## What passed

- axe reported 0 violations in app code on all five screens, with and without errors showing.
- Every Tab stop has a visible focus ring (3px `#0D3B38`, 12.35:1 on white), including the custom checkbox and radio cards.
- Tab order follows the visual order and reaches every control. There is no keyboard trap.
- Every control has a label.
- No axe contrast failures. Input borders are `#6B7C7A`, 4.38:1 on white, and invalid fields switch to a 2px `#A3261F` border.
- Error messages name the field, for example "Enter a service name." and "Choose at least one service."

axe also flagged `aria-prohibited-attr` and `region` on `.panel-entry-btn`. That is the Vue DevTools overlay from the dev server, not app code, so it is excluded here and from later runs.

## Issues and status

| # | Screen | Problem | Impact | Owner | Status |
|---|---|---|---|---|---|
| 1 | Barber form | "Choose at least one service." was not linked to its fieldset | Moderate | Firas | Fixed in #14 |
| 2 | Barber form | The working-hours error was not linked to its fieldset | Moderate | Firas | Fixed in #14 |
| 3 | Sign-in, service form, barber form | Errors appear silently, with no live region and no focus move | Moderate | Haziq (sign-in), Francis (service form), Firas (barber form) | Fixed: focus moves to the first invalid field, in #21 (service form), #23 (sign-in) and #24 (barber form). Re-checked 6 Nov |
| 4 | Service form | `#svc-dur` points `aria-describedby` at an id that does not exist until an error shows | Minor | Francis | Fixed in #21. Re-checked 6 Nov |
| 5 | Barber form | `#b-pass` pointed at `b-pass-err` before that element existed | Minor | Firas | Fixed in #14 |
| 6 | Barber form | A full week of time inputs takes about 60 Tab presses | Minor | Firas | Not planned. Check with NFR-02 first |

## What PR #14 changed

Only `src/views/staff/BarberForm.vue` changed, with 5 lines added and 5 removed. The services and working-hours fieldsets now carry `aria-describedby` pointing at their error span (`b-svc-err` and `b-hours-err`), but only while that error is showing. The password input points at `b-pass-hint` alone until its error appears, and then at both `b-pass-hint` and `b-pass-err`.

## How the fix was checked

Checked by hand in Chrome against the Firebase emulators on Tue 27 Oct 2026.

- Services error. With nothing ticked, saving showed "Choose at least one service." and DevTools showed `aria-describedby="b-svc-err"` on the fieldset with a matching `id` on the span.
- Working-hours error. A Monday start of 06:00 PM with an end of 09:00 AM showed "Check the hours for Mon: start must be before end." and the fieldset pointed at it.
- Password error. A short password showed "Temporary password must be at least 8 characters." The input had `aria-invalid="true"` and `aria-describedby="b-pass-hint b-pass-err"`, and both ids existed.
- No error showing. In edit mode, the services fieldset had no `aria-describedby` at all, so nothing points at a missing element.
- Add and edit both saved correctly.
- Lighthouse accessibility scored 96. The one failing audit was `div.vue-devtools__anchor-btn`, the dev-only overlay already excluded above.
- `npm run test:rules` gave 169 passing and 0 failing. No automated test covers the form, so the browser checks above are the evidence for this fix.

## Still to do

- Fix issues 7 to 10 with their owners, using the same "focus the first invalid field on submit" pattern as #21, #23 and #24:
  - Issue 7, guest verify errors: Haziq (FR-03, `VerifyView`).
  - Issue 8, My bookings errors: Alson (FR-04, `MyBookingsView`).
  - Issue 9, Schedule block-form errors: Francis (FR-08, `ScheduleView`).
  - Issue 10, Booking confirmed focus and announcement: Haziq (FR-03, `VerifyView`).
- **Issues 7 and 10 block an accessible booking for screen-reader users** and are recommended for a fix before the code freeze. Use the same pattern as #24 (focus the first invalid field on submit), plus moving focus to the confirmation heading when Booking confirmed appears.
- Do a manual screen-reader pass (VoiceOver) on the booking flow: **done 9 Nov** (see [Screen reader pass](#screen-reader-pass-voiceover-safari-macos-9-nov-2026)). It confirmed issues 7 and 10. My bookings was not covered.
- Run axe on the staff Queue screen once #30 is merged (skipped on 6 Nov).
- Run axe's "needs review" results, which the first audit did not record.
- Dev login hint in the production bundle: found 29 Oct, fixed by #25 (merged 2 Nov). Re-check with `npm run build` and `grep -r owner@shop-jurong dist/` on the final deploy build.

## Re-run, 6 Nov 2026

Run Fri 6 Nov 2026 on `main` at `c485d23` (after #32), against the Firebase emulators seeded with `npm run seed`, on a dev server at port 5180. The script is in `~/fresher-audit` (`audit-rerun.mjs`), outside the repo; no dependency was added to the repo.

**Method:** the same as 26 Oct.
- axe-core with the same tags, at 390x844 and 1280x900.
- The Vue DevTools overlay excluded.
- Each form checked before and after an empty or invalid submit.
- A Tab walk with the screenshot focus check, and the accessible name of every control.
- Each error's text, its `aria-describedby` link, and where focus ends up.

**Screens:**
- landing and discovery (search 160055, 8 shops);
- the shop page (Kopi & Clippers);
- guest verify (details step, code step and Booking confirmed);
- My bookings (phone step, code step, the list, and the reschedule panel);
- the staff Schedule screen (signed in as the `shop-jurong` owner).

**Not covered:** the staff Queue screen was skipped, because #30 is not on `main` yet.

### Results per screen

The results were the same at both widths.

| Screen | axe before / after errors | Tab walk | Errors on empty or invalid submit | Focus after submit |
|---|---|---|---|---|
| Landing | 0 / 0 | 73 stops, all with a visible ring, no repeats | "Enter a 6-digit Singapore postal code." linked to `#postal`, in a `role="alert"` span | Stays on Search (the error is announced by the alert) |
| Discovery (160055) | 0 | 89 stops, all visible | — | — |
| Shop page | 0 / 0 | 5 stops, all visible (each radio group is one stop; arrow keys not re-checked) | "Choose a service." and "Choose a time.", each linked to its fieldset, `role="alert"` | Stays on Continue (announced by the alert) |
| Verify, details | 0 / 0 | 6 stops, all visible | "Enter your name." and "Enter your mobile number.", linked to `#name` and `#phone` | Stays on Send code, no live region (**issue 7**) |
| Verify, code | 0 / 0 | 6 stops, all visible | "Enter the 6-digit code." linked to `#code` | Stays on Confirm booking, no live region (**issue 7**) |
| Booking confirmed | 0 | 3 stops, all visible | — | Focus is left on the page body (**issue 10**) |
| My bookings, phone | 0 / 0 | 5 stops, all visible | "Enter your mobile number." linked to `#phone` | Stays on Send code, no live region (**issue 8**) |
| My bookings, code | 0 / 0 | 6 stops, all visible | "Enter the 6-digit code." linked to `#code` | Stays on Verify, no live region (**issue 8**) |
| My bookings, list | 0 | 6 stops, all visible | — | — |
| My bookings, reschedule | 0 / 0 | — | "Choose a new time." linked to its fieldset | Stays on Move booking, no live region (**issue 8**) |
| Staff Schedule | 0 / 0 | All stops visible; no trap (see below) | "Choose a start time." and "Choose an end time.", linked to `#f-start` and `#f-end` | Stays on Block this time, no live region (**issue 9**) |

**On every screen:**
- every control has a label;
- every input border is at least 3:1;
- no `aria-describedby` points at a missing id.

**Schedule Tab walk.** The screenshot walk repeated the date field (`#day`) 115 times. That is the walker's blur-and-refocus resetting the date input to its first part, as with the time inputs on 26 Oct. A Tab-only walk confirmed there is no trap. Each date field takes 4 Tab presses (day, month, year and the picker button), and focus wraps back to the top after 21 presses at 390px and 24 at 1280px.

**Issues 3 and 4 re-checked:**
- **Sign-in:** an empty submit puts focus on `#email`.
- **Service form:** an empty submit puts focus on `#svc-name`, and `#svc-dur` points only at `svc-dur-hint` until an error shows.
- **Barber form:** an empty submit puts focus on `#b-name`.

In all three, every error is linked to its field and nothing points at a missing id.

**Console:** no errors from app code. The dev console showed:
- a Google Maps `RefererNotAllowedMapError`, because the Maps key is not allowed for `localhost:5180`, so the map fell back to its list view;
- two 501 responses (the source was not identified; most likely an emulator endpoint);
- one transient Firestore "could not reach backend" warning.

None of these is an accessibility issue.

### New issues

| # | Screen | Problem | Impact | Owner | Status |
|---|---|---|---|---|---|
| 7 | Guest verify (details and code steps) | Errors appear silently: focus stays on the submit button and the error spans are not live regions, so a screen-reader user hears nothing (as issue 3). Confirmed by the VoiceOver pass on 9 Nov | Moderate | Haziq (FR-03, `VerifyView`) | Open |
| 8 | My bookings (phone step, code step, reschedule panel) | Errors appear silently, as issue 7 | Moderate | Alson (FR-04, `MyBookingsView`) | Open |
| 9 | Staff Schedule, "Block personal time" form | Errors appear silently, as issue 7 | Moderate | Francis (FR-08, `ScheduleView`) | Open |
| 10 | Booking confirmed | After Confirm booking, focus is left on the page body, and the "Status: Confirmed" `role="status"` badge is inserted together with the page, so it may not be announced. A screen-reader user may not learn that the booking succeeded. Confirmed by the VoiceOver pass on 9 Nov: the confirmation was not announced | Moderate (raised from Minor on 9 Nov) | Haziq (FR-03, `VerifyView`) | Open |

The landing and shop-page errors are announced through `role="alert"`, so they are not counted as issues, although focus stays on the button there too.

### Still to do after the re-run

- Manual screen-reader pass (VoiceOver) on the booking flow: **done 9 Nov**, see below. Issue 10 is real.
- Queue screen, once #30 is merged.
- axe "needs review" results (still not recorded).

## Screen reader pass (VoiceOver, Safari, macOS, 9 Nov 2026)

Tester: Firas, on Mon 9 Nov 2026.

**Setup.** Safari with VoiceOver on macOS, against a dev server connected to the Firebase emulators seeded with `npm run seed`. Test number +65 9000 0302; the code is read from the Auth emulator, and no SMS is sent.

**Flow.** Search 160055, open Kopi & Clippers, choose a service and a slot two days ahead, Continue, the details step, the code step, then Booking confirmed.

**Method.** For each check, the button was pressed with VoiceOver (Ctrl+Option+Space). The tester then took their hands off the keyboard for 5 seconds and noted whether VoiceOver announced the message by itself.

| Check | Result | Issue |
|---|---|---|
| Details step: field labels when tabbing onto them | Pass: each label was read out | — |
| Details step: empty submit (Send code) | **Fail:** the errors were not announced | 7 |
| Code step: empty submit (Confirm booking) | **Fail:** the error was not announced | 7 |
| Booking confirmed | **Fail:** the confirmation was not announced | 10 |
| My bookings | Not tested in this pass | (8) |

**Outcome.**
- **Issue 7 is confirmed.** It stays Moderate and Open.
- **Issue 10 is confirmed** and raised from Minor to Moderate. It stays Open.
- **Issues 8 and 9 are unchanged.** They remain automated findings only: My bookings and the staff Schedule screen were not part of this pass.

A screen-reader user can fill in the details, but is not told when a step fails or when the booking succeeds. See "Still to do" for the recommended fix.
