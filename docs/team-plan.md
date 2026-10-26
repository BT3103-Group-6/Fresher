# Fresher — Team plan

The team's **Scrum workbook is the source of truth**. This plan is built from it: the sprint dates, the sprint each story is in, each story's start and end dates and the story owners below come from the workbook (`BT3103 SCRUM with sprints`, Sprint 1 and Sprint 2 sheets, read 22 Oct 2026). File ownership, the pull-request order, target dates, branches and commands follow from those. If the workbook changes, update it first, then this file and `.github/CODEOWNERS`.

- **Sprint 1: Wed 21 Oct – Fri 30 Oct 2026** (Fri 30 Oct is the sprint review). Setup, FR-01–08, FR-11, FR-12, NFR-04 and NFR-06.
- **Sprint 2: Sat 31 Oct – Tue 10 Nov 2026.** FR-09, FR-10, FR-13, FR-14, FR-15, NFR-01, NFR-02, NFR-03, NFR-05, NFR-07 and NFR-08, then the integration close-out.

The code comes from the exploratory prototype, kept on the git tag `prototype` (commit `b5bf4d7`). Requirement IDs refer to [requirements.md](requirements.md); decision and limitation IDs (A…, L…) refer to [decisions.md](decisions.md).

---

## 1. Story owners

| Owner | Sprint 1 stories | Sprint 2 stories | GitHub handle (CODEOWNERS) |
|---|---|---|---|
| **Haziq** | Setup (21 Oct), FR-02 Real-time availability, FR-03 Guest booking | NFR-03 Booking integrity, NFR-08 Auditability | `@haziqnoorazmi`, taken from the repository URL; check it |
| **Alson** | FR-04 Cancel/reschedule, NFR-04 Security and privacy | FR-09 Reminders, FR-10 Queue | `@alson-github` (placeholder) |
| **K-Rei** | FR-01 Shop discovery, FR-05 Cancellation window | FR-15 Waitlist, NFR-05 Reliability | `@krei-github` (placeholder) |
| **Francis** | FR-06 Services, FR-08 Time blocks, FR-12 No-shows | FR-13 Deposits, FR-14 Analytics | `@francis-github` (placeholder) |
| **Firas** | FR-07 Multiple barbers, FR-11 History/rebook, NFR-06 Accessibility | NFR-01 Performance, NFR-02 Usability, NFR-07 Cost | `@firas-github` (placeholder) |

### Story dates (workbook)

Every PR's target date (section 4) falls inside the dates of the story it belongs to. A file brought in early as a dependency (section 4) does not move its story: the story is still done and checked on these dates.

| Sprint | Story | Owner | Start | End | PRs and branches |
|---|---|---|---|---|---|
| 1 | Setup | Haziq | Wed 21 Oct | Wed 21 Oct | PR-01 |
| 1 | FR-06 Service configuration | Francis | Wed 21 Oct | Thu 22 Oct | PR-05 |
| 1 | FR-02 Real-time availability | Haziq | Wed 21 Oct | Fri 23 Oct | PR-06 |
| 1 | FR-07 Multiple barbers | Firas | Wed 21 Oct | Fri 23 Oct | PR-04 |
| 1 | NFR-04 Security and privacy | Alson | Wed 21 Oct | Fri 23 Oct | PR-01 (rules), `fix/nfr-04-app-check`, `feat/nfr-04-security-tests` |
| 1 | FR-01 Shop discovery | K-Rei | Wed 21 Oct | Tue 27 Oct | PR-09 |
| 1 | FR-08 Personal time blocks | Francis | Fri 23 Oct | Tue 27 Oct | PR-07 |
| 1 | FR-03 Guest booking | Haziq | Sat 24 Oct | Thu 29 Oct | PR-08 |
| 1 | FR-04 Cancellation and rescheduling | Alson | Mon 26 Oct | Wed 28 Oct | PR-10 |
| 1 | FR-11 Booking history and rebooking | Firas | Mon 26 Oct | Tue 27 Oct | PR-03 (dependency, early), check after PR-10 |
| 1 | FR-05 Cancellation window | K-Rei | Wed 28 Oct | Thu 29 Oct | PR-11 |
| 1 | FR-12 No-show tracking | Francis | Wed 28 Oct | Thu 29 Oct | PR-12 |
| 1 | NFR-06 Accessibility | Firas | Wed 28 Oct | Thu 29 Oct | PR-01 (design system), `fix/nfr-06-accessibility`, `chore/nfr-06-evidence` |
| 2 | FR-09 Automated reminders | Alson | Mon 2 Nov | Wed 4 Nov | PR-02 (dependency, early), PR-14 |
| 2 | FR-13 Escalating no-show policy (deposits) | Francis | Mon 2 Nov | Fri 6 Nov | PR-15 |
| 2 | FR-15 Waitlist | K-Rei | Mon 2 Nov | Fri 6 Nov | PR-16 |
| 2 | NFR-07 Cost efficiency | Firas | Mon 2 Nov | Tue 3 Nov | `chore/nfr-07-cost` |
| 2 | NFR-08 Auditability | Haziq | Mon 2 Nov | Tue 3 Nov | `feat/nfr-08-audit-trail` |
| 2 | NFR-02 Usability | Firas | Wed 4 Nov | Fri 6 Nov | `chore/nfr-02-usability` |
| 2 | NFR-03 Booking integrity | Haziq | Wed 4 Nov | Mon 9 Nov | PR-19, `feat/nfr-03-load-test` |
| 2 | FR-10 Queue and reconciliation | Alson | Thu 5 Nov | Mon 9 Nov | PR-17, `fix/fr-10-queue-screenshot` |
| 2 | FR-14 Shop analytics | Francis | Sat 7 Nov | Mon 9 Nov | PR-18 |
| 2 | NFR-01 Mobile performance | Firas | Sat 7 Nov | Mon 9 Nov | `fix/nfr-01-scroll-lag`, `chore/nfr-01-lighthouse` |
| 2 | NFR-05 Reliability | K-Rei | Sat 7 Nov | Mon 9 Nov | `feat/nfr-05-failure-handling` |

Known issues go with the story they belong to:

| Issue | Story | Owner | Sprint |
|---|---|---|---|
| App Check deferral (L1) | NFR-04 | Alson | 1 |
| Accessibility fixes | NFR-06 | Firas | 1 |
| Scroll lag | NFR-01 | Firas | 2 |
| Queue screen screenshot | FR-10 (fix) | Alson | 2 |

