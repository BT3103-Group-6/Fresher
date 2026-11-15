# Fresher: Team plan

The team's **Scrum workbook is the source of truth**. Sprint dates, story owners and story dates come from it (`BT3103 SCRUM`, Sprint 1 and Sprint 2 sheets). File ownership, the pull-request order, branches and conventions follow from those. If the workbook changes, update it first, then this file and `.github/CODEOWNERS`.

Requirement IDs refer to [requirements.md](requirements.md). Decision and limitation IDs (A…, L…) refer to [decisions.md](decisions.md).

---

## 1. Sprints

| Sprint | Dates | Scope |
|---|---|---|
| **Sprint 1** | Wed 21 Oct – Fri 30 Oct 2026 (review Fri 30 Oct) | Setup, FR-01 to FR-08, FR-11, FR-12, NFR-04, NFR-06 |
| **Sprint 2** | Sat 31 Oct – Sat 14 Nov 2026 | FR-09, FR-10, FR-13, FR-14, FR-15, NFR-01, NFR-02, NFR-03, NFR-05, NFR-07, NFR-08, then close-out |

The features were first explored in a prototype phase before Sprint 1. In the sprints, each story was brought onto `main` as its own reviewed pull request, in dependency order, and checked against its acceptance criteria. The NFR work, its evidence and the fixes were done in the sprints.

---

## 2. Story owners and dates

| Owner | GitHub | Sprint 1 | Sprint 2 |
|---|---|---|---|
| **Haziq** (PO) | `@haziqnoorazmi` | Setup, FR-02 Real-time availability, FR-03 Guest booking | NFR-03 Booking integrity, NFR-08 Auditability |
| **Alson** | `@A140904` | FR-04 Cancel and reschedule, NFR-04 Security and privacy | FR-09 Reminders, FR-10 Queue |
| **K-Rei** | `@teok-rei` | FR-01 Shop discovery, FR-05 Cancellation window | FR-15 Waitlist, NFR-05 Reliability |
| **Francis** | `@francisgoonws` | FR-06 Services, FR-08 Time blocks, FR-12 No-shows | FR-13 Deposits, FR-14 Analytics |
| **Firas** (SM) | `@mofiras123` | FR-07 Multiple barbers, FR-11 History and rebook, NFR-06 Accessibility | NFR-01 Performance, NFR-02 Usability, NFR-07 Cost |

### Story dates (from the workbook)

Every PR's target date falls inside the dates of its story. A file that has to merge early as a dependency (section 3) does not move its story: the story is still done and checked on these dates.

