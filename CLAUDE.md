# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fresher is a multi-shop barber booking app (Vue 3 + Vite frontend; Firebase Auth, Firestore, Cloud Functions, Security Rules, App Check, Hosting). It is a student prototype (BT3103). The foundation exists (`src/firebase.js` emulator wiring, real `firestore.rules`, `scripts/seed.mjs`, `tests/rules.test.mjs`), and FR-06/FR-07 exist (staff sign-in, UI-O1 shop configuration in `src/views/staff/`, Vue Router guard in `src/router/`, `addBarber` in `functions/index.js`). FR-02/FR-03 exist (UI-C2/C3 in `src/views/customer/`, `holdSlot`/`confirmBooking`/`releaseHold` in `functions/booking.js`, concurrency test `npm run test:concurrency`). FR-01 exists (UI-C1 at `/` in `src/views/customer/DiscoverView.vue`, now the landing page with search state kept in `src/stores/discover.js` (A15); customer pages share `CustomerHeader.vue`, `geocode` callable and the `summarizeShopServices` trigger, pure logic in `src/lib/discovery.js`; `ONEMAP_TOKEN` is a Functions secret and is mocked when unset, emulator only). FR-08 exists (UI-B1 at `/staff/schedule` in `src/views/staff/ScheduleView.vue`, `createBlock`/`removeBlock` in `functions/blocks.js`, pure day-view logic in `src/lib/schedule.js`; barbers land on it after sign-in, owners on `/staff/config`). FR-12 exists (start/finish/no-show buttons on UI-B1; `startService`/`finishService`/`markNoShow`/`reverseNoShow` in `functions/service.js`). FR-11 exists (History tab and Rebook on UI-C4, pure logic in `src/lib/history.js`). FR-14 exists (UI-O2 at `/staff/dashboard` in `src/views/staff/DashboardView.vue`, owner only; `onAppointmentWritten` in `functions/stats.js` maintains `dailyStats` through a `statContrib` ledger; pure logic in `src/lib/dashboard.js`; `npm run backfill:stats`). FR-09 exists (reminder tasks written by `confirmBooking`/`cancelBooking`/`reschedule` via `functions/notifications.js`; `processNotifications` in `functions/sweep.js` runs every minute, sends through the mock provider in `functions/messaging.js` and expires HELD appointments (resolves L2); reminder status per booking on UI-B1; `npm run sweep` runs it by hand against the emulators; `npm run backfill:notifications` adds missing reminders to older bookings). FR-13 exists (`confirmBooking` moves a customer with `shopStats.noShowCount >= 2` to PENDING_PAYMENT with a `deposits/{bookingId}` doc; `functions/payments.js` holds the mock payment provider, `createDeposit`, the signed `paymentWebhook` (HTTPS) and the emulator-only `mockPay`; UI-C5 at `/deposit/:requestId` in `src/views/customer/DepositView.vue`, pure logic in `src/lib/deposit.js`; the expiry sweep also expires PENDING_PAYMENT; `npm run seed:fr13` creates a test customer with two no-shows). FR-15 exists (`functions/waitlist.js`: `joinWaitlist`, `claimOffer` and the `offerFreedTime` trigger on schedule writes, which offers freed time to the earliest compatible entry as a 15-minute exclusive HELD appointment with `waitlistEntryId`, only if the slot starts at least 15 minutes ahead; `claimOffer` reuses `confirmHeldInTx` from `booking.js`, so the FR-13 deposit rule applies; the sweep also expires lapsed offers and entries at the end of their date; UI-C6 at `/waitlist` in `src/views/customer/WaitlistView.vue`, pure logic in `src/lib/waitlist.js`). FR-10 exists (UI-B2 at `/staff/queue` in `src/views/staff/QueueView.vue`, owner and barber, a barber sees only their own queue; `addWalkIn`/`startWalkIn`/`finishWalkIn`/`removeWalkIn` in `functions/queue.js`; walk-ins live only in `shops/{shopId}/queue` and are not schedule intervals; bookings come first, so waiting walk-ins never delay a booking and only get an estimated wait; the delay projection and warning rule are in `functions/queueDelay.js` with a client copy in `src/lib/queue.js` that `tests/queue.unit.test.mjs` keeps in step; `startService`/`finishService`, the queue callables and the sweep recalculate, and a delay over 10 minutes writes one `{bookingId}_delay` task only if it can go out at least 15 minutes before the start; `npm run seed:fr10`). No other customer screens or callables yet; the starter template components remain unused. Most of the architecture below is design to build toward.

## Commands

```sh
npm install
npm run dev          # Vite dev server
npm run build        # outputs dist/ (served by Firebase Hosting)

npm --prefix functions install
npm --prefix functions run lint   # ESLint (google config); also the firebase predeploy step

npx -y firebase-tools@latest emulators:start   # Auth 9099, Functions 5001, Firestore 8080, Hosting 5002, UI
npm run seed         # fictional shops/barbers/services + staff logins into the RUNNING emulators (refuses without emulator env vars)
npm run seed:fr13   # FR-13: test customer (+65 9123 0013) with 2 no-shows at shop-jurong, so a booking there needs a deposit
npm run seed:fr10   # FR-10: Jun Wei running late (a booking in service, one 25 min late, one walk-in) for UI-B2
npm run sweep      # FR-09: run one notification + expiry sweep now (the emulator does not fire schedules); --watch repeats every 60 s
npm run test:concurrency  # NFR-03/05: needs Auth, Functions and Firestore emulators running (functions loaded)
npm run test:rules   # Security Rules tests (node --test) against the already-running emulator; uses project id fresher-rules-test, so seeded data is untouched
```

