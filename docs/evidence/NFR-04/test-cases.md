# NFR-04 Security and privacy: test cases

Each row is one attack: who tries it, what they try, what must happen, and the test that proves it.
"Rules" tests are in `tests/rules.test.mjs` and run against the Firestore emulator
(`node --test tests/rules.test.mjs`, 74 passed, 0 failed, 0 skipped on `main`, 22 Oct 2026).
Line numbers refer to that file on `main`.

Actors in the tests: `customer('cust1')`, another customer `cust2`/`cust3`, `owner('a')`, `barber('a', 'b1')`,
staff of another shop `owner('b')`/`barber('b')`, platform `admin()`, and signed-out `anon()`.

## 1. A customer and other customers' data

| ID | Who | Attempt | Expected | Covered by |
|---|---|---|---|---|
| S-01 | Customer | Read another customer's appointment by ID | Denied | Rules L162 "customer reads only their own appointments and profile"; L305 "a customer cannot list or read another customer's appointments" |
| S-02 | Customer | List another customer's appointments (`where customerId == other`) or list all appointments | Denied | Rules L305; L252 "supports listing own appointments by customerId" |
| S-03 | Customer | Read another customer's booking history | Denied | Rules L488 "denies another customer's history, an unfiltered listing, and a status-only listing" |
| S-04 | Customer | Cancel, move or flag an appointment directly in Firestore (own or another's) | Denied | Rules L297 "a customer cannot cancel, move or flag their own appointment from the client"; L319 "nobody can change an appointment or the schedule from the client" |
| S-05 | Customer | Edit or delete a finished appointment in their history | Denied | Rules L507 "history is read-only" |
| S-06 | Customer | Read another customer's profile | Denied | Rules L162 |
| S-07 | Customer | Read another customer's deposit | Denied | Rules L211 "lets a customer read only their own deposit (FR-13)" |
| S-08 | Customer | Mark their own deposit as paid | Denied | Rules L280 "denies updating and deleting deposits, including the customer marking their own as paid (FR-13)" |
| S-09 | Customer | Read or list another customer's waitlist entry | Denied | Rules L183 "lets a customer read only their own waitlist entries (FR-15)"; L191 "supports listing own entries by customerId, and nobody else's" |
| S-10 | Customer | Create, claim or delete a waitlist entry directly (skipping `joinWaitlist`/`claimOffer`) | Denied | Rules L271 "denies creating, updating and deleting waitlist entries ... (FR-15)" |
| S-11 | Customer | Read another customer's no-show and late-cancel counts (`shopStats`), or reset their own | Denied | Rules L309 "a customer reads only their own shopStats and cannot write them"; L349 (noShowCount) |
| S-12 | Customer, signed-out user | Read a HELD slot that has no customer yet | Denied | Rules L238 "keeps a HELD appointment (no customer yet) unreadable to customers and anonymous users" |
| S-13 | Customer | Read reminder tasks (`notifications`) | Denied | Rules L175 "scopes audit log and notifications to the shop" |
| S-14 | Customer | Cancel or reschedule another customer's booking through the `cancelBooking`/`reschedule` callable | Refused (`permission-denied`) | **Missing** (callable, not rules; the functions arrive in PR-10) |

## 2. Staff of one shop and another shop's data

| ID | Who | Attempt | Expected | Covered by |
|---|---|---|---|---|
| S-20 | Owner of shop B | Read shop A's appointments | Denied | Rules L169 "staff read only their own shop appointments; barbers only their own" |
| S-21 | Owner of shop B | Read shop A's audit log and reminder tasks | Denied | Rules L175; L325 (cancellation audit records) |
| S-22 | Staff of shop B | Read shop A's deposits | Denied | Rules L217 "lets the shop owner, and only the matching barber, read deposits (FR-13)" |
| S-23 | Staff of shop B | Read shop A's waitlist entries | Denied | Rules L196 (owner), L201 (barber) |
| S-24 | Staff of shop B | Read shop A's time blocks | Denied | Rules L125 "an owner reads every block in their own shop, and no other shop's"; L133 |
| S-25 | Owner of shop B | Read shop A's walk-in queue | Denied | Rules L514 "lets the owner read every walk-in in their own shop, and no other shop's" |
| S-26 | Owner of shop B | Read shop A's dashboard stats | Denied | Rules L72 "barbers, other shops, customers, admin and the public cannot read it" |
| S-27 | Owner of shop B | Edit shop A's profile, services or barbers | Denied | Rules L429 (profile), L403 (services), L408 (barbers) |
| S-28 | Staff of shop B | Change shop A's appointments or schedule | Denied | Rules L319 |
| S-29 | Owner or barber | Read customer `shopStats` (no-show and late-cancel counts) | Denied | Rules L315 "staff cannot read customer shopStats"; L349 |

## 3. A barber doing owner-only actions

| ID | Who | Attempt | Expected | Covered by |
|---|---|---|---|---|
| S-30 | Barber | Read another barber's appointments, deposits, waitlist entries, blocks, queue or reminders in the same shop | Denied | Rules L169, L217, L201, L117, L520, L232 |
| S-31 | Barber | List a collection without limiting it to their own `barberId` | Denied | Rules L138, L201, L226, L232, L526 |
| S-32 | Barber | Read the owner dashboard (`dailyStats`) | Denied | Rules L72 |
| S-33 | Barber | Create a service | Denied | Rules L376 "owner writes valid services in own shop only" |
| S-34 | Barber | Deactivate or edit an existing service | Denied | **Missing** (L376 covers create only) |
| S-35 | Barber | Edit or deactivate a barber (themselves or another) | Denied | Rules L408 "owner edits and deactivates barbers in own shop only" |
| S-36 | Barber | Edit the shop profile (name, notice window) | Denied | **Missing** (L437 tests only the summary fields for a barber) |
| S-37 | Barber | Create a barber login through the `addBarber` callable | Refused (`permission-denied`) | **Missing** (callable, not rules; `addBarber` arrives in PR-07) |
| S-38 | Owner or barber | Create or delete a barber doc directly | Denied | Rules L425 "clients cannot create or delete barbers (addBarber does that)" |

## 4. Anyone writing server-owned data

| ID | Who | Attempt | Expected | Covered by |
|---|---|---|---|---|
| S-40 | Anyone (signed out, customer, owner, barber, admin) | Write `appointments`, `auditLog`, `notifications`, `deposits`, `waitlist`, `schedules`, `queue`, `blocks`, `dailyStats`, `statContrib`, `customers`, `shopStats`, `members` | Denied | Rules L265 "denies writes to {path}" (13 tests, all five actors each) |
| S-41 | Owner, customer | Update or delete an existing appointment | Denied | Rules L286 "denies updating and deleting existing appointments" |
| S-42 | Anyone | Change a schedule's intervals | Denied | Rules L319; L149 "nobody writes blocks or schedule intervals from the client" |
| S-43 | Anyone | Start, finish, mark or reverse a no-show from the client | Denied | Rules L342 |
| S-44 | Anyone | Write or edit audit records | Denied | Rules L325, L362 |
| S-45 | Owner, admin | Create a shop | Denied | Rules L451 "does not allow creating shops from the client" |
| S-46 | Owner | Change the shop's verification status | Denied | Rules L429 |
| S-47 | Admin | Change anything on a shop except its status | Denied | Rules L429 |
| S-48 | Anyone | Write the trigger-owned shop summary fields (`priceMin`, `priceMax`, `serviceTypes`, `minDurationMin`) | Denied | Rules L437 |
| S-49 | Anyone | Read or write the stats trigger ledger (`statContrib`) | Denied | Rules L77, L265 |

## Missing tests (to add before this PR leaves draft)

| ID | Plan |
|---|---|
| S-34 | Rules test: `barber('a')` updating `shops/a/services/s1` `{ active: false }` fails. |
| S-36 | Rules test: `barber('a')` updating `shops/a` `{ noticeMins: 60 }` fails. |
| S-14 | Callable test once `cancelBooking`/`reschedule` are on `main` (PR-10): another customer's call returns `permission-denied`. Record as "pending PR-10" until then. |
| S-37 | Callable test once `addBarber` is on `main` (PR-07): a barber's call returns `permission-denied`. Record as "pending PR-07" until then. |
