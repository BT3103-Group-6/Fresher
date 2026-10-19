# Fresher — Public demo deployment runbook

Decision: A17 in `docs/decisions.md`. Project `fresher-6d857` (alias `prod`), Blaze plan, region `asia-southeast1`.
**The demo is shared through an expiring Hosting preview channel** (`https://fresher-6d857--demo-<random>.web.app`), not the live `fresher-6d857.web.app` address, which is never deployed. **App Check is deferred for this demo** (`VITE_APP_CHECK_ENABLED=false`, `APP_CHECK_ENFORCE=false`; both default to on), so the backend is open to any client that knows the URL: keep the link among friends and let the channel expire (L1).
**You run every command below yourself.** Claude Code does not deploy and does not touch the production project.

This is a **demo**: SMS and payments are mocked, customers sign in with Firebase test phone numbers, and demo mode is on. **The site carries no demo banner**: only the landing page footer (mock data and messages) and the "Test mode" note on the deposit checkout say so. Tell friends this is a demo, which postal codes work (`160055`, `520478`, `600135`) and which test phone number and code each of them uses.

## What changes in production

| Area | Local (emulators) | Public demo |
|---|---|---|
| Firebase config | `import.meta.env.DEV` connects Auth, Firestore, Functions to emulators | Real config from `.env.local`; no emulator code path runs |
| App Check | Not used (emulator) | **Off for this demo** (deferred, L1). When on (the default): web reCAPTCHA Enterprise, and `enforceAppCheck` on every callable. Switches: `VITE_APP_CHECK_ENABLED` and `APP_CHECK_ENFORCE` |
| Demo mode | Mocks allowed (emulator) | `DEMO_MODE=true` (functions) and `VITE_DEMO_MODE=true` (web): `mockPay` and the postal stub available (no banner; the deposit checkout keeps its "Test mode" note) |
| `PAYMENT_WEBHOOK_SECRET` | Fixed mock value | Real secret in Secret Manager |
| `ONEMAP_TOKEN` | Unset, stub | Unset, stub (function does not bind it in demo mode) |
| `APP_BASE_URL` | `http://localhost:5002` | The preview channel URL, known only after the first channel deploy (Part 4) |
| Seed | `npm run seed` | `npm run seed:live -- --confirm-live=fresher-6d857` |
| Customer sign-in | Auth emulator prints the OTP | Firebase test phone numbers (fixed codes, no SMS) |

## Files that carry the configuration

