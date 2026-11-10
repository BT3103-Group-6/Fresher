# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fresher is a multi-shop barber booking app (Vue 3 + Vite frontend; Firebase Auth, Firestore, Cloud Functions, Security Rules, App Check, Hosting). It is a student prototype (BT3103, Group 6). **All Core and Extension features are on `main`** (FR-01 to FR-15) and the work is now in the non-functional evidence, the deploy and the demo (Sprint 2, November 2026). After PR-19 merges, `main` is under a code freeze: only fixes for problems found in the smoke test or rehearsal go in.

## Where things are

- **Customer screens** (`src/views/customer/`): `DiscoverView` (FR-01 search and map), `ShopView` (FR-02 slots), `VerifyView` (FR-03 OTP and confirm), `MyBookingsView` (FR-04/05 cancel and reschedule), `DepositView` (FR-13), `WaitlistView` (FR-15).
- **Staff screens** (`src/views/staff/`): `SignInView`, `ShopConfigView`, `ServiceForm`, `BarberForm` (FR-06/07), `ScheduleView` (FR-08 blocks), `QueueView` (FR-10 walk-ins and delays), `DashboardView` (FR-14, owner only).
- **Shared client logic**: `src/lib/` (pure helpers, unit tested); Firebase setup in `src/firebase*.js` (each module connects to the emulators when `import.meta.env.DEV` is true).
- **Cloud Functions** (`functions/`, CommonJS, Node 24): `booking.js` (holdSlot, confirmBooking, releaseHold, cancelBooking, reschedule), `service.js` (FR-12 start, finish, no-show), `blocks.js`, `queue.js` + `queueDelay.js`, `payments.js` (FR-13, mock provider), `waitlist.js`, `notifications.js` + `sweep.js` (FR-09 reminders and hold expiry), `stats.js` (FR-14 trigger), `discovery.js` + `geocode.js` (FR-01). `index.js` wires them up and must stay identical to the `prototype` tag.
- **Rules**: `firestore.rules` (default deny; clients never write booking data).
- **Docs**: `docs/requirements.md`, `docs/architecture.md`, `docs/decisions.md` (A1..), `docs/deployment.md`, `docs/team-plan.md`; NFR evidence in `docs/evidence/NFR-0x/`.

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

- Node: root `^22.18.0 || >=24.12.0`; `functions/` uses Node 24.
- Module style: root package is ESM; `functions/` is CommonJS. Follow the local style in each.
- Evidence tests live in their own files (`tests/nfr03.*`, `tests/nfr04.*`, `tests/nfr08.*`) so the rest of `tests/` stays identical to the `prototype` tag.

## Working rules

- The emulators are already running in the developer's own terminal. Don't start, stop or restart them; if they seem down, say so.
- Never run `firebase deploy`, `npm run seed:live` or anything else that touches the live project (`fresher-6d857`) unless explicitly asked. Deploys follow `docs/deployment.md`.
- OTP testing: the Auth emulator prints phone OTP codes in its terminal output; no real SMS is sent. Use SG test numbers like +65 9000 0001.
- Don't implement anything outside `docs/requirements.md` without asking. During the code freeze, only fix what the smoke test or rehearsal found.
- Put the requirement ID in commit messages and at the top of new functions/components (e.g. `// FR-02, NFR-03`).
- Every PR description has real test totals and real manual checks. Authors merge their own PR after approval.
- Never commit `.env.local`, keys, passwords or the `.firebase/` deploy cache.
- Use the `@` alias for `src` imports.

## Architecture (big picture)

- **Browser is untrusted.** No secrets (OneMap token, messaging/payment keys) in the bundle; those live in Cloud Functions secrets (`defineSecret`). External services are called only from functions.
- **Clients never write** to `appointments`, `schedules`, `deposits`, `notifications`, `auditLog`, `waitlist`, `queue`. Security Rules deny it; all booking state changes go through callable functions. Each function: check auth/role → load state in a Firestore transaction → verify the transition against the appointment state table → write the new state **and** an `auditLog` record in the same transaction (NFR-08).
- **Concurrency model:** one `shops/{shopId}/schedules/{barberId_yyyymmdd}` doc per barber-day holds `intervals[]` (booking/hold/block) and acts as the lock document. Transactions ignore expired holds, so correctness never depends on the scheduler. `holdSlot` is idempotent via a client-generated `requestId` that is also the `appointments` doc ID; duration/end are computed server-side.
- **Data conventions:** half-open intervals `[start, end)`; money as integer SGD cents; Timestamps in UTC; appointments snapshot `priceCents`/`durationMin`; deterministic notification IDs `{bookingId}_{type}`.
- **Region/time zone:** `asia-southeast1` for Firestore and all functions; `Asia/Singapore` for shop-local dates and times.
- **Identity:** customers use Phone Auth (SMS OTP, SG mobiles only; fresh OTP needed for history or booking changes); staff use email/password with custom claims `{ shopId, role: owner|barber, barberId }` set by `addBarber`; platform admin claim `admin: true` may only change shop `status`. No anonymous auth. Staff access is scoped to their own shop.
- **App Check** is enforced on every callable outside the emulator (decisions A17).
- Messaging and payment are **mocked** behind small interfaces in the prototype, and the UI/report must say so.

## UI conventions

Mobile-first, accessible labelled controls, visible focus, field-level validation, and entered form data preserved after recoverable failures (SLOT_TAKEN, OTP failure, network loss). On a failed submit, focus moves to the first invalid field (NFR-06). Design direction: white background, charcoal text, dark teal action colour, labelled status indicators. Keep feature code near its owning screen (UI-C1..C6 customer, UI-B1/B2 barber, UI-O1/O2 owner).
