# Fresher — Requirements

Source: BT3103 Midterm Report (Sections 3–5). This file is the build spec.
Rules for anything the requirements leave open are in `docs/decisions.md`.
Architecture and data model are in `docs/architecture.md`.

## Product summary

Fresher is a booking web app for independent and home-based barbers in Singapore and their customers.
Barbers publish services and availability; customers find a shop, pick a slot and book with a name and
mobile number verified by OTP, without creating a password or account.

Stack (mandatory): HTML, CSS, Vue 3, Firebase.

## Users and roles

| Role | Goal | Access |
|---|---|---|
| Customer | Find shops, book, manage own bookings | Phone OTP. Sees only their own bookings/history. |
| Barber | View assigned appointments, block personal time, mark attendance | Email sign-in. Own shop only. |
| Shop owner | Configure services, barbers, hours, policy; manage appointments; view analytics | Email sign-in. Own shop only. Includes all barber permissions (a solo barber is an owner). |
| Platform admin | Verify shops | Admin claim. Only shop verification is defined; do not build other admin features. |

## Out of scope
- AI booking (discussed but not a requirement; future work).
- Platform admin features beyond shop verification.
- Chairs as a separate resource (one barber = one chair; see decisions A1).

## Release status (proposed, see decisions A10)
- **Core:** FR-01 to FR-08
- **Extension:** FR-09, FR-11, FR-12, FR-14
- **Stretch (build only if time allows; external services mocked):** FR-10, FR-13, FR-15

---

## Functional requirements

Each requirement has a test ID (T-Fxx) used in the report's traceability matrix.

### FR-01 Shop discovery — High — Core — UI-C1, T-F01
Customers find nearby shops by postal code or shared location, filter by service type, and compare distance, price and earliest availability.
- Lists shops within a 3 km radius of the searched postal code or shared location.
- Shows distance, price range and next available slot for each result.
- Falls back to postal code entry when location permission is denied.

### FR-02 Real-time availability — High — Core — UI-C2, T-F02
Shows bookable slots for a selected service and barber, reflecting working hours, existing bookings and blocks, refreshed so customers don't act on stale data.
- Offers only slots that fit the selected service duration within the barber's working hours.
- Excludes slots overlapping an existing booking, a live hold or a personal time block.
- Rejects a slot taken between page load and submission (SLOT_TAKEN), then refreshes the list.

### FR-03 Guest booking — High — Core — UI-C3, T-F03
First-time customers confirm a booking with only a name and Singapore mobile number, verified by OTP, with no password or persistent account visible to them.
- Creates a booking from a display name and mobile number without a password.
- Sends a six-digit OTP within 60 seconds of the request.
- Holds the slot for 10 minutes; releases it on expiry or after three failed OTP attempts.

### FR-04 Cancellation and rescheduling — High — Core — UI-C4, T-F04
Customers cancel or move a booking; released time returns to the pool and the barber is notified.
- Returns the released slot to the available pool immediately and notifies the assigned barber.
- Requires OTP verification on the booking's mobile number before any change.
- When rescheduling, holds the replacement slot before releasing the original (atomic swap; if the new slot is taken, the original booking is unchanged).

### FR-05 Cancellation window — High — Core — UI-C4, T-F05
Each shop sets a minimum notice period. Cancelling inside it is late; the policy is shown before confirmation.
- Blocks cancellation inside the shop's configured notice window (per latePolicy, see decisions A3).
- Records the late attempt on the customer's profile for that shop.
- Displays the shop's cancellation policy before booking confirmation.

### FR-06 Service configuration — High — Core — UI-O1, T-F06
Owners create and edit services (name, duration, price), immediately selectable by customers.
- Requires a name, a duration in 5-minute increments and a price before saving.
- Publishes the service to the customer booking flow within 10 seconds.
- Preserves the duration and price captured on existing confirmed bookings (snapshot).

### FR-07 Multiple barbers — High — Core — UI-C2, UI-O1, T-F07
Owners add, edit and deactivate barbers, each with an independent schedule. Customers choose a named barber or "Any available barber".
- Assigns "Any available barber" to the eligible barber with the fewest bookings that day.
- Prevents any barber from holding two overlapping bookings.
- A deactivated barber is withdrawn from new bookings only; existing bookings remain.

### FR-08 Personal time blocks — High — Core — UI-B1, T-F08
Barbers block unavailable periods without disturbing confirmed appointments.
- Removes all slots inside the blocked window from customer view.
- Rejects a slot whose service duration would cross into the block.
- Lists conflicting confirmed bookings to the barber instead of cancelling them automatically.

