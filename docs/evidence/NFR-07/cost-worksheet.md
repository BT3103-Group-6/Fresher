# NFR-07 cost worksheet

Status: **revised 4 Nov 2026** after the Product Owner's decision (A9). Branch `chore/nfr-07-cost`.

**Target (NFR-07, restated by the Product Owner, Haziq, on 4 Nov 2026):** in the demo, messaging runs at no cost (mock reminder provider, Firebase test phone numbers for OTP), and infrastructure stays under **S$5 per active shop per month** at **200 bookings per shop per month**. The cost calculation still covers hosting, Firestore, OTP delivery, reminders and message retries, and there must be no unnecessary repeated reads of data that is still valid.

**Result: met in the demo.** Messaging costs **S$0** (mock provider and test numbers). Infrastructure is about **S$0.43** per shop per month (about S$0.10 once the queue sweep is fixed). Google Maps is not in that figure: in the demo it stays within Google's 10,000 free loads a month; beyond the free tier, at one map load per visit, it would add up to S$5.37 per shop.

**Still open:** the queue sweep re-reads unchanged appointments every minute (section 4, item 1), which the "no unnecessary repeated reads" bullet rules out. Owner: Alson (FR-10, PR-17).

**Why the target was changed.** The original target was "infrastructure plus messaging below S$5 per active shop per month", with real SMS for OTP and reminders. Against that target the result was **not met**: about **S$62 to S$67 per shop per month**, roughly 12–13.5 times S$5, almost all of it SMS (about S$61.69). Sections 2 and 3 keep that calculation as the reason for the change.

All amounts use **US$1 = S$1.2789** (mid-market, 2 Nov 2026).

---

## 1. How the reads and writes were counted

**Run:** 2 Nov 2026, about 20:30 SGT, on the Firestore, Auth and Functions emulators seeded with `npm run seed` (54 shops). Headless Chromium at 390 × 844 against a Vite dev server on port 5180. Script: `~/fresher-audit/nfr07-measure.mjs` (outside the repo); results: `~/fresher-audit/results/nfr07-booking.json`.

**Flow:** landing page → search postal code 160055 (8 shops found) → wait for every "Next available" lookup to finish → open Kopi & Clippers (`shop-tiong-bahru`) → Gents haircut, "Any available barber", tomorrow, first time (10:00 AM) → Continue (`holdSlot`) → name and +65 9000 0001, Send code, code read from the Auth emulator → Confirm booking (`confirmBooking`) → status `CONFIRMED`.

