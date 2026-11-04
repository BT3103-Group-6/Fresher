# NFR-02 usability test: results

Script: [task-script.md](task-script.md). Consent: [consent-form.md](consent-form.md) (signed forms kept by the moderator, not in the repo).

**Status: not run yet.** Fill in one row per participant.

- Sessions run: ____ (dates)
- Moderator: Firas
- Setup: moderator's laptop, Firebase emulators started fresh and seeded with `npm run seed` once at the start of each session day, phone-sized window (390 × 844), one test number per participant (P01 +65 9000 0001 to P08 +65 9000 0008).
- **Branch and commit used for the sessions:** `chore/demo-dataset` at `________` (fill in from `git log --oneline -1` on the day). The sessions run from this branch because `scripts/seed.mjs` is not on `main` yet (PR-13 not merged); at the time of writing its head was `f181da5`.

## Sample size

**Sample size: 8 first-time participants**, to be confirmed by the PO (Haziq) under A8.

With 8 participants, 95% means **all 8** must succeed (7 of 8 is 87.5%). A single failure misses the target.

## Results table

Time is from the end of reading the task to the success criterion (mm:ss), or "stopped" with the time.

| Participant | First-time user of Fresher | Task 1 without help | Task 2 without help | Task 3 without help | Time task 1 | Time task 2 | Time task 3 | Notes |
|---|---|---|---|---|---|---|---|---|
| P01 | | | | | | | | |
| P02 | | | | | | | | |
| P03 | | | | | | | | |
| P04 | | | | | | | | |
| P05 | | | | | | | | |
| P06 | | | | | | | | |
| P07 | | | | | | | | |
| P08 | | | | | | | | |

Notes should cover the following (see the script):
- errors and whether field-named messages were understood;
- whether the summary screen was read, and whether the participant's answer to "what were you booking?" matched;
- whether the confirmation details were clear ("when, and with whom?");
- any help given, word for word.

## Completion rate without help

**How it is counted (per participant):**
- A participant **succeeds only if they finish task 1 and task 2, both without help**. Finishing one of the two, or needing help on either, is a failure.
- The rate is **successful first-time participants divided by all first-time participants**.
- Task 3 (cancel or reschedule, FR-04) is **reported separately** and does not affect the rate.
- Participants who had used Fresher before are listed but not counted.
- A session spoiled by an app defect is counted as not completed, and the defect is filed as a finding.

| Measure | Result |
|---|---|
| First-time participants (n) | ____ |
| Succeeded (tasks 1 and 2 both without help) | ____ of ____ = ____% |
| **Against the 95% target** | **met / not met** |
| Task 3 completed without help (reported separately) | ____ of ____ = ____% |
| Median time, tasks 1 / 2 / 3 | ____ / ____ / ____ |

**Statement (fill in honestly):** "____ of ____ first-time participants (____%) completed the standard booking flow (tasks 1 and 2) without help, against a target of 95%. The target was met / not met. The sample was ____ participants, recruited ____ (for example classmates outside the team), which is / is not representative of first-time users because ____."

If the target is missed, say so plainly here. Do not drop participants or re-run sessions to change the rate. List what caused each failure in the findings below.

## Other NFR-02 checks

| Check (NFR-02) | Observed | Evidence |
|---|---|---|
| Before final confirmation, one screen shows shop, service, barber, date, time and price | yes / no | "Your booking" summary on the verify screen; participants' answers to "what were you booking?" |
| Every invalid or missing required input shows a visible message naming the field | yes / no | errors seen in sessions (notes column) |
| A successful booking shows an explicit confirmation with the appointment details | yes / no | "Booking confirmed" screen; answers to "when, and with whom?" |

## Findings

One row per problem seen. A problem seen by several participants is one row, with the count.

**Severity:**
- **Critical:** stopped a participant from completing a task without help.
- **Major:** caused a clear error, a long delay or a misunderstanding, but the participant recovered alone.
- **Minor:** hesitation or a cosmetic issue.

| # | Finding | Task | Participants affected | Severity | Owning story | Owner | Filed as |
|---|---|---|---|---|---|---|---|
| F1 | | | | | | | |

**Owning story and owner** (from docs/team-plan.md):

| Area | Story | Owner |
|---|---|---|
| Landing page, postal code search, shop cards | FR-01 Shop discovery | K-Rei |
| Shop page: service, date, time slots | FR-02 Real-time availability | Haziq |
| Barber choice, "Any available barber" | FR-07 Multiple barbers | Firas |
| Verify screen: name, phone, OTP, summary, Booking confirmed | FR-03 Guest booking | Haziq |
| My bookings: cancel and reschedule | FR-04 Cancel/reschedule | Alson |
| Cancellation window and policy text | FR-05 Cancellation window | K-Rei |
| History and Rebook in My bookings | FR-11 History/rebook | Firas |
| Labels, focus, error wording and their link to fields | NFR-06 Accessibility | Firas |
| Speed, slow screens, lag | NFR-01 Performance | Firas |

File each finding as a GitHub issue against its story and put the issue number in "Filed as".
