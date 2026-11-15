# Fresher

**A fresh cut, booked in a minute.**

[![CI](https://github.com/BT3103-Group-6/Fresher/actions/workflows/ci.yml/badge.svg)](https://github.com/BT3103-Group-6/Fresher/actions/workflows/ci.yml)

## About

Fresher is a booking and scheduling platform for Singapore barbershops and small salons. It charges a flat monthly fee per chair with **no commission on any booking**, and walk-in queues and booked appointments share one chair timeline, so shops can adopt it without giving up the first-come-first-served model they already run.

BT3103 Group 6 built it with Scrum over two sprints (21–30 Oct and 31 Oct–14 Nov 2026). The backlog held 23 user stories (15 functional, 8 non-functional; 73 story points). Sprint 1 completed 28 of its 35 committed points and Sprint 2 all 38, plus the 7 carried over. Every story reached `main` through its own pull request with a teammate's approval, each non-functional requirement has measured evidence in [`docs/evidence/`](docs/evidence), and the app is covered by 805 automated tests. After the sprints we added continuous integration; deploys are still manual.

## Links

| What | Where |
|---|---|
| Live app | https://fresher-6d857.web.app |
| Repository | https://github.com/BT3103-Group-6/Fresher |
| Testing instructions and demo accounts | Section 6 and Appendix A of the final report |
| Final report and Scrum workbook | Submitted with the project |
| Evidence for each NFR | [`docs/evidence/`](docs/evidence) |
| Decisions and architecture | [`docs/decisions.md`](docs/decisions.md), [`docs/architecture.md`](docs/architecture.md) |

## Team

| Member | Role | GitHub |
|---|---|---|
| Mohammad Firas | Developer and Scrum Master | [@mofiras123](https://github.com/mofiras123) |
| Muhammad Haziq Bin Noorazmi | Developer and Product Owner | [@haziqnoorazmi](https://github.com/haziqnoorazmi) |
| Teo K-Rei | Developer | [@teok-rei](https://github.com/teok-rei) |
| Francis Goon Wei Shan | Developer | [@francisgoonws](https://github.com/francisgoonws) |
| Alson Chew DingXuan | Developer | [@A140904](https://github.com/A140904) |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vue 3, Vite and Vue Router, mobile-first |
| Authentication | Firebase Auth: phone sign-in with a one-time code for customers, email and password for staff |
| Backend | Cloud Functions (Node 24, `asia-southeast1`); every booking change runs here |
| Database and access | Cloud Firestore with Security Rules; clients cannot write booking data |
| Abuse protection | Firebase App Check (reCAPTCHA Enterprise) on every callable |
| Maps and geocoding | Google Maps JavaScript API and OneMap postal-code lookup |
| Hosting | Firebase Hosting |
| CI | GitHub Actions: lint, build, unit and emulator tests on every pull request |

## Key features

### Customer side
- **Shop discovery** — search by postal code or location for shops within 3 km, with distance, price range and next available slot (FR-01)
- **Real-time availability** — only slots that fit the service duration, barber hours and existing bookings are shown; stale slots are rejected on submit (FR-02)
- **Guest booking** — book with just a name and Singapore mobile number, verified by a six-digit OTP; slot held for 10 minutes (FR-03)
- **Cancel and reschedule** — OTP-verified; rescheduling swaps slots atomically (FR-04)
- **Cancellation window** — shop-defined notice period shown before booking; late cancellations blocked and recorded (FR-05)
- **Booking history and one-tap rebook** (FR-11)
- **Waitlist** — freed slots offered in joining order, held 15 minutes per offer (FR-15)

### Shop side
- **Service configuration** — name, duration (5-minute increments) and price; live within 10 seconds (FR-06)
- **Multiple barbers** — independent schedules; "Any Available Barber" assigned to the least-booked barber that day (FR-07)
- **Personal time blocks** — conflicting bookings are listed, never auto-cancelled (FR-08)
- **Automated reminders** — 24 h and 2 h before each appointment, with delivery logging (FR-09)
- **Queue and appointment reconciliation** — running delay tracked from actual service times; customers warned when projected delay exceeds 10 minutes (FR-10)
- **No-show tracking** — enabled 15 minutes after start, reversible within 24 hours (FR-12)
- **Escalating no-show policy** — 50% deposit required after two no-shows at a shop (FR-13)
- **Shop analytics** — completed bookings, booked value, no-show rate and per-barber utilisation (FR-14)

## Run it locally

You need Node.js 24 and the Firebase CLI (`npm install -g firebase-tools`). Locally the app talks only to the Firebase emulators, never to the live project.

```sh
git clone https://github.com/BT3103-Group-6/Fresher.git
cd Fresher
npm install
npm --prefix functions install
cp .env.example .env.local    # the placeholders work with the emulators

firebase emulators:start      # in its own terminal: Auth, Functions, Firestore, Hosting
npm run seed                  # sample shops, barbers, services and bookings
npm run dev                   # http://localhost:5173
```

## Tests and CI

```sh
firebase emulators:exec --project demo-fresher --only firestore "npm run test:rules"   # 741 tests: Security Rules and emulator suite
npm run test:concurrency      # 64 concurrency tests (with the emulators running)
```

Every pull request runs [CI](.github/workflows/ci.yml): functions lint, the production build, 430 unit tests and the 741-test emulator suite, in about two minutes. A pull request needs the required check and a teammate's approval before it can merge into `main`.

## How we worked

| | Sprint 1 | Sprint 2 |
|---|---|---|
| Dates | Wed 21 Oct – Fri 30 Oct 2026 | Sat 31 Oct – Sat 14 Nov 2026 |
| Focus | Booking engine and core features (FR stories) | Remaining features, then NFR evidence and fixes |
| Story points | 28 of 35 committed | 38 of 38, plus 7 carried over |
| Pull requests merged | 17 | 32 |
| Median PR cycle time | 9.6 hours | 17.5 hours |

- **Product backlog and ceremonies** are in the Scrum workbook: sprint planning, weekly stand-ups, sprint reviews against a Definition of Done, and retrospectives.
- **Inspect and adapt.** The Sprint 1 retrospective found one late pull request blocking five features in a serial chain, so Sprint 2 was planned with parallel stories and evidence work as tasks of their own.
- **Known process gaps.** Continuous integration was added only after the sprints, and deploys to Firebase Hosting are still made by hand. Automatic deployment on merge is the next step.

## Why Fresher

A September 2026 survey of 38 Singapore barbershop and salon owners found that:

- **Most shops use no booking software at all.** The only platform in use was Fresha (11 of 38 shops), and those 11 accounted for all measurable software spending.
- **Cost is the main barrier.** Most shops currently pay nothing, so any subscription reads as a new expense rather than a saving.
- **Setup time is the second barrier.** A shop that is busy cutting hair cannot spare an afternoon to configure software.
- **Commission floors penalise barbering.** A minimum per-client fee makes the effective rate rise as service value falls, taking proportionally more from an SGD 18 cut than from an SGD 200 perm.

Fresher addresses this with flat per-chair pricing, single-session onboarding, and first-class support for walk-ins.

## Objectives

1. **Flat cost, independent of revenue** — fixed monthly fee per chair, no commission.
2. **Minimal adoption friction** — register, configure services and staff, and take a first booking in one short session without assistance.
3. **Recover idle capacity** — reminders, a waitlist for released slots and conditional deposits reduce no-show losses.
4. **Upfront transparency** — prices, durations and genuine availability visible before a customer commits.

## Users

| Group | Goal |
|---|---|
| Solo barber | Fill the chair without spending the day answering messages |
| Multi-chair shop owner | Coordinate several barbers and see which staff and slots are productive |
| Employed barber / stylist | Control personal availability and see the day ahead |
| Appointment-booking customer | Book a specific barber and time, knowing the price upfront |
| Returning regular | Repeat a known-good booking in one action |

## Architecture

- **The browser is untrusted.** No secrets go in the web bundle; they live in Cloud Functions secrets, and external services are called only from functions.
- **Clients never write booking data.** Every booking change is a callable function that checks the caller's role, loads the current state in a Firestore transaction, checks the transition, and writes the new state and an audit record together.
- **One lock per barber per day.** `shops/{shopId}/schedules/{barberId_yyyymmdd}` holds that day's bookings, holds and blocks, so two people can never take the same slot (tested with 50 simultaneous requests and a 1,000-transaction load test).
- **Retries are safe.** Each booking attempt carries a client-generated `requestId`, which is also the appointment's document ID, so a retried request cannot create a second booking.

### Booking lifecycle

```
HELD ──► PENDING_PAYMENT ──► CONFIRMED ──► IN_SERVICE ──► COMPLETED
  │             │                │
  └──► EXPIRED ◄┘                ├──► CANCELLED
                                 └──► NO_SHOW (reversible within 24 h)
```

A hold lasts 10 minutes. Customers with two recorded no-shows at a shop pay a 50% deposit, which moves the booking through `PENDING_PAYMENT`.

## Quality targets

| ID | Area | Target | Evidence |
|---|---|---|---|
| NFR-01 | Performance | Booking flow loads in < 3 s on 4G; Lighthouse mobile ≥ 85 | [NFR-01](docs/evidence/NFR-01) |
| NFR-02 | Usability | 95% of first-time users complete booking unassisted | [NFR-02](docs/evidence/NFR-02) |
| NFR-03 | Concurrency | 50 simultaneous requests for one slot → exactly one succeeds; zero double bookings in 1,000 transactions | [NFR-03](docs/evidence/NFR-03) |
| NFR-04 | Security | OTP-gated customer data; role-restricted staff access; 100% of unauthorised attempts rejected; HTTPS only | [NFR-04](docs/evidence/NFR-04) |
| NFR-05 | Reliability | No failed write shown as success; connection-loss message within 3 s; form input preserved | [NFR-05](docs/evidence/NFR-05) |
| NFR-06 | Accessibility | Labelled inputs, visible focus, field-specific error messages | [NFR-06](docs/evidence/NFR-06) |
| NFR-07 | Cost | < S$5 infrastructure and messaging cost per active shop per month at 200 bookings | [NFR-07](docs/evidence/NFR-07) |
| NFR-08 | Auditability | 100% of state changes audited; 12-month retention | [NFR-08](docs/evidence/NFR-08) |

## Screens

| Screen | Requirements |
|---|---|
| Landing / shop discovery | FR-01 |
| Shop page (service → barber → date → time) | FR-02, FR-06, FR-07 |
| Booking summary, OTP, confirmation | FR-03, FR-05 |
| Deposit checkout | FR-13 |
| My Bookings (upcoming / history) | FR-04, FR-05, FR-11 |
| Waitlist offer | FR-15 |
| Staff sign-in and shop configuration | FR-06, FR-07 |
| Barber schedule | FR-08, FR-09, FR-12 |
| Queue management | FR-10 |
| Shop dashboard | FR-14 |

> **Mock data:** shops, barbers, customers and appointments in the demo are mock data. Reminders, delay warnings and deposit payments are simulated, so no reminder is sent and no money moves. Sign-in codes are sent by real SMS.

## Known limitations

- **Off-platform activity** — bookings taken by phone, chat or walk-in that aren't entered into Fresher make displayed availability inaccurate.
- **Variable service times** — wait estimates and last-minute openings can't be predicted precisely.
- **Marketplace cold start** — the platform is less useful to customers until enough shops join, and vice versa.
- **Assessment-based pricing** — some services can only show a starting price or range.
- **Capacity modelling** — barber availability doesn't capture shared resources such as chairs, wash stations or equipment.

## Design

Mobile-first, with a restrained palette of white, charcoal and dark teal. Teal is reserved for primary actions and selected options. Selected options are marked with a tick, thicker border and bold text, so state never relies on colour alone. The logo is a leaf whose lower half is cut into comb teeth.

## References

See Section 7 of the project report for full citations (CNA, Fresha, IMDA, OECD, Pabau, SME Horizon, The Salon Business, and Wang, Liu & Wan, 2020).
