# Fresher

**A fresh cut, booked in a minute.**

Fresher is a booking and scheduling platform for Singapore barbershops and small salons. It charges a flat monthly fee per chair with **no commission on any booking**, so a shop selling SGD 15 haircuts carries the same proportional overhead as one selling SGD 200 treatments. Walk-in queues and booked appointments share one chair timeline, so shops can adopt Fresher without abandoning the first-come-first-served model they already run.

---

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

## Features

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

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Vue (mobile-first) |
| Authentication | Firebase Authentication (Phone Auth for customers, email/password for staff) |
| Backend logic | Firebase Cloud Functions |
| Database | Cloud Firestore |
| Access control | Firebase Security Rules (server-side) |
| Geocoding | OneMap (postal code → coordinates) |
| Messaging | External messaging provider (simulated in prototype) |
| Payments | External payment provider (simulated in prototype) |

### Data model

Four Firestore collections, accessed through these operations:

- **Customer** — `upsert`
- **Shop** — `findNear`, `getService`
- **TimeSlot** — `findOpen`, `hold`, `book`, `release`, `block` (one 5-minute slot per barber, at most one booking each)
- **Booking** — `save`, `findByCustomer`, `nextWaitlisted`

### Booking lifecycle

```
held ──► awaiting payment ──► confirmed ──► completed
  │              │                 │
  └──► expired ◄─┘                 ├──► cancelled
                                   └──► no-show
```

- Every booking attempt carries a `requestId`, so retries cannot create duplicates.
- `TimeSlot.hold` succeeds only if every required slot is still `OPEN`; otherwise it returns `SLOT_TAKEN` with refreshed availability.
- Every state change writes an immutable audit record (booking ID, actor, timestamp, previous and resulting state).

## Quality targets

| ID | Area | Target |
|---|---|---|
| NFR-01 | Performance | Booking flow loads in < 3 s on 4G; Lighthouse mobile ≥ 85 |
| NFR-02 | Usability | 95% of first-time users complete booking unassisted |
| NFR-03 | Concurrency | 50 simultaneous requests for one slot → exactly one succeeds; zero double bookings in 1,000 transactions |
| NFR-04 | Security | OTP-gated customer data; role-restricted staff access; 100% of unauthorised attempts rejected; HTTPS only |
| NFR-05 | Reliability | No failed write shown as success; connection-loss message within 3 s; form input preserved |
| NFR-06 | Accessibility | Labelled inputs, visible focus, field-specific error messages |
| NFR-07 | Cost | < S$5 infrastructure and messaging cost per active shop per month at 200 bookings |
| NFR-08 | Auditability | 100% of state changes audited; 12-month retention |

## Prototype screens

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

> **Mock data:** shops, barbers, customers and appointments in the prototype are mock data. SMS messages and deposit payments are simulated — no real messages are sent and no real payments are taken.

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
