# Fresher — Public demo deployment runbook

Decision: A17 in `docs/decisions.md`. Project `fresher-6d857` (alias `prod`), Blaze plan, region `asia-southeast1`, public URL `https://fresher-6d857.web.app`.
**You run every command below yourself.** Claude Code does not deploy and does not touch the production project.

This is a **demo**: SMS and payments are mocked, customers sign in with Firebase test phone numbers, and demo mode is on. The site says so on every page.

## What changes in production

| Area | Local (emulators) | Public demo |
|---|---|---|
| Firebase config | `import.meta.env.DEV` connects Auth, Firestore, Functions to emulators | Real config from `.env.local`; no emulator code path runs |
| App Check | Not used (emulator) | Web: reCAPTCHA Enterprise. Functions: `enforceAppCheck` on every callable |
| Demo mode | Mocks allowed (emulator) | `DEMO_MODE=true` (functions) and `VITE_DEMO_MODE=true` (web): `mockPay` and the postal stub available, banner shown |
| `PAYMENT_WEBHOOK_SECRET` | Fixed mock value | Real secret in Secret Manager |
| `ONEMAP_TOKEN` | Unset, stub | Unset, stub (function does not bind it in demo mode) |
| `APP_BASE_URL` | `http://localhost:5002` | `https://fresher-6d857.web.app` |
| Seed | `npm run seed` | `npm run seed:live -- --confirm-live=fresher-6d857` |
| Customer sign-in | Auth emulator prints the OTP | Firebase test phone numbers (fixed codes, no SMS) |

## Files that carry the configuration

| File | Contents | Committed? |
|---|---|---|
| `.env.local` | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` (real web config) and `VITE_APP_CHECK_SITE_KEY` | No (`*.local` is git-ignored). The web config is not secret, but keep it out of the repo anyway |
| `.env.production` | `VITE_DEMO_MODE=true` | Yes (not secret) |
| `functions/.env.prod` | `DEMO_MODE=true`, `APP_BASE_URL=https://fresher-6d857.web.app` | Yes (not secret). Loaded only when deploying with `--project prod`, so the emulators never see it |
| Secret Manager | `PAYMENT_WEBHOOK_SECRET` | Never in files |
| `.firebaserc` | alias `prod` → `fresher-6d857` | Yes |

`.env.example` documents the variables; `VITE_DEMO_MODE` defaults to off.

## Part 1 — Console checklist (do these first, by hand)

### 1. Authentication (Build → Authentication)
- [ ] **Sign-in method**: Email/Password enabled (staff) and **Phone** enabled (customers).
- [ ] **Phone test numbers** (Sign-in method → Phone → "Phone numbers for testing"): you have added them. Check each is `+65` followed by 8 digits starting with 8 or 9 (the app rejects anything else) and note the 6-digit code for each. Maximum 10. Give friends one number and code each, and use different numbers for different friends (they otherwise share one customer account, L38).
- [ ] **Settings → Authorized domains**: `fresher-6d857.web.app` and `fresher-6d857.firebaseapp.com` are there by default. Remove nothing; do not add `localhost` for production.
- [ ] Do **not** enable anonymous sign-in.

### 2. Firestore (Build → Firestore Database)
- [ ] The default database exists in Native mode in **asia-southeast1** (`firebase.json` says so). If it does not, create it there in production (locked) mode; the rules deploy replaces the locked rules.

### 3. reCAPTCHA Enterprise key (Google Cloud console, project `fresher-6d857`)
Open <https://console.cloud.google.com/security/recaptcha> (Security → reCAPTCHA / Fraud Defense).
- [ ] Enable the **reCAPTCHA Enterprise API** if it asks.
- [ ] **Create key**: display name `fresher-web`; platform **Website**; domains `fresher-6d857.web.app` and `fresher-6d857.firebaseapp.com`; leave **"Use checkbox challenge" unselected** (App Check needs the invisible score-based type). **Do not add `localhost`** to this key.
- [ ] Copy the **key ID** (the site key). It is public, so it goes in `.env.local` as `VITE_APP_CHECK_SITE_KEY=<key id>`.
- [ ] Check the current reCAPTCHA Enterprise free tier and pricing (the project is on Blaze; the budget alert covers surprises).

### 4. App Check (Build → App Check)
- [ ] **Apps** tab → your web app → **reCAPTCHA Enterprise** → paste the same key ID → Save. Leave the token time-to-live at the default (1 hour) and the risk threshold at 0.5.
- [ ] **APIs** tab: leave Cloud Firestore, Authentication (and Storage, if listed) as **Unenforced** for now. Callables are enforced in code, not here. After a day of friends using the site, the metrics should show mostly "verified" requests; only then consider enforcing Firestore (optional, L1).
- [ ] Cloud Functions does not appear as an enforceable API here for callables (our functions enforce it themselves); do not expect a toggle for it.

### 5. Budget and APIs
- [ ] Budget alert set (you did this). Consider also a budget action or a low cap for the first week.
- [ ] `firebase deploy` will enable the other APIs it needs (Cloud Build, Artifact Registry, Cloud Run, Eventarc, Pub/Sub, Cloud Scheduler, Secret Manager). If a deploy asks you to enable one, say yes.

## Part 2 — Local files (one time, before deploying)

```sh
cd ~/fresher-project

# 1. Alias so functions/.env.prod is picked only for production.
npx -y firebase-tools@latest use --add          # choose fresher-6d857, alias: prod
# (or edit .firebaserc: "projects": { "default": "fresher-6d857", "prod": "fresher-6d857" })
```

Add to `.env.local` (keep the four `VITE_FIREBASE_*` lines that are already the real config):