| File | Contents | Committed? |
|---|---|---|
| `.env.local` | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` (real web config); `VITE_APP_CHECK_SITE_KEY` only once App Check is turned on | No (`*.local` is git-ignored). The web config is not secret, but keep it out of the repo anyway |
| `.env.production` | `VITE_DEMO_MODE=true`, `VITE_APP_CHECK_ENABLED=false` | Yes (not secret) |
| `functions/.env.prod` | `DEMO_MODE=true`, `APP_CHECK_ENFORCE=false`, `APP_BASE_URL=<preview channel URL>` | Yes (not secret). Loaded only when deploying with `--project prod`, so the emulators never see it |
| Secret Manager | `PAYMENT_WEBHOOK_SECRET` | Never in files |
| `.firebaserc` | alias `prod` → `fresher-6d857` | Yes |

`.env.example` documents the variables. Defaults: `VITE_DEMO_MODE` off; `VITE_APP_CHECK_ENABLED` and `APP_CHECK_ENFORCE` **on** (only the exact value `false` turns them off). The two App Check switches must agree: web on with functions off is harmless, but web off with functions on makes every callable fail.

## Part 1 — Console checklist (do these first, by hand)

### 1. Authentication (Build → Authentication)
- [ ] **Sign-in method**: Email/Password enabled (staff) and **Phone** enabled (customers).
- [ ] **Phone test numbers** (Sign-in method → Phone → "Phone numbers for testing"): you have added them. Check each is `+65` followed by 8 digits starting with 8 or 9 (the app rejects anything else) and note the 6-digit code for each. Maximum 10. Give friends one number and code each, and use different numbers for different friends (they otherwise share one customer account, L38).
- [ ] **Settings → Authorized domains**: `fresher-6d857.web.app` and `fresher-6d857.firebaseapp.com` are there by default, but **a preview channel host is not**. After the first channel deploy (Part 4, step 2) add its exact host, for example `fresher-6d857--demo-a1b2c3d4.web.app`, or customer phone sign-in fails with `auth/unauthorized-domain`. Do not add `localhost`.
- [ ] Do **not** enable anonymous sign-in.

### 2. Firestore (Build → Firestore Database)
- [ ] The default database exists in Native mode in **asia-southeast1** (`firebase.json` says so). If it does not, create it there in production (locked) mode; the rules deploy replaces the locked rules.

### 3. App Check — deferred for this demo (skip 3 and 4 unless turning it on)
Nothing to register while `VITE_APP_CHECK_ENABLED=false` and `APP_CHECK_ENFORCE=false`. The build does not need a site key and the web app does not start App Check. To turn it on later, follow "Turning App Check on" at the end.

### 4. Budget and APIs
- [ ] **Google Maps key** for the landing page map (decisions A20, L46): Google Cloud console (project `fresher-6d857`) -> APIs & Services -> enable **Maps JavaScript API** -> Credentials -> Create API key. Restrict it: *Application restrictions* = Websites, allowing `http://localhost:5173/*` and the exact preview channel host (add it after the first channel deploy, as with Authorized domains); *API restrictions* = Maps JavaScript API only. The Maps API needs the billing account linked; add a budget alert for it. Put the key in `.env.local` as `VITE_GOOGLE_MAPS_API_KEY` (not committed). Without the key the app still builds and the map section shows the list view.
- [ ] **Map ID and map style** (decisions A20, L48; needed for the decluttered look, and for Advanced Markers to be styled). In the same Cloud project: Google Maps Platform -> **Map Management** (the label may read "Map management" in the sidebar; Google renames things now and then).
  1. **Create a Map ID:** Map IDs -> *Create Map ID*. Name `fresher-landing`; Map type **JavaScript**; Map type option **Vector** (raster also works); leave tilt and rotation off. Save. Copy the Map ID.
  2. **Create the style:** Map Styles -> *Create style*. Start from the default (Standard) map. In the style editor:
     - **Points of interest:** set visibility to *off* for the whole group, or one by one: Attractions, Business, Government, Medical, Parks, Place of worship, School, Sports complex. (If you keep parks at all, hide their *icons* and keep only the area fill.)
     - **Transit:** hide *Stations* (rail, bus, airport icons); hiding all of Transit is fine.
     - **Landscape / natural (parks and green areas):** fill a muted grey-green such as `#DDE8E4` (or `#E9EEEC`); no saturated green.
     - **Water:** fill a muted blue-grey such as `#C9DAE0`.
     - **Roads and labels:** leave roads and the road, neighbourhood and area names visible (people orient by them); optionally lighten road strokes to `#FFFFFF` fill and `#E3E8E6` stroke.
     Save, then **Publish** the style.
  3. **Attach the style:** Map IDs -> `fresher-landing` -> *Map style* -> pick the published style -> Save. Changes can take a few minutes to appear.
  4. **Use it:** put the Map ID in `.env.local` as `VITE_GOOGLE_MAP_ID=<the id>` and restart `npm run dev` (Vite reads the file at start); for the demo build set it before `npm run build`. The Map ID is not secret, and no key restriction is needed for it. If it is unset the code falls back to `DEMO_MAP_ID` (no custom style).
- [ ] Budget alert set (you did this). Consider also a budget action or a low cap for the first week.
- [ ] `firebase deploy` will enable the other APIs it needs (Cloud Build, Artifact Registry, Cloud Run, Eventarc, Pub/Sub, Cloud Scheduler, Secret Manager). If a deploy asks you to enable one, say yes.

## Part 2 — Local files (one time, before deploying)

```sh
cd ~/fresher-project

# 1. Alias so functions/.env.prod is picked only for production.
npx -y firebase-tools@latest use --add          # choose fresher-6d857, alias: prod
# (or edit .firebaserc: "projects": { "default": "fresher-6d857", "prod": "fresher-6d857" })
```

`.env.production` and `functions/.env.prod` already exist for this demo (nothing to type). Check they read:

```sh
cat .env.production        # VITE_DEMO_MODE=true  VITE_APP_CHECK_ENABLED=false
cat functions/.env.prod    # DEMO_MODE=true  APP_CHECK_ENFORCE=false  (APP_BASE_URL is added in Part 4)
```

`.env.local` keeps the four real `VITE_FIREBASE_*` lines. No App Check site key is needed.

Check the emulators still ignore the production file: start them as usual and confirm the log line "Loaded environment variables from …" does **not** list `.env.prod`, and that a search on `/` in dev still works.

## Part 3 — Secrets

```sh
# Random 32-byte hex secret straight into Secret Manager (never printed, never in a file).
openssl rand -hex 32 | npx -y firebase-tools@latest functions:secrets:set PAYMENT_WEBHOOK_SECRET --data-file - --project prod
```