| Sprint | Story | Owner | Start | End | PRs |
|---|---|---|---|---|---|
| 1 | Setup | Haziq | Wed 21 Oct | Wed 21 Oct | #1, #2 |
| 1 | FR-06 Service configuration | Francis | Wed 21 Oct | Thu 22 Oct | #9 |
| 1 | FR-02 Real-time availability | Haziq | Wed 21 Oct | Fri 23 Oct | #11 |
| 1 | FR-07 Multiple barbers | Firas | Wed 21 Oct | Fri 23 Oct | #7 |
| 1 | NFR-04 Security and privacy | Alson | Wed 21 Oct | Fri 23 Oct | #2 (rules), #6, #19, #25 |
| 1 | FR-01 Shop discovery | K-Rei | Wed 21 Oct | Tue 27 Oct | #16 |
| 1 | FR-08 Personal time blocks | Francis | Fri 23 Oct | Tue 27 Oct | #13 |
| 1 | FR-03 Guest booking | Haziq | Sat 24 Oct | Thu 29 Oct | #15 |
| 1 | FR-04 Cancellation and rescheduling | Alson | Mon 26 Oct | Wed 28 Oct | #18 |
| 1 | FR-11 Booking history and rebooking | Firas | Mon 26 Oct | Tue 27 Oct | #4 (dependency, early), checked after #18 |
| 1 | FR-05 Cancellation window | K-Rei | Wed 28 Oct | Thu 29 Oct | #20 |
| 1 | FR-12 No-show tracking | Francis | Wed 28 Oct | Thu 29 Oct | #22 |
| 1 | NFR-06 Accessibility | Firas | Wed 28 Oct | Thu 29 Oct | #2 (design system), #14, #17, #21, #23, #24 |
| 2 | FR-09 Automated reminders | Alson | Mon 2 Nov | Wed 4 Nov | #5 (dependency, early), #26 |
| 2 | FR-13 Escalating no-show policy (deposits) | Francis | Mon 2 Nov | Fri 6 Nov | #34 |
| 2 | FR-15 Waitlist | K-Rei | Mon 2 Nov | Fri 6 Nov | #36 |
| 2 | NFR-07 Cost efficiency | Firas | Mon 2 Nov | Tue 3 Nov | #28, #48 |
| 2 | NFR-08 Auditability | Haziq | Mon 2 Nov | Tue 3 Nov | #31 |
| 2 | NFR-02 Usability | Firas | Wed 4 Nov | Fri 6 Nov | #27 (demo dataset), #29 |
| 2 | NFR-03 Booking integrity | Haziq | Wed 4 Nov | Mon 9 Nov | #42, #43 |
| 2 | FR-10 Queue and reconciliation | Alson | Thu 5 Nov | Mon 9 Nov | #30 |
| 2 | FR-14 Shop analytics | Francis | Sat 7 Nov | Mon 9 Nov | #38 |
| 2 | NFR-01 Mobile performance | Firas | Sat 7 Nov | Mon 9 Nov | #37, #39 |
| 2 | NFR-05 Reliability | K-Rei | Sat 7 Nov | Mon 9 Nov | #40 |

Fixes after review: #32 and #35 (FR-08 schedule route), #33, #41 and #50 (NFR-06), #45 (verified phone reuse), #46 and #47 (FR-04).

---

## 3. Integration order

`main` started with the docs only. Stories then merged as **one chain of pull requests across both sprints**, ordered by the real imports between files: each PR built on the last, and a PR could only merge once the one before it had. Story branches outside the chain (security, accessibility, performance, reliability, auditability, cost and usability) branched from `main` whenever they were ready.

**Dependencies.** Some PRs import a file whose story comes later in the workbook. That file merged early in the first PR that needed it, as a dependency only, with no route, export or story work. Its owner stayed its code owner and approved it there, and the story was still checked on its own dates.

