# Fleqo — Instructions for Coding Agents

Fleqo is a multi-tenant order-sync automation platform: a signed `order.created` webhook becomes a workflow run that upserts a CRM customer and appends a spreadsheet row, exactly once, with retries, dead letters and per-attempt logs. The store, CRM and sheet are PostgreSQL-backed mocks. The app is deployed (Vercel + Render + Neon); treat `main` as production.

Read before changing behaviour: [docs/architecture.md](docs/architecture.md), [docs/database-erd.md](docs/database-erd.md), [docs/security.md](docs/security.md). The API contract is [docs/api-spec.yaml](docs/api-spec.yaml).

## Repository
| Path | What |
| --- | --- |
| `apps/api` | Express 5 API (`src/server.ts`), BullMQ worker (`src/worker.ts`) and the demo supervisor (`src/single-service.ts`); Prisma schema and migrations in `prisma/`; Vitest suites in `test/`; production `Dockerfile` |
| `apps/web` | Next.js 16 App Router, Tailwind 4, shadcn/ui, TanStack Query; Playwright specs in `e2e/` |
| `deploy/` | Environment templates (placeholders only) for production and the $0 demo |
| `scripts/reliability-check.sh` | Process-level fault injection (CI `reliability` job) |
| `docs/` | Architecture, data model, API, security, auth, frontend, testing, deployment |

## Commands
```bash
npm run infra:up                    # PostgreSQL + Redis (compose.yaml)
npm run dev:api | dev:worker | dev:web
npm run lint && npm run typecheck   # both workspaces
npm test                            # API integration tests on the *_test database
npm run test:e2e                    # Playwright (starts the stack if not running)
npm run build
npm run db:migrate                  # create a migration while changing schema.prisma
```
- `apps/api/src/generated` (Prisma client) is generated, never edited or committed; `dev`, `typecheck`, `test`, `build` regenerate it.
- If the shell has `NODE_ENV=production`, install with `npm install --include=dev`.

## Locked decisions
- Express API and a separate worker process. Do not move the API into Next.js route handlers or switch frameworks.
- PostgreSQL is the source of truth; Redis/BullMQ only transports jobs. Idempotency comes from unique keys, persisted action state and transactions, never from queue job IDs.
- Better Auth with the Organization plugin; tenant = the session's active organization, re-verified on every request (`requireOrg`). Permissions live in `apps/api/src/lib/permissions.ts`.
- The browser talks only to the web origin; `/api/*` is proxied to the API (first-party cookies).
- Zod validates every input. Money is integer minor units with a currency code. Synthetic and imported data keep their provenance labels.
- Production runs API and worker as separate services; the $0 demo runs both through `single-service.ts`. Keep both working.

## Security non-negotiables
- Every query on tenant data filters by resource ID **and** `organizationId`; cross-tenant access returns 404.
- Webhooks verify HMAC over the **raw** body before parsing; the tenant comes only from the verified connection.
- No secrets in browser code, URLs, logs or the repository. OAuth and email secrets live only on the API service.
- Never fetch user-supplied URLs. Errors stay sanitized (`{ error: { code, message, details?, requestId } }`).

## Safety rules
- Never run `prisma migrate reset`, `db push` or `migrate dev` against a shared or production database, drop tables or delete Docker volumes without the owner's explicit approval. Migrations are forward-only (expand → migrate → contract).
- Never commit `.env` files, credentials, keys or large binaries. Do not rewrite Git history or force-push.
- Do not commit, push or deploy unless the owner asks.
- Do not claim something works without running it; report failing checks with their output.

## Definition of done for a change
`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass; behaviour changes come with tests (API in `apps/api/test`, UI flows in `apps/web/e2e`); schema changes come with a migration (CI fails on drift); docs and `docs/api-spec.yaml` match the code.