- **Do not create `ONEMAP_TOKEN`.** In demo mode `functions/index.js` does not even declare it (the CLI prompts for every declared secret, bound or not), so the deploy never asks for a value; `tests/demo.unit.test.mjs` checks this. (If you turn demo mode off later you must create it first, or the deploy stops.)
- Confirm: `npx -y firebase-tools@latest functions:secrets:get PAYMENT_WEBHOOK_SECRET --project prod` shows the secret exists (it prints metadata, or the value; do not paste it anywhere).

## Part 4 — Deploy, in this order

Run from the repo root. Each step is separate so you can stop and check. Hosting goes out **second**, as a preview channel, because its URL is needed for the message links and for Auth.

```sh
# 0. Quality gate. Emulators must be running for the rules and function tests.
npm run test:rules
npm --prefix functions run lint
npm run build            # fails on placeholder web config (and on a missing site key only if App Check is on)

# 1. Security Rules and indexes
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project prod
#    Wait until every index shows "Enabled" (Console -> Firestore -> Indexes). Building takes minutes.

# 2. Web app as an expiring preview channel (predeploy runs `npm run build`). The URL is printed at the end.
npx -y firebase-tools@latest hosting:channel:deploy demo --expires 7d --project prod
#    -> https://fresher-6d857--demo-<random>.web.app   (max expiry 30d)
#    Now: add that host to Console -> Authentication -> Settings -> Authorized domains,
#    and put it in functions/.env.prod as APP_BASE_URL=<that URL> (uncomment the line).

# 3. Functions (creates the Cloud Scheduler job for processNotifications)
grep '^APP_BASE_URL=' functions/.env.prod    # must print the preview URL, or message links point to a placeholder
npx -y firebase-tools@latest deploy --only functions --project prod
#    First deploy may ask about an Artifact Registry cleanup policy: accept it (avoids storage cost).

# 4. Live seed (deliberate, see Part 5)
SEED_STAFF_PASSWORD='<a strong password, 12+ chars>' \
  npm run seed:live -- --confirm-live=fresher-6d857
```

Share the preview URL only after step 4. Never run a bare `firebase deploy` (it would also push the Auth provider block in `firebase.json` and the live site); always pass `--only` or use `hosting:channel:deploy`. Do not run `deploy --only hosting`: that publishes to the live `fresher-6d857.web.app`.

The build guard fails when `VITE_FIREBASE_*` is missing or starts with `demo-`, and, only when `VITE_APP_CHECK_ENABLED` is not `false`, when `VITE_APP_CHECK_SITE_KEY` is missing. It does not require `VITE_DEMO_MODE`.

## Part 5 — The live seed

`npm run seed:live` on its own does nothing except print how to run it. It writes only if **all** of these hold:
- `--confirm-live=fresher-6d857` (the project id, typed by you);
- the emulator environment variables are **not** set;
- `SEED_STAFF_PASSWORD` is set, 12+ characters (there is no default; `password123` is never used on the live project);
- none of the sample shops exist yet, unless you add `--overwrite`;
- Application Default Credentials exist: `gcloud auth application-default login` (choose the Google account that owns the project).

It creates the fictional shops, services, barbers and the staff accounts (`owner@shop-*.example.com`, `barber@…`, `admin@fresher.example.com`) with the password you gave. Print of the account list appears in your terminal only. Re-running with `--overwrite` replaces the sample shops and resets their edited fields (L39).

**Demo dataset (A18).** The same command also seeds 50 fictional demo shops (`demo-NN-<area>`) with barbers, services, personal blocks, 14 days of past bookings and 7 days of upcoming ones, plus customers, a few waitlist entries and walk-ins. It creates about 212 more staff accounts (`owner@<shopId>.example.com` and `<barberId>@<shopId>.example.com`, same password) and 8 showcase customer accounts. The existing rules are unchanged; the existing-shops check also covers the demo shop IDs, so a second run needs `--overwrite`, which deletes and regenerates the demo shops' generated data. Add `--skip-demo` to seed only the four sample shops. Check the size first with `npm run demo:dry-run` (no Firebase access): it prints the document counts and the estimated write cost (about 20,400 writes, roughly US$0.04, about one day of the free write quota; A18 has the breakdown). Afterwards the script reads the data back, validates it and prints the counts.

