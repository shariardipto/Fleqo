# Fleqo — Testing

Fleqo is verified at four levels: API integration tests against real PostgreSQL and Redis, browser E2E against a production web build, process-level fault injection, and a smoke test that runs against any deployment. CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs all of them on every push and pull request.

| Layer | Command | Runs against |
| --- | --- | --- |
| Lint, types | `npm run lint`, `npm run typecheck` | Source (`typecheck` runs `prisma generate` and `next typegen` first) |
| API integration | `npm test` | Real PostgreSQL + Redis (isolated, below) |
| 100-event batch | `npm run test:batch` (also part of `npm test`) | Same |
| Browser E2E | `npm run test:e2e` | API, worker and production web build |
| Reliability | `npm run test:reliability` | Compiled API + worker, throwaway containers |
| Smoke | `npm run smoke -- --base-url <url>` | Any running stack, through the web proxy or the API directly |

## 1. Isolation
Tests never touch development data.
- **Vitest** derives a separate database by appending `_test` to `DATABASE_URL` (or uses `TEST_DATABASE_URL`). It creates and migrates that database and refuses to run against any database whose name does not end in `_test`. Queues use the `fleqo-test` prefix, tables are truncated between tests, and files run one at a time.
- **Playwright** signs up a brand-new user and organization in every run. With `E2E_BASE_URL` unset it starts the dev API, the worker and `next start`, or reuses ones already running.
- **The reliability script** uses its own PostgreSQL and Redis containers (`fleqo-rel-pg`, `fleqo-rel-redis`) and ports, and removes them on exit.
- **The smoke test** creates a throwaway user, organization and data each time.

## 2. API integration tests (Vitest + Supertest)
12 files, 74 tests.

| File | Covers |
| --- | --- |
| `schema-constraints` | Unique keys and CHECK constraints |
| `auth-tenancy` | Auth, organization creation and switching, RBAC, invite-link acceptance, member removal |
| `security` | Session lifecycle, invitation-squatting regression, CSRF origin check, `no-store`, organization deletion disabled, sanitized errors, Admin vs Member |
| `connections-import` | Secrets shown once and encrypted at rest, RBAC, synthetic and DummyJSON import |
| `mock-providers` | Upsert and insert-or-keep, rollback on injected failure |
| `workflows` | CRUD, mapping validation, activation guard, tenant isolation |
| `webhooks` | Signature, replay window, payload validation, duplicates and conflicts, tenant derivation, Redis outage with outbox |
| `worker` | Execution, retries without repeating CRM, dead letter and manual retry, permanent errors, duplicate jobs, crash recovery |
| `recovery` | Recovery decision for each BullMQ job state (waiting/active/delayed left alone; failed/completed/missing re-dispatched; finished runs untouched) |
| `social-auth` | Configured providers only, `state` + PKCE, open-redirect rejection, new and returning users, pre-hijacking guard, cancelled or tampered callbacks (provider token endpoint stubbed) |
| `email-auth` | Verification required/optional, enumeration-safe sign-up and reset, single-use reset with session revocation, trusted redirects, configuration validation |
| `batch` | The 100-event batch (§3) |

## 3. 100-event batch
`apps/api/test/batch.test.ts` sends a realistic mixed load through the real ingestion and worker path and asserts exact database state. The summary is written to `apps/api/test-results/batch-summary.json`.

| Expectation | Result |
| --- | --- |
| 100 unique signed events → 100 incoming events, 100 runs succeeded | 100 / 100, 0 failed |
| 30 distinct customers → 30 CRM rows | 30 |
| 100 orders → 100 unique sheet rows, totals match | 100 (sum of `totalMinor` asserted) |
| 25 duplicate deliveries (20 identical, 5 with reordered keys) | 25 acknowledged, no new runs |
| 5 forged deliveries | 5 × 401 |
| 10 events with injected transient failures | 5 CRM × 1 retry, 5 Sheet × 2 retries; untouched actions at 1 attempt |
| Total action attempts = 200 + 5 + 10 | 215 |
| Dead letters | 0 |

Counts are identical on every run; timings vary with machine load and are not benchmarks.

## 4. Browser E2E (Playwright)
26 tests on a production build with the production CSP. A shared fixture (`e2e/fixtures.ts`) fails any test on an uncaught page error, a CSP violation or a console error.

