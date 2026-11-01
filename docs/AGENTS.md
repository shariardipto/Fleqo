# Fleqo — Instructions for AI Coding Agents

You are contributing to **Fleqo**, an Integration & Workflow Automation SaaS. Your goal is to **complete the existing repository**, not recreate it. Build and verify the MVP end-to-end using the project specifications.

## Source of truth (read in this order)
1. `docs/requirements.md` — product goal, MVP scope, user journeys, roles, definition of done.
2. `docs/architecture.md` — service boundaries, event lifecycle, recovery and security design.
3. `docs/database-erd.md` — entities, relationships, unique constraints, tenancy.
4. Existing application code, configs, migrations, package manifests and tests — **audit before editing**.
5. `docs/agent-implementation-plan.md` — implementation checkpoints and verification plan.

If docs and current code disagree, preserve working code until you identify the conflict. Prefer explicit product requirements and documented architecture; record any deliberate deviation with a rationale in `docs/agent-progress.md`. Do not assume an untested file or generated Prisma client means its feature works.

## Locked decisions
- Product name: **Fleqo**. UI defaults to English; documentation and code should be readable.
- Frontend: Next.js App Router + React + TypeScript + Tailwind CSS + shadcn/ui; TanStack Query for API data. Zustand only if truly useful.
- Backend: separate Node.js + Express.js + TypeScript server. **Do not migrate to NestJS or Next.js-only API routes.**
- Database: PostgreSQL and Prisma, retaining the compatible installed major version after verification. Use database migrations and constraints.
- Auth: Better Auth, with Express-based session handling and server-enforced organization RBAC.
- Async: Redis + BullMQ and an independently running worker/dispatcher.
- Validation: Zod. Tests: Vitest/Supertest and Playwright. Dev infra: Docker Compose.
- Monorepo: retain current `apps/web`, `apps/api`, `docs` and root workspace. Introduce `apps/worker` and shared packages only as needed. Respect existing Prisma schema/output paths; don't duplicate clients or migration directories without good reason.
- Production target: Vercel frontend; a long-running service for Express API and separate BullMQ worker (Render: web service + background worker); managed PostgreSQL/Redis. Never claim deployment succeeded without live verification.

## Current repository handoff notes
Screenshots suggest that `apps/web`, `apps/api`, a Prisma schema and generated Prisma client, `apps/api/src/lib/prisma.ts`, `apps/api/src/server.ts`, Docker Compose, a root `.env` and `apps/api/.env` already exist. **These are observations, not proof of correct runtime behavior.** The Prisma config may currently be named `prisma7.config.ts`; inspect its actual contents and CLI invocation before changing anything. Docker Compose may be called `compose.yaml`.

Do **not** replace/reinitialize the repository. Preserve user-owned code and history. Inspect `git status` before editing. Never run `prisma migrate reset`, delete volumes, drop tables, remove project files, force-push, or overwrite secrets without the user's explicit permission. Do not commit `.env`, credentials, personal data, or large installers/artifacts (e.g. Node `.msi`).

## MVP behavior — must actually work
1. Better Auth sign-up/sign-in/sign-out and a user-created organization with Owner/Admin/Member roles.
2. Organization-scoped mock connections: `mock_store`, `mock_crm`, `mock_sheet`.
3. Guided form-based workflow: **`mock_store.order.created` → `mock_crm.upsert_customer` → `mock_sheet.append_order`**, sequential actions, configurable mapping, enable/disable.
4. Import/sample public e-commerce API/dataset inputs, validate, normalize and mark synthetic examples. Avoid paid APIs and private customer data.
5. Authorized demo event simulator generates signed `order.created` webhooks.
6. Express receives *raw* signed webhook body, verifies HMAC and timestamp/replay window, validates payload, resolves tenant from trusted connection, persists event+dispatch intent and returns appropriate status.
7. Dedicated BullMQ worker executes workflows; PostgreSQL persists events, runs, action runs, mock destination records, status/error/attempt logs.
8. Duplicate events and action retries never duplicate mock CRM/Sheet side effects. Unique database keys, persisted action states and transactions provide idempotency; Redis job IDs are not sufficient.
9. Database-backed outbox/dispatch recovery covers DB-success-but-Redis-unavailable cases. Bounded retries with exponential backoff, failed/dead-letter visibility and authorized manual retry only of incomplete actions.
10. Dashboard, connections, workflow create/detail, executions list/detail, team/settings; responsive, accessible and with loading/error/empty states.
11. Automated backend/integration/E2E tests and a reproducible **100-event batch including duplicates and transient failures**; real logs/results, not invented benchmarks.
12. Production deployment instructions, README, `.env.example`, CI and verified smoke tests. If actual cloud credentials aren't provided, complete a deployable configuration and mark live deployment blocked; do not invent a URL.

## Security and engineering non-negotiables
- Enforce org membership and role authorization **server-side on every protected request**; never rely on only a client-supplied org ID. A connection identifies webhook tenant after secret verification.
- Zod input validation, input-size limits, rate limiting, safe CORS and cookie strategy, sanitized errors and structured logging. No integration secrets in browser bundles, URLs, logs or source control.
- Webhook verification must receive the raw body before JSON parsing; test invalid signatures, altered bodies and replay attempts.
- Prevent cross-tenant data leaks; constrain outgoing destinations to explicit mock/provider adapters (do not fetch arbitrary user-supplied URLs).
- Use integer minor units for monetary amounts; preserve currency codes. Record source/license metadata and clearly label synthetic demo data.
- Prefer minimal composable modules and migrations, no unnecessary frameworks, no fake analytics or mock UI-only features presented as finished.
- Follow package versions and current API contracts actually installed. Consult official docs where version behavior materially differs.

## How to work
1. **Audit first.** Read documents; inspect repository, package scripts, Prisma config/schema, migrations, env examples, Docker/compose, existing tests. Run non-destructive health/build/type checks. Note exact working and broken areas.
2. Create or update `docs/agent-progress.md`: current state, dependency/version issues, gap list, ordered milestones, acceptance checklist and blockers. Do not silently discard previous work.
3. Work through `docs/agent-implementation-plan.md`. Make small cohesive changes. After each milestone run available typecheck, lint, unit/integration tests, and relevant manual smoke tests; record exact commands and results.
4. Add migrations and tests whenever implementing persistent behavior. Prefer integration tests against temporary/local services over pretending with skipped tests.
5. Keep specs synchronized with actual API shapes: create `docs/api-spec.yaml`, `docs/database-schema.md`, `docs/ui-ux-spec.md` where useful. Document design tradeoffs and deviations.
6. Continue autonomously through remaining MVP milestones rather than stopping after a scaffold. Ask the owner only when secrets/account permissions, deployment authorization, an irreversible operation, or an unrecoverable contradiction blocks you.
7. Before completion: run all repeatable checks; use demo credentials only via documented safe seeding, not published privileged accounts. Provide final summary: implemented features, test evidence, known limitations, remaining blockers and exact local/deploy commands.

**Definition of done:** every checkbox in `docs/requirements.md` §15 has either verified evidence or an explicitly labeled external blocker. Never describe untested features as complete.