To sign in as a showcase customer, add these as **test phone numbers** (Console -> Authentication -> Sign-in method -> Phone; up to 10, L38) with any six-digit codes: `+65 8000 0101` to `+65 8000 0108`. Two or more no-shows at a shop (deposit demo): 0101, 0102, 0103. History and Rebook across shops: 0104 to 0107; 0108 has a mix (one no-show, below the deposit threshold). Postal search in demo mode now accepts any valid six-digit postal code (nearest sector centroid); exact codes `160055`, `520478`, `600135` still work.


## Part 6 — First deploy checks (tick these, then mark L20 and L33 resolved)

- [ ] The preview URL loads on `/`, `/my-bookings` and `/staff/config` (no demo banner, by decision). `https://fresher-6d857.web.app` itself is **not** deployed (Hosting shows the default page or nothing).
- [ ] Landing page map (L47): scroll to "Barbers across Singapore": Google map loads only then (Network shows no `maps.googleapis.com` request before), pins and clusters show, Tab reaches a pin and Enter opens the card, one finger scrolls the page on a phone, and "View as list" lists all shops. A `RefererNotAllowedMapError` in the console means the channel host is missing from the key's referrers.
- [ ] Phone sign-in on the preview URL works with a test number (no `auth/unauthorized-domain`).
- [ ] Devtools -> Network: no `firebase-appcheck` calls (App Check is off, as intended).
- [ ] Search postal code `600135`: results appear (stub). A code that is not in the exact table, such as `123456`, is placed at its postal sector's approximate centre and finds nearby demo shops; a code in a sector that does not exist, such as `999999`, says not found; nothing calls OneMap.
- [ ] Book a slot with a test phone number: hold, code, confirmation. The mock SMS link in the notification task (Console → Firestore → `notifications`) starts with the preview channel URL.
- [ ] Staff sign-in at `/login` with the seeded owner and your `SEED_STAFF_PASSWORD`; `/staff/config` loads.
- [ ] Firestore → Indexes: all **Enabled** (L20, L33).
- [ ] Cloud Scheduler has a `processNotifications` job in `asia-southeast1`, and Functions logs show a run every minute (L20).
- [ ] Deposit flow: a customer with two no-shows sees the mock checkout and "pay" completes it (needs a customer with two no-shows; `seed:fr13` is emulator-only, so create the case by marking two of a test customer's bookings no-show as the owner). `mockPay` works only because demo mode is on.
- [ ] Budget alert email works; check Billing → Reports after a day (the once-a-minute sweep is the steady cost).

## Rollback and turning things off

- **Channel life:** `npx -y firebase-tools@latest hosting:channel:list --project prod`. The channel stops serving when it expires. To extend it (up to 30 days from now), run `hosting:channel:deploy demo --expires 30d --project prod` again; the URL stays the same. To take it down now: `hosting:channel:delete demo --project prod`. The backend (functions, data, scheduler) keeps running after the channel expires; see "Cost stop".
- **Turn demo mode off:** remove `DEMO_MODE` from `functions/.env.prod` and `VITE_DEMO_MODE` from `.env.production`, create `ONEMAP_TOKEN`, redeploy functions and hosting. The mock checkout and the stub disappear.
- **Cost stop:** disable the schedule with `gcloud scheduler jobs pause` on the `processNotifications` job (find its name in Cloud Scheduler), or delete the function.
- **Remove the seed data:** delete the sample shops and staff users by hand in the console; there is no automated reset.

## Turning App Check on later (resolves the deferral in L1)
1. Create the reCAPTCHA Enterprise key (Google Cloud console -> Security -> reCAPTCHA): platform Website; domains = the host(s) the site is served from (the live `fresher-6d857.web.app` and `fresher-6d857.firebaseapp.com`; a preview channel host must be listed too, and its domain changes if you make a new channel); checkbox challenge off; no `localhost`. Enable the reCAPTCHA Enterprise API if asked.
2. Console -> App Check -> Apps -> your web app -> reCAPTCHA Enterprise -> paste the key ID. Leave the token TTL (1 hour) and risk threshold (0.5) at their defaults. Leave Firestore and Auth enforcement off until the metrics show verified traffic.
3. Add `VITE_APP_CHECK_SITE_KEY=<key id>` to `.env.local`; delete `VITE_APP_CHECK_ENABLED=false` from `.env.production` and `APP_CHECK_ENFORCE=false` from `functions/.env.prod` (or set both to `true`).
4. `npm run build`, then redeploy functions (`deploy --only functions --project prod`) and the web app. Ship both together: web off with functions on breaks every callable.
5. Check: devtools shows callable requests with `X-Firebase-AppCheck`; `curl -s -X POST <holdSlot URL from the deploy output> -H 'Content-Type: application/json' -d '{"data":{}}'` returns `UNAUTHENTICATED`.