| Spec | What it proves |
| --- | --- |
| `order-sync` | The full operator loop: connect → workflow → import → signed events → duplicate → transient retry → dead letter → manual retry → filters → records → dashboard → invite link → settings → sign out |
| `connections-permissions` | Status badge, switch and label agree, with ≥ 3:1 switch contrast in both themes; a stranger cannot use an invite link; an invited Member sees "View only" and no switches |
| `organizations` | Second organization from the switcher, data separation, switching back, session survives reload |
| `landing` | Landing page and auth entry points; protected routes redirect; the interactive demo makes no API calls; every internal link resolves; metadata, robots and sitemap; no overflow at 375/768 px; mobile menu |
| `theme` | One-click toggle, persistence across routes, no flash at `domcontentloaded`, following the OS preference, keyboard operation |
| `accessibility` | axe-core WCAG 2.0/2.1 A + AA on 14 public and app pages, light and dark: 0 serious or critical violations |
| `password-reset` | Forgot password → email → reset → old password refused → new password works → reused link expired. Skipped unless the API uses `EMAIL_PROVIDER=file` and `E2E_EMAIL_DIR` points to its folder |
| `social-auth` | Only configured providers are shown; Google starts an authorization-code + PKCE request (intercepted, never sent); error messages. **Skipped** unless the API has OAuth credentials |
| `release-label` | The sidebar release label |
| `mobile` (Pixel 7) | Drawer navigation, empty states, no horizontal overflow |

In CI the API writes emails to files (`EMAIL_PROVIDER=file`) so the reset flow can follow its link, and the three social specs are skipped (23 passed, 3 skipped).

## 5. Process-level reliability
[`scripts/reliability-check.sh`](../scripts/reliability-check.sh) runs the **compiled** API and worker with `NODE_ENV=production` against throwaway PostgreSQL and Redis (AOF on, `noeviction`), injects real failures, and asserts exact database state after each scenario. Logs go to `apps/api/test-results/reliability/`.

| Scenario | Assertion |
| --- | --- |
| S1 Baseline | 10 events → 10 runs succeeded, 10 sheet rows |
| S2 Worker stopped | Events still accepted (202); runs stay `queued`, not lost; the restarted worker drains them |
| S3 Redis stopped | `/api/ready` 503; events still accepted; outbox rows stay `pending`; Redis back → all dispatched and succeeded |
| S4 Worker **SIGKILL** during retry back-off | After restart the failed Sheet action finishes; the completed CRM action is **not** repeated |
| S5 Redis **restart** with a retry scheduled | Run completes with exactly one sheet row |
| S6 PostgreSQL **restart** | Data persisted; API ready again; new events processed |
| S7 API restart | The existing session cookie still works (database-backed sessions) |
| S8 Duplicate after all restarts | Acknowledged as `duplicate`, no new run |
| Final invariants | Every run succeeded, one row per order, no duplicate rows, every CRM action at exactly 1 attempt, 0 dead letters |

## 6. Smoke test
`apps/api/src/scripts/smoke.ts` performs 13 checks against a running stack: health and readiness, sign-up, organization, three connections, an active workflow, synthetic import, two signed events, worker execution (CRM upsert → Sheet append), duplicate acknowledged, unsigned webhook rejected. Use it after every deployment:

```bash
npm run smoke -- --base-url https://<web-domain>                                   # through the web proxy
npm run smoke -- --base-url https://<api-domain> --origin https://<web-domain>      # API directly
```

## 7. Production image and free-tier emulation
- The `docker` CI job builds `apps/api/Dockerfile` from the repository root, as Render does. The image runs as the non-root `fleqo` user, contains no web or dev-only packages, applies migrations with `npm run db:deploy` (no network download), refuses non-HTTPS origins and `NODE_TLS_REJECT_UNAUTHORIZED=0` in production, and shuts down cleanly on SIGTERM.
- The single-container demo (`node dist/single-service.js`) was emulated under Render Free limits (0.1 CPU, 512 MB, Neon-style TLS database, 25 MB Key Value). Cold start, memory, crash recovery and outage results are in [deployment-demo.md §6](./deployment-demo.md#6-measured-results-local-emulation-of-the-free-tiers).

## 8. Not covered
- Load or throughput testing: out of scope; no performance claims are made.
- Live OAuth providers and real email delivery: tested offline (stubbed provider, file transport); use the live checklists in [authentication.md](./authentication.md) before enabling them.
- Screen-reader walkthroughs: covered by axe and keyboard tests only.
