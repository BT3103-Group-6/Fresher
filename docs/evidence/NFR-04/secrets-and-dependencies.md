# NFR-04 Secrets and dependencies check

Checked on `main` at `c547489` (after PR-09, FR-01 discovery), Wed 28 Oct 2026, with Node 22 and npm 10.
This covers the "Secrets and dependencies" part of NFR-04 in `docs/team-plan.md`. Screenshots of console settings
(Maps key restriction) are separate and must show no key values.

## 1. Secrets

| Check | Method | Result |
|---|---|---|
| No secret in git history | Searched every commit on every branch and tag (`git log --all -p`) for Google API keys (`AIza…`), private keys and service-account JSON, Stripe/GitHub/Slack tokens, reCAPTCHA keys, and values for `PAYMENT_WEBHOOK_SECRET`, `ONEMAP_TOKEN` and `SEED_STAFF_PASSWORD` | **None found** |
| No secret files ever committed | Listed every path ever committed (`git log --all --name-only`) for `.env*`, service-account, `.pem`, `.p12` | Only `.env.example`, `.env.production` and, on the `prototype` tag only, `functions/.env.prod`. All three hold flags or placeholders, no secrets (`DEMO_MODE`, `APP_CHECK_ENFORCE`, a commented example URL). `functions/.env.prod` was removed from the prototype in `b5bf4d7` and is git-ignored |
| Working tree | `git ls-files` | Only `.env.example` and `.env.production` are tracked; `.env.local`, `.env.*`, `functions/.env.*` and `*.secret.local` are git-ignored |
| No secret in the browser bundle | `npm run build`, then searched `dist/` for the same patterns | **No secret found.** One finding, see F-1 |
| Server secrets stay server-side | Searched `src/` for `PAYMENT_WEBHOOK_SECRET` and `ONEMAP_TOKEN` | Not referenced in the web app; they are Functions secrets only (decisions A17) |

**F-1 (low).** `dist/` contains the text `password123`. It is the **emulator-only** staff password in the sign-in page's "Dev accounts" hint (`src/views/staff/SignInView.vue`, line 85). The hint is behind `v-if="isDev"`, so it is never shown in production, but the string is still compiled into the bundle. It is not a live credential: live staff accounts use `SEED_STAFF_PASSWORD`, which has no default and is never committed (decisions A17). Optional fix later: move the hint text into a dev-only module so it is dropped from production builds.

## 2. Dependencies (`npm audit`)

| Package set | All dependencies | Production only (`--omit=dev`) |
|---|---|---|
| Root (web app) | 9: 7 high, 2 moderate | 5 high |
| `functions/` | 17: 1 high, 11 moderate, 5 low | 10: 1 high, 9 moderate |

No critical findings.

### Root

| Advisory | Severity | Where | Assessment |
|---|---|---|---|
| `@grpc/grpc-js` returns unauthorized certificates from `getAuthContext` (pulled in by `firebase` → `@firebase/firestore`) | high | prod | **Not in the browser bundle.** The web Firestore SDK uses WebChannel; `grpc-js` is only used by the Node build. Checked: the built `firebase-firestore` chunk contains no `grpc-js` code. `npm audit` suggests "fixing" by downgrading `firebase` to 9.14.0, which is a breaking downgrade and not taken |
| `vite` 8.3.0–8.3.2: `launch-editor` command-argument escaping on Windows | high | dev | Dev server only (open-in-editor), never in the build. Fix available (`npm audit fix`) |
| `source-map-js`: event-loop DoS on crafted source maps | high | dev | Build tooling only. Fix available |
| `uuid` buffer bounds, via `gaxios` | moderate | dev | `firebase-admin` used by tests and seed scripts only |

### functions/

| Advisory | Severity | Where | Assessment |
|---|---|---|---|
| `body-parser` 2.0.0–2.3.0: DoS via trailing bytes after a compressed request body (via `firebase-functions` → `express`) | high | prod | Affects every HTTPS function, including callables and `paymentWebhook`. Impact is denial of service, not data access; App Check (#19) reduces exposure for callables but not for `paymentWebhook`. **Fix available without a breaking change (`npm audit fix` in `functions/`)** |
| `qs` DoS, `uuid` bounds, `google-gax`/`retry-request`/`teeny-request` (via `firebase-admin`) | moderate | prod | Transitive in the Admin SDK; the suggested fix is a major `firebase-admin` change, not taken in the prototype |
| `jest`, `deepmerge`, `ts-deepmerge` (via `firebase-functions-test`) | low/moderate | dev | Test tooling only |

### Decision needed (Haziq)

Running `npm audit fix` changes `package-lock.json` and `functions/package-lock.json`, which the PR-19 parity check compares with the `prototype` tag. Options:

1. Record the findings here and in the limitations (L-entries), and leave the lockfiles at the prototype versions for Sprint 1.
2. After PR-19's parity check passes, apply the non-breaking fixes (`body-parser`, `vite`, `source-map-js`) in one `fix/nfr-04-dependencies` PR in Sprint 2, re-run the tests, and record the new `npm audit` totals here.

Recommended: option 2, so the one production high in `functions/` (`body-parser`) is fixed before the final deploy.

## 3. Still to do for this part

- [ ] Google Maps browser key: screenshot of its restriction (HTTP referrers and Maps JavaScript API only), with the key value hidden.
- [ ] Re-run this check on the final `main` before the last deploy and update the totals.