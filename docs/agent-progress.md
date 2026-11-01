# Fleqo — Agent Progress Log

This log records what was audited, changed and verified, milestone by milestone. Commands and results are copied from real runs. The repository owner commits changes manually; the agent does not commit.

## Initial audit (2026-10-31)

**Git:** branch `master`, 2 commits (`f578a97` init monorepo, `380fca2` PostgreSQL/Redis/Prisma setup). Untracked: `docs/AGENTS.md`, `docs/agent-implementation-plan.md`, `docs/agent-start-prompt.txt`. Working tree deletes `docs/node-v24.22.2-x64.msi`.

**Toolchain:** Node v24.22.2, npm 11.19.0. PostgreSQL 18 (`postgres:18-alpine`) and Redis 8 (`redis:8-alpine`) running healthy via `compose.yaml`.

**Installed versions:** prisma / @prisma/client / @prisma/adapter-pg 7.10.1, express 5.3.0, zod 4.6.7, dotenv 18.0.9, next 16.4.3, react 19.3.0, tailwindcss 4.3.3, typescript 5.9.3, tsx 4.23.15.

| Area | State found |
| --- | --- |
| API | `src/server.ts` with `/api/health` and `/api/db-health`, Helmet, CORS hardcoded to `http://localhost:3000`. Working. |
| Prisma | Prisma 7 `prisma-client` generator → `apps/api/src/generated/prisma` (ESM, `.ts` imports), `@prisma/adapter-pg` in `src/lib/prisma.ts`. **Schema had zero models and no migrations.** Config file named `prisma7.config.ts` (not auto-discovered by the CLI). |
| Web | Default `create-next-app` page (App Router, Tailwind 4, React Compiler). No shadcn/ui, TanStack Query, auth or API calls. |
| Worker / queue | Missing (no BullMQ, no worker). |
| Auth | Missing (no Better Auth). |
| Tests / CI / README | Missing. |
| Env | Root `.env.example` only has Postgres credentials; no API env example. |

