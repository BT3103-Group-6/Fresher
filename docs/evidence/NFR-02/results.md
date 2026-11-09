# NFR-02 usability test: results

Script: [task-script.md](task-script.md). Consent: [consent-form.md](consent-form.md) (signed forms kept by the moderator, not in the repo).

**Status: run.** Results from the moderator's report (Firas).

- Sessions run: Thu 5 Nov 2026, about 3 pm to midnight.
- Moderator: Firas.
- Setup: the moderator's laptop, Chrome, in a phone-sized window (device mode). The task script also planned fresh, seeded emulators, a 390 × 844 window and one test number per participant (P01 +65 9000 0001 to P08 +65 9000 0008); whether each of these was followed in each session was not recorded.
- The consent form signed on 5 Nov said the system was wiped after each session. It was wiped at the end of the day. Only made-up names and test numbers were entered.
- **Branch and commit used for the sessions:** `chore/demo-dataset` (`f181da5`) for sessions before 10.12 pm; `main` afterwards if re-seeded; not noted per session. PR-13 (#27) merged on Thu 5 Nov at 10.12 pm.

## Sample size

**Sample size: 8 first-time participants**, confirmed by the PO under A8.

With 8 participants, 95% means **all 8** must succeed (7 of 8 is 87.5%). A single failure misses the target.

## Results table

The script planned to time each task from the end of reading it to the success criterion. Times were not recorded.

| Participant | First-time user of Fresher | Task 1 without help | Task 2 without help | Task 3 without help | Time task 1 | Time task 2 | Time task 3 | Notes |
|---|---|---|---|---|---|---|---|---|
| P01 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |
| P02 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |
| P03 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |
| P04 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |
| P05 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |
| P06 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |
| P07 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |
| P08 | Yes | Yes | Yes | Yes | not recorded | not recorded | not recorded | not recorded |

**Help given:** none.

Per-participant notes (errors seen, answers to "what were you booking?" and "when, and with whom?") were not recorded. The moderator's report gives these only as totals across all 8; see "Other NFR-02 checks".

## Completion rate without help

**How it is counted (per participant):**
- A participant **succeeds only if they finish task 1 and task 2, both without help**. Finishing one of the two, or needing help on either, is a failure.
- The rate is **successful first-time participants divided by all first-time participants**.
- Task 3 (cancel or reschedule, FR-04) is **reported separately** and does not affect the rate.
- Participants who had used Fresher before are listed but not counted.
- A session spoiled by an app defect is counted as not completed, and the defect is filed as a finding.

| Measure | Result |
|---|---|
| First-time participants (n) | 8 |
| Succeeded (tasks 1 and 2 both without help) | 8 of 8 = 100% |
| **Against the 95% target** | **met** |
| Task 3 completed without help (reported separately) | 8 of 8 = 100% |
| Median time, tasks 1 / 2 / 3 | not recorded / not recorded / not recorded |

**Statement:** "8 of 8 first-time participants (100%) completed the standard booking flow (tasks 1 and 2) without help, against a target of 95%. The target was met. The sample was 8 participants; how they were recruited, and how representative they are of first-time users, was not recorded. All 8 also completed task 3 (cancel or reschedule) without help, which is reported separately."

No participant was dropped and no session was re-run.

## Other NFR-02 checks

| Check (NFR-02) | Observed | Evidence |
|---|---|---|
| Before final confirmation, one screen shows shop, service, barber, date, time and price | Yes | "Your booking" summary on the verify screen. Moderator's report: the summary screen was understood by all 8 |
| Every invalid or missing required input shows a visible message naming the field | Yes | Moderator's report: field-named errors were seen and understood by all 8 (which errors, per participant: not recorded) |
| A successful booking shows an explicit confirmation with the appointment details | Yes | "Booking confirmed" screen. Moderator's report: the confirmation was clear (what, when, with whom) to all 8 |

## Findings

One row per problem seen. A problem seen by several participants is one row, with the count.

**Severity:**
- **Critical:** stopped a participant from completing a task without help.
- **Major:** caused a clear error, a long delay or a misunderstanding, but the participant recovered alone.
- **Minor:** hesitation or a cosmetic issue.

**None flagged by participants.** Moderator summary: the flow was described as smooth and intuitive.

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

## Limits

- **Times and notes.** Task times and per-participant notes were not recorded, so there are no median times and no per-participant evidence beyond the completion results.
- **Sample size.** The sample is 8 participants (confirmed by the PO under A8).
- **Device.** Sessions ran on a laptop in a phone-sized window (Chrome device mode), not on phones.
- **Moderator.** The moderator (Firas) is a team member.
- **What the result shows.** With n = 8, a result of 8 of 8 is consistent with, but does not prove, a 95% completion rate in a wider population of first-time users.
