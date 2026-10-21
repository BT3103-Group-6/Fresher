# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fresher is a multi-shop barber booking app (Vue 3 + Vite frontend; Firebase Auth, Firestore, Cloud Functions, Security Rules, App Check, Hosting). It is a student prototype (BT3103) and is currently at the **starter stage**: `src/` is still the Vue template (`HelloWorld`, `TheWelcome`), `functions/index.js` is the Firebase stub, `src/firebase.js` does not exist yet, and `firestore.rules` is a temporary starter rule. Most of what is described below is the design to build toward, not existing code.

## Commands

```sh
npm install
npm run dev          # Vite dev server
npm run build        # outputs dist/ (served by Firebase Hosting)

npm --prefix functions install
npm --prefix functions run lint   # ESLint (google config); also the firebase predeploy step

firebase emulators:start   # run by the developer in their own terminal; Auth 9099, Functions 5001, Firestore 8080, Hosting 5002, UI
```

- There is no automated test script yet. Run the narrowest relevant build, lint, emulator or rules test after changes. Concurrency tests (NFR-03/05) are meant to run against the Firestore emulator with scripted concurrent calls.
- Node: root `^22.18.0 || >=24.12.0`; `functions/` uses Node 24.
- Use the emulators for development. Do not deploy or touch production services.
- Module style: root package is ESM; `functions/` is CommonJS. Follow the local style in each.

## Working rules

- The emulators are already running in the developer's own terminal. Don't start, stop or restart them; if they seem down, say so.
- Never run `firebase deploy` or anything that touches the live Firebase project unless explicitly asked.
- OTP testing: the Auth emulator prints phone OTP codes in its terminal output; no real SMS is sent. Use SG test numbers like +65 9000 0001.
- Don't implement anything outside docs/requirements.md without asking, including "nice to have" extras.
- Put the requirement ID in commit messages and at the top of new functions/components (e.g. `// FR-02, NFR-03`).
- Work in small steps: one requirement (or part of one) per task, and stop for review after each.
- Use the `@` alias for `src` imports.

## Read the docs before implementing a feature

[docs/requirements.md](docs/requirements.md) (FR-01..15, NFR-01..08, release tiers), [docs/architecture.md](docs/architecture.md) (trust zones, data model, state machine, callable functions, `holdSlot` algorithm), [docs/decisions.md](docs/decisions.md) (decision register A1..).

- Use PROPOSED decisions as defaults. If something is OPEN or missing, ask; don't invent rules. When a decision changes, update `docs/decisions.md` first, then the code.
- Build order: Core requirements first, then Extensions, then Stretch (see Release status in requirements.md).

## Architecture (big picture)

- **Browser is untrusted.** No secrets (OneMap token, messaging/payment keys) in the bundle; those live in Cloud Functions secrets (`defineSecret`). External services (OneMap geocoding, messaging, payment) are called only from functions.
- **Clients never write** to `appointments`, `schedules`, `deposits`, `notifications`, `auditLog`, `waitlist`, `queue`. Security Rules deny it; all booking state changes go through callable functions (`holdSlot`, `confirmBooking`, `cancelBooking`, `reschedule`, `markNoShow`, ... full list in architecture.md). Each function: check auth/role → load state in a Firestore transaction → verify the transition against the appointment state table → write the new state **and** an `auditLog` record in the same transaction.
- **Concurrency model:** one `schedules/{barberId_yyyymmdd}` doc per barber-day holds `intervals[]` (booking/hold/block) and acts as the lock document. Transactions ignore expired holds, so correctness never depends on the scheduler. `holdSlot` is idempotent via a client-generated `requestId` that is also the `appointments` doc ID; duration/end are computed server-side.
- **Data conventions:** half-open intervals `[start, end)`; money as integer SGD cents; Timestamps in UTC; appointments snapshot `priceCents`/`durationMin`; deterministic notification IDs `{bookingId}_{type}`.
- **Region/time zone:** `asia-southeast1` for Firestore and all functions; `Asia/Singapore` for shop-local dates and times.
- **Identity:** customers use Phone Auth (SMS OTP, SG mobiles only; fresh OTP needed for history or booking changes); staff use email/password with custom claims `{ shopId, role: owner|barber }` set by `addBarber`; platform admin claim `admin: true` may only change shop `status`. No anonymous auth. Staff access is scoped to their own shop.
- Messaging and payment are **mocked** behind small interfaces in the prototype, and the UI/report must say so.
- `src/firebase.js` (to be created) should connect to emulators when `import.meta.env.DEV` is true.
- Security Rules are part of each feature; replace the starter `firestore.rules` before real data flows are added.

## UI conventions

Mobile-first, accessible labelled controls, visible focus, field-level validation, and entered form data preserved after recoverable failures (SLOT_TAKEN, OTP failure, network loss). Design direction: white background, charcoal text, dark teal action colour, labelled status indicators. Keep changes to the starter components minimal; keep feature code near its owning screen (UI-C1..C6 customer, UI-B1/B2 barber, UI-O1/O2 owner).
