# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Fresher is a multi-shop barber booking app built for BT3103 (Group 6). The frontend is Vue 3 with Vite; the backend uses Firebase Auth, Firestore, Cloud Functions, Security Rules, App Check and Hosting.

- **Status:** all Core and Extension features (FR-01 to FR-15) are on `main`, with evidence for every non-functional requirement in `docs/evidence/`. Sprint 2 ended on Sat 14 Nov 2026.
- **Code freeze:** `main` only takes fixes for problems found in the smoke test or rehearsal.
- **Demo services:** messaging and payments are mocked behind small interfaces, and the UI and report must say so.

## Architecture

- **The browser is untrusted.** No secrets (OneMap token, messaging or payment keys) go in the bundle. They live in Cloud Functions secrets (`defineSecret`), and external services are called only from functions.
- **Clients never write booking data.** Security Rules deny client writes to `appointments`, `schedules`, `deposits`, `notifications`, `auditLog`, `waitlist` and `queue`. Every booking state change goes through a callable function that:
  1. checks auth and role,
  2. loads the current state in a Firestore transaction,
  3. verifies the transition against the appointment state table,
  4. writes the new state **and** an `auditLog` record in the same transaction (NFR-08).
- **Concurrency model:** one `shops/{shopId}/schedules/{barberId_yyyymmdd}` document per barber per day holds `intervals[]` (bookings, holds and blocks) and acts as the lock document. Transactions ignore expired holds, so correctness never depends on the scheduler. `holdSlot` is idempotent through a client-generated `requestId`, which is also the `appointments` document ID. Duration and end time are computed on the server.
- **Identity:**
  - Customers use Phone Auth (SMS OTP, Singapore mobiles only). Seeing bookings needs an OTP sign-in; cancelling or rescheduling needs one from the last 10 minutes.
  - Staff use email and password, with custom claims `{ shopId, role: owner|barber, barberId }` set by `addBarber`. Staff access is scoped to their own shop.
  - The platform admin claim `admin: true` may only change a shop's `status`.
  - No anonymous auth.
- **App Check** is enforced on every callable outside the emulator (decisions A17).
- **Region and time zone:** `asia-southeast1` for Firestore and all functions; `Asia/Singapore` for shop-local dates and times.
- **Data conventions:** half-open intervals `[start, end)`; money as integer SGD cents; Timestamps in UTC; appointments snapshot `priceCents` and `durationMin`; deterministic notification IDs `{bookingId}_{type}`.

## Where things are

- **Customer screens** (`src/views/customer/`): `DiscoverView` (FR-01 search and map), `ShopView` (FR-02 slots), `VerifyView` (FR-03 OTP and confirm), `MyBookingsView` (FR-04/05 cancel and reschedule, FR-11 history), `DepositView` (FR-13), `WaitlistView` (FR-15).
- **Staff screens** (`src/views/staff/`): `SignInView`, `ShopConfigView` with `ServiceForm` and `BarberForm` (FR-06/07), `ScheduleView` (FR-08 blocks, FR-12 actions), `QueueView` (FR-10 walk-ins and delays), `DashboardView` (FR-14, owner only).
- **Shared client logic:** `src/lib/` holds pure, unit-tested helpers. Firebase setup is in `src/firebase*.js`; each module connects to the emulators when `import.meta.env.DEV` is true.
- **Cloud Functions** (`functions/`, CommonJS, Node 24):
  - `booking.js`: holdSlot, confirmBooking, releaseHold, cancelBooking, reschedule
  - `service.js`: FR-12 start, finish, no-show
  - `blocks.js`: FR-08 personal time blocks
  - `queue.js` and `queueDelay.js`: FR-10 walk-ins and delays
  - `payments.js`: FR-13 deposits, mock provider
  - `waitlist.js`: FR-15
  - `notifications.js` and `sweep.js`: FR-09 reminders and hold expiry
  - `stats.js`: FR-14 trigger
  - `discovery.js` and `geocode.js`: FR-01
  - `index.js` wires them all up.
- **Rules:** `firestore.rules` (default deny; clients never write booking data).
- **Docs:** `docs/requirements.md`, `docs/architecture.md`, `docs/decisions.md` (A1 onwards), `docs/deployment.md`, `docs/team-plan.md`, and NFR evidence in `docs/evidence/NFR-0x/`.

## Commands

```sh
npm install && npm --prefix functions install
npm run dev                 # Vite dev server (talks to the emulators)
npm run build               # dist/, served by Firebase Hosting
npm --prefix functions run lint

firebase emulators:start    # run by the developer in their own terminal: Auth 9099, Functions 5001, Firestore 8080, Hosting 5002, UI
npm run seed                # demo data into the emulators (never the live project)
npm run sweep               # one FR-09 sweep on demand (the emulator does not fire schedules)

npm run test:rules          # Security Rules, unit and Firestore-emulator tests (needs the Firestore emulator)
npm run test:concurrency    # NFR-03/05 scripted concurrent calls (needs Auth, Functions and Firestore emulators)
```

- **Evidence tests** live in their own files: `tests/nfr03.*`, `tests/nfr04.*`, `tests/nfr05.*` and `tests/nfr08.*`.
- **OTP testing:** the Auth emulator prints phone OTP codes in its terminal output, and no real SMS is sent. Use Singapore test numbers such as +65 9000 0001.

## Code conventions

- **Node:** root `^22.18.0 || >=24.12.0`; `functions/` uses Node 24.
- **Module style:** the root package is ESM and `functions/` is CommonJS. Follow the local style in each.
- **Imports:** use the `@` alias for `src` imports.
- **Requirement IDs:** put the requirement ID in commit messages and at the top of new functions and components (for example `// FR-02, NFR-03`).

## UI conventions

- **Mobile-first and accessible:** labelled controls, visible focus and field-level validation. On a failed submit, focus moves to the first invalid field (NFR-06).
- **Keep what the user typed:** entered form data survives recoverable failures (SLOT_TAKEN, OTP failure, network loss).
- **Design direction:** white background, charcoal text, dark teal action colour, labelled status indicators.
- **Feature code** stays near its owning screen (UI-C1..C6 customer, UI-B1/B2 barber, UI-O1/O2 owner).

## Working rules

- **Emulators:** they are already running in the developer's own terminal. Don't start, stop or restart them; if they seem down, say so.
- **Live project:** never run `firebase deploy`, `npm run seed:live` or anything else that touches the live project (`fresher-6d857`) unless explicitly asked. Deploys follow `docs/deployment.md`.
- **Scope:** don't implement anything outside `docs/requirements.md` without asking. During the code freeze, only fix what the smoke test or rehearsal found.
- **Pull requests:** every PR description has real test totals and real manual checks. Authors merge their own PR after approval.
- **Secrets:** never commit `.env.local`, keys, passwords or the `.firebase/` deploy cache.
