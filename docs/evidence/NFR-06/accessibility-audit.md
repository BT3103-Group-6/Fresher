# NFR-06 accessibility evidence

Story owner Firas. Audit run Mon 26 Oct 2026 on `main` at `2a37612`. Fixes merged in PR #14 on Wed 28 Oct 2026 (commit `abdaa83`).

## Summary

The first audit covered sign-in, shop configuration, the service form, the barber form and the customer shop page. axe-core found no violations in the app's own code on any of them. Manual checks found 6 issues, none critical or serious (3 moderate, 3 minor), and all of them concern error messages and ARIA references rather than focus, labels or contrast. Issues 1, 2 and 5 were in the barber form and have been fixed and checked in the browser. Issues 3 and 4 touch files owned by other people and are still open. Issue 6 is optional.

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
| 3 | Sign-in, service form, barber form | Errors appear silently, with no live region and no focus move | Moderate | Haziq (sign-in), Francis (service form), Firas (barber form) | Open, to agree with owners |
| 4 | Service form | `#svc-dur` points `aria-describedby` at an id that does not exist until an error shows | Minor | Francis | Open, to agree with owner |
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

- Agree issues 3 and 4 with Haziq and Francis, and make "focus the first invalid field on submit" the shared pattern.
- Run axe again on the screens that have merged since the audit (shop discovery, guest booking verification, the barber schedule), since they are in NFR-06's scope.
- Run axe's "needs review" results, which the first audit did not record.
- Do a manual screen-reader pass (VoiceOver) on the booking flow.
- After someone has the real Firebase values, run `npm run build` and `grep -r "owner@shop-jurong" dist/` to confirm the dev-only hint on the sign-in page is not shipped.