- Never start emulators from a session: they are expected to be running already in the user's terminal. They need JDK 21+. Copy `.env.example` to `.env.local` for the `VITE_FIREBASE_*` values (placeholders are fine in dev).
- The only automated tests are the rules tests. Run the narrowest relevant build, lint or rules test after changes. Concurrency tests (NFR-03/05) are meant to run against the Firestore emulator with scripted concurrent calls.
- Node: root `^22.18.0 || >=24.12.0`; `functions/` uses Node 24.
- Use the emulators for development. Do not deploy or touch production services.
- Module style: root package is ESM; `functions/` is CommonJS. Follow the local style in each.
- Use the `@` alias for `src` imports.

## Read the docs before implementing a feature

[docs/requirements.md](docs/requirements.md) (FR-01..15, NFR-01..08, release tiers), [docs/architecture.md](docs/architecture.md) (trust zones, data model, state machine, callable functions, `holdSlot` algorithm), [docs/decisions.md](docs/decisions.md) (decision register A1..).

- Keep the "Known limitations and backlog" section at the end of `docs/decisions.md` current: add an entry whenever a shortcut is taken or work is deferred, and mark it resolved when fixed. It becomes the report's Limitations section. L1 (App Check) blocks any public demo or deployment; L2 (expired HELD docs) must be handled in UI-B1 and the FR-09 cleanup job.
- Use PROPOSED decisions as defaults. If something is OPEN or missing, ask; don't invent rules. When a decision changes, update `docs/decisions.md` first, then the code.
- Build order: Core requirements first, then Extensions, then Stretch (see Release status in requirements.md).

## Architecture (big picture)

- **Browser is untrusted.** No secrets (OneMap token, messaging/payment keys) in the bundle; those live in Cloud Functions secrets (`defineSecret`). External services (OneMap geocoding, messaging, payment) are called only from functions.
- **Clients never write** to `appointments`, `schedules`, `deposits`, `notifications`, `auditLog`, `waitlist`, `queue`. Security Rules deny it; all booking state changes go through callable functions (`holdSlot`, `confirmBooking`, `cancelBooking`, `reschedule`, `markNoShow`, ... full list in architecture.md). Each function: check auth/role → load state in a Firestore transaction → verify the transition against the appointment state table → write the new state **and** an `auditLog` record in the same transaction.
- **Concurrency model:** one `schedules/{barberId_yyyymmdd}` doc per barber-day holds `intervals[]` (booking/hold/block) and acts as the lock document. Transactions ignore expired holds, so correctness never depends on the scheduler. `holdSlot` is idempotent via a client-generated `requestId` that is also the `appointments` doc ID; duration/end are computed server-side.
- **Data conventions:** half-open intervals `[start, end)`; money as integer SGD cents; Timestamps in UTC; appointments snapshot `priceCents`/`durationMin`; deterministic notification IDs `{bookingId}_{type}`.
- **Region/time zone:** `asia-southeast1` for Firestore and all functions; `Asia/Singapore` for shop-local dates and times.
- **Identity:** customers use Phone Auth (SMS OTP, SG mobiles only; fresh OTP needed for history or booking changes); staff use email/password with custom claims `{ shopId, role: owner|barber }` (barbers also `barberId`) set by `addBarber`; platform admin claim `admin: true` may only change shop `status`. No anonymous auth. Staff access is scoped to their own shop. Staff cannot read `customers`; `confirmBooking` copies `customerName` and a masked phone onto the appointment.
- Messaging and payment are **mocked** behind small interfaces in the prototype, and the UI/report must say so.
- `src/firebase.js` re-exports Auth, Firestore and Functions, each in its own module (`firebaseAuth.js`, `firebaseDb.js`, `firebaseFunctions.js`) that connects to the emulators when `import.meta.env.DEV` is true; the landing page loads Firebase lazily and Auth only on demand (A16), so never import `@/firebase` from code the landing page loads statically; App Check is not wired yet.
- Security Rules are part of each feature: extend `firestore.rules` and `tests/rules.test.mjs` together. Rules default-deny and allow no client writes to server-owned collections; `notifications` and `deposits` carry `shopId` so staff reads can be scoped.

## UI conventions

Mobile-first, accessible labelled controls, visible focus, field-level validation, and entered form data preserved after recoverable failures (SLOT_TAKEN, OTP failure, network loss). Design direction: off-white background, charcoal text, dark teal action colour, labelled status indicators. Tokens, shared button/card/badge/field styles and the AA contrast table are in `src/assets/design-system.css` (decision A14); use its `--color-*`, `--space-*` and `--radius-*` variables rather than hard-coded values; the logo is `src/components/FresherLogo.vue`, the favicon `public/favicon.svg`. Keep changes to the starter components minimal; keep feature code near its owning screen (UI-C1..C6 customer, UI-B1/B2 barber, UI-O1/O2 owner).