### FR-09 Automated reminders — High — Extension — UI-C3, UI-B1, T-F09
Scheduled reminders before each confirmed appointment through the customer's channel, with delivery logging.
- Sends reminders 24 hours and 2 hours before start time.
- Logs each attempt with timestamp, channel and delivery outcome.
- Cancels pending reminders on cancellation and recalculates them on reschedule.

### FR-10 Queue and appointment reconciliation — Medium — Stretch — UI-B2, T-F10
Where walk-ins and bookings share barbers, track running delay and warn affected customers.
- Notifies the customer when projected delay exceeds 10 minutes.
- Sends the warning at least 15 minutes before the original start time where detectable.
- Calculates delay from actual service start and completion times.

### FR-11 Booking history and rebooking — Medium — Extension — UI-C4, T-F11
Verified returning customers see past appointments and rebook in one action.
- Requires OTP verification before displaying booking history.
- Pre-fills the last shop, barber and service on a single rebook action.
- Suppresses the pre-fill when the service or barber is no longer available.

### FR-12 No-show tracking — Medium — Extension — UI-B1, T-F12
Staff record when a customer fails to attend, incrementing a count held against that customer for that shop.
- Enables the no-show mark only 15 or more minutes after the appointment start.
- Increments the customer's no-show count by one for each recorded no-show.
- Allows staff to reverse the mark within 24 hours; both the mark and the reversal are logged.

### FR-13 Escalating no-show policy — Medium — Stretch — UI-C5, T-F13
Customers with repeated no-shows at a shop pay a deposit for future bookings there.
- Requires a deposit of 50% of the service price after two recorded no-shows at that shop.
- Holds the slot for 10 minutes pending payment confirmation.
- Marks the deposit refundable on attendance and forfeited on a further no-show.

### FR-14 Shop analytics — Medium — Extension — UI-O2, T-F14
Owners review performance over a chosen period.
- Reports completed bookings, booked value, no-show rate and utilisation per barber.
- Counts bookings by appointment start time within the selected date range.
- Shows zero values with an empty-state message when no bookings exist.

### FR-15 Waitlist — Low — Stretch — UI-C6, T-F15
Customers join a waitlist for a date and are offered freed capacity in joining order.
- Notifies the earliest-joined compatible entry when a cancellation frees a slot.
- Holds the freed slot exclusively for 15 minutes before passing it on.
- Expires all entries automatically at the end of the requested date (Asia/Singapore).

---

## Non-functional requirements

### NFR-01 Mobile performance and responsiveness — High — T-N01
- Customer booking flow loads within 3 seconds on 4G.
- Customer-facing pages score at least 85 on Lighthouse mobile performance.
- No page in the core booking flow needs horizontal scrolling or has overlapping/inaccessible controls at any viewport width.
- Every booking function available on desktop is usable on mobile.

### NFR-02 Usability and booking efficiency — High — T-N02
- 95% of representative first-time users complete the standard booking flow without help.
- Before final confirmation, one screen shows shop, service, barber, date, time and price.
- Every invalid or missing required input shows a visible message naming the field.
- A successful booking shows an explicit confirmation with the appointment details.

### NFR-03 Booking integrity and concurrency — High — T-N03
- 50 simultaneous valid requests for the same barber and slot: exactly one succeeds.
- Across 1000 test booking transactions: zero double bookings for the same barber and overlapping period.
- Repeated submission of the same request does not create duplicate records.

### NFR-04 Security and privacy — High — T-N04
- All unauthorised access attempts in the security test cases are rejected by Firebase Security Rules.
- A customer cannot read or modify another customer's protected booking data.
- A barber or owner cannot read or modify protected data of another shop.

### NFR-05 Reliability and failure handling — High — T-N05
- Across 100 simulated failed booking writes, none is shown to the customer as successful.
- Across 100 repeated submissions of the same request, at most one appointment record is created.
- Within 3 seconds of losing connectivity during booking, a connection/failure message appears.
- After a temporary connection failure, data already entered in the booking form remains.

### NFR-06 Accessibility — Medium — T-N06
- Every booking-form input has an associated text label.
- Keyboard focus is always visible.
- Every validation error identifies the field and describes the error in readable text.

### NFR-07 Cost efficiency — High — T-N07
- Infrastructure plus messaging cost stays below S$5 per active shop per month at 200 bookings/month.
- The cost calculation includes hosting, Firestore usage, OTP delivery, reminders and message retries.
- No unnecessary repeated reads/requests where previously fetched data is still valid.

### NFR-08 Auditability — Medium — T-N08
- 100% of booking state changes create an immutable audit record: booking ID, actor, timestamp, previous state, resulting state.
- Audit records are retained for 12 months from the action date.
- For every tested transition, the audit record matches the stored booking state.