**Issues found**
1. `NODE_ENV=production` is set in the developer's global Windows environment. npm therefore omits devDependencies on install, and tools would run in production mode. Worked around with `npm install --include=dev` and explicit `NODE_ENV` in dev/test scripts; the owner may want to remove the global variable.
2. `NODE_TLS_REJECT_UNAUTHORIZED=0` is set in the shell environment (TLS verification disabled for Node). Not changed; flagged for the owner.
3. A 33 MB Node installer (`docs/node-v24.22.2-x64.msi`) is in git history (commit `f578a97`). Removing it needs a history rewrite, which requires the owner's explicit approval.
4. The generated Prisma client is committed. Kept as-is (owner's choice); `npm run build` now runs `prisma generate` so builds never rely on a stale client.

## Decisions (approved by owner on 2026-10-31)
- Worker is a second entry point inside `apps/api` (`src/worker.ts`, `npm run dev:worker`), deployed as its own process. Prisma schema/client stay in `apps/api`.
- Better Auth with its official Organization plugin and Prisma adapter; plugin-managed `organization`, `member`, `invitation` models replace hand-made organization tables.
- Owner commits manually.

---

## Milestone: M0 — Stabilize current foundation

**Changes**
- Renamed `apps/api/prisma7.config.ts` → `apps/api/prisma.config.ts` (now auto-discovered: `Loaded Prisma config from prisma.config.ts`).
- `src/config/env.ts`: Zod-validated environment (fails fast with a readable list of problems).
- `src/app.ts` (`createApp`) split from `src/server.ts` (listen + graceful shutdown) so tests can mount the app.
- Structured logging with pino/pino-http, `X-Request-Id` on every response, credentials/signature headers redacted.
- Consistent error format `{ error: { code, message, details?, requestId } }` (`src/lib/errors.ts`, `src/middleware/error-handler.ts`).
- `/api/ready` checks PostgreSQL and Redis; `/api/health` and `/api/db-health` preserved.
- CORS origins from `WEB_ORIGINS` (no wildcard). `TRUST_PROXY` setting for PaaS proxies.
- `src/engine/queue.ts`: BullMQ producer with fail-fast Redis connection and enqueue timeout.
- Scripts: root `dev:worker`, `build`, `typecheck`, `lint`, `test`, `test:batch`, `db:*`, `infra:up`; API `typecheck`, `lint` (ESLint 9 + typescript-eslint), `test` (Vitest), `db:*`.
- `apps/api/.env.example` documents every variable. Local secrets (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`) were generated into the git-ignored `apps/api/.env` without printing them.
- Dependencies added (exact versions): better-auth 1.7.14, bullmq 6.5.3, ioredis 6.0.0, express-rate-limit 8.7.2, pino 10.4.0, pino-http 11.0.0; dev: vitest 5.0.5, supertest 7.3.1, eslint 9.39.5, typescript-eslint 8.72.1, cross-env 10.1.0, pino-pretty 13.2.0.

**Validation**
| Command | Result |
| --- | --- |
| `npx prisma validate` (apps/api) | `The schema at prisma\schema.prisma is valid` |
| `npm run typecheck --workspace=apps/api` | exit 0 |
| `npm run lint --workspace=apps/api` | exit 0 |
| `npm run build --workspace=apps/api` | `Generated Prisma Client (7.10.1)`, tsc exit 0 |
| `npm run typecheck --workspace=apps/web` / `lint` | exit 0 / exit 0 |
| `GET /api/health` | `200 {"success":true,...}` |
| `GET /api/db-health` | `200 {"success":true,"database":"connected"}` |
| `GET /api/ready` | `200 {"database":"connected","redis":"connected"}` |
| `GET /api/nope` | `404 {"error":{"code":"not_found",...,"requestId":...}}` |

**Remaining:** none for M0.

---

## Milestone: M1 — Prisma models, migrations and seed

**Changes**
- Better Auth models generated with the official CLI (`npx auth@1.7.14 generate --config src/lib/auth.ts`): `user`, `session` (+`activeOrganizationId`), `account`, `verification`, `organization`, `member`, `invitation`.
- Added `@@unique([organizationId, userId])` to the generated `member` model (ERD requirement).
- Fleqo domain models: `IntegrationConnection`, `Workflow`, `WorkflowTrigger`, `WorkflowAction`, `IncomingEvent`, `EventDispatch` (outbox), `WorkflowRun`, `ActionRun`, `ExecutionLog`, `DeadLetterEvent`, `MockCustomer`, `MockSheetRow`, `ImportedRecord`, `AuditLog`; Postgres enums for providers/statuses.
- Migration `20261031155142_init` (created with `--create-only`, reviewed, then applied). Hand-added CHECK constraints: non-negative `totalMinor`, ISO-4217-shaped currency, non-negative attempts, valid `errorKind`, positive action position.
- Test harness: dedicated `fleqo_test` database (created on demand, migrated with `migrate deploy`); truncation helper refuses any database whose name does not end in `_test`.
- The demo seed is implemented in M3/M4, once the services it uses exist.

**Validation**
| Command | Result |
| --- | --- |
| dev DB pre-check | only `_prisma_migrations` (empty) existed → no drift, no reset needed |
| `npx prisma migrate dev --name init --create-only` then `npx prisma migrate dev` | `20261031155142_init` applied, `Your database is now in sync with your schema` |
| `npx vitest run test/schema-constraints.test.ts` | 6 passed — duplicate membership, event, run, action run, dispatch, mock customer, sheet row and import all rejected with `P2002`; same external event ID allowed in another org; negative total and lowercase currency rejected |

**Decisions:** `ImportedRecord.sourceRecordId` carries the source path (`users/5`, `products/12`) so the ERD's 3-column unique key needs no `kind` column. One connection per mock provider per organization (`@@unique([organizationId, provider])`) keeps MVP configuration simple.

---

## Milestone: M2 — Auth, organizations and permissions

**Changes**
- `src/lib/auth.ts`: Better Auth (email/password, Prisma adapter, Organization plugin with Fleqo access control). Mounted at `/api/auth/*splat` **before** `express.json()`.
- `src/lib/permissions.ts`: one access-control model shared by Better Auth and Fleqo routes. Owner/Admin: manage connections, workflows, imports, retries, audit. Member: read + run simulator.
- `src/middleware/auth.ts`: `requireSession` and `requireOrg(permission)`. The tenant comes from the server-side session's `activeOrganizationId`; membership and role are re-read from the database on **every** request.
- `src/modules/organizations/organizations.routes.ts`: `GET /api/me`, `POST /api/organizations`, `POST /api/organizations/active`, `GET/PATCH /api/organization`, `GET /api/team`, invitations, role change, member removal, `GET /api/invitations`, `POST /api/invitations/:id/accept`.
- New sessions start in the user's oldest organization (Better Auth session hook). Invitations are not emailed (MVP); invitees accept from the app.
- Audit entries for organization/member/invitation events via plugin hooks.
- Better Auth `APIError`s are mapped to the standard error format; general API rate limiter (`RATE_LIMIT_API_PER_MIN`).

**Validation**
| Command | Result |
| --- | --- |
| `npx vitest run` | 2 files, **12 passed** |
| `npx tsc -p tsconfig.typecheck.json` / `npx eslint .` | exit 0 / exit 0 |

Covered by `test/auth-tenancy.test.ts`: 401 without a session; sign-up → 409 `no_active_organization` → create org as owner (audit row written); sign-out invalidates the session; a user cannot switch into another org through Fleqo **or** directly through Better Auth (403, and Better Auth fails closed by clearing the active org); member cannot invite or update org (403); owner promotes to admin (admin can update org); removed member loses access immediately; validation errors are machine-readable (422 with field paths).

---

## Milestone: M3 — Public data import + mock integrations

**Changes**
- `src/lib/crypto.ts`: AES-256-GCM secret encryption, signing-secret/public-ID generation, HMAC-SHA256 signing, constant-time verification, canonical JSON hashing.
- `src/modules/connections/connections.routes.ts`: `GET/POST /api/connections`, `PATCH /api/connections/:id` (rename, enable/disable), `POST /api/connections/:id/rotate-secret`, `GET /api/mock-crm/customers`, `GET /api/mock-sheet/rows`. The Mock Store signing secret is returned **once** (create/rotate) and stored encrypted; lists expose only `secretLast4`.
- `src/integrations/mock-providers.ts`: PostgreSQL-backed `upsertCustomer` (unique `(org, provider, customerExternalId)`) and `appendOrderRow` (insert-or-keep on `(org, action, orderExternalId)`). Both run inside the caller's transaction. Deterministic fault injection (`simulation.failures`) fires **after** the write to prove rollback.
- `src/modules/demo/import.service.ts` + `POST /api/demo/import`, `GET /api/demo/records`, `GET /api/demo/sources`: DummyJSON adapter (fixed endpoints only; Zod-validated; prices → integer minor units; provenance URL + licence note) and an **offline deterministic synthetic generator** (`@example.test` emails). Upserts by `(org, source, sourceRecordId)`, so re-imports never duplicate.

**Validation:** `npx vitest run` → 4 files, 21 passed at this point. `test/connections-import.test.ts`: secret shown once, encrypted at rest, not in list responses, 409 on second store connection, rotation; members read-only (403 on create/disable); other tenant gets 404/empty; synthetic import 20 created then 0 created/20 updated on re-run; DummyJSON normalization (stubbed with real response shapes captured from `https://dummyjson.com`); members cannot import. `test/mock-providers.test.ts`: create-then-update customer, one sheet row per order on re-run, injected transient failure rolls back the row then retry appends exactly once, disabled connection → permanent error.

---

## Milestone: M4 — Workflow configuration and contracts

**Changes**
- `src/engine/mapping.ts`: action catalog (`mock_crm.upsert_customer`, `mock_sheet.append_order`), allowed event source paths, type-compatibility rules, default mappings, configuration-time validation and runtime mapping (output re-validated with Zod).
- `src/modules/workflows/workflows.routes.ts`: `GET /api/workflows/catalog`, `GET/POST /api/workflows`, `GET/PATCH/DELETE /api/workflows/:id` (DELETE archives). Connections are resolved server-side from the tenant's own connections; activating requires every used connection to be enabled; every change is audited.

**Validation:** `test/workflows.test.ts` 5 passed — Order Sync created active with ordered actions and default mappings; missing connection → 409; incompatible type / missing required field / unknown source path → 422 with `details[].path`; mapping/config update, activation blocked while CRM disabled, archive hides and freezes the workflow, audit trail `created → updated → enabled → archived`; another tenant gets 404 on read/update/archive; member can read, not modify.

---

## Milestone: M5 — Signed webhook ingestion + outbox

**Changes**
- `POST /api/webhooks/mock-store` (`src/modules/webhooks/*`): `express.raw` (64 KB, `application/json`) mounted before `express.json()`; per-connection+IP rate limit. Verification order: connection lookup (active `mock_store` only) → timestamp within ±`WEBHOOK_TOLERANCE_SECONDS` → HMAC-SHA256 of `<timestamp>.<raw body>` with constant-time compare → JSON parse → Zod schema.
- One transaction persists the `IncomingEvent`, a `WorkflowRun` per matching active workflow, its `ActionRun`s (queued) and an `EventDispatch` outbox row, **then** responds `202`. Duplicates (unique-key violation) return `200 {status:"duplicate"}` without new runs; the same event ID with a different canonical payload returns `409`.
- `src/engine/dispatcher.ts`: claims pending outbox rows with `FOR UPDATE SKIP LOCKED` + lease, enqueues `run-<id>-g<generation>` jobs, marks dispatched, or leaves the row pending with exponential backoff and `lastError`.
- `src/modules/demo/simulator.service.ts` + `POST /api/demo/simulate-order`: builds synthetic orders from imported data, signs them with the tenant's secret and sends them through the same verification path (`source: "simulator"`); supports re-sending an earlier event and fault injection.

**Validation:** `npx vitest run` → 6 files, **36 passed**; `eslint` exit 0. `test/webhooks.test.ts` (10 tests): valid event → 202 with run/action runs/dispatch persisted and job enqueued; missing/wrong/garbage signature and tampered body → 401 with nothing stored; timestamps ±301 s → 401 `stale_timestamp`; unknown or disabled connection → 401; malformed JSON 400, invalid currency/negative total 422 (field path), wrong content type 400, >64 KB 413; replay/reformatted duplicate → 200 duplicate with the same run and one job; changed payload with same ID → 409; tenant derived only from the verified connection (body `organizationId` ignored; B's ID + A's secret → 401); **Redis outage**: 202 + pending dispatch with `lastError`, dispatcher later enqueues exactly once; no active workflow → event stored, no runs; simulator requires imported data, members may simulate, re-send yields duplicate.

**Defect found and fixed:** re-sending a stored event was reported as a payload conflict because PostgreSQL JSONB reorders keys. Payload hashes now use canonical (key-sorted) JSON.

---

## Milestone: M6 — Worker execution, idempotency, recovery

**Changes**
- `src/worker.ts` (`npm run dev:worker` / `npm run start:worker`): independent process running the BullMQ consumer **and** the outbox dispatcher loop (`DISPATCH_POLL_MS`) with periodic stale-run recovery.
- `src/engine/executor.ts`:
  1. **Run lease:** conditional `UPDATE … WHERE status IN (queued, retrying) OR (running AND lease expired)`, so only one executor owns a run at a time.
  2. Actions run in position order; actions already `succeeded` are skipped (and logged as "not repeated").
  3. Each action's destination write + `ActionRun → succeeded` update commit in **one transaction**, guarded by `updateMany WHERE status='running' AND attempts=<this attempt>` so concurrent duplicate jobs cannot both commit.
  4. Transient errors (and unknown errors) → action `retrying`, run `retrying`, rethrow → BullMQ exponential backoff (`WORKFLOW_MAX_ATTEMPTS`, `WORKFLOW_BACKOFF_MS`). Permanent errors or the final attempt → action/run `failed`, `DeadLetterEvent` row, `UnrecoverableError`.
  5. Every step writes `ExecutionLog` rows (level, attempt, duration, output).
- `src/engine/recovery.ts`: unfinished runs whose BullMQ job is gone (expired lease after a crash, or `dispatched` for over 2 minutes with no job) get their outbox row reset to `pending` with a new generation.
- `src/modules/executions/executions.routes.ts`: `GET /api/executions` (status/workflow/search filters, cursor pagination), `GET /api/executions/:id` (event payload, action runs, logs, dead letters, dispatch), `POST /api/executions/:id/retry` (Admin/Owner, failed runs only, re-queues only incomplete actions, resolves dead letters, bumps generation, audited), `GET /api/events`.
- `src/modules/dashboard/dashboard.routes.ts`: `GET /api/dashboard/summary` (real counts only), `GET /api/audit-logs`.

**Validation** (real Redis 8 + BullMQ 6, isolated `fleqo-test` prefix)
| Command | Result |
| --- | --- |
| `npx vitest run test/worker.test.ts` | **8 passed** |
| `npx vitest run test/batch.test.ts` | **1 passed** (100-event batch) |
| `npx vitest run` (full suite, run twice back-to-back) | **8 files, 45 passed** both times |

`test/worker.test.ts`: CRM → Sheet happy path with logs; duplicate event not re-executed; Sheet failing twice → succeeds on delivery 3 with CRM attempts = 1 (not repeated); Sheet failing 5× → dead-lettered after 4 attempts, member retry 403, other tenant 404, owner retry 202, second retry 409, then succeeds with CRM still at 1 attempt and exactly one row; permanent CRM error → failed after 1 attempt, Sheet never run; Redis outage at ingestion → dispatcher → success; duplicate jobs for one run → single commit; crashed worker (expired lease, no job) → recovered and completed once.

**100-event batch** (`npm run test:batch`; real output in `apps/api/test-results/batch-summary.json`):
```
uniqueEventsSent 100 · duplicateDeliveries 25 (20 identical + 5 reformatted) · forged 5 (all 401)
30 distinct customers · 10 events with injected transient failures · 2 workers × concurrency 5
→ incomingEvents 100 · runsSucceeded 100 · mockCustomers 30 · mockSheetRows 100 · deadLetters 0
→ duplicatesAcknowledged 25 · totalActionAttempts 215 (= 200 + 5 CRM retries + 10 Sheet retries)
timings (local dev machine, backoff base 50 ms): ingestion 1271 ms, end-to-end 1791 ms
```
These timings come from a single local run with test settings. They are not a throughput benchmark.

---

## Milestone: M7 — Professional frontend

**Changes** (`apps/web`)
- shadcn/ui initialized (`shadcn@4.23.0`, Radix base, "radix-nova" style, Tailwind 4) + components: button, card, input, label, badge, table, dialog, alert-dialog, select, dropdown-menu, sonner, skeleton, tabs, switch, separator, alert, textarea, tooltip, sheet, avatar, checkbox. The CLI uses shadcn's own `cn` package (from `shadcn-ui/cn`) in place of `clsx` + `tailwind-merge`.
- TanStack Query 5.105.0 for all API data; Better Auth React client for sign-in, sign-up and sign-out.
- **Same-origin API proxy:** `next.config.ts` rewrites `/api/*` → `API_URL` (default `http://localhost:4000`), so the browser only talks to the web origin and Better Auth cookies are first-party in dev and on Vercel. Basic security headers are added.
- Pages: `/sign-in`, `/sign-up`, `/onboarding` (create org / accept invitations), `/dashboard`, `/connections` (+ CRM/Sheet record tables), `/workflows`, `/workflows/new` (guided trigger → actions → mapping form), `/workflows/[id]` (enable/disable, mapping edit, archive), `/executions` (status filter, search, live refresh), `/executions/[id]` (per-action status, input/output, errors, attempt logs, dead letters, raw payload, retry), `/demo` (import + simulator with fault injection and duplicate re-send), `/team`, `/settings` (+ audit log).
- App shell: responsive sidebar plus a mobile drawer, organization switcher, user menu; every page has loading (skeleton), error (retry) and empty states; buttons are hidden or disabled by role (the API still enforces every permission).
- `apps/web/e2e`: Playwright specs; `npm run test:e2e`. Optional worker `/health` endpoint (`WORKER_HEALTH_PORT`) added so the E2E harness and hosts can health-check the worker.

**Validation**
| Command | Result |
| --- | --- |
| `npx tsc --noEmit` / `npx eslint` (apps/web) | exit 0 / exit 0 |
| `npx next build` | compiled; 15 routes |
| `E2E_BASE_URL=http://localhost:3100 npx playwright test` (production build on :3100, API :4000, worker :4100) | **2 passed** (desktop 28.4 s, mobile 1.4 s) |

The desktop E2E drives the full operator loop in Chromium: sign-up → onboarding → connect 3 mock services (secret shown once) → create Order Sync with default mappings → import synthetic data → send 3 signed events → re-send (duplicate) → transient Sheet failure (CRM 1 attempt, Sheet 2) → exhausted retries → dead letter → manual retry (CRM still 1 attempt, Sheet 6) → executions list + status filter → 5 sheet rows visible → dashboard counts → invite teammate → rename org → sign out → `/dashboard` redirects to `/sign-in`. The mobile spec (Pixel 7) checks drawer navigation, empty states and no horizontal overflow.

**Defects found and fixed**
- The Demo page crashed on first render (`reading 'eventId'`); the re-send handler now reads a guarded `firstEventId`.
- Detail pages overflowed at 1400 px with long log lines; grid columns now use `minmax(0,1fr)` / `min-w-0`.
- Playwright output was being linted; it is now ignored in `eslint.config.mjs`.

**Notes**
- The owner had `next dev` running on :3000 during this work. It was left untouched; E2E ran against a production build on :3100 with `WEB_ORIGINS` extended for that session only.
- `shadcn` (the CLI, needed at build time for `shadcn/tailwind.css`) was moved to devDependencies. `npm audit` reports 6 low/moderate advisories in its transitive tooling (deepmerge, minimatch via ts-morph); `npm audit --omit=dev` reports **0**. `npm audit fix --force` would downgrade shadcn to 1.0.0, so it was not applied.

---

## Milestone: M8 — QA, docs, CI, deployability

**Changes**
- `apps/api/Dockerfile` (one image for API and worker; build from the repo root) + root `.dockerignore`.
- `deploy/railway/api.json` (pre-deploy `npx prisma migrate deploy`, health check `/api/ready`) and `deploy/railway/worker.json` (`node dist/worker.js`).
- `.github/workflows/ci.yml`: PostgreSQL 18 + Redis 8 service containers, per-run generated secrets, `npm ci`, migrations, typecheck, lint, API tests (incl. batch), builds, Playwright E2E, smoke test, Docker image build; uploads the batch summary and the Playwright report on failure.
- `apps/api/src/scripts/smoke.ts` (`npm run smoke -- --base-url …`): 13 black-box checks with a throwaway tenant.
- Env examples: root `.env.example` (compose), `apps/api/.env.example`, `apps/web/.env.example` (now un-ignored in `apps/web/.gitignore`).
- Docs: `README.md`; `docs/api-spec.yaml` (OpenAPI 3.1, 34 paths); `docs/ui-ux-spec.md`; `docs/database-erd.md` reconciled with the generated schema; `docs/architecture.md` §16 implementation notes and an extended decision log; status table in `docs/agent-implementation-plan.md`; `docs/requirements.md` §15 updated with evidence or blocker.

**Validation**
| Command | Result |
| --- | --- |
| `npm run typecheck` (root) | exit 0 |
| `npm run lint` (root) | exit 0 |
| `npm test` (root) | **8 files, 45 passed** (31.95 s) |
| `npm run build` (root) | exit 0 (`prisma generate` + `tsc`; `next build` 15 routes) |
| `node dist/server.js` / `node dist/worker.js` (NODE_ENV=production) | `/api/ready` 200; worker `/health` `{"database":true,"redis":true,"consuming":true}` |
| `docker build -f apps/api/Dockerfile .` | built (1.34 GB) |
| `docker run … npx prisma migrate deploy` (release step) | `No pending migrations to apply.` |
| API + worker containers (production mode) + `npm run smoke -- --base-url http://localhost:4400 --origin http://localhost:3000` | **13/13 checks passed**; the worker container logged 2 completed jobs |
| `docs/api-spec.yaml` parse + `$ref` check (js-yaml) | parsed; 72 refs, 0 unresolved; every implemented route documented |
| Secret scan of 181 committable files against real `.env` values | 0 matches |

**Defects found and fixed:** the Docker build needed `DATABASE_URL` for `prisma generate` (strict `prisma.config.ts`), so a placeholder is passed in that build step only; `apps/web/.env.example` was git-ignored by the web app's `.gitignore`.

**Not verified:** the GitHub Actions workflow has not run on GitHub (each of its steps was run locally). There is no live deployment.

---

## Acceptance checklist (requirements §15)

| Criterion | Status | Evidence |
| --- | --- | --- |
| New account can sign in and create an organization | ✅ | `auth-tenancy.test.ts` "signs up, requires an organization, then creates one as owner"; E2E sign-up → onboarding → dashboard |
| Org member cannot access another organization's resources | ✅ | `auth-tenancy` (switch refused via Fleqo and Better Auth), `workflows` (404 read/update/archive), `connections-import` (404/empty), `worker` (404 execution read/retry), `webhooks` (tenant only from the verified connection) |
| Public example data can be imported; generated orders labelled synthetic | ✅ | `connections-import` (DummyJSON normalization with provenance; synthetic import repeatable); `webhooks` (simulator events `isSynthetic`, `source: simulator`); UI badges |
| User can configure and enable the Order Sync workflow | ✅ | `workflows.test.ts`; E2E `/workflows/new` → Active |
| Valid signed `order.created` events are accepted and processed | ✅ | `webhooks` (202 + durable run), `worker` (CRM → Sheet succeeded), smoke step 11 |
| Invalid signature and malformed payload are rejected | ✅ | `webhooks` (401 missing/forged/tampered/stale/unknown; 400 malformed; 422 schema; 413 size) |
| One unique order creates/updates the expected CRM customer and Sheet row | ✅ | `mock-providers`, `worker`, batch (30 customers / 100 rows / totals match) |
| Re-sending the same event does not create duplicates | ✅ | `webhooks` (duplicate → 200, 1 run, 1 job), `worker`, batch (25 duplicates → no extra runs), E2E re-send, smoke step 12 |
| Temporary failure triggers retry; completed actions not repeated | ✅ | `worker` (Sheet ×2 then success, CRM attempts = 1; manual retry after dead letter, CRM still 1), batch (attempt accounting = 215), E2E |
| Failed and successful runs visible with action-level logs | ✅ | `GET /api/executions/:id` (logs, action runs, dead letters); E2E execution detail; screenshots reviewed |
| Repeatable ≥100-event batch with duplicate/failure scenarios passes | ✅ | `npm run test:batch` → `apps/api/test-results/batch-summary.json` (100 unique, 25 duplicates, 5 forged, 10 transient-failure events, 0 dead letters) |
| Frontend, backend, worker and database deployed and smoke-tested | ⛔ **Blocked (external)** | Needs Vercel + Railway (or equivalent) credentials and explicit approval. The deployable configuration is complete; the production Docker image passed the smoke test locally (13/13). |
| README documents architecture, setup, trade-offs and real test results | ✅ | `README.md` |

## Open items for the owner
1. **Deployment:** provide Vercel and Railway (or equivalent) access plus managed PostgreSQL/Redis, and approve deployment. Then follow README → Deployment and run `npm run smoke -- --base-url <vercel-url>`.
2. **Environment:** `NODE_ENV=production` and `NODE_TLS_REJECT_UNAUTHORIZED=0` are set globally on this machine. The first makes npm skip devDependencies; the second disables TLS verification for all Node processes. Removing both is recommended.
3. **Git history:** `docs/node-v24.22.2-x64.msi` (33 MB) remains in commit `f578a97`. Removing it needs a history rewrite, which needs your approval.
4. **Commits:** nothing has been committed (owner commits manually). The working tree contains all M0–M8 changes; the regenerated Prisma client under `apps/api/src/generated` is part of them.

---

# Release v1.0 — production readiness (R1–R6), 2026-11-01

Owner brief: audit and harden the MVP for production without rebuilding it; verify, document and prepare deployment; no commits, no deployment without approval, no destructive operations on developer data.

## R1 — Codebase & functional audit
- Read-only checks on the developer DB: `migrate status` up to date; `migrate diff` reports no drift. The owner-reported Demo Store numbers were verified exactly (60 runs succeeded, 60 sheet rows, 41 CRM customers, 2 duplicates ignored, 0 failed or open runs); integrity queries clean.
- **Reported Connections issue** reproduced in Playwright (light/dark, Owner/Member). It was a **visual** inconsistency, not a state bug (`data-state` always matched the DB): near-white "on" track in dark mode, disabled 50 %-opacity switches for Members, and a static "Enabled" label. Fixed and covered by `e2e/connections-permissions.spec.ts`.
- 14 findings (F1–F14), fixes and component classification: [release-audit.md](./release-audit.md).

## R2 — Reliability testing
- API: `npm test` → **10 files, 59 passed**, including the new `security.test.ts` (7) and `recovery.test.ts` (7). The 100-event batch re-ran with identical results (215 attempts, 0 dead letters).
- E2E (production build, CSP on, console-error guard): **5 passed**, including the new switch regression, invite link and organization-switching specs.
- `scripts/reliability-check.sh` (compiled API + worker, throwaway PostgreSQL/Redis): worker down, Redis outage, worker SIGKILL during back-off, Redis restart, PostgreSQL restart, API restart (session kept), duplicate → **all passed**, 32/32 runs, CRM never repeated.
- Owner's running demo stack: smoke 13/13, demo login, live DummyJSON import (60 created, then 60 updated).
- Details: [production-test-results.md](./production-test-results.md).

## R3 — Security audit
- Fixed: invitation takeover through unverified email (**High**), CSRF origin check, webhook rate-limit bypass, production TLS/HTTPS startup guards, `Cache-Control: no-store`, web CSP/HSTS/Permissions-Policy, organization deletion disabled.
- `npm audit --omit=dev` 0; full 0. The developer's agent environment has `NODE_ENV=production` and `NODE_TLS_REJECT_UNAUTHORIZED=0` at process scope only (not User/Machine). Exact fix commands are documented; **OS settings not changed**.
- Report: [security-audit.md](./security-audit.md).

## R4 — Repository & CI
- Generated Prisma client untracked (`.gitignore`, pre-scripts regenerate it; `prisma.config.ts` URL optional for `generate`). **Owner action:** `git rm -r --cached apps/api/src/generated`.
- Only large historical file: the 31.8 MB installer in `f578a97` (history rewrite needs approval; not done).
- CI: production audit gate, schema-drift guard, explicit service start with logs, test-results artifact, `reliability` job, image job. `actionlint` and ShellCheck clean. Not run on GitHub (no authorization; `gh` not installed).
- Proposed commit structure: [release-audit.md §4](./release-audit.md#4-proposed-commit-structure).

## R5 — Deployment preparation
- Dockerfile: 3 stages, production deps only (Prisma CLI moved to dependencies), web workspace pruned → **725 MB** (was 1.34 GB), non-root. Verified: migrations from an empty DB, production guards, worker health, smoke 13/13, graceful SIGTERM.
- Railway configs validated against Railway's published schema; `drainingSeconds` added. Production env templates in `deploy/env/`.
- Guide with backups, rollback, observability and the R6 checklist: [deployment.md](./deployment.md).

## R6 — Production verification
**BLOCKED:** requires cloud credentials (Railway, Vercel, managed PostgreSQL/Redis) and explicit deployment approval. No live claims are made.

## Housekeeping
- Temporary databases created for isolated testing: `fleqo_test` (tests) and `fleqo_e2e` (E2E). They are safe to drop: `DROP DATABASE fleqo_e2e;`. The dev database `fleqo` holds a few new throwaway tenants created by smoke/import checks (`smoke-*@example.test`, `dj-*@example.test`, `e2e-*` users only in `fleqo_e2e`).
- Docker images pulled for validation only: `rhysd/actionlint:1.7.7`, `koalaman/shellcheck:v0.10.0`. All test containers and networks were removed.

---

# Release v1.1 — landing page, social sign-in, theme system, 2026-11-01

Owner brief: add a professional public website, social authentication and a complete Light/Dark/System theme without rebuilding the project, breaking the automation engine or removing email/password auth; no invented customers or statistics; no secrets in the frontend; no commits or deployment.

## Task 01 — Public landing page
- `/` is now a statically prerendered landing page (`app/page.tsx`, `components/landing/*`): sticky header, hero with an animated pipeline illustration, an **in-browser interactive demo** (real WebCrypto HMAC with a published demo secret, duplicate detection, simulated CRM outage + retry, **no API calls**), 8 features, how it works (tabs), integrations (4 available mocks; Shopify, WooCommerce, Google Sheets, HubSpot labelled *planned, not available yet*), real product screenshots in both themes, security & reliability, final CTA, footer.
- `/docs` (quick start, concepts, webhook API with signing example, roles, limits); `robots.txt`, `sitemap.xml`, generated Open Graph image; metadata uses `NEXT_PUBLIC_SITE_URL`.
- Signed-in visitors see **Go to Dashboard**; protected routes still redirect to sign-in.
- No testimonials, customer logos, usage numbers, awards or certifications. Only links to pages that exist. Details: [landing-page.md](./landing-page.md).

## Task 02 — Social authentication
- Better Auth `socialProviders` for Google, GitHub, Apple and X (`apps/api/src/lib/social-providers.ts`), enabled per provider only when both env values are set; a half-configured provider stops startup. `GET /api/public/auth-providers` tells the web app which buttons to show (IDs and names only).
- Safe linking: `requireLocalEmailVerified: true`, no trusted providers, no different-email linking, which blocks account pre-hijacking through unverified password accounts. `disableOriginCheck: false` set explicitly, because Better Auth skips callback-URL validation in test environments; without it the open-redirect test returned 200 instead of 403.
- Redesigned `/sign-in` and `/sign-up`: two-column layout, Back to home, theme switcher, password show/hide, confirm password, inline validation, "Or continue with", friendly OAuth error messages (unknown codes never echoed).
- **Status:** Google and GitHub *configured but not live-verified* (no credentials provided); Apple and X *blocked* (paid / developer accounts, HTTPS domain). Email-verification proposal and provider setup: [social-auth.md](./social-auth.md).

## Task 03 — Theme system
- `next-themes` with Light / Dark / System, stored in `localStorage`, applied before first paint (verified at `domcontentloaded`), live System following, View-Transition cross-fade (instant under reduced motion).
- Switchers: landing/docs header, auth pages, onboarding, invite page, app sidebar and mobile header (`ThemeToggle`), Settings → Appearance (`ThemeSelector`).
- Owner feedback: the sidebar's "Mock integrations · synthetic data" pill is now a release label, "Workflow Automation v1.1" (`APP_VERSION` in `lib/site.ts`). Mocks stay labelled on the Connections, Demo data and execution pages. Covered by `e2e/release-label.spec.ts`.
- Owner feedback: the user menu was removed; the sidebar shows the user's name and email with a one-click sign-out icon next to the theme toggle.
- Owner feedback: `public/logo.png` is now the logo and favicon. It was traced into an SVG (`src/lib/logo.ts`) whose blocks use new `--logo-1…5` tokens (teal → primary indigo, brighter in dark mode), so it matches the theme. `icon.svg` follows the browser's light/dark setting; `favicon.ico` and `apple-icon.png` are generated by `npm run icons --workspace=apps/web`; the OG card uses the same mark.
- Owner feedback: the footer's "Powered by" link now uses theme tokens (`text-foreground`, hover `text-primary` with a matching underline, external-link arrow, "opens in a new tab" for screen readers) instead of fixed black/white and `blue-900`.
- Owner feedback: the header control opened a Light/Dark/System menu; it is now a **single-click light ↔ dark toggle** (no menu). System remains the default for first visits and selectable in Settings.
- Semantic tokens added (`surface`, `brand`, `brand-2`, `success`, `success-solid`, `warning`, `info`); every hardcoded palette class in Fleqo components replaced. Details: [theme-architecture.md](./theme-architecture.md).

## Task 04 — QA
- `npm test` → **11 files, 66 passed** (49.8 s), incl. new `social-auth.test.ts` (7). Batch counts identical to v1.0.
- E2E (production build, CSP, console guard, fake Google/GitHub IDs) → **25 passed** (1.6 min) in one run: new `landing` (9), `theme` (3), `accessibility` (4, axe WCAG AA on 12 pages × 2 themes), `social-auth` (3), `release-label` (1), plus the v1.0 suite.
- Accessibility fixes found by axe: focusable scrollable regions (code blocks, logs, tables), org-switcher accessible name, Demo-data filter (pressed buttons instead of tab triggers without panels).
- `npm run lint` / `typecheck` exit 0; `npm audit --omit=dev` 0. Results: [production-test-results.md §9](./production-test-results.md#9-v11--landing-page-social-sign-in-themes-2026-11-01).

## Task 05 — Documentation
README, `landing-page.md`, `theme-architecture.md`, `social-auth.md` (new); `security-audit.md` §8, `deployment.md` (OAuth variables, redirect URIs, `NEXT_PUBLIC_SITE_URL`, checks), `ui-ux-spec.md`, `api-spec.yaml` (`/api/public/auth-providers`), env templates.

## Open items for the owner (v1.1)
1. OAuth credentials (Google first) to run the live checklist in [social-auth.md §6](./social-auth.md#6-live-verification-checklist-needs-real-credentials); until then no provider is marked verified.
2. An email provider for verification and password reset (proposal in social-auth.md §7).
3. Earlier items still open: `git rm -r --cached apps/api/src/generated`, the agent-environment `NODE_TLS_REJECT_UNAUTHORIZED=0`, deployment approval (R6).

---

# v1.1 follow-up: green CI, Railway IaC, OAuth and email (2026-11-01)

Owner brief: fix the failing GitHub Actions run (`Cannot find name 'LayoutProps'` on `0b6f92d`), update outdated Actions, migrate off Railway's deprecated Config as Code, validate the production templates, prepare Google/GitHub OAuth and secure email verification + password reset, and record results. No history rewrite, no secrets, no paid resources without approval.

## CI (first priority): done and green on GitHub
- Reproduced in a fresh clone. Cause: Next's generated route types (`LayoutProps`) only exist after `next typegen`/build. Fix: `"typecheck": "next typegen && tsc --noEmit"`.
- Actions v4 → v7 (Node 24), runners pinned to `ubuntu-24.04`, E2E uses the compiled API/worker (the dev scripts raced on `prisma generate`).
- With the owner's approval, pushed as `4f81a18` (the owner chose `git add .` and the message). Run 41290735002: all three jobs **success**, no annotations.

## Railway: Infrastructure as Code
- Railway's docs confirm the deprecation (new services cannot use Config as Code; hard cutoff 2026-12-01). Added `.railway/railway.ts` (PostgreSQL, Redis, `fleqo-api`, `fleqo-worker`) using the official `railway@3.16.0` SDK as a dev dependency, type-checked in CI (`npm run railway:check`). Removed `deploy/railway/*.json`.
- Secrets stay out of Git: shared variables for the values both services need, `preserve()` for API-only secrets. The env templates mirror the file for dashboard-only setups.
- Redis: ioredis `family: 0` for Railway's IPv6-only private networks.
- Not executed: `railway config plan/apply` (needs the CLI login and approval).

## OAuth preparation
- Exact production values (origins and callback URLs on the web origin) in deployment.md §3.5 and social-auth.md §8. No credentials invented; providers remain "configured but not live-verified".

## Email verification and password reset
- `lib/mailer.ts` (Resend over HTTPS; `log`/`file` for local use and tests only, refused in production), `lib/emails.ts` templates, Better Auth wiring (`requireEmailVerification` behind `REQUIRE_EMAIL_VERIFICATION`, single-use reset with session revocation, owner notice on duplicate sign-up, invitation verification, 3/min rate limits).
- Web: "Forgot password?" (only when emails can be sent), `/forgot-password`, `/reset-password`, `/verify-email`, "Check your inbox" after sign-up, a clear message for unverified sign-ins.
- Tests: `email-auth.test.ts` (8), `password-reset.spec.ts`, two pages added to the axe audit; the required-verification browser flow was run locally. A clean-clone run caught one regression before it was pushed (sign-in redirect via `callbackURL`), now fixed.
- Off by default; no real email sent (needs a Resend domain and key).

## Results
API **74/74** (12 files), E2E **23 passed + 3 skipped** in the CI configuration, smoke **13/13**, lint/typecheck/audit clean. Details: [production-test-results.md §10](./production-test-results.md#10-ci-fix-railway-iac-and-email-2026-11-01).

## Open items for the owner
1. Commit and push the uncommitted IaC + email + docs work (CI will verify it).
2. Railway: CLI ≥ 5.42.1, `railway link`, shared variables, `railway config plan` → approve → `apply`; generate the API domain; Vercel `API_URL`/`NEXT_PUBLIC_SITE_URL`.
3. Google/GitHub OAuth apps with the exact URLs in social-auth.md §8, then the live checklist.
4. Resend: verify a sending domain (SPF/DKIM/DMARC), create a sending-only key, test a reset email, then `REQUIRE_EMAIL_VERIFICATION=true`.
5. Still open: `git rm -r --cached apps/api/src/generated` (the generated Prisma client is tracked although gitignored).