| Dependency | Its story (owner) | Merged in | Because |
|---|---|---|---|
| `functions/notifications.js`, `functions/messaging.js` | FR-09 (Alson) | PR-02 (#5) | `booking.js` requires `notifications.js` |
| `src/lib/history.js` | FR-11 (Firas) | PR-03 (#4) | `ShopView` imports it |
| `src/lib/serviceTypes.js` | FR-01 (K-Rei) | PR-05 (#9) | `ServiceForm` imports it |
| `src/lib/deposit.js` | FR-13 (Francis) | PR-10 (#18) | `MyBookingsView` imports it |
| `functions/queue.js`, `functions/queueDelay.js` | FR-10 (Alson) | PR-12 (#22) | `service.js` requires `queue.js` |
| `functions/stats.js` | FR-14 (Francis) | PR-13 (#27) | the demo dataset needs it, and NFR-07 needs the seed |

**Stub routes.** The setup PR added placeholder routes (showing the sign-in page) for every screen the headers link to. Each screen's PR replaced its placeholder with the real route.

### The chain

| # | Sprint | Target | Branch | Author | Reviewer | Story | PR |
|---|---|---|---|---|---|---|---|
| PR-01 | 1 | Wed 21 Oct | `chore/setup-foundation` | Haziq | Alson | Setup (with NFR-04 rules and NFR-06 design system) | #2 |
| PR-02 | 1 | Thu 22 Oct | `feat/fr-09-notification-engine` | Alson | Haziq | Dependency (FR-09) | #5 |
| PR-03 | 1 | Thu 22 Oct | `feat/fr-11-history-logic` | Firas | Haziq | Dependency (FR-11) | #4 |
| PR-04 | 1 | Thu 22 Oct | `feat/fr-07-barbers` | Firas | Francis | FR-07 | #7 |
| PR-05 | 1 | Thu 22 Oct | `feat/fr-06-services` | Francis | Firas | FR-06 | #9 |
| PR-06 | 1 | Fri 23 Oct | `feat/fr-02-availability` | Haziq | Firas | FR-02 | #11 |
| PR-07 | 1 | Mon 26 Oct | `feat/fr-08-time-blocks` | Francis | Alson | FR-08 | #13 |
| PR-08 | 1 | Mon 26 Oct | `feat/fr-03-guest-booking` | Haziq | K-Rei | FR-03 | #15 |
| PR-09 | 1 | Tue 27 Oct | `feat/fr-01-discovery` | K-Rei | Francis | FR-01 | #16 |
| PR-10 | 1 | Tue 27 Oct | `feat/fr-04-cancel-reschedule` | Alson | K-Rei | FR-04 | #18 |
| PR-11 | 1 | Wed 28 Oct | `feat/fr-05-cancellation-window` | K-Rei | Alson | FR-05 | #20 |
| PR-12 | 1 | Thu 29 Oct | `feat/fr-12-no-shows` | Francis | Firas | FR-12 | #22 |
| PR-13 | 2 | Mon 2 Nov | `chore/demo-dataset` | Firas | Haziq | Seed and demo dataset | #27 |
| PR-14 | 2 | Tue 3 Nov | `feat/fr-09-reminder-sweep` | Alson | K-Rei | FR-09 | #26 |
| PR-15 | 2 | Thu 5 Nov | `feat/fr-13-deposits` | Francis | Alson | FR-13 | #34 |
| PR-16 | 2 | Fri 6 Nov | `feat/fr-15-waitlist` | K-Rei | Francis | FR-15 | #36 |
| PR-17 | 2 | Fri 6 Nov | `feat/fr-10-queue` | Alson | Firas | FR-10 | #30 |
| PR-18 | 2 | Sat 7 Nov | `feat/fr-14-analytics` | Francis | Firas | FR-14 | #38 |
| PR-19 | 2 | Sat 7 Nov | `chore/nfr-03-integration-suite` | Haziq | Firas | NFR-03 | #43 |

PR-19 closed the chain. It added the concurrency suite and the demo-mode tests, completed the router and the function exports, and confirmed that `npm run test:rules` and `npm run test:concurrency` pass in full.

---

## 4. Code ownership

Each file is owned by the owner of the story it mainly implements, and `.github/CODEOWNERS` lists them. A file that also serves other stories lists those owners as co-owners. GitHub lets any one listed owner approve, so the team rule is that **a change to a shared file is approved by the owner of the story the change affects.**

| Owner | Main areas |
|---|---|
| **Haziq** | Project setup and config, Firebase modules, `functions/index.js`, `src/router/index.js`, `functions/booking.js`, `ShopView`, `VerifyView`, slots and booking store, concurrency and demo-mode tests |
| **Alson** | `firestore.rules` and rules tests, notifications and messaging, the sweep, `MyBookingsView`, the queue (functions, screen and tests) |
| **K-Rei** | Discovery (landing page, shop map, geocode, discovery functions and tests), cancellation-window tests, the waitlist (functions, screen and tests) |
| **Francis** | Shop configuration and service form, schedule and time blocks, no-show functions, deposits and payments, stats trigger and the owner dashboard |
| **Firas** | Design system, headers and shared components, `BarberForm`, history and rebook logic, the seed and demo dataset, NFR-01, NFR-02 and NFR-07 evidence |

The shared files that matter most:

- **`src/router/index.js` and `functions/index.js`** hold one route or export block per story. Edits to another story's block need that story owner's approval.
- **`functions/booking.js`** holds FR-02 and FR-03 (Haziq), the FR-04 cancel and reschedule (Alson), the FR-05 notice rule (K-Rei), "Any available barber" for FR-07 (Firas) and the FR-13 deposit hold (Francis). Its owner reviews every change, and the affected story owner approves.
- **`firestore.rules` and `tests/rules.test.mjs`** belong to NFR-04 (Alson) but guard every story's data, so a rules change also needs the affected story owner.
- **`tests/concurrency.test.mjs`** belongs to NFR-03 (Haziq) and has blocks for FR-04, FR-05, FR-08, FR-10 and FR-12, which those owners keep green.
- **`MyBookingsView.vue`** belongs to FR-04 (Alson) and also shows FR-05 (K-Rei), FR-11 rebook (Firas) and FR-13 deposits (Francis).

---

## 5. Conventions

- **Branches:** `feat/<story>-<topic>`, `fix/<story>-<topic>`, `chore/<topic>`, `test/<story>-<topic>` or `docs/<topic>`, in lower case. For example `feat/fr-02-availability`, `fix/nfr-06-verify-errors`.
- **Commits:** `tag(FR-xx): description`, imperative and lower case. For example `feat(FR-02): add slot availability and holdSlot`. The setup story uses `chore(setup): …`.
- **Pull requests:** the title is the first commit's message. The body lists the story, the files, the real test totals (passed, failed, skipped, and which files ran) and the manual checks. The reviewer is another story owner.
- **Development:** emulators only. Nothing is deployed outside a story that says so.

## 6. Workflow for a pull request

```sh
git switch main && git pull
git switch -c <branch>
# make the change
npm run build && npm --prefix functions run lint
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node --test <your test files>
git add -A
git commit -m "feat(FR-xx): <description>"
git push -u origin <branch>
gh pr create --base main --title "feat(FR-xx): <description>" --reviewer <reviewer handle>
```

`main` is protected, so every change goes through a pull request approved by another story owner. Authors merge their own PR after approval.

---

## 7. Sprint 2 evidence and close-out

Evidence goes in `docs/evidence/<NFR-id>/`: method, raw output, result against the requirement, date and commit. New test scripts go under `tests/` and into `package.json`.

| NFR | Owner | Evidence |
|---|---|---|
| NFR-01 Mobile performance | Firas | Lighthouse mobile runs at 320 to 1280 px and the 4G load check (`docs/evidence/NFR-01/`) |
| NFR-02 Usability | Firas | Task script and results with 8 first-time participants (`docs/evidence/NFR-02/`) |
| NFR-03 Booking integrity | Haziq | 50-way race and repeated-submission tests, and a 1,000-transaction load test (`docs/evidence/NFR-03/`) |
| NFR-04 Security and privacy | Alson | Security test cases, App Check on the deployed site, secrets and dependency audit (`docs/evidence/NFR-04/`) |
| NFR-05 Reliability | K-Rei | 100 failed writes, 100 repeated submissions, connection loss (`docs/evidence/NFR-05/`) |
| NFR-06 Accessibility | Firas | axe and keyboard audit, VoiceOver pass, issue list (`docs/evidence/NFR-06/`) |
| NFR-07 Cost efficiency | Firas | Cost worksheet at 200 bookings per shop per month (`docs/evidence/NFR-07/`) |
| NFR-08 Auditability | Haziq | Audit record test for every state transition (`docs/evidence/NFR-08/`) |

**Close-out work** (not workbook stories):

- **Final deploy:** follow `docs/deployment.md`, add the serving domain to the reCAPTCHA key, and record the smoke checklist.
- **Demo:** presentation and live demo on Wed 11 Nov.
- **Report:** due Sun 15 Nov. It must state that messaging and payments are mocked.
- **Release notes and a `v1.0` tag** on the deployed commit.

---

## 8. Definition of Done (every PR)

- Approved by the named reviewer (another story owner) and by the code owner of every file touched. For shared files, approved by the owner of the story the change affects.
- `npm run build` and `npm --prefix functions run lint` pass. The relevant tests pass, and the PR states the totals (passed, failed, skipped) and the files run.
- Branch and commit names follow section 5. New functions and components carry the requirement ID in a comment (CLAUDE.md).
- No secrets in the diff.
- If a decision changes, `docs/decisions.md` is updated first, in the same PR.
- Nothing is deployed except the App Check preview channel (NFR-04) and the final deploy.
