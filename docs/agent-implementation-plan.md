# Fleqo — AI Agent Implementation Plan

**Status:** Handoff plan. This is a checklist for the existing repository, not a claim of implemented features.

## Execution status (2026-10-31)
| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 Stabilize foundation | ✅ Done | Health/db/ready endpoints, typecheck, lint, build |
| M1 Models, migrations, seed | ✅ Done | `20261031155142_init`; `schema-constraints.test.ts` (6); idempotent `db:seed` |
| M2 Auth, organizations, RBAC | ✅ Done | `auth-tenancy.test.ts` (6) |
| M3 Import + mock integrations | ✅ Done | `connections-import.test.ts` (5), `mock-providers.test.ts` (4) |
| M4 Workflow configuration + contracts | ✅ Done | `workflows.test.ts` (5); `docs/api-spec.yaml`, `docs/ui-ux-spec.md` |
| M5 Signed webhooks + outbox | ✅ Done | `webhooks.test.ts` (10) |
| M6 Worker, idempotency, recovery | ✅ Done | `worker.test.ts` (8), `batch.test.ts` (100 events) |
| M7 Frontend | ✅ Done | Playwright E2E (desktop + mobile) against the production build |
| M8 QA, docs, CI, deployability | ✅ Done locally · ⛔ live deployment blocked | README, CI workflow, Dockerfile + Railway configs, smoke test 13/13 against the production image; no cloud credentials or deploy approval yet |

Details, commands and real outputs: [`agent-progress.md`](./agent-progress.md).

## Start with a repository audit
- Read `AGENTS.md`, `docs/requirements.md`, `docs/architecture.md`, `docs/database-erd.md`.
- Inspect `git status`, installed package versions, npm workspace scripts, `apps/api/prisma/schema.prisma`, Prisma config filename and generator output, `apps/api/src/lib/prisma.ts`, `apps/api/src/server.ts`, Next.js routes, Docker Compose and `.env.example`.
- Run safe checks for available scripts (`npm install` only if needed; `npm run ...` based on existing scripts), Prisma validation, typecheck, Docker health, API/web smoke test.
- Never guess what is complete from folders existing. Keep current working parts and document gaps in `docs/agent-progress.md`.

## Build order and milestone acceptance

### M0 — Stabilize current foundation
- Fix only demonstrated configuration/runtime problems. Ensure supported Node/npm, consistent monorepo scripts, Prisma/PostgreSQL connection, Redis, API `/api/health`, frontend start and API integration.
- Check `.gitignore`, environment variable examples, no committed secrets or installer artifacts.
- **Pass:** documented setup commands work and build/typecheck run; DB+Redis health checks pass.

### M1 — Prisma models, migrations and seed
- Implement identity-compatible, organizations, memberships, connections, workflows, triggers, actions, incoming events, outbox dispatch, runs/action runs, mock CRM/Sheet, imported records, audit/dead-letter models consistent with ERD.
- Unique constraints: `(organizationId,userId)`, `(organizationId,provider,externalEventId)`, `(workflowId,incomingEventId)`, `(workflowRunId,workflowActionId)`, `(workflowRunId)` for outbox dispatch, mock customer and mock sheet keys.
- Use current compatible Prisma version and generated client strategy. Create reproducible migrations and safe seeds.
- **Pass:** migrations apply on empty test DB; seed/test data query; uniqueness tests demonstrate intended conflicts.

### M2 — Auth, organizations and permissions
- Better Auth mounted correctly on Express (middleware order/raw body considerations); login/session; organization creation, switching and server-side Owner/Admin/Member authorization.
- **Pass:** valid session works; unauthorized access denied; users of Org A cannot read/write Org B data.

### M3 — Import data + mock integrations
- Public data adapter(s), dataset provenance + license notes, input validation, synthetic order simulator, mock store/CRM/Sheet persistence and connection health/configuration.
- First delivery should work offline from synthetic seed data, without network API availability; public adapters enhance it.
- **Pass:** repeatable import and sample order generation; mock CRM upserts and sheet records persist in PostgreSQL.

### M4 — Workflow configuration and contracts
- Workflow CRUD, enabled/disabled, ordered two action types, input/output mapping schema, validation. Write formal API request/response examples in `docs/api-spec.yaml` and UI structure in `docs/ui-ux-spec.md`.
- **Pass:** authenticated user creates an active Order Sync workflow through API; another tenant cannot touch it.

### M5 — Signed webhook ingestion + outbox
- Raw-body HMAC verification, timestamp/replay, Zod payload validation, connection/tenant resolution, unique event persistence, matching workflow run creation, outbox row committed transactionally.
- **Pass:** invalid/missing signatures rejected; duplicates acknowledged but not re-executed; simulated Redis outage cannot lose persisted event intent.

### M6 — Worker execution, idempotency, recovery
- Separate BullMQ worker and outbox dispatcher, sequential CRM upsert → Sheet append, durable action run state/logs, transaction-protected local side effects, controlled retry/backoff and dead-letter/manual replay.
- **Pass:** worker performs persisted end-to-end automation; 100-event batch, duplicates and intermittent failures produce correct unique destination records; existing successful actions not repeated on retry.

### M7 — Professional frontend
- Next.js pages: `/sign-in`, `/sign-up`, `/dashboard`, `/connections`, `/workflows`, `/workflows/new`, `/workflows/[id]`, `/executions`, `/executions/[id]`, `/team`, `/settings`.
- shadcn/ui, accessible responsiveness, forms, TanStack Query, correct cookie/CORS handling, empty/loading/error states, action-level logs and retry UI.
- **Pass:** operator can complete full event-import → workflow-creation → simulation → execution-review loop in browser.

### M8 — QA, docs, CI, deployability
- Unit, API integration and E2E tests, multi-tenant isolation, negative webhook cases, retry crash recovery, deduplication, 100-event result assertions, basic rate/payload limits.
- CI: typecheck, lint, test/build with sensible independent service checks. Complete README, design/tradeoffs, `.env.example`, setup/health/smoke-test commands.
- Deployment: Vercel web, separate API and worker on long-running host, managed PG/Redis; handle cookie domain/CORS correctly. Require explicit user credentials/permission for external deploy. Verify live deployment if access exists.
- **Pass:** real test outputs are recorded, no known critical security defects, and `docs/requirements.md` §15 is checked with evidence or external blockers.

## Suggested regular agent status format
Update `docs/agent-progress.md` as work proceeds:

```
Milestone: Mx — title
Changes: [files/features]
Validation: [exact commands and result]
Remaining: [specific next tasks]
Blockers: [only genuine external blockers]
Decisions: [deviations from SRS/architecture]
```

## Explicitly deferred (post-MVP)
Visual drag/drop canvas, generalized script runner, conditional branches, real Shopify/Google OAuth, billing, AI workflow generation, high-volume scale claims. Do not spend MVP time on these.