**Browser side (measured).** The emulator has no per-operation usage counter, so the script wraps the page's `fetch` and `XMLHttpRequest` before the app loads (no app code changed) and decodes the Firestore WebChannel traffic:
- every `documentChange` on a Listen stream is one billed document read;
- every query or document target that returned nothing is counted as **one** read (Firestore's minimum charge per query);
- every entry in a Write-channel request is one billed write;
- callable requests (`geocode`, `holdSlot`, `confirmBooking`) are listed but their own Firestore work is counted from the code (below).

**Server side (counted from code).** The Admin SDK talks to the emulator over gRPC, which the browser cannot see. Reads and writes are counted from `functions/booking.js`, `functions/notifications.js` and `functions/index.js` on this branch. The documents the two callables should write were then checked in the emulator, and all of them exist (appointment, barber-day schedule, `auditLog/{id}_HELD`, `auditLog/{id}_CONFIRMED`, `customers/{uid}`, and the confirmation and 2-hour reminder tasks; the 24-hour reminder was correctly skipped because the slot was less than 24 hours away).

**Not on this branch.** The scheduled sweep (reminders, expired holds, waitlist, queue delays), the `dailyStats` trigger and the waitlist trigger arrive with later PRs. Their costs are counted from the `prototype` tag (`git show prototype:functions/sweep.js`, `stats.js`, `queue.js`, `waitlist.js`).

### 1.1 Measured: one booking, browser reads

| Screen / step | Billed reads | What was read |
|---|---|---|
| Landing page | 0 | Firebase is not loaded until the first search |
| Search 160055 | **129** | 2 geohash queries: 12 shop docs + 1 empty query (13); for the 8 shops in range: services 49, barbers 30, schedules 35 + 2 empty queries (37) for the next-slot lookups |
| Shop page | 7 | shop doc 1, active services 4, active barbers 2 (live listeners) |
| Slot listeners | 4 | barber-day schedule docs: today × 2 barbers (both empty, 1 read each), tomorrow × 2 barbers |
| Verify screen | 3 | shop, service and barber docs again |
| OTP and confirm | 0 | Auth requests only (5) |
| **Total** | **143** | **0 browser writes** (clients never write booking data) |

A first run 20 minutes earlier gave 136 reads. The difference is data, not method: in the second run Sara's schedule for tomorrow existed (created by the first booking), and the step labels moved a few reads between rows.

The run was at about 20:30, after the shops had closed, so each next-slot lookup checked today and tomorrow. In the daytime, lookups that find a slot today read fewer schedule docs (up to about half of the 37 schedule reads).

### 1.2 Counted from code: one booking, server reads and writes

| Function | Reads | Writes | Notes |
|---|---|---|---|
| `geocode` | 0 | 0 | No Firestore. The emulator and demo use the postal stub; real OneMap calls are outside Firebase |
| `holdSlot` ("Any", 2 barbers) | 7 | 3 | shop, service, 2 active barbers (query), then in the transaction: appointment (missing) + 2 barber-day schedules. Writes: schedule, appointment, `auditLog/{id}_HELD` |
| `confirmBooking` | 3 | 7 | appointment, schedule, `customers/{uid}/shopStats/{shopId}` (missing). Writes: schedule, appointment, customer, `auditLog/{id}_CONFIRMED`, 3 notification tasks (2 in this run) |
| **Booking flow subtotal** | **10** | **10** | Assumes a lookup of a missing document is billed as a read (**assumption**; not confirmed on Google's page) |

**One booking, end to end of the customer flow: 153 reads, 10 writes.**

### 1.3 Counted from code: the rest of the booking's life (prototype tag)

| Item | Reads | Writes | Notes |
|---|---|---|---|
| 3 messages sent (confirmation, 24 h, 2 h) | 15 | 6 | per attempt: due query 1 + claim (task, appointment, customer) 3 + record 1; writes: claim lease + record |
| Retries | 0.75 | 0.3 | **assumption:** 5% of attempts fail and are retried once (up to 3 attempts allowed, A4) |
| `dailyStats` trigger | 8 | 2 | 4 appointment writes (HELD, CONFIRMED, IN_SERVICE, COMPLETED) × 2 reads; writes only on COMPLETED |
| Staff start + finish | ~14 | ~6 | **estimate:** each reads the appointment and the barber's queue state (about 5 appointments + queue), writes appointment, audit, queue recalculation |
| Waitlist trigger on schedule writes | 0 | 0 | No freed time, so it returns before reading |
| Audit TTL after 12 months | — | — | about 4 deletes per booking, at the delete rate |
| **Subtotal** | **~38** | **~14** | |

**Per booking excluding the queue sweep: about 191 reads and 24 writes.**

### 1.4 The queue sweep (prototype, runs every minute)

`sweepQueueDelays` (FR-10, L33) runs in `processNotifications` every minute. It reads every `CONFIRMED`/`IN_SERVICE` appointment starting from 12 hours ago to 24 hours ahead, then, for each barber found, reads all of that barber's appointments in the same window and their live queue entries. A booking therefore stays in the window for about 36 hours (2,160 runs) and is read about twice per run, even when nothing has changed.

At 200 bookings per month (about 6.6 per day), a shop has about 10 appointments in the window at any time:
- sweep query ≈ 7 reads;
- per-barber reloads ≈ 10 reads;
- empty queue queries ≈ 3 reads (3 barbers).

That is **about 20 reads a minute, or about 864,000 reads per shop per month** (range about 0.6–1.1 million depending on how bookings are spread). This is about 4,300 reads per booking, more than 95% of the Firestore total.

The other sweep queries (due notifications, expired holds, two waitlist queries, plus the queue query itself when empty) cost about 5 reads a minute for the whole platform: **about 216,000 reads per month in total**, shared by all shops.

---

## 2. Prices

Prices checked on **2 Nov 2026**. "Confirmed" means read on the official page that day. "Assumption" means the official figure could not be read, so an estimate is used and must be checked before the report.

**Exchange rate used throughout: US$1 = S$1.2789** (mid-market, 2 Nov 2026 05:20 UTC, [exchange-rates.org](https://www.exchange-rates.org/converter/usd-sgd)). Bank and card rates are slightly worse.

| Item | Price used | Status | Source |
|---|---|---|---|
| Firebase Hosting | 10 GB storage and 360 MB/day transfer free, then $0.026/GB stored and $0.15/GB transferred | Confirmed | [firebase.google.com/pricing](https://firebase.google.com/pricing) |
| Firestore reads / writes / deletes | $0.03 / $0.09 / $0.01 per 100,000 (default rates) | Confirmed. The page does not break prices down by location, so the default rates are used for asia-southeast1 | [cloud.google.com/firestore/pricing](https://cloud.google.com/firestore/pricing) |
| Firestore free quota | 50,000 reads, 20,000 writes, 20,000 deletes per day | Confirmed | [cloud.google.com/firestore/pricing](https://cloud.google.com/firestore/pricing) |
| Cloud Functions invocations | 2M/month free, then $0.40 per million | Confirmed | [firebase.google.com/pricing](https://firebase.google.com/pricing) |
| Cloud Functions compute | 400,000 GB-s and 200,000 CPU-s free per month (confirmed); beyond that about $0.000024 per vCPU-s | **Assumption** for the rate beyond the free tier (the Cloud Run pricing page did not load in full) | [firebase.google.com/pricing](https://firebase.google.com/pricing); [cloud.google.com/run/pricing](https://cloud.google.com/run/pricing) |
| Cloud Scheduler | $0.10 per job per 31 days; 3 jobs free per billing account | Confirmed | [cloud.google.com/scheduler/pricing](https://cloud.google.com/scheduler/pricing) |
| OTP SMS (Firebase Phone Auth / Identity Platform) to Singapore | **$0.05 per SMS sent**; the first 10 SMS per day per project are free | Confirmed | [cloud.google.com/identity-platform/pricing](https://cloud.google.com/identity-platform/pricing) |
| Confirmation and reminder SMS (Twilio, outbound to Singapore) | **$0.0591 per segment**, "pricing current as of October 2026"; one segment per message assumed | Confirmed. **Carrier fees may apply and are not included** | [twilio.com/en-us/sms/pricing/sg](https://www.twilio.com/en-us/sms/pricing/sg) |
| Google Maps (Dynamic Maps, Maps JavaScript API) | 10,000 loads/month free, then $7.00 per 1,000 (up to 100,000) | Confirmed | [developers.google.com/maps/billing-and-pricing/pricing](https://developers.google.com/maps/billing-and-pricing/pricing) |

Twilio is used as a stand-in: the prototype's messaging provider is a mock (L4) and no provider has been chosen.

---

## 3. Monthly cost per active shop (200 bookings)

Free tiers are **ignored per shop** (they are per project or billing account and shared by all shops), so this is the marginal cost of one more shop. Section 3.1 shows how far the free tiers go.

| Item | Volume per shop per month | US$ | S$ |
|---|---|---|---|
| Hosting transfer | **assumption:** 3 visits per booking × about 0.3 MB gzip (app shell, Vue, Firebase SDK, landing, shop and verify chunks, from the last production build) ≈ 180 MB | 0.03 | 0.03 |
| Firestore reads, booking life | 200 × 191 = 38,200 | 0.01 | 0.01 |
| Firestore writes | 200 × 24 = 4,800 | 0.00 | 0.01 |
| Firestore reads, queue sweep | about 864,000 | 0.26 | 0.33 |
| Firestore deletes (audit TTL) | about 800 | 0.00 | 0.00 |
| Functions invocations | 200 × 11 (geocode, hold, confirm, 4 stats, 2 waitlist, start, finish) = 2,200 | 0.00 | 0.00 |
| Functions compute | **assumption:** 0.5 vCPU-s per invocation ≈ 1,100 vCPU-s | 0.03 | 0.03 |
| Scheduler + idle sweep (platform, shared) | 1 job (free) + 216,000 reads ≈ $0.06 for the platform; shown for 10 shops | 0.01 | 0.01 |
| **Infrastructure subtotal** | | **0.34** | **0.43** |
| Google Maps (not in NFR-07's list, but infrastructure) | 0 to 600 loads (only when the map section is scrolled into view) | 0 to 4.20 | 0 to 5.37 |
| OTP SMS | 200 + **assumption** 10% resends = 220 | 11.00 | 14.07 |
| Confirmation and reminder SMS (carrier fees not included) | 3 per booking + **assumption** 5% retries = 630 | 37.23 | 47.62 |
| **Total** | | **48.57 to 52.77** | **62.11 to 67.49** |

Rows are rounded; the subtotals and totals are calculated from unrounded values.

**Against the original S$5 target (with real SMS): not met.** Infrastructure passes (S$0.43). The total fails by about 12–13.5 times. Messaging alone (S$61.69) is 12 times the target, and the 200 first-attempt OTP messages alone (S$12.79) are more than S$5.

To stay under S$5 with SMS at about S$0.076 each (Twilio), a shop could send about 66 paid messages a month in total, or **about 0.3 per booking**.

### 3.1 What the free tiers cover (whole project)

- **Firestore:** 50,000 reads a day (about 1.5 million a month) covers the queue sweep for fewer than two shops; the other per-booking reads for about 39 shops.
- **Hosting:** 360 MB a day (about 10.8 GB a month) covers about 60 shops.
- **Maps:** 10,000 loads a month covers about 16 shops at one map load per visit.
- **Phone Auth:** 10 free SMS a day (about 300 a month) covers about 1.4 shops' OTPs.
- **Functions:** the free invocations and compute easily cover the prototype.

The demo deployment will very likely cost nothing. This does not change the per-shop answer at scale.

### 3.2 Sensitivity

- Queue sweep fixed (section 4, item 1): infrastructure ≈ **S$0.10**.
- If Firestore cost twice the default rates in this location (the page gives no location breakdown): infrastructure ≈ S$0.79.
- If customers search 3 times per booking: +258 reads per booking, about +S$0.02.
- Carrier fees on Twilio messages are not included and would add to the S$47.62.
- The total is dominated by the two SMS prices; a 20% change in them moves the total by about S$12.

### 3.3 Options considered (decided 4 Nov 2026, A9)

These were the options put to the Product Owner. **Decision (Haziq, PO, 4 Nov 2026):** for the demo, keep the free mock reminder provider and Firebase test phone numbers for OTP, and measure infrastructure against S$5 (A9, `docs/requirements.md` NFR-07). A production launch would need paid SMS or a free channel, and the target would have to be revisited then.
- **Measure infrastructure against S$5 and pass messaging through to the shop at cost.** On these figures infrastructure is S$0.43 per shop per month (S$0.10 with the queue sweep fixed), so this meets the target; messaging (about S$62) would be billed to the shop as used.
- **Cheaper or free reminder channel:** push notifications, email, or messaging-app templates. Not priced here.
- **Fewer messages:** for example, no confirmation SMS (the confirmation is on screen) and one reminder instead of two.
- **Fewer OTPs:** the verify screen always sends a new code, even though `confirmBooking` accepts any verified Singapore phone token. Reusing a still-valid sign-in for a new booking would remove most OTPs for returning customers. This must be checked against the identity rules (fresh OTP for history and booking changes).
- **Restate the target** in another form, for example messaging per booking.

Example: OTP for first-time customers only (assume 30% of bookings, with 10% resends: 66 SMS ≈ US$3.30) plus reminders through a free channel, plus infrastructure (US$0.34) ≈ **S$4.65**. That is just under S$5 with little margin, and it depends on two decisions that have not been made.

---

## 4. Repeated reads of unchanged data

| # | Where | Reads | Recommendation |
|---|---|---|---|
| 1 | **Open.** **Queue sweep** re-reads every live appointment in a 36-hour window, about twice a minute (`sweepQueueDelays` + `recalcBarber`/`loadState`, prototype `functions/queue.js`; L33) | about 864,000 per shop per month; more than 95% of the Firestore cost | **Fix.** Only recalculate barbers whose state can have changed: something in service, a live walk-in queue, or a booking whose start has passed. Or skip a barber whose appointments and queue have not changed since the last run. L33 already lists the first option. **Owner: Alson (FR-10, PR-17).** |
| 2 | **Verify screen** re-reads shop, service and barber (`VerifyView.vue`, 3 `getDoc`s) that the shop page's listeners loaded seconds earlier | 3 per booking | **Fix (low priority).** Pass the names from the shop page in the booking draft. Saves very little money but is exactly what NFR-07's third bullet rules out. **Owner: Haziq (`VerifyView`).** |
| 3 | **Shop page** re-reads the shop doc, services and barbers that discovery's `shopDetail` cache already holds | 7 per booking | **Justify.** The shop page needs live listeners so a deactivated barber or service disappears at once (FR-07, checked on 2 Nov). The shop doc alone (1 read) could reuse the search result; not worth the extra code path |
| 4 | **Shop page schedule listeners** re-read the barber-day schedules the next-slot lookup read | 2 per booking | **Justify.** Availability must be live (FR-02, NFR-03); the discovery cache is 60 seconds old by design |
| 5 | **`holdSlot`** re-reads shop, service and barbers the client already has | 4 per booking | **Justify.** The server must not trust client data (trust zones) |
| 6 | **Shop map** reads every verified shop (whole docs) once per page session, including shops the search already loaded (L44) | about 50 per visitor who scrolls to the map (not in this run) | **Justify for now** (once per session, cached); fix before the catalogue grows past a few hundred shops, as L44 says |
| 7 | **Idle sweep queries** run every minute even when nothing is due | about 216,000 per month for the whole platform (about US$0.13) | **Justify.** Needed for reminders and hold expiry; the cost is fixed and small |
| 8 | **Shop page** subscribes to today's schedules before a date is chosen | 2 per booking (empty) | **Justify.** Trivial; today is the default date |

Not repeated, but worth knowing:
- The geohash range queries return shops just outside the 3 km circle: 12 shop docs read for 8 shown. This is inherent to the geohash method.
- The next-slot lookups (79 service and barber reads, about 37 schedule reads) are the largest part of a booking's client reads. This is the cost of L14 (nearest 10 shops, 3 days).

---

## 5. Limits

Not measured in the emulator run:
- **The shop map** (not scrolled into view in the run; about 50 reads per visitor who scrolls to it).
- **My Bookings, cancel and reschedule** (each adds reads and writes to the bookings that use them).
- **Staff start and finish:** estimated from the code, not measured.
- **The sweep (reminders, holds, waitlist, queue), the `dailyStats` trigger and the waitlist trigger:** not on this branch; counted from the `prototype` tag.
- **Server-side reads and writes of `holdSlot` and `confirmBooking`:** counted from code. The written documents were checked in the emulator; the reads were not.

## 6. Other open points

- **Prices still assumed:** the Cloud Functions compute rate beyond the free tier, and Twilio carrier fees (not included).
- **Whether reading a missing document is billed** is assumed (counted as one read each).
- **One flow, two runs** (136 and 143 reads), at night, against emulator data. Production uses the same SDK, and billing counts documents the same way; the transport may differ.
- **Hosting size** comes from the most recent production build's gzip sizes, not from this branch's build (not run, to avoid changing `dist/`).
- **Decision recorded:** NFR-07 was restated by the Product Owner on 4 Nov 2026 (A9). The queue sweep fix (section 4, item 1) is still open.
