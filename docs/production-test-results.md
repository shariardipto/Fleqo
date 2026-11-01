# Fleqo — Production Readiness Test Results (v1.0, plus v1.1 in §9)

All results below come from real runs on 2026-10-31/11-01 on the developer machine (Windows 11, Node 24.22.2, Docker Desktop, PostgreSQL 18, Redis 8). Timings are single local runs under varying load (VS Code processes held about 56 % CPU during some runs). **They are not performance benchmarks.**

**Environments used** (none of the developer's data was modified):
| Name | Purpose |
| --- | --- |
| `fleqo_test` DB + `fleqo-test` queue prefix | Vitest suites (truncated between tests; guarded to `*_test`) |
| `fleqo_e2e` DB + `fleqo-e2e` prefix, API :4400, worker :4401, production web build :3400 | Playwright E2E |
| Throwaway containers `fleqo-rel-pg`/`fleqo-rel-redis` | Reliability script (restarted/stopped deliberately, removed afterwards) |
| Throwaway Docker network `fleqo-imgcheck` | Production image verification (removed afterwards) |
| Owner's running demo stack (:3000 → :4000, `fleqo` DB) | Smoke test and DummyJSON import in **new throwaway tenants**; read-only SQL checks |

## 1. Static checks
| Command | Result |
| --- | --- |
| `npm run lint` (API ESLint + web ESLint) | exit 0 |
| `npm run typecheck` (API incl. tests + web) | exit 0 |
| `npm run build` (`prisma generate` + `tsc`; `next build`, 16 routes incl. `/invite/[id]`) | exit 0 |
| `npx prisma migrate status` (dev DB, read-only) | `Database schema is up to date!` |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | `No difference detected.` (exit 0) |
| `actionlint 1.7.7` on `.github/workflows/ci.yml` | exit 0 |
| `shellcheck v0.10.0 -S warning scripts/reliability-check.sh` | exit 0 (after fixing two SC2155 warnings) |
| Railway configs vs `https://backboard.railway.app/railway.schema.json` | no unknown keys; `preDeployCommand` uses the ≤ 1-item array form (superseded: Railway Config as Code is deprecated; see §10.4) |
| `npm audit --omit=dev` / `npm audit` | 0 / 0 vulnerabilities |

## 2. API unit and integration tests (`npm test`)
**10 files, 59 tests passed** (62.1 s; earlier runs: 59/59 in 147 s under heavy machine load).

| File | Tests | Covers |
| --- | --- | --- |
| `schema-constraints.test.ts` | 6 | Unique keys and CHECK constraints |
| `auth-tenancy.test.ts` | 6 | Auth, org creation, switching, RBAC, invite-link acceptance, removal |
| `security.test.ts` (**new**) | 7 | Login/logout/session persistence, invitation-squatting regression, CSRF origin check, `no-store`, org deletion disabled, sanitized errors, admin vs member |
| `connections-import.test.ts` | 5 | Secrets shown once and encrypted, RBAC, synthetic + DummyJSON import |
| `mock-providers.test.ts` | 4 | Upsert/insert-or-keep, rollback on injected failure |
| `workflows.test.ts` | 5 | CRUD, mapping validation, activation guard, isolation |
| `webhooks.test.ts` | 10 | Signature, replay window, payload validation, duplicates, tenant derivation, Redis outage + outbox |
| `worker.test.ts` | 8 | Execution, retries without repeating CRM, dead letter + manual retry, permanent errors, duplicate jobs, crash recovery |
| `recovery.test.ts` (**new**) | 7 | Recovery decisions per BullMQ job state (waiting/active/delayed left alone; failed/completed/unknown re-dispatched; finished runs untouched) |
| `batch.test.ts` | 1 | 100-event batch (§3) |

## 3. 100-event batch (re-run)
`npm run test:batch` (also part of `npm test`). Real output (`apps/api/test-results/batch-summary.json`, final run):

| Expectation | Actual |
| --- | --- |
| 100 unique signed events → 100 incoming events | 100 |
| All runs succeed | 100 succeeded, 0 failed |
| 30 distinct customers → 30 CRM rows | 30 |
| 100 orders → 100 sheet rows, unique, totals match | 100 (sum of `totalMinor` asserted) |
| 25 duplicate deliveries (20 identical + 5 reformatted) → acknowledged, no new runs | 25 |
| 5 forged deliveries → 401 | 5 × 401 |
| 10 events with injected transient failures → retried, CRM never repeated | 5 CRM ×1 retry, 5 Sheet ×2 retries; untouched actions all at 1 attempt |
| Total action attempts = 200 + 5 + 10 | **215** |
| Dead letters | 0 |

Timing varied with machine load across today's runs: ingestion 1.3–8.4 s, end-to-end 1.8–11.1 s. Counts were identical in every run.

## 4. End-to-end browser tests (Playwright, production build, CSP enforced)
`E2E_BASE_URL=http://localhost:3400 npx playwright test` → **5 passed** (1.0 min). An automatic fixture fails any test on uncaught page errors, CSP violations or console errors.

| Spec | Result | What it proves |
| --- | --- | --- |
| `connections-permissions` — switches | ✅ 8.3 s | **Regression for the reported issue:** badge, switch and label agree; checked track is green with ≥ 3:1 contrast against the card in **light and dark** mode; toggle off/on round-trips; other switches stay usable |
| `connections-permissions` — invite link | ✅ 8.4 s | A stranger cannot use the link; the invitee signs up from the link, accepts, and sees "View only" with **no** switches |
| `order-sync` | ✅ 34.1 s | Full operator loop: connect → workflow → import → 3 signed events → duplicate → transient retry (CRM 1 attempt, Sheet 2) → dead letter → manual retry (CRM 1, Sheet 6) → filters → records → dashboard → invite link → settings → sign out |
| `organizations` (**new**) | ✅ 4.6 s | Create a second org from the switcher; data separated; switch back; session survives reload |
| `mobile` (Pixel 7) | ✅ 2.7 s | Drawer navigation, empty states, no horizontal overflow |

## 5. Process-level reliability (`bash scripts/reliability-check.sh`)
Compiled API + worker, `NODE_ENV=production`, throwaway PostgreSQL 18 + Redis 8 (AOF on, `noeviction`). Real output:

| Scenario | Assertion | Result |
| --- | --- | --- |
| S1 baseline | 10 events → 10 runs succeeded, 10 rows | ✔ |
| S2 worker stopped | 10 events accepted (202); 10 runs stay `queued` (not lost); worker restart drains them → 20 | ✔ |
| S3 Redis stopped | `/api/ready` 503; 5 events still accepted; 5 outbox rows `pending`; Redis back → dispatched, 25 succeeded, 0 pending | ✔ |
| S4 worker **SIGKILL** during retry back-off (Sheet fails 3×) | After restart: CRM `upsert_customer:1`, Sheet `append_order:4` (completed CRM action **not repeated**) | ✔ |
| S5 Redis **restart** while a retry is scheduled | Run completes with exactly one sheet row (job survived via AOF; 0 stale-run recoveries needed) | ✔ |
| S6 PostgreSQL **restart** | 27 rows persisted; API ready again; 5 new events processed → 32 | ✔ |
| S7 API restart | The existing session cookie still works (DB-backed sessions) | ✔ |
| S8 duplicate after all restarts | `duplicate`, no new run | ✔ |
| Final invariants | 32 runs, 32 succeeded, 32 rows, 0 duplicate rows, 0 CRM actions with attempts ≠ 1, 0 dead letters | ✔ |

Worker log warnings were only the expected ones: 6 × "Job attempt failed" (injected) and 3 × "Enqueue failed; dispatch stays pending" (Redis outage). The API logged no errors.

## 6. Production image
`docker build -f apps/api/Dockerfile .` → **725 MB** (was 1.34 GB). On a throwaway network:

| Check | Result |
| --- | --- |
| `npx prisma migrate deploy` on an **empty** database (release step) | `All migrations have been successfully applied.` |
| Start with `WEB_ORIGINS=http://app.example.com` (NODE_ENV=production) | refused: `WEB_ORIGINS must use https in production` |
| Start with `NODE_TLS_REJECT_UNAUTHORIZED=0` | refused: `…disables TLS certificate verification; remove it in production` |
| Worker `GET /health` | `{"database":true,"redis":true,"consuming":true}` |
| `npm run smoke -- --base-url http://localhost:4700 --origin http://localhost:3000` | **13/13** passed; worker logged 2 completed jobs |
| Process user | `fleqo` (non-root) |
| `docker stop` (SIGTERM) | "Shutting down worker" / "Shutting down API", exit code 0 |
| Runtime dependencies resolvable, no web/dev/peer-only packages | ✔ (`next`, `react`, `vitest`, `typescript`, `vite` absent) |

## 7. Existing demo environment (owner's running stack)
| Check | Result |
| --- | --- |
| `npm run smoke -- --base-url http://localhost:3000` | **13/13** passed (new throwaway tenant) |
| Demo login `demo@fleqo.local` through the web proxy | 200; `/api/me` → Demo Store, owner; sign-out 200 |
| Live **DummyJSON** import, run twice (throwaway tenant) | Run 1: 60 created (20 customers, 20 products, 20 carts); run 2: 0 created / 60 updated; product prices in minor units, `sourceUrl` kept |
| Owner-reported numbers (read-only SQL, Demo Store) | 60 succeeded runs, 0 failed/open, 60 sheet rows, 41 CRM customers, 2 duplicates ignored, 0 open dead letters — **matches the report exactly** |
| Integrity (whole DB) | 0 orders with duplicate sheet rows; 0 succeeded runs missing their row |
| Production response headers (production build) | CSP, HSTS, Permissions-Policy, X-Frame-Options present; no `X-Powered-By`; API `Cache-Control: no-store` through the proxy |

## 8. Not executed (and why)
| Item | Reason |
| --- | --- |
| GitHub Actions on GitHub | No authorization to push and `gh` is not installed. Every step was run locally; the workflow is actionlint-clean |
| Live deployment checks (R6) | Blocked: no cloud credentials or deployment approval. Procedure: [deployment.md §8](./deployment.md#8-production-verification-r6) |
| Load or performance testing | Out of MVP scope; no throughput claims are made |

---

## 9. v1.1 — landing page, social sign-in, themes (2026-11-01)
Same machine and isolated environments as above. The E2E API ran with **fake** Google and GitHub client IDs/secrets (`e2e-fake-*`), so the provider buttons render and the flow can be driven up to the provider; no real provider was contacted.

### 9.1 Static checks and audit
| Command | Result |
| --- | --- |
| `npm run lint` (API + web) | exit 0 |
| `npm run typecheck` (API incl. tests + web) | exit 0 |
| `npm run build --workspace=apps/web` | exit 0; `/`, `/docs`, `/robots.txt`, `/sitemap.xml`, `/opengraph-image` prerendered as static |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Hardcoded palette classes in `apps/web/src` (`grep -E "(red\|emerald\|amber\|…)-[0-9]"`, excluding provider logos) | 0 (the footer's "Powered by" link was moved to theme tokens on the owner's request) |
| OAuth secrets in the web build/source (`grep` for the fake secrets and `*_CLIENT_SECRET` in `apps/web/.next`, `apps/web/src`) | 0 matches |

### 9.2 API tests (`npm test`)
**11 files, 66 tests passed** (49.8 s): the 59 v1.0 tests unchanged, plus 7 new.

New file `social-auth.test.ts` (7 tests; Google's token endpoint is stubbed, everything else is real Better Auth + PostgreSQL):
| Test | Proves |
| --- | --- |
| Lists only configured providers | `GET /api/public/auth-providers` → Google + GitHub, no secrets; Apple/X absent |
| Authorization redirect | `state` + PKCE `S256`; `redirect_uri` = `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Open redirect + unconfigured provider | external `callbackURL` and `errorCallbackURL` → **403**; `provider: "apple"` (not configured) → rejected with a 4xx |
| New user | callback creates the user (`emailVerified: true`) and a session → `/onboarding` |
| Pre-hijacking guard | existing **unverified** password account with the same email → **not linked**, redirect to `/sign-in?error=…`; accounts stay `["credential"]` |
| Returning user | second sign-in → `/dashboard`, same user, no duplicate |
| Cancelled / tampered | `error=access_denied` and a forged `state` → error redirect, no session |

### 9.3 E2E (`E2E_BASE_URL=http://localhost:3400 npx playwright test`, production build, CSP enforced)
**25 passed (1.6 min)** in a single run (desktop 24, Pixel 7 1). The console-error fixture was active for every test.

| Spec | Tests | What it proves |
| --- | --- | --- |
| `landing` (**new**) | 9 | Anonymous `/` shows the landing page and reaches sign-in/sign-up; protected routes still redirect to `/sign-in?next=`; signed-in visitors see **Go to Dashboard** and sign-out works; the interactive demo syncs, flags a duplicate and retries after an outage **without any API call** besides the session check; every internal link on `/` and `/docs` resolves (external links must be HTTPS + `noopener`); title, description, canonical, OG image, robots and sitemap; no horizontal overflow at 375 px and 768 px; mobile menu opens, navigates and closes |
| `theme` (**new**) | 3 | One click flips light ↔ dark (no menu) on `/` and in the app; the choice persists across reloads, `/sign-in` and the app, and is applied at `domcontentloaded` (no flash); first visits follow the emulated OS preference live until a click overrides it; the toggle (Enter/Space) and the Settings selector (arrow keys) work by keyboard |
| `accessibility` (**new**) | 4 | axe-core WCAG 2.0/2.1 A + AA on `/`, `/docs`, `/sign-in`, `/sign-up`, `/onboarding`, `/dashboard`, `/connections`, `/workflows/new`, `/executions`, `/demo`, `/team`, `/settings` — **light and dark** — 0 serious/critical violations |
| `social-auth` (**new**) | 3 | Only configured providers (Google, GitHub) on sign-in and sign-up; Google starts an authorization-code + PKCE request to `accounts.google.com` (intercepted, never sent); cancelled consent and an existing-account conflict show clear messages without echoing the URL text |
| `release-label` (**new**) | 1 | The app sidebar shows "Workflow Automation" and `v1.1` |
| `connections-permissions`, `order-sync`, `organizations`, `mobile` | 5 | v1.0 regression suite unchanged and green with the redesigned auth forms |

### 9.4 Regression
- The 100-event batch inside `npm test` reproduced the v1.0 counts exactly (100 runs, 30 CRM customers, 100 sheet rows, 25 duplicates, 215 attempts, 0 dead letters).
- `scripts/reliability-check.sh` was not re-run for v1.1: no API, worker, queue or database code changed except the new read-only `/api/public/auth-providers` route and the Better Auth options.

### 9.5 Visual evidence
- Product screenshots captured from the real app with synthetic data: `apps/web/public/screens/{dashboard,connections,workflows,executions}-{light,dark}.png` (used on the landing page).
- Review screenshots of the final build (landing, sign-in/sign-up, mobile, light and dark) are kept outside the repository; they are listed in the v1.1 hand-over.

### 9.6 Not executed
| Item | Reason |
| --- | --- |
| Live Google / GitHub sign-in | No OAuth credentials were provided. Status: **configured but not live-verified** ([social-auth.md §1](./social-auth.md#1-provider-status)) |
| Apple, X | Blocked on paid/developer accounts and an HTTPS domain; hidden in the UI while unconfigured |
| Screen-reader walkthrough (NVDA/VoiceOver) | Not available in this environment; covered by axe + keyboard tests only |

---

## 10. CI fix, Railway IaC and email (2026-11-01)

### 10.1 GitHub Actions failure: reproduced and fixed
| Step | Result |
| --- | --- |
| Failing runs | `be52ddd` and `0b6f92d`: job *Lint, typecheck…* failed at `npm run typecheck` with `src/app/layout.tsx(33,50): error TS2304: Cannot find name 'LayoutProps'`. Annotations also showed a Node 20 deprecation warning (checkout/setup-node/upload-artifact v4) and an `ubuntu-latest` → Ubuntu 26 notice |
| Reproduction | Fresh `git clone` of `0b6f92d`, `npm ci` without `NODE_ENV`, `npm run typecheck` → **same error** |
| Cause | `LayoutProps` is a global type that Next.js generates into `.next/types/routes.d.ts`, imported by the generated `next-env.d.ts`. Both are gitignored build outputs: present on a developer machine, absent in CI, where typecheck runs before the build |
| Fix | Web `typecheck` runs `next typegen && tsc --noEmit` (Next 16's type generator, about 1 s) |
| Also fixed | Actions v4 → **v7** (Node 24); runners pinned to `ubuntu-24.04`; E2E now starts the compiled API/worker, because the two dev scripts ran `prisma generate` concurrently (on Windows the worker died on a file lock; on Linux it is a race). Until this fix the E2E/smoke part of the job had never run on GitHub, because typecheck failed first |
| Validation | `actionlint 1.7.12`: clean |
| **GitHub run 41290735002 (`4f81a18`)** | **success**: verify 4.4 min, reliability 1.5 min, docker 0.7 min, all on `ubuntu-24.04`, **no annotations** |

### 10.2 Clean-clone CI runs (the verify job's exact steps, throwaway PostgreSQL 18 / Redis 8)
| Run | Result |
| --- | --- |
| `0b6f92d` + CI fix | audit 0, migrations, drift guard, lint, typecheck, **66/66** API tests, build, **E2E 22 passed / 3 skipped**, **smoke 13/13** |
| Working tree (IaC + email, uncommitted) | audit 0, migrations, drift guard, lint, typecheck incl. `railway:check`, **74/74** API tests (12 files, 56.8 s), build, **E2E 23 passed / 3 skipped** (1.7 min), **smoke 13/13** |

The 3 skipped E2E tests are the social sign-in specs; they run only when an OAuth provider is configured (they passed against the isolated stack with fake credentials, §9.3). The second run caught a real bug before it reached GitHub: passing `callbackURL` to `signIn.email` made Better Auth redirect every successful sign-in to `/verify-email`. Sign-in now uses its normal destination; the regression is covered by `password-reset.spec.ts`.

### 10.3 Email verification and password reset
| Check | Result |
| --- | --- |
| `apps/api/test/email-auth.test.ts` | **8/8**: capabilities flags; no session before verification; sign-in blocked (`EMAIL_NOT_VERIFIED`) and link re-sent; link verifies and signs in; tampered link → `/verify-email?error=INVALID_TOKEN`; sign-up for an existing address answers like a new one and emails the owner; reset link works once and revokes other sessions; identical answers for unknown addresses; off-site `redirectTo`/`callbackURL` → 403; configuration validation |
| `apps/web/e2e/password-reset.spec.ts` | Passed: Forgot password? → email → `/reset-password` → old password refused → new password signs in → reused link shows "This link has expired" |
| Required-verification browser flow (API with `REQUIRE_EMAIL_VERIFICATION=true`, file transport) | Sign-up → "Check your inbox", `/api/me` 401 → sign-in refused with "Verify your email…" and a new link → the link opens `/verify-email` "Email verified", signed in → Continue → app; `/verify-email?error=TOKEN_EXPIRED` → "This link has expired" |
| Accessibility | `/forgot-password` and `/reset-password` added to the axe WCAG AA audit (both themes): 0 serious/critical |
| Real email delivery | **Not executed**: no Resend account, domain or key (owner action, email.md §3) |

### 10.4 Railway Infrastructure as Code
| Check | Result |
| --- | --- |
| Deprecation | Confirmed in Railway's docs on 2026-11-01: Config as Code is deprecated, new services cannot use it, and existing files stop being read on 2026-12-01 |
| `.railway/railway.ts` | Type-checks against `railway@3.16.0` (`npm run railway:check`, part of `npm run typecheck` and CI). A negative test (misspelled `DATABASE_ULR`, invalid restart policy) failed as expected |
| Settings parity | Every key of the former `deploy/railway/api.json`/`worker.json` (builder, Dockerfile path, watch paths, start, pre-deploy, healthcheck + timeout, restart policy + retries, draining) is declared with the SDK's typed `build`/`deploy` objects |
| Redis on Railway's private network | ioredis `family: 0` added; API suite and CI green with it |
| `railway config plan` / `apply` | **Not executed**: needs the Railway CLI login and your approval (it creates billable resources) |

## 11. Deployment target changed to Render + Vercel (2026-11-01)
Railway configuration removed (`.railway/`, the `railway` dev dependency and the `railway:check` step); docs and env templates rewritten for Render + Vercel. No runtime code changed (three comments reworded).

| Check | Result |
| --- | --- |
| `package.json` / `package-lock.json` | Identical to `4f81a18` (before the Railway SDK was added): `git diff 4f81a18` is empty |
| `npm audit --omit=dev` / `npm audit` | 0 / 0 vulnerabilities |
| `npm run lint` | exit 0 |
| `npm run typecheck` (API + web, with `next typegen`) | exit 0 |
| `npm test` | **12 files, 74/74 passed** (73.4 s). A first run had 1 failure in `webhooks.test.ts` → "rejects stale and future timestamps": the test's future timestamp is exactly `tolerance + 1` s, so a request that reaches the server more than 1 s after the test reads the clock (machine under load) falls inside the window. The file passed 10/10 alone and the full suite passed on the re-run. This existing test-timing margin is unrelated to this change |
| `npm run build` | exit 0 (API `tsc`, web `next build`, 24 static pages) |
| `docker build -f apps/api/Dockerfile .` (Render's settings: Dockerfile path + repository-root context) | Success, 725 MB; runs as `fleqo` in `/app/apps/api`; `dist/server.js`, `dist/worker.js` and Prisma CLI 7.10.1 present (pre-deploy `npx prisma migrate deploy` works) |
| E2E | Not re-run: no web, API or worker code changed in this step |
| Render deployment | **Not executed** (owner deploys by hand; checklist in deployment.md §8) |

## 12. Render compatibility review (2026-11-01)
A local emulation of Render's runtime using the production image, built exactly as Render builds it (Dockerfile Path `apps/api/Dockerfile`, repository root as context). Throwaway containers, networks and secrets; nothing deployed.

| Check | Result |
| --- | --- |
| Pre-deploy `npm run db:deploy` as the image's non-root user, on a network **without internet**, PostgreSQL **16**, Render-style internal URL (`postgresql://user:pass@dpg-…/db`, no port or parameters) | `All migrations have been successfully applied`; re-run: `No pending migrations` (the migration engine is inside the image; migrations work on PostgreSQL 16) |
| Same command from `/app` / from `/` | Works / fails loudly with `ENOENT /package.json` (no download) |
| `npx prisma migrate deploy` started from `/` | **Downloaded and ran `prisma@8.0.0-rc.29` from npm** (refused only because that release renamed the command). Fixed: the documented release command is now `npm run db:deploy` |
| API, image `CMD`, `PORT=10000`, `NODE_ENV=production` | `Fleqo API running on port 10000`; `/api/health` 200; `/api/ready` → database and Redis connected |
| Worker, Docker Command `node dist/worker.js` | Started; processed the smoke test's jobs |
| Key Value: Valkey 8 with `noeviction` | Reports `redis_version:7.2.4` (BullMQ-compatible); no warnings |
| Key Value left at `allkeys-lru` | Worker logs `IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"` (now in the troubleshooting table) |
| `npm run smoke` against the API | **13/13** |
| Free-instance Docker Command `sh -c "… migrate … && node dist/server.js"` | Migrates, serves on 10000, shuts down gracefully on SIGTERM |
| SIGTERM (`docker stop -t 30`, Render's default shutdown delay) | API and worker exit 0 with "Shutting down …"; no error logs |