```
VITE_APP_CHECK_SITE_KEY=<the reCAPTCHA Enterprise key id>
```

`.env.production` (create) and `functions/.env.prod` (create):

```sh
printf 'VITE_DEMO_MODE=true\n' > .env.production
printf 'DEMO_MODE=true\nAPP_BASE_URL=https://fresher-6d857.web.app\n' > functions/.env.prod
```

Check the emulators still ignore the production file: start them as usual and confirm the log line "Loaded environment variables from …" does **not** list `.env.prod`, and that a search on `/` in dev still works.

## Part 3 — Secrets

```sh
# Random 32-byte hex secret straight into Secret Manager (never printed, never in a file).
openssl rand -hex 32 | npx -y firebase-tools@latest functions:secrets:set PAYMENT_WEBHOOK_SECRET --data-file - --project prod
```

- **Do not create `ONEMAP_TOKEN`.** In demo mode `geocode` does not bind it. (If you turn demo mode off later you must create it first, or the deploy stops.)
- Confirm: `npx -y firebase-tools@latest functions:secrets:get PAYMENT_WEBHOOK_SECRET --project prod` shows the secret exists (it prints metadata, or the value; do not paste it anywhere).

## Part 4 — Deploy, in this order

Run from the repo root. Each step is separate so you can stop and check.

```sh
# 0. Quality gate. Emulators must be running for the rules and function tests.
npm run test:rules
npm --prefix functions run lint
npm run build            # fails on placeholder web config or a missing App Check site key

# 1. Security Rules and indexes
npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project prod
#    Wait until every index shows "Enabled" (Console → Firestore → Indexes). Building takes minutes.

# 2. Functions (creates the Cloud Scheduler job for processNotifications)
npx -y firebase-tools@latest deploy --only functions --project prod
#    First deploy may ask about an Artifact Registry cleanup policy: accept it (avoids storage cost).

# 3. Live seed (deliberate, see Part 5)
SEED_STAFF_PASSWORD='<a strong password, 12+ chars>' \
  npm run seed:live -- --confirm-live=fresher-6d857

# 4. Hosting last: the public URL goes live only now. Its predeploy step runs `npm run build`.
npx -y firebase-tools@latest deploy --only hosting --project prod
```

Never run a bare `firebase deploy` (it would also push the Auth provider block in `firebase.json`). Always pass `--only`.

The build guard fails when `VITE_FIREBASE_*` is missing or starts with `demo-`, or `VITE_APP_CHECK_SITE_KEY` is missing. It does not require `VITE_DEMO_MODE`; check the banner shows after deploy (below).

## Part 5 — The live seed

`npm run seed:live` on its own does nothing except print how to run it. It writes only if **all** of these hold:
- `--confirm-live=fresher-6d857` (the project id, typed by you);
- the emulator environment variables are **not** set;
- `SEED_STAFF_PASSWORD` is set, 12+ characters (there is no default; `password123` is never used on the live project);
- none of the sample shops exist yet, unless you add `--overwrite`;
- Application Default Credentials exist: `gcloud auth application-default login` (choose the Google account that owns the project).

It creates the fictional shops, services, barbers and the staff accounts (`owner@shop-*.example.com`, `barber@…`, `admin@fresher.example.com`) with the password you gave. Print of the account list appears in your terminal only. Re-running with `--overwrite` replaces the sample shops and resets their edited fields (L39).

## Part 6 — First deploy checks (tick these, then mark L20 and L33 resolved)

- [ ] `https://fresher-6d857.web.app` loads and shows the **Demo** banner on `/`, `/my-bookings` and `/staff/config`.
- [ ] Browser devtools → Network: calls to `firebase-appcheck` / `exchangeRecaptchaEnterpriseToken` succeed, and callable requests carry the header `X-Firebase-AppCheck`.
- [ ] A callable without the header is refused: `curl -s -X POST https://asia-southeast1-fresher-6d857.cloudfunctions.net/holdSlot -H 'Content-Type: application/json' -d '{"data":{}}'` returns `UNAUTHENTICATED` (use the function URL from the deploy output if this address does not resolve).
- [ ] Search postal code `600135`: results appear (stub). An unlisted code such as `123456` says not found; nothing calls OneMap.
- [ ] Book a slot with a test phone number: hold, code, confirmation. The mock SMS link in the notification task (Console → Firestore → `notifications`) starts with `https://fresher-6d857.web.app`.
- [ ] Staff sign-in at `/login` with the seeded owner and your `SEED_STAFF_PASSWORD`; `/staff/config` loads.
- [ ] Firestore → Indexes: all **Enabled** (L20, L33).
- [ ] Cloud Scheduler has a `processNotifications` job in `asia-southeast1`, and Functions logs show a run every minute (L20).
- [ ] Deposit flow: a customer with two no-shows sees the mock checkout and "pay" completes it (needs a customer with two no-shows; `seed:fr13` is emulator-only, so create the case by marking two of a test customer's bookings no-show as the owner). `mockPay` works only because demo mode is on.
- [ ] Budget alert email works; check Billing → Reports after a day (the once-a-minute sweep is the steady cost).

## Rollback and turning things off

- **Take the site down:** `npx -y firebase-tools@latest hosting:disable --project prod` (functions and data stay).
- **Turn demo mode off:** remove `DEMO_MODE` from `functions/.env.prod` and `VITE_DEMO_MODE` from `.env.production`, create `ONEMAP_TOKEN`, redeploy functions and hosting. The mock checkout and the stub disappear.
- **Cost stop:** disable the schedule with `gcloud scheduler jobs pause` on the `processNotifications` job (find its name in Cloud Scheduler), or delete the function.
- **Remove the seed data:** delete the sample shops and staff users by hand in the console; there is no automated reset.