**Not in the workbook (no owner yet):** the final deploy, the report and the demo. They are listed in [section 6](#6-not-yet-in-the-workbook) so the team can add them to the workbook and assign them. The seed and demo dataset (PR-13) has no story either.

### Workload flags

Sizes are measured on the prototype: LOC means non-blank lines, and tests means `it(`/`test(` cases in the files each person owns (section 2). These are not story points; points live in the workbook.

| Person | Source LOC | vs mean | Test LOC | Tests | vs mean |
|---|---:|---:|---:|---:|---:|
| Haziq | 2,154 | -15% | 1,263 | 79 | -44% |
| Alson | 2,342 | -7% | 1,962 | 199 | +42% |
| K-Rei | 2,262 | -11% | 1,639 | 178 | +27% |
| Francis | 3,384 | +34% | 1,752 | 204 | +46% |
| Firas | 2,507 | -1% | 382 | 40 | -71% |
| **Mean** | 2,530 | | 1,400 | 140 | |

- **Francis** owns the most code (3,384 source LOC, +34%) and five FR stories: three in Sprint 1 (three PRs from 22 to 29 Oct) and FR-13 and FR-14 in Sprint 2.
- **Firas** owns the fewest tests (40) and has NFR-06 at the end of Sprint 1, then three NFR stories in Sprint 2, including the scroll-lag fix and the seed and demo dataset (PR-13).
- **Haziq** has the fewest feature tests. The 63-test concurrency suite counts for Haziq, the 62 rules tests for Alson.
- **FR-05 (K-Rei)** has no screen or function of its own. The late-cancel rule runs inside `cancelBooking` in `functions/booking.js` (Haziq), and its UI is in `VerifyView` (Haziq) and `MyBookingsView` (Alson). K-Rei owns `tests/booking.unit.test.mjs` and is a co-owner of those three files.
- **The seed and demo dataset** (`scripts/seed.mjs`, `scripts/demo/`, about 1,400 LOC) has no workbook story. It is assigned to Firas, because the NFR-02 usability sessions and the NFR-07 cost run use it. Add a story for it, or move it, in the workbook.

If the team rebalances in the workbook, move whole stories (a story's files move with it). Then regenerate sections 1, 2 and CODEOWNERS.

---

## 2. File ownership

Every file is owned by the owner of the story it mainly implements. **⚑ marks a shared file:** it also implements stories owned by other people (column "Also serves"). In `.github/CODEOWNERS`, a shared file lists the main owner first and then the co-owners. GitHub lets **any one** listed owner approve. So the team rule is: a change to a shared file is approved by the owner of the story the change affects.

Directory rows aggregate their files. LOC "—" means config or assets that are not counted. **"(dep.)" in the PR column** means the file comes in unchanged, ahead of its story's dates, because an earlier PR imports it (section 4). Ownership does not change: the story owner still owns and approves it.

### 2.1 Haziq

| Path | Files | LOC | Tests | Story | Also serves | PR | What it does |
|---|---:|---:|---:|---|---|---|---|
| `package.json` | 1 | — |  | SETUP |  | PR-01 | Scripts, dependencies; `test:rules` lists every test file |
| `package-lock.json` | 1 | — |  | SETUP |  | PR-01 | Locked dependencies |
| `vite.config.js` ⚑ | 1 | — |  | SETUP | NFR-01 | PR-01 | Build config, chunk splitting (NFR-01) |
| `jsconfig.json` | 1 | — |  | SETUP |  | PR-01 | `@` alias |
| `index.html` | 1 | — |  | SETUP |  | PR-01 | HTML entry |
| `firebase.json` | 1 | — |  | SETUP |  | PR-01 | Emulators, hosting, predeploy lint |
| `.firebaserc` | 1 | — |  | SETUP |  | PR-01 | Project aliases |
| `firestore.indexes.json` ⚑ | 1 | — |  | SETUP | FR-01, FR-08, FR-09, FR-15 | PR-01 | Composite indexes (discovery, blocks, notifications, waitlist, sweep) |
| `.env.example` | 1 | — |  | SETUP |  | PR-01 | Placeholder web config |
| `.env.production` ⚑ | 1 | — |  | SETUP | NFR-04 | PR-01 | Demo build flags (App Check off, demo mode on) |
| `public/` | 2 | — |  | SETUP |  | PR-01 | Favicons |
| `functions/package.json` | 1 | — |  | SETUP |  | PR-01 | Functions dependencies, lint script |
| `functions/package-lock.json` | 1 | — |  | SETUP |  | PR-01 | Locked functions dependencies |
| `functions/.eslintrc.js` | 1 | — |  | SETUP |  | PR-01 | Functions lint rules |
| `functions/.gitignore` | 1 | — |  | SETUP |  | PR-01 | Functions ignores |
| `functions/index.js` ⚑ | 1 | 249 |  | SETUP | every FR | PR-01 | Entry point: global options, App Check switch, and the export of every callable/trigger/schedule (each PR adds its own) |
| `functions/demo.js` ⚑ | 1 | 20 |  | SETUP | NFR-04 | PR-01 | Demo-mode and App Check switches for functions |
| `src/main.js` | 1 | 5 |  | SETUP |  | PR-01 | Creates the Vue app and mounts the router |
| `src/App.vue` | 1 | 22 |  | SETUP |  | PR-01 | App shell: customer or staff header per route |
| `src/router/index.js` ⚑ | 1 | 75 |  | SETUP | every FR | PR-01 | Routes and staff guards for every screen (each PR adds its own) |
| `src/firebase.js` | 1 | 6 |  | SETUP |  | PR-01 | Re-exports the Firebase service modules |
| `src/firebaseApp.js` ⚑ | 1 | 17 |  | SETUP | NFR-04 | PR-01 | Firebase app init and optional App Check (reCAPTCHA Enterprise) |
| `src/firebaseAuth.js` | 1 | 8 |  | SETUP | FR-03 | PR-01 | Auth instance, emulator connection in dev |
| `src/firebaseDb.js` | 1 | 7 |  | SETUP |  | PR-01 | Firestore instance, emulator connection in dev |
| `src/firebaseFunctions.js` | 1 | 7 |  | SETUP |  | PR-01 | Functions instance (asia-southeast1), emulator connection |
| `src/stores/session.js` ⚑ | 1 | 53 |  | SETUP | NFR-01 | PR-01 | Staff session with custom claims; Auth loaded on demand |
| `src/views/staff/SignInView.vue` | 1 | 98 |  | SETUP |  | PR-01 | Staff email/password sign-in |
| `src/lib/demo.js` ⚑ | 1 | 9 |  | SETUP | NFR-04 | PR-01 | Demo-mode flag, web side |
| `functions/booking.js` ⚑ | 1 | 793 |  | FR-02 | FR-03, FR-04, FR-05, FR-07, FR-13, NFR-03, NFR-05, NFR-08 | PR-06 | holdSlot, confirmBooking, releaseHold, cancelBooking, reschedule: the lock transaction, state checks, audit records |
| `src/lib/slots.js` | 1 | 86 |  | FR-02 |  | PR-06 | Client-side free-slot computation (used by most screens) |
| `src/stores/booking.js` ⚑ | 1 | 32 |  | FR-02 | FR-03, NFR-05 | PR-06 | In-progress booking kept across recoverable failures |
| `src/views/customer/ShopView.vue` ⚑ | 1 | 331 |  | FR-02 | FR-07, FR-11 | PR-06 | UI-C2: service, barber ("Any available"), live slots; rebook pre-fill |
| `tests/slots.test.mjs` | 1 | 49 | 7 | FR-02 |  | PR-06 | Slot computation tests |
| `src/views/customer/VerifyView.vue` ⚑ | 1 | 297 |  | FR-03 | FR-05, FR-13, NFR-02 | PR-08 | UI-C3: name, SG mobile, OTP, policy and summary, confirm |
| `src/lib/customerAuth.js` | 1 | 39 |  | FR-03 |  | PR-08 | Phone Auth OTP send/verify |
| `tests/concurrency.test.mjs` ⚑ | 1 | 1113 | 63 | NFR-03 | FR-04, FR-05, FR-08, FR-10, FR-12, NFR-05 | PR-19 | Every booking transaction against the emulator, incl. 50-way races |
| `tests/demo.unit.test.mjs` ⚑ | 1 | 101 | 9 | SETUP | NFR-04 | PR-19 | Demo-mode and App Check switch tests (loads the full functions/index.js) |

### 2.2 Alson

| Path | Files | LOC | Tests | Story | Also serves | PR | What it does |
|---|---:|---:|---:|---|---|---|---|
| `firestore.rules` ⚑ | 1 | 122 |  | NFR-04 | every FR | PR-01 | Security Rules for every collection |
| `tests/rules.test.mjs` ⚑ | 1 | 541 | 62 | NFR-04 | FR-01, FR-04, FR-08, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15 | PR-01 | Rules tests: isolation, no client writes |
| `functions/notifications.js` ⚑ | 1 | 255 |  | FR-09 | FR-10, FR-15 | PR-02 (dep.) | Reminder and offer task planning, cancel and recalculation |
| `functions/messaging.js` | 1 | 38 |  | FR-09 |  | PR-02 (dep.) | Mock messaging provider interface |
| `tests/notifications.unit.test.mjs` | 1 | 186 | 15 | FR-09 |  | PR-02 (dep.) | Reminder planning tests |
| `src/views/customer/MyBookingsView.vue` ⚑ | 1 | 528 |  | FR-04 | FR-05, FR-11, FR-13 | PR-10 | UI-C4: OTP, bookings, cancel/reschedule, late-cancel policy, rebook |
| `functions/queue.js` | 1 | 386 |  | FR-10 |  | PR-12 (dep.) | Walk-in callables, delay recalculation |
| `functions/queueDelay.js` | 1 | 100 |  | FR-10 |  | PR-12 (dep.) | Delay projection and warning rule |
| `src/views/staff/QueueView.vue` ⚑ | 1 | 435 |  | FR-10 | FR-12 | PR-17 | UI-B2: in-progress service, walk-ins, projected delays |
| `src/lib/queue.js` | 1 | 156 |  | FR-10 |  | PR-17 | Client copy of the delay projection |
| `scripts/seed-fr10.mjs` | 1 | 53 |  | FR-10 |  | PR-17 | Emulator seed for queue scenarios |
| `tests/queue.unit.test.mjs` | 1 | 264 | 44 | FR-10 |  | PR-17 | Delay and warning tests |
| `functions/sweep.js` ⚑ | 1 | 222 |  | FR-09 | FR-13, FR-15 | PR-14 | Scheduled job: due messages, expired holds, waitlist expiry |
| `scripts/sweep.mjs` | 1 | 22 |  | FR-09 |  | PR-14 | Runs the sweep in the emulator |
| `scripts/backfill-notifications.mjs` | 1 | 25 |  | FR-09 |  | PR-14 | Rebuilds notification tasks |
| `tests/notifications.emulator.test.mjs` | 1 | 435 | 32 | FR-09 |  | PR-14 | Notification tasks against the emulator |
| `tests/queue.emulator.test.mjs` | 1 | 536 | 46 | FR-10 |  | PR-17 | Queue callables against the emulator (needs the sweep) |

### 2.3 K-Rei

| Path | Files | LOC | Tests | Story | Also serves | PR | What it does |
|---|---:|---:|---:|---|---|---|---|
| `src/views/customer/DiscoverView.vue` ⚑ | 1 | 301 |  | FR-01 | NFR-01 | PR-09 | UI-C1 landing page: search within 3 km, filter, results, lazy map |
| `src/components/ShopMapSection.vue` | 1 | 261 |  | FR-01 |  | PR-09 | "Barbers across Singapore" map and list view |
| `src/lib/discovery.js` | 1 | 57 |  | FR-01 |  | PR-09 | Distance, filtering, sorting |
| `src/lib/discoveryData.js` ⚑ | 1 | 76 |  | FR-01 | NFR-07 | PR-09 | Geohash queries and geocode callable |
| `src/lib/googleMap.js` | 1 | 199 |  | FR-01 |  | PR-09 | Google Maps loader, clustered pins, cards |
| `src/lib/regions.js` | 1 | 109 |  | FR-01 |  | PR-09 | Postal sector to area and region |
| `src/lib/shopMap.js` | 1 | 88 |  | FR-01 |  | PR-09 | Map data shaping, region grouping |
| `src/lib/shopMapData.js` ⚑ | 1 | 21 |  | FR-01 | NFR-07 | PR-09 | The single cached shops query behind the map |
| `src/lib/serviceTypes.js` ⚑ | 1 | 11 |  | FR-01 | FR-06 | PR-05 (dep.) | Fixed service categories (also used by the service form) |
| `src/stores/discover.js` | 1 | 12 |  | FR-01 |  | PR-09 | Search state kept when going back |
| `functions/geocode.js` | 1 | 107 |  | FR-01 |  | PR-09 | Postal code to coordinates (OneMap server-side, mock in emulator/demo) |
| `functions/postalSectors.js` | 1 | 102 |  | FR-01 |  | PR-09 | Postal-sector centroids for the geocode stub |
| `functions/discovery.js` ⚑ | 1 | 30 |  | FR-01 | FR-06 | PR-09 | Shop service summary recomputed when services change |
| `tests/discovery.test.mjs` | 1 | 156 | 20 | FR-01 |  | PR-09 | Discovery tests |
| `tests/geocode.unit.test.mjs` | 1 | 159 | 19 | FR-01 |  | PR-09 | Geocode tests |
| `tests/shopMap.test.mjs` | 1 | 193 | 32 | FR-01 |  | PR-09 | Map data tests (imports the demo catalogue) |
| `tests/booking.unit.test.mjs` ⚑ | 1 | 44 | 8 | FR-05 | FR-04 | PR-11 | Notice-window and cancel helper tests |
| `src/views/customer/WaitlistView.vue` | 1 | 401 |  | FR-15 |  | PR-16 | UI-C6: join a waitlist, claim an offer |
| `src/lib/waitlist.js` | 1 | 92 |  | FR-15 |  | PR-16 | Waitlist display logic |
| `functions/waitlist.js` ⚑ | 1 | 395 |  | FR-15 | FR-13 | PR-16 | joinWaitlist, offerFreedTime trigger, claimOffer |
| `tests/waitlist.unit.test.mjs` | 1 | 144 | 29 | FR-15 |  | PR-16 | Waitlist matching tests |
| `tests/waitlist.emulator.test.mjs` ⚑ | 1 | 854 | 58 | FR-15 | FR-13 | PR-16 | Waitlist flow against the emulator |
| `tests/waitlistUi.test.mjs` | 1 | 89 | 12 | FR-15 |  | PR-16 | Waitlist display tests |

### 2.4 Francis

| Path | Files | LOC | Tests | Story | Also serves | PR | What it does |
|---|---:|---:|---:|---|---|---|---|
| `src/views/staff/ShopConfigView.vue` ⚑ | 1 | 134 |  | FR-06 | FR-07 | PR-05 | UI-O1: services and barbers lists, active toggles, opens the forms |
| `src/views/staff/ServiceForm.vue` | 1 | 121 |  | FR-06 |  | PR-05 | Create/edit a service |
| `src/views/customer/DepositView.vue` | 1 | 225 |  | FR-13 |  | PR-15 | UI-C5: deposit checkout (mock, "Test mode") |
| `src/lib/deposit.js` | 1 | 52 |  | FR-13 |  | PR-10 (dep.) | Deposit display logic |
| `functions/payments.js` | 1 | 275 |  | FR-13 |  | PR-15 | createDeposit, signed paymentWebhook, mockPay |
| `scripts/seed-fr13.mjs` | 1 | 29 |  | FR-13 |  | PR-15 | Emulator seed for deposit scenarios |
| `tests/deposit.test.mjs` | 1 | 83 | 14 | FR-13 |  | PR-15 | Deposit display tests |
| `tests/payments.unit.test.mjs` | 1 | 126 | 14 | FR-13 |  | PR-15 | Signature and event tests |
| `src/views/staff/ScheduleView.vue` ⚑ | 1 | 489 |  | FR-08 | FR-09, FR-12 | PR-07 | UI-B1: barber day, time blocks, no-show marking |
| `src/lib/schedule.js` | 1 | 208 |  | FR-08 | FR-12 | PR-07 | Day-view logic (also used by the queue screen) |
| `functions/blocks.js` | 1 | 238 |  | FR-08 |  | PR-07 | createBlock/removeBlock, conflict listing |
| `tests/blocks.unit.test.mjs` | 1 | 139 | 15 | FR-08 |  | PR-07 | Block tests |
| `tests/schedule.test.mjs` | 1 | 260 | 41 | FR-08 | FR-12 | PR-07 | Day-view tests |
| `functions/service.js` ⚑ | 1 | 235 |  | FR-12 | FR-10, FR-13 | PR-12 | startService, finishService, markNoShow, reverseNoShow |
| `scripts/seed-fr12.mjs` | 1 | 72 |  | FR-12 |  | PR-12 | Emulator seed for no-show scenarios |
| `tests/service.unit.test.mjs` | 1 | 30 | 3 | FR-12 |  | PR-12 | No-show timing tests |
| `functions/stats.js` | 1 | 156 |  | FR-14 |  | PR-13 (dep.) | onAppointmentWritten trigger keeping dailyStats |
| `src/views/staff/DashboardView.vue` | 1 | 243 |  | FR-14 |  | PR-18 | UI-O2: owner dashboard |
| `src/components/dashboard/` | 5 | 350 |  | FR-14 |  | PR-18 | BarberTable, BaseChart, ChartCard, KpiCard, dashboard.css |
| `src/lib/dashboard.js` | 1 | 155 |  | FR-14 |  | PR-18 | Dashboard formulas |
| `src/lib/dashboardCharts.js` | 1 | 205 |  | FR-14 |  | PR-18 | Chart and trend data shaping |
| `src/lib/chartConfigs.js` | 1 | 135 |  | FR-14 |  | PR-18 | Chart.js configurations |
| `src/lib/chartSetup.js` | 1 | 36 |  | FR-14 |  | PR-18 | Tree-shaken Chart.js registration |
| `scripts/backfill-stats.mjs` | 1 | 26 |  | FR-14 |  | PR-18 | Rebuilds dailyStats |
| `tests/stats.unit.test.mjs` | 1 | 64 | 9 | FR-14 |  | PR-18 | Stats contribution tests |
| `tests/stats.trigger.test.mjs` | 1 | 123 | 9 | FR-14 |  | PR-18 | Stats trigger against the emulator |
| `tests/dashboard.test.mjs` | 1 | 134 | 19 | FR-14 |  | PR-18 | Dashboard formula tests |
| `tests/dashboardCharts.test.mjs` | 1 | 200 | 26 | FR-14 |  | PR-18 | Chart data tests |
| `tests/payments.emulator.test.mjs` ⚑ | 1 | 593 | 54 | FR-13 | FR-09 | PR-15 | Deposit flow against the emulator (needs no-shows and the sweep) |

### 2.5 Firas

| Path | Files | LOC | Tests | Story | Also serves | PR | What it does |
|---|---:|---:|---:|---|---|---|---|
| `src/assets/design-system.css` | 1 | 248 |  | NFR-06 | NFR-01 | PR-01 | Design tokens, focus styles, shared components |
| `src/assets/base.css` | 1 | 73 |  | NFR-06 |  | PR-01 | Base reset |
| `src/assets/main.css` ⚑ | 1 | 139 |  | NFR-06 | FR-14 | PR-01 | Global layout and screen styles (includes dashboard styles) |
| `src/assets/logo.svg` | 1 | 1 |  | NFR-06 |  | PR-01 | Template logo (unused) |
| `src/components/CustomerHeader.vue` | 1 | 23 |  | NFR-06 |  | PR-01 | Header for all customer pages |
| `src/components/StaffHeader.vue` | 1 | 96 |  | NFR-06 |  | PR-01 | Staff navigation, keyboard-safe dropdown |
| `src/components/FresherLogo.vue` | 1 | 39 |  | NFR-06 |  | PR-01 | Logo mark and wordmark |
| `src/components/CombMotif.vue` ⚑ | 1 | 14 |  | NFR-06 | FR-01 | PR-01 | Decorative motif (landing page) |
| `src/components/HelloWorld.vue` | 1 | 39 |  | NFR-06 |  | PR-01 | Vue starter template (unused) |
| `src/components/TheWelcome.vue` | 1 | 82 |  | NFR-06 |  | PR-01 | Vue starter template (unused) |
| `src/components/WelcomeItem.vue` | 1 | 76 |  | NFR-06 |  | PR-01 | Vue starter template (unused) |
| `src/components/icons/` | 5 | 47 |  | NFR-06 |  | PR-01 | Vue starter template icons (unused) |
| `src/lib/history.js` ⚑ | 1 | 61 |  | FR-11 | FR-13 | PR-03 (dep.) | Booking lists and rebook pre-fill logic |
| `tests/history.test.mjs` ⚑ | 1 | 117 | 17 | FR-11 | FR-13 | PR-03 (dep.) | History and rebook logic tests |
| `src/views/staff/BarberForm.vue` | 1 | 185 |  | FR-07 |  | PR-04 | Add (addBarber) or edit a barber and their hours |
| `scripts/seed.mjs` ⚑ | 1 | 210 |  | NFR-02 | FR-14, NFR-07 | PR-13 | Emulator seed and guarded live seed (no workbook story) |
| `scripts/demo/catalogue.mjs` ⚑ | 1 | 168 |  | NFR-02 | FR-01 | PR-09 | Demo shop catalogue (also imported by the FR-01 map test) |
| `scripts/demo/` ⚑ | 5 | 1006 |  | NFR-02 | FR-14, NFR-07 | PR-13 | Demo dataset generator, validator, writer, dry run (no workbook story) |
| `tests/demoData.unit.test.mjs` | 1 | 265 | 23 | NFR-02 |  | PR-13 | Demo dataset tests |

### 2.6 Shared files (⚑)

| Path | Owner (story) | Shared with |
|---|---|---|
| `vite.config.js` | Haziq (SETUP) | Firas (NFR-01) |
| `firestore.indexes.json` | Haziq (SETUP) | Alson (FR-09); K-Rei (FR-01, FR-15); Francis (FR-08) |
| `.env.production` | Haziq (SETUP) | Alson (NFR-04) |
| `functions/index.js` | Haziq (SETUP) | Alson (FR-04, FR-09, FR-10); K-Rei (FR-01, FR-05, FR-15); Francis (FR-06, FR-08, FR-12, FR-13, FR-14); Firas (FR-07, FR-11) |
| `functions/demo.js` | Haziq (SETUP) | Alson (NFR-04) |
| `src/router/index.js` | Haziq (SETUP) | Alson (FR-04, FR-09, FR-10); K-Rei (FR-01, FR-05, FR-15); Francis (FR-06, FR-08, FR-12, FR-13, FR-14); Firas (FR-07, FR-11) |
| `src/firebaseApp.js` | Haziq (SETUP) | Alson (NFR-04) |
| `src/stores/session.js` | Haziq (SETUP) | Firas (NFR-01) |
| `src/lib/demo.js` | Haziq (SETUP) | Alson (NFR-04) |
| `functions/booking.js` | Haziq (FR-02) | Alson (FR-04); K-Rei (FR-05, NFR-05); Francis (FR-13); Firas (FR-07) |
| `src/stores/booking.js` | Haziq (FR-02) | K-Rei (NFR-05) |
| `src/views/customer/ShopView.vue` | Haziq (FR-02) | Firas (FR-07, FR-11) |
| `src/views/customer/VerifyView.vue` | Haziq (FR-03) | K-Rei (FR-05); Francis (FR-13); Firas (NFR-02) |
| `tests/concurrency.test.mjs` | Haziq (NFR-03) | Alson (FR-04, FR-10); K-Rei (FR-05, NFR-05); Francis (FR-08, FR-12) |
| `tests/demo.unit.test.mjs` | Haziq (SETUP) | Alson (NFR-04) |
| `firestore.rules` | Alson (NFR-04) | Haziq (FR-02, FR-03, SETUP); K-Rei (FR-01, FR-05, FR-15); Francis (FR-06, FR-08, FR-12, FR-13, FR-14); Firas (FR-07, FR-11) |
| `tests/rules.test.mjs` | Alson (NFR-04) | K-Rei (FR-01, FR-15); Francis (FR-08, FR-12, FR-13, FR-14); Firas (FR-11) |
| `functions/notifications.js` | Alson (FR-09) | K-Rei (FR-15) |
| `src/views/customer/MyBookingsView.vue` | Alson (FR-04) | K-Rei (FR-05); Francis (FR-13); Firas (FR-11) |
| `src/views/staff/QueueView.vue` | Alson (FR-10) | Francis (FR-12) |
| `functions/sweep.js` | Alson (FR-09) | K-Rei (FR-15); Francis (FR-13) |
| `src/views/customer/DiscoverView.vue` | K-Rei (FR-01) | Firas (NFR-01) |
| `src/lib/discoveryData.js` | K-Rei (FR-01) | Firas (NFR-07) |
| `src/lib/shopMapData.js` | K-Rei (FR-01) | Firas (NFR-07) |
| `src/lib/serviceTypes.js` | K-Rei (FR-01) | Francis (FR-06) |
| `functions/discovery.js` | K-Rei (FR-01) | Francis (FR-06) |
| `tests/booking.unit.test.mjs` | K-Rei (FR-05) | Alson (FR-04) |
| `functions/waitlist.js` | K-Rei (FR-15) | Francis (FR-13) |
| `tests/waitlist.emulator.test.mjs` | K-Rei (FR-15) | Francis (FR-13) |
| `src/views/staff/ShopConfigView.vue` | Francis (FR-06) | Firas (FR-07) |
| `src/views/staff/ScheduleView.vue` | Francis (FR-08) | Alson (FR-09) |
| `functions/service.js` | Francis (FR-12) | Alson (FR-10) |
| `tests/payments.emulator.test.mjs` | Francis (FR-13) | Alson (FR-09) |
| `src/assets/main.css` | Firas (NFR-06) | Francis (FR-14) |
| `src/components/CombMotif.vue` | Firas (NFR-06) | K-Rei (FR-01) |
| `src/lib/history.js` | Firas (FR-11) | Francis (FR-13) |
| `tests/history.test.mjs` | Firas (FR-11) | Francis (FR-13) |
| `scripts/seed.mjs` | Firas (NFR-02) | Francis (FR-14) |
| `scripts/demo/catalogue.mjs` | Firas (NFR-02) | K-Rei (FR-01) |
| `scripts/demo/` | Firas (NFR-02) | Francis (FR-14) |

The shared files that matter most:

- **`src/router/index.js` and `functions/index.js`** hold one route or export block per story. Each PR adds only its own block (section 4). Edits to another story's block need that story owner's approval.
- **`functions/booking.js`** holds FR-02/FR-03 (Haziq), the FR-04 cancel and reschedule (Alson), the FR-05 notice rule (K-Rei), "Any available barber" for FR-07 (Firas) and the FR-13 deposit hold (Francis). Its owner reviews every change, and the affected story owner approves.
- **`firestore.rules` and `tests/rules.test.mjs`** belong to NFR-04 (Alson) but guard every story's data. A rules change also needs the affected story owner.
- **`tests/concurrency.test.mjs`** is NFR-03 (Haziq), but has describe blocks for FR-04, FR-05, FR-08, FR-10 and FR-12. Those owners keep their blocks green.
- **`src/views/customer/MyBookingsView.vue`** is FR-04 (Alson) and also shows FR-05 (K-Rei), FR-11 rebook (Firas) and FR-13 deposits (Francis).

---

## 3. Conventions

- **Branches:** `feat/<story>-<topic>` for features, `fix/<story>-<topic>` for fixes, `chore/<topic>` for setup, tests and tooling. Use lower case, e.g. `feat/fr-02-availability`, `fix/nfr-01-scroll-lag`, `chore/setup-foundation`.
- **Commits:** `tag(FR-xx): description`, in the imperative and lower case, e.g. `feat(FR-02): add slot availability and holdSlot`, `fix(NFR-01): stop scroll jank on the landing page`, `chore(FR-10): add queue emulator tests`. The setup story has no FR ID, so it uses `chore(setup): …`. Use the workbook's ID instead if it has one.
- **Pull requests:** the title is the first commit's message, e.g. `feat(FR-02): add slot availability and holdSlot`. The body lists the story, the files, the test totals (passed/failed/skipped, and which files ran) and how to see the change in the emulator. The reviewer is from another story owner.
- **Development:** emulators only. Nothing is deployed outside a story that says so.

---

## 4. Integration chain and Sprint 1 (21 – 30 Oct 2026)

### How integration works

The prototype stays on the `prototype` tag. `main` on GitHub started as a **baseline that holds only the docs**. Every story then brings its own files in from the tag, unchanged:

```sh
git checkout prototype -- <paths>
```

In a chain PR, the only hand edits allowed are its own route entries in `src/router/index.js` and export blocks in `functions/index.js`, copied verbatim from `git show prototype:<file>`, plus the stub routes described below. Story branches outside the chain (NFR-04 and NFR-06 in Sprint 1; NFR-01, NFR-05, NFR-08 and the FR-10 fix in Sprint 2) may change prototype files on purpose, and each lists the files it changed in its PR body. The close-out PR (PR-19) checks that `main` matches `prototype` for all app paths apart from those listed changes.

**The PRs form one chain across both sprints: each builds on the last.** Branch from `main` only after the previous PR has merged. If you start before then, branch from the previous PR's branch and rebase onto `main` once it merges.

**Dependencies.** The order follows the real imports. Some PRs import a file whose story comes later in the workbook. That file is brought in **unchanged, as a dependency only**, in the earliest PR that needs it: no route, no export and no story work. The file's owner stays its code owner and approves it in that PR. The story is still done and checked on its own workbook dates.

| Dependency | Its story (owner, dates) | Brought in by | Because |
|---|---|---|---|
| `functions/notifications.js`, `functions/messaging.js`, `tests/notifications.unit.test.mjs` | FR-09 (Alson, 2–4 Nov) | PR-02 (done) | `booking.js` (PR-06) requires `notifications.js` |
| `src/lib/history.js`, `tests/history.test.mjs` | FR-11 (Firas, 26–27 Oct) | PR-03 (open) | `ShopView` (PR-06) imports `history.js` |
| `src/lib/serviceTypes.js` | FR-01 (K-Rei, 21–27 Oct) | PR-05 | `ServiceForm` (PR-05) imports it |
| `src/lib/deposit.js` | FR-13 (Francis, 2–6 Nov) | PR-10 | `MyBookingsView` (PR-10) imports it |
| `functions/queue.js`, `functions/queueDelay.js` | FR-10 (Alson, 5–9 Nov) | PR-12 | `service.js` (PR-12) requires `queue.js`, which requires `queueDelay.js` |
| `functions/stats.js` | FR-14 (Francis, 7–9 Nov) | PR-13 | the demo generator and validator require it, and NFR-07 (2–3 Nov) needs the seed |

The other import edges are met by the order. `ShopConfigView` imports `BarberForm`, so PR-04 comes before PR-05. `ScheduleView`, `DiscoverView` and the discovery test import `slots.js`, so PR-06 comes before PR-07 and PR-09. `MyBookingsView` imports `customerAuth.js`, so PR-08 comes before PR-10. `sweep.js` requires `queue.js` (PR-12, then PR-14). `payments.unit.test` checks the `devRunSweep` export, and the payments emulator test needs no-shows and the sweep, so PR-12 and PR-14 come before PR-15. The waitlist emulator test requires `payments.js` (PR-15, then PR-16). The queue emulator test needs the sweep and `service.js`. The concurrency suite calls every callable, so PR-19 is last. A script replayed this chain on the prototype and confirmed that every import resolves at every step, and that every app file is present after PR-19.

**Stub routes.** PR-01 added stub routes (showing the sign-in page) for the named routes the headers link to. Each PR that brings in a screen replaces its stub with the real route. Two more names are linked from screens that arrive before their own screens: `waitlist` (from `ShopView` and `MyBookingsView`) and `deposit` (from `VerifyView` and `MyBookingsView`). PR-06 adds a `waitlist` stub and PR-08 adds a `deposit` stub, in the same form as PR-01's. PR-15 and PR-16 replace them.

Until PR-19 merges, run only your own tests (`node --test <files>`). The full `npm run test:rules` and `npm run test:concurrency` can only pass at the end, because `package.json` lists every test file from the start.

### PR chain

"Dependency" means the PR only brings in files for a later story (see above). Each target date is inside the dates of the PR's story. A dependency PR is dated by the PR that needs it, and PR-13 (no story) is dated by NFR-07, which needs it.

| # | Sprint | Target merge | Branch | Author | Reviewer | Story | Contents |
|---|---|---|---|---|---|---|---|
| PR-01 | 1 | Wed 21 Oct | `chore/setup-foundation` | Haziq | Alson (+ Firas as code owner) | Setup | **Merged (#2).** Config, Firebase modules, shell, router with sign-in and stubs, session, `functions/index.js` skeleton, demo/App Check switches; carries Alson's rules + rules tests (NFR-04) and Firas's design system and headers (NFR-06) |
| PR-02 | 1 | Thu 22 Oct | `feat/fr-09-notification-engine` | Alson | Haziq | Dependency (FR-09) | **Done, open as #5.** Notification task engine, mock messaging, unit test; needed by PR-06 |
| PR-03 | 1 | Thu 22 Oct | `feat/fr-11-history-logic` | Firas | Haziq | Dependency (FR-11) | **Open as #4.** History and rebook logic, tests; needed by PR-06 |
| PR-04 | 1 | Thu 22 Oct | `feat/fr-07-barbers` | Firas | Francis | FR-07 | Barber form, `addBarber` export |
| PR-05 | 1 | Thu 22 Oct | `feat/fr-06-services` | Francis | Firas | FR-06 | Shop config, service form; `serviceTypes.js` (dependency, FR-01) |
| PR-06 | 1 | Fri 23 Oct | `feat/fr-02-availability` | Haziq | Firas | FR-02 | `booking.js`, slots, booking store, ShopView |
| PR-07 | 1 | Mon 26 Oct | `feat/fr-08-time-blocks` | Francis | Alson | FR-08 | Schedule screen, blocks |
| PR-08 | 1 | Mon 26 Oct | `feat/fr-03-guest-booking` | Haziq | K-Rei | FR-03 | VerifyView, Phone Auth |
| PR-09 | 1 | Tue 27 Oct | `feat/fr-01-discovery` | K-Rei | Francis | FR-01 | Landing page, shop map, geocode, discovery (+ Firas's demo catalogue, used by the map test) |
| PR-10 | 1 | Tue 27 Oct | `feat/fr-04-cancel-reschedule` | Alson | K-Rei | FR-04 | My bookings, cancel and reschedule exports; `deposit.js` (dependency, FR-13) |
| PR-11 | 1 | Wed 28 Oct | `feat/fr-05-cancellation-window` | K-Rei | Alson | FR-05 | Notice-window tests |
| PR-12 | 1 | Thu 29 Oct | `feat/fr-12-no-shows` | Francis | Firas | FR-12 | Start/finish/no-show callables; `queue.js`, `queueDelay.js` (dependency, FR-10) |
| PR-13 | 2 | Mon 2 Nov | `chore/demo-dataset` | Firas | Haziq | (no story) | Seed and demo dataset; `stats.js` (dependency, FR-14) |
| PR-14 | 2 | Tue 3 Nov | `feat/fr-09-reminder-sweep` | Alson | K-Rei | FR-09 | Scheduled sweep, notification emulator test |
| PR-15 | 2 | Thu 5 Nov | `feat/fr-13-deposits` | Francis | Alson | FR-13 | Deposit checkout, payments, deposit and payments tests |
| PR-16 | 2 | Fri 6 Nov | `feat/fr-15-waitlist` | K-Rei | Francis | FR-15 | Waitlist screen, functions, tests |
| PR-17 | 2 | Fri 6 Nov | `feat/fr-10-queue` | Alson | Firas | FR-10 | Queue screen, client delay logic, walk-in exports, queue tests |
| PR-18 | 2 | Sat 7 Nov | `feat/fr-14-analytics` | Francis | Firas | FR-14 | Stats trigger export, dashboard |
| PR-19 | 2 | Sat 7 Nov | `chore/nfr-03-integration-suite` | Haziq | Firas | NFR-03 | Concurrency suite, demo switch tests, exact router and exports, parity check |

### Sprint 1 story branches (outside the chain)

Branch from `main` when ready; these do not wait for the chain.

| Target merge | Branch | Author | Reviewer | Story |
|---|---|---|---|---|
| Fri 23 Oct | `fix/nfr-04-app-check` | Alson | Haziq | NFR-04 |
| Fri 23 Oct | `feat/nfr-04-security-tests` | Alson | Francis | NFR-04 |
| Wed 28 Oct | `fix/nfr-06-accessibility` | Firas | K-Rei | NFR-06 |
| Thu 29 Oct | `chore/nfr-06-evidence` | Firas | Haziq | NFR-06 |

Reviews per person in Sprint 1 (PR-01 to PR-12 and the branches above): Haziq 4, Alson 3, K-Rei 3, Francis 3, Firas 3.

### Haziq

**Setup — repository, foundation PR, branch protection (Wed 21 Oct)** — PR-01 (merged)
As the team, we want a protected repository with the app foundation on `main`, so that every story can build on it.
- The `prototype` tag is pushed. Baseline `main` (docs, `.github/CODEOWNERS`) is pushed (commands in section 7).
- Branch protection on `main`: pull request required, 1 approval, "Require review from Code Owners", no force pushes. The CODEOWNERS placeholder handles are replaced, and GitHub reports no CODEOWNERS errors.
- PR-01 is merged. `npm run build` and `npm --prefix functions run lint` pass. `node --test tests/rules.test.mjs` passes against the emulator, with totals in the PR.
- `npm run dev` shows the sign-in page with the staff header, connected to the emulators.

**FR-02 Real-time availability (21–23 Oct)** — PR-06, target Fri 23 Oct
- `booking.js`, `slots.js`, the booking store and `ShopView` are copied unchanged. The `book` route and the `holdSlot`/`releaseHold` exports are added verbatim, plus the `waitlist` stub route.
- `slots.test` passes, with totals in the PR.
- On emulator data, the shop page shows only slots that fit the service, and a slot taken in a second tab disappears without a reload.

**FR-03 Guest booking (24–29 Oct)** — PR-08, target Mon 26 Oct
- `VerifyView` and `customerAuth.js` are copied unchanged. The `book-verify` route (with its booking-store guard and the `draft` import) and the `confirmBooking` export are added verbatim, plus the `deposit` stub route.
- A customer confirms a held slot with the emulator OTP for +65 9000 0001, and a wrong code three times releases the hold.

### Alson

**NFR-04 Security and privacy (21–23 Oct)** — PR-01 (rules and rules tests, merged), `fix/nfr-04-app-check` and `feat/nfr-04-security-tests`, target Fri 23 Oct
- **App Check (L1).** `docs/decisions.md` L1 and A17 are updated first. Then "Turning App Check on later" in `docs/deployment.md` is followed. `VITE_APP_CHECK_ENABLED` and `APP_CHECK_ENFORCE` are switched on together, and the reCAPTCHA key lists the serving domain. On a temporary preview channel, a callable without a token is rejected, and the callables on `main` that day (`addBarber`, `holdSlot`, `releaseHold`) still work from the app. Emulator development still works without a site key.
- **Isolation tests.** The security cases are written down first: a customer reading or changing another customer's data; staff of shop A touching shop B; a barber doing owner-only actions; unverified callers; a forged `paymentWebhook`. Missing rules cases are added as tests, and every case is rejected. The forged-webhook case is covered by the signature tests in `payments.unit.test`, which arrive with FR-13 (PR-15, reviewed by Alson); its result is added to the evidence then. Story owners approve rules changes to their data.
- **Secrets and dependencies.** No secret is in git history, the working tree or `dist/`. `npm audit` is recorded for root and `functions/`. The Maps key is referrer-restricted. Screenshots go in `docs/evidence/NFR-04/`, with no values shown.

**FR-04 Cancellation and rescheduling (26–28 Oct)** — PR-10, target Tue 27 Oct
- `MyBookingsView` is copied unchanged, plus `src/lib/deposit.js` (dependency, FR-13; Francis approves it as code owner). The `my-bookings` route replaces its stub, and the `cancelBooking`/`reschedule` exports are added verbatim.
- In the emulator, after an OTP, a customer cancels a booking (the slot frees at once) and reschedules another (the original stays if the new slot is taken).

### K-Rei

**FR-01 Shop discovery (21–27 Oct)** — PR-09, target Tue 27 Oct
- The discovery files are copied unchanged, plus `scripts/demo/catalogue.mjs` (Firas, unchanged), which `shopMap.test` imports. `serviceTypes.js` is already on `main` (PR-05). The `discover` (`/`) route replaces its stub, and the `geocode`/`summarizeShopServices` exports are added.
- `discovery.test`, `geocode.unit.test` and `shopMap.test` pass. A search for `160055` lists shops within 3 km, and the map loads only when scrolled into view.

**FR-05 Cancellation window (28–29 Oct)** — PR-11, target Wed 28 Oct
- `booking.unit.test.mjs` is copied, and it passes.
- In the emulator: the policy shows before confirmation (VerifyView); a late cancel at a `block` shop is refused and recorded once; at a `flag` shop it proceeds and is flagged. Each check is written down in the PR.

### Francis

**FR-06 Service configuration (21–22 Oct)** — PR-05, target Thu 22 Oct
- `ShopConfigView` and `ServiceForm` are copied unchanged, plus `src/lib/serviceTypes.js` (dependency, FR-01; K-Rei approves it as code owner). The `shop-config` route replaces its stub.
- An owner adds a service (name, duration in 5-minute steps, price), and it is listed in shop configuration. It appears on the shop page once PR-06 merges (Fri 23 Oct, one day after the story's end date); that check is recorded in the workbook.

**FR-08 Personal time blocks (23–27 Oct)** — PR-07, target Mon 26 Oct
- `ScheduleView`, `schedule.js` and `blocks.js` are copied unchanged. The `schedule` route replaces its stub, and the `createBlock`/`removeBlock` exports are added.
- `blocks.unit.test` and `schedule.test` pass. A block hides the slots inside it and lists conflicting bookings. (The start, finish and no-show buttons work from PR-12.)

**FR-12 No-show tracking (28–29 Oct)** — PR-12, target Thu 29 Oct
- `service.js` and `seed-fr12` are copied, plus `functions/queue.js` and `functions/queueDelay.js` (dependency, FR-10; Alson approves them as code owner). The start/finish/no-show exports are added. The walk-in exports wait for PR-17.
- `service.unit.test` passes. The no-show mark is possible only 15 minutes after the start, and is reversible within 24 hours.

### Firas

**FR-07 Multiple barbers (21–23 Oct)** — PR-04, target Thu 22 Oct
- `BarberForm` is copied unchanged, and the `addBarber` export is added.
- After PR-05 and PR-06 (by Fri 23 Oct): an owner adds a barber with hours, and "Any available barber" picks the eligible barber with the fewest bookings.

**FR-11 Booking history and rebooking (26–27 Oct)** — PR-03 (dependency, merged early on Thu 22 Oct for PR-06)
- `src/lib/history.js` and `history.test` are copied unchanged, and the tests pass.
- On Tue 27 Oct, after PR-10: a verified customer sees past bookings; rebook pre-fills shop, barber and service, and the pre-fill is suppressed when the service or barber is no longer available. Checked in the emulator and noted in the PR-10 review and the workbook.

**NFR-06 Accessibility (28–29 Oct)** — PR-01 (design system, merged), `fix/nfr-06-accessibility` (Wed 28 Oct), `chore/nfr-06-evidence` (Thu 29 Oct)
- An axe and keyboard-only audit of every screen on `main` (UI-C1–C4, UI-B1, UI-O1, staff sign-in) is recorded as an issue list (screen, element, rule, owner).
- Fixes: visible focus, labelled inputs, errors that name the field, keyboard-usable headers, 4.5:1 contrast. Fixes in other owners' screens are approved by them.
- Evidence: zero serious or critical axe issues, plus a keyboard-only walkthrough video of the booking flow.
- UI-C5, UI-C6, UI-B2 and UI-O2 arrive in Sprint 2 (PR-15 to PR-18). Each of those PRs records an axe run in its body, and any serious or critical issue is filed against NFR-06.

---

## 5. Sprint 2 (31 Oct – 10 Nov 2026): remaining FRs, NFR evidence and close-out

Evidence goes in `docs/evidence/<NFR-id>/`: method, raw output, result against the requirement, date and commit. New test scripts go under `tests/` and into `package.json`.

**Checkpoints:** the seed (PR-13) on Mon 2 Nov, before the NFR-07 cost run. The close-out (PR-19) on Sat 7 Nov, so the NFR-03 and NFR-05 reruns on Mon 9 Nov use the full suite. The scroll-lag fix on Sat 7 Nov, before the Lighthouse runs. All evidence by Mon 9 Nov; no story ends on Tue 10 Nov.

### Sprint 2 story branches (outside the chain)

| Target merge | Branch | Author | Reviewer | Story |
|---|---|---|---|---|
| Tue 3 Nov | `feat/nfr-08-audit-trail` | Haziq | K-Rei | NFR-08 |
| Tue 3 Nov | `chore/nfr-07-cost` | Firas | Francis | NFR-07 |
| Fri 6 Nov | `chore/nfr-02-usability` | Firas | Alson | NFR-02 |
| Sat 7 Nov | `fix/nfr-01-scroll-lag` | Firas | K-Rei | NFR-01 |
| Mon 9 Nov | `chore/nfr-01-lighthouse` | Firas | Francis | NFR-01 |
| Mon 9 Nov | `feat/nfr-03-load-test` | Haziq | Alson | NFR-03 |
| Mon 9 Nov | `feat/nfr-05-failure-handling` | K-Rei | Haziq | NFR-05 |
| Mon 9 Nov | `fix/fr-10-queue-screenshot` | Alson | Haziq | FR-10 |

Reviews per person in Sprint 2 (PR-13 to PR-19 and the branches above): 3 each.

### Haziq

**NFR-08 Auditability (2–3 Nov)** — `feat/nfr-08-audit-trail`, target Tue 3 Nov
- An emulator test drives every transition in the architecture.md state table. Each produces one `auditLog` record (booking ID, actor, timestamp, previous and resulting state) that matches the stored appointment.
- Clients cannot change audit records (rules test, reviewed by Alson as rules owner). `expireAt` is 12 months from the action date.
- **Date conflict:** the deposit (FR-13), waitlist (FR-15) and walk-in (FR-10) transitions reach `main` on 5–6 Nov, after NFR-08 ends. On 3 Nov the test covers the transitions on `main` and lists the missing ones. Either the workbook moves NFR-08's end date to 9 Nov, or the missing transitions are added on Mon 9 Nov as a follow-up.

**NFR-03 Booking integrity and concurrency (4–9 Nov)** — PR-19 (target Sat 7 Nov) and `feat/nfr-03-load-test` (target Mon 9 Nov)
- PR-19: `concurrency.test.mjs` and `demo.unit.test.mjs` are added. `src/router/index.js` and `functions/index.js` are compared with `prototype` and corrected, so any earlier copy mistakes show in the diff; the only differences left are lines changed by merged story branches, listed in the PR.
- PR-19: `npm run test:rules` and `npm run test:concurrency` pass in full, with totals for each run in the PR.
- PR-19: `git diff --stat prototype HEAD -- src functions firestore.rules firestore.indexes.json scripts tests public package.json package-lock.json vite.config.js jsconfig.json index.html firebase.json` lists only files changed by merged story branches (NFR-04, NFR-06, NFR-08 and any others merged by then), each named in the PR body.
- Load test: the existing 50-way race and repeated-submission tests are rerun, and their totals recorded. A new emulator script runs 1,000 booking transactions (concurrent batches over several barbers and overlapping periods), then checks every barber-day for overlapping intervals: zero overlaps. The evidence records run time, batch sizes and the commit.

### Alson

**FR-09 Automated reminders (2–4 Nov)** — PR-02 (dependency, Sprint 1) and PR-14, target Tue 3 Nov
- PR-02 (done): `notifications.js`, `messaging.js` and `notifications.unit.test` are copied unchanged, and the tests pass.
- PR-14: `sweep.js`, the sweep and backfill scripts and `notifications.emulator.test` are copied. The `processNotifications` and `devRunSweep` exports are added. The tests pass, with totals in the PR.
- `npm run sweep` sends due reminders through the mock provider and logs each attempt (timestamp, channel, outcome). Reminders are planned at 24 hours and 2 hours before the start, cancelled on cancellation and recalculated on reschedule.

**FR-10 Queue and reconciliation (5–9 Nov)** — PR-17 (target Fri 6 Nov) and `fix/fr-10-queue-screenshot` (target Mon 9 Nov)
- PR-17: `QueueView`, client queue logic, `seed-fr10`, `queue.unit.test` and `queue.emulator.test` are copied unchanged (`functions/queue.js` and `queueDelay.js` are on `main` since PR-12). The `queue` route replaces its stub, and the walk-in exports are added.
- `queue.unit.test` and `queue.emulator.test` pass. A barber adds, starts and finishes a walk-in, and projected delays show.
- Screenshot fix: the problem is written down first (what is wrong, viewport, data); the docs do not describe it yet. It is fixed in UI-B2, or in the seed data if that is the cause. New screenshots at 390 px and 1280 px go in `docs/evidence/screenshots/`.

### K-Rei

**FR-15 Waitlist (2–6 Nov)** — PR-16, target Fri 6 Nov
- The waitlist screen, client logic, functions and the three test files are copied unchanged. The `waitlist` route replaces its stub, and the `joinWaitlist`, `claimOffer` and `offerFreedTime` exports are added.
- The tests pass. A cancellation offers the freed slot to the earliest compatible entry.

**NFR-05 Reliability and failure handling (7–9 Nov)** — `feat/nfr-05-failure-handling`, target Mon 9 Nov
- 100 simulated failed booking writes, none shown as success. Method and counts recorded.
- 100 repeated submissions create at most one appointment (existing test rerun, after PR-19).
- With the network cut during booking, a message appears within 3 s and the entered name and number remain. Evidence is a screen recording.

### Francis

**FR-13 Escalating no-show policy (deposits) (2–6 Nov)** — PR-15, target Thu 5 Nov
- The deposit screen, `payments.js`, `seed-fr13`, `deposit.test`, `payments.unit.test` and `payments.emulator.test` are copied unchanged (`deposit.js` is on `main` since PR-10). The `deposit` route replaces its stub, and the `createDeposit`, `paymentWebhook` and `mockPay` exports are added.
- The three test files pass. The checkout shows the "Test mode" badge. After two no-shows a 50% deposit is required, the slot is held for 10 minutes pending payment, and the deposit is refundable on attendance and forfeited on a further no-show.

**FR-14 Shop analytics (7–9 Nov)** — PR-18, target Sat 7 Nov
- The dashboard files and the backfill script are copied unchanged (`stats.js` is on `main` since PR-13). The `dashboard` route replaces its stub, and the `onAppointmentWritten` export is added.
- The stats and dashboard tests pass. After `npm run backfill:stats`, the dashboard shows figures, charts, summaries and tables, and an empty range shows zeros with an empty-state message.

### Firas

**Seed and demo dataset (no workbook story)** — PR-13, target Mon 2 Nov
- `scripts/seed.mjs`, `scripts/demo/` and `demoData.unit.test` are copied unchanged, plus `functions/stats.js` (dependency, FR-14; Francis approves it as code owner).
- `npm run demo:dry-run` validates the dataset, and the test passes. `npm run seed` fills the screens on `main`; the Sprint 2 screens show the seeded data once their PRs land.

**NFR-07 Cost efficiency (2–3 Nov)** — `chore/nfr-07-cost`, target Tue 3 Nov
- A worksheet for 200 bookings per shop per month covers hosting, Firestore, Functions, OTP SMS, reminders and retries, with dated prices.
- Read counts come from an emulator run of a typical booking, and the result is compared with S$5 per active shop per month. Any repeated reads of still-valid data are listed, then fixed or justified.

**NFR-02 Usability (4–6 Nov)** — `chore/nfr-02-usability`, target Fri 6 Nov
- A task script and consent form are written, and the number of non-team first-time participants is agreed in advance (at least 8 suggested).
- The completion rate without help is recorded against 95%, with the sample size, and stated honestly if missed. The summary screen, field-named errors and confirmation details are checked. Findings are filed against the owning story.

**NFR-01 Mobile performance (7–9 Nov)** — `fix/nfr-01-scroll-lag` (target Sat 7 Nov) and `chore/nfr-01-lighthouse` (target Mon 9 Nov)
- **Scroll lag.** Recorded first: page, device, steps and a Performance recording. The docs do not describe it yet. If the cause is in another owner's file, that owner approves the fix (section 2). After the fix there are no frames over 50 ms while scrolling, with no visible design change.
- **Lighthouse.** Mobile, 5 runs, median, at least 85 on `/`, a shop page, verify, my bookings, waitlist and deposit. The booking flow loads in 3 s or less on 4G throttling. No horizontal scroll at 320, 390, 768 and 1280 px.

---

## 6. Not yet in the workbook

These were in the earlier plan but have no workbook story or owner. Add them to the workbook (with owners and a sprint) or drop them:

- **Final deploy:** follow `docs/deployment.md`, add the final channel domain to the reCAPTCHA key, record the smoke checklist and the channel expiry.
- **Report:** sections per story, a traceability matrix (FR/NFR to T-Fxx/T-Nxx, tests, evidence) and a project README. It must state that messaging and payments are mocked.
- **Demo:** a script covering every screen, a data reset step, a backup recording and timed rehearsals.
- **Release notes and a `v1.0` tag** on the deployed commit.

---

## 7. Git commands

### Once, as part of setup (Haziq, 21 Oct)

In the clone that has the `prototype` tag. The old local `main` is kept as `prototype-main`.

```sh
git push origin prototype
git switch --orphan baseline
git rm -r -q --cached .                        # untrack everything; files stay on disk
git add .gitignore README.md CLAUDE.md docs .github .agents .claude skills-lock.json .vscode/extensions.json .firebase
git commit -m "chore(setup): add docs, team plan and CODEOWNERS baseline"
git branch -m main prototype-main
git branch -m baseline main
git push -u origin main
```

Then turn on branch protection. **Everyone, Haziq included, works from a fresh clone from here on:**

```sh
git clone <repo URL> fresher && cd fresher
git fetch origin --tags
npm install && npm --prefix functions install
cp .env.example .env.local
```

### Every integration PR

```sh
git switch main && git pull                    # after the previous PR in the chain has merged
git switch -c <branch>
git checkout prototype -- <paths>              # paths below
git show prototype:src/router/index.js         # copy only your routes
git show prototype:functions/index.js          # copy only your export blocks
npm run build && npm --prefix functions run lint
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node --test <your test files>
git add -A
git commit -m "feat(FR-xx): <description>"
git push -u origin <branch>
gh pr create --base main --title "feat(FR-xx): <description>" --reviewer <reviewer handle>   # or "Compare & pull request" on GitHub
```

In a PR that brings in a dependency, say so in the body: the file, its story and the importing file, and that it is unchanged.

### Paths, routes, exports and commit per PR

**PR-01 `chore/setup-foundation`** — Haziq, reviewer Alson — merged (#2)
```sh
git checkout prototype -- package.json package-lock.json vite.config.js jsconfig.json index.html firebase.json \
  .firebaserc firestore.indexes.json .env.example .env.production public functions/package.json \
  functions/package-lock.json functions/.eslintrc.js functions/.gitignore functions/demo.js src/main.js \
  src/App.vue src/firebase.js src/firebaseApp.js src/firebaseAuth.js src/firebaseDb.js \
  src/firebaseFunctions.js src/stores/session.js src/views/staff/SignInView.vue src/lib/demo.js \
  firestore.rules tests/rules.test.mjs src/assets/design-system.css src/assets/base.css src/assets/main.css \
  src/assets/logo.svg src/components/CustomerHeader.vue src/components/StaffHeader.vue \
  src/components/FresherLogo.vue src/components/CombMotif.vue src/components/HelloWorld.vue \
  src/components/TheWelcome.vue src/components/WelcomeItem.vue src/components/icons
git commit -m "chore(setup): add foundation, rules and design system from prototype"
```
Route: `/login`, plus stub routes for the names the headers link to. `functions/index.js`: header, `setGlobalOptions`, `APP_CHECK` and shared helpers only (no exports yet; drop requires that later blocks use, or lint fails). Tests: tests/rules.test.mjs.
Hand-written in this PR: `src/router/index.js` and `functions/index.js` as described above.

**PR-02 `feat/fr-09-notification-engine`** — Alson, reviewer Haziq — dependency (FR-09), done, open as #5
```sh
git checkout prototype -- functions/notifications.js functions/messaging.js tests/notifications.unit.test.mjs
git commit -m "feat(FR-09): add notification task engine and mock messaging"
```
No route or export. Tests: tests/notifications.unit.test.mjs.

**PR-03 `feat/fr-11-history-logic`** — Firas, reviewer Haziq — dependency (FR-11), open as #4
```sh
git checkout prototype -- src/lib/history.js tests/history.test.mjs
git commit -m "feat(FR-11): add booking history and rebook logic"
```
No route or export. Tests: tests/history.test.mjs.

**PR-04 `feat/fr-07-barbers`** — Firas, reviewer Francis
```sh
git checkout prototype -- src/views/staff/BarberForm.vue
git commit -m "feat(FR-07): add barber form and addBarber"
```
Export: `addBarber`. Tests: (none of its own).

**PR-05 `feat/fr-06-services`** — Francis, reviewer Firas (+ K-Rei as code owner of `serviceTypes.js`)
```sh
git checkout prototype -- src/views/staff/ShopConfigView.vue src/views/staff/ServiceForm.vue \
  src/lib/serviceTypes.js
git commit -m "feat(FR-06): add shop configuration and service form"
```
Route: `shop-config` (replaces the stub). Dependency: `src/lib/serviceTypes.js` (FR-01). Tests: (none of its own).

**PR-06 `feat/fr-02-availability`** — Haziq, reviewer Firas
```sh
git checkout prototype -- functions/booking.js src/lib/slots.js src/stores/booking.js \
  src/views/customer/ShopView.vue tests/slots.test.mjs
git commit -m "feat(FR-02): add slot availability and holdSlot"
```
Route: `book`, plus a `waitlist` stub. Exports: `holdSlot`, `releaseHold`. Tests: tests/slots.test.mjs.

**PR-07 `feat/fr-08-time-blocks`** — Francis, reviewer Alson
```sh
git checkout prototype -- src/views/staff/ScheduleView.vue src/lib/schedule.js functions/blocks.js \
  tests/blocks.unit.test.mjs tests/schedule.test.mjs
git commit -m "feat(FR-08): add barber schedule and personal time blocks"
```
Route: `schedule` (replaces the stub). Exports: `createBlock`, `removeBlock`. Tests: tests/blocks.unit.test.mjs tests/schedule.test.mjs.

**PR-08 `feat/fr-03-guest-booking`** — Haziq, reviewer K-Rei
```sh
git checkout prototype -- src/views/customer/VerifyView.vue src/lib/customerAuth.js
git commit -m "feat(FR-03): add OTP verification and confirmBooking"
```
Route: `book-verify` (and the `draft` import from `@/stores/booking`), plus a `deposit` stub. Export: `confirmBooking`. Tests: (none of its own; check the flow in the emulator).

**PR-09 `feat/fr-01-discovery`** — K-Rei, reviewer Francis
```sh
git checkout prototype -- src/views/customer/DiscoverView.vue src/components/ShopMapSection.vue \
  src/lib/discovery.js src/lib/discoveryData.js src/lib/googleMap.js src/lib/regions.js src/lib/shopMap.js \
  src/lib/shopMapData.js src/stores/discover.js functions/geocode.js \
  functions/postalSectors.js functions/discovery.js tests/discovery.test.mjs tests/geocode.unit.test.mjs \
  tests/shopMap.test.mjs scripts/demo/catalogue.mjs
git commit -m "feat(FR-01): add shop discovery and shop map"
```
Route: `discover` (`/`, replaces the stub). Exports: `geocode`, `summarizeShopServices`. Tests: tests/discovery.test.mjs tests/geocode.unit.test.mjs tests/shopMap.test.mjs.

**PR-10 `feat/fr-04-cancel-reschedule`** — Alson, reviewer K-Rei (+ Francis as code owner of `deposit.js`)
```sh
git checkout prototype -- src/views/customer/MyBookingsView.vue src/lib/deposit.js
git commit -m "feat(FR-04): add my bookings, cancel and reschedule"
```
Route: `my-bookings` (replaces the stub). Exports: `cancelBooking`, `reschedule`. Dependency: `src/lib/deposit.js` (FR-13). Tests: (none of its own; history.test already ran in PR-03, deposit.test runs in PR-15).

**PR-11 `feat/fr-05-cancellation-window`** — K-Rei, reviewer Alson
```sh
git checkout prototype -- tests/booking.unit.test.mjs
git commit -m "feat(FR-05): add cancellation window tests"
```
No route or export. Tests: tests/booking.unit.test.mjs.

**PR-12 `feat/fr-12-no-shows`** — Francis, reviewer Firas (+ Alson as code owner of the queue files)
```sh
git checkout prototype -- functions/service.js scripts/seed-fr12.mjs tests/service.unit.test.mjs \
  functions/queue.js functions/queueDelay.js
git commit -m "feat(FR-12): add start, finish and no-show callables"
```
Exports: `startService`, `finishService`, `markNoShow`, `reverseNoShow` (not the walk-in exports). Dependency: `functions/queue.js`, `functions/queueDelay.js` (FR-10). Tests: tests/service.unit.test.mjs.

**PR-13 `chore/demo-dataset`** — Firas, reviewer Haziq (+ Francis as code owner of `stats.js`)
```sh
git checkout prototype -- scripts/seed.mjs scripts/demo tests/demoData.unit.test.mjs functions/stats.js
git commit -m "chore(NFR-02): add seed and demo dataset"
```
No route or export. Dependency: `functions/stats.js` (FR-14). Also run `npm run demo:dry-run`. Tests: tests/demoData.unit.test.mjs.

**PR-14 `feat/fr-09-reminder-sweep`** — Alson, reviewer K-Rei
```sh
git checkout prototype -- functions/sweep.js scripts/sweep.mjs scripts/backfill-notifications.mjs \
  tests/notifications.emulator.test.mjs
git commit -m "feat(FR-09): add scheduled reminder sweep"
```
Exports: `processNotifications`, `devRunSweep` (the emulator-only block). Tests: tests/notifications.emulator.test.mjs.

**PR-15 `feat/fr-13-deposits`** — Francis, reviewer Alson
```sh
git checkout prototype -- src/views/customer/DepositView.vue functions/payments.js scripts/seed-fr13.mjs \
  tests/deposit.test.mjs tests/payments.unit.test.mjs tests/payments.emulator.test.mjs
git commit -m "feat(FR-13): add deposit checkout and payments"
```
Route: `deposit` (replaces the stub). Exports: the FR-13 block (`createDeposit`, `paymentWebhook`, `mockPay`). Tests: tests/deposit.test.mjs tests/payments.unit.test.mjs tests/payments.emulator.test.mjs.

**PR-16 `feat/fr-15-waitlist`** — K-Rei, reviewer Francis
```sh
git checkout prototype -- src/views/customer/WaitlistView.vue src/lib/waitlist.js functions/waitlist.js \
  tests/waitlist.unit.test.mjs tests/waitlist.emulator.test.mjs tests/waitlistUi.test.mjs
git commit -m "feat(FR-15): add waitlist and freed-time offers"
```
Route: `waitlist` (replaces the stub). Exports: `joinWaitlist`, `claimOffer`, `offerFreedTime`. Tests: tests/waitlist.unit.test.mjs tests/waitlist.emulator.test.mjs tests/waitlistUi.test.mjs.

**PR-17 `feat/fr-10-queue`** — Alson, reviewer Firas
```sh
git checkout prototype -- src/views/staff/QueueView.vue src/lib/queue.js scripts/seed-fr10.mjs \
  tests/queue.unit.test.mjs tests/queue.emulator.test.mjs
git commit -m "feat(FR-10): add walk-in queue and delay warnings"
```
Route: `queue` (replaces the stub). Exports: `addWalkIn`, `startWalkIn`, `finishWalkIn`, `removeWalkIn`. Tests: tests/queue.unit.test.mjs tests/queue.emulator.test.mjs.

**PR-18 `feat/fr-14-analytics`** — Francis, reviewer Firas
```sh
git checkout prototype -- src/views/staff/DashboardView.vue src/components/dashboard \
  src/lib/dashboard.js src/lib/dashboardCharts.js src/lib/chartConfigs.js src/lib/chartSetup.js \
  scripts/backfill-stats.mjs tests/stats.unit.test.mjs tests/stats.trigger.test.mjs tests/dashboard.test.mjs \
  tests/dashboardCharts.test.mjs
git commit -m "feat(FR-14): add analytics trigger and owner dashboard"
```
Route: `dashboard` (replaces the stub). Export: `onAppointmentWritten`. Tests: tests/stats.unit.test.mjs tests/stats.trigger.test.mjs tests/dashboard.test.mjs tests/dashboardCharts.test.mjs.

**PR-19 `chore/nfr-03-integration-suite`** — Haziq, reviewer Firas
```sh
git checkout prototype -- tests/concurrency.test.mjs tests/demo.unit.test.mjs
git diff prototype -- src/router/index.js functions/index.js   # only lines from merged story branches may remain
git commit -m "chore(NFR-03): add concurrency suite and restore full router and exports"
```
Brings `src/router/index.js` and `functions/index.js` to the prototype versions, keeping only lines changed by merged story branches. Then `npm run test:rules && npm run test:concurrency` and the parity `git diff` (section 5, NFR-03). Tests: tests/concurrency.test.mjs tests/demo.unit.test.mjs.

### Story branches

```sh
git switch main && git pull
git switch -c fix/nfr-04-app-check
git commit -m "fix(NFR-04): enforce App Check on the demo"
git push -u origin fix/nfr-04-app-check
gh pr create --base main --title "fix(NFR-04): enforce App Check on the demo" --reviewer <Haziq's handle>
```

---

## 8. Definition of Done (every PR)

- Approved by the named reviewer (another story owner) and by the code owner of every file touched. For shared files, approved by the owner of the story the change affects.
- `npm run build` and `npm --prefix functions run lint` pass. The relevant tests pass, and the PR states the totals (passed/failed/skipped) and the files run.
- Branch and commit names follow section 3. New functions and components carry the requirement ID in a comment (CLAUDE.md).
- No secrets in the diff.
- If a decision changes, `docs/decisions.md` is updated first, in the same PR.
- Nothing is deployed except the temporary App Check preview channel (NFR-04) and the final deploy, once it is in the workbook.
