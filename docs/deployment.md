# Fleqo — Production Deployment Guide

**Status (2026-11-01): prepared, NOT deployed.** Every artifact below was verified locally (production Docker image, migrations from an empty database, health checks, smoke test). The live deployment needs your cloud credentials and explicit approval. Nothing here has been provisioned, purchased or published.

## 1. Architecture

```
Browser ──HTTPS──▶ Vercel (Next.js, apps/web) ──rewrite /api/*──▶ Railway "fleqo-api"  (node dist/server.js)
                                                                        │   ▲
External webhook senders ──HTTPS──▶ Railway "fleqo-api" /api/webhooks   │   │ outbox / jobs
                                                                        ▼   │
                                       Railway PostgreSQL ◀──── Railway "fleqo-worker" (node dist/worker.js)
                                       Railway Redis      ◀────┘
```
- One Docker image (`apps/api/Dockerfile`) serves two Railway services with different start commands.
- Browsers only talk to the Vercel origin. `/api/*` is proxied, so Better Auth cookies are first-party: no cross-site cookies, no wildcard CORS.
- PostgreSQL is the source of truth (events, runs, outbox, destination records). Redis carries BullMQ jobs and can be rebuilt from the outbox (see §6).

## 2. Prerequisites (owner)
- GitHub repository `shariardipto/Fleqo` with this code committed and pushed (see release-audit.md §4).
- Railway account and project; Vercel account. Plans and costs are your decision — this guide assumes no specific plan.
- Generate two secrets locally and store them **only** in Railway:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
  ```
  **Back up `ENCRYPTION_KEY`** in a password manager: losing it makes stored webhook secrets unrecoverable (they can be rotated, see §7).

## 3. Railway

### 3.1 Data services
1. **PostgreSQL** (Railway Postgres plugin or another managed PostgreSQL ≥ 16). Note its `DATABASE_URL`. Prefer the private-network URL for the API and worker.
2. **Redis** (Railway Redis plugin or another TCP Redis ≥ 6.2; BullMQ cannot use REST-only Redis). Required settings:
   - `maxmemory-policy noeviction` — BullMQ requirement; eviction would silently drop jobs.
   - Persistence (AOF or RDB) recommended. The reliability test showed jobs surviving a Redis restart with AOF.
   - `rediss://` URLs (TLS) are supported by ioredis.
   - Check after provisioning: `redis-cli -u "$REDIS_URL" CONFIG GET maxmemory-policy`. Some managed tiers do not allow `CONFIG`; check the provider's settings page instead.

### 3.2 API service `fleqo-api`
1. New service → Deploy from GitHub repo → this repository, branch `main` (or `master`).
2. Settings → **Config-as-code file path:** `deploy/railway/api.json`. It sets: Dockerfile builder (`apps/api/Dockerfile`), start `node dist/server.js`, **pre-deploy `npx prisma migrate deploy`**, health check `/api/ready` (60 s), restart on failure (5 retries), draining 15 s.
3. Variables: copy from [`deploy/env/api.production.env.example`](../deploy/env/api.production.env.example) and fill in:
   - `DATABASE_URL`, `REDIS_URL` (Railway references such as `${{Postgres.DATABASE_URL}}`)
   - `BETTER_AUTH_URL` and `WEB_ORIGINS` = your **Vercel** URL (`https://…`). The API refuses to start in production with non-HTTPS origins.
   - `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`
   - `TRUST_PROXY=2` (Vercel proxy + Railway edge; verify per §8)
   - Do **not** set `NODE_TLS_REJECT_UNAUTHORIZED` (the API refuses to start with `0`).
4. Networking → generate a public domain (e.g. `fleqo-api.up.railway.app`). It is needed by Vercel's rewrite and by external webhook senders.

### 3.3 Worker service `fleqo-worker`
1. New service → same repository.
2. Config-as-code file path: `deploy/railway/worker.json` (start `node dist/worker.js`, restart policy ALWAYS, draining 30 s so in-flight jobs finish).
3. Variables: [`deploy/env/worker.production.env.example`](../deploy/env/worker.production.env.example). `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `BETTER_AUTH_URL` and `WEB_ORIGINS` must **equal** the API's values.
4. No public domain. Optional health check: set `PORT=8080`, `WORKER_HEALTH_PORT=8080` and health check path `/health`.
5. Scaling: more worker replicas are safe (run leases + action states guarantee single execution). `WORKER_CONCURRENCY` (default 5) is per replica.

### 3.4 Migrations — safety rules
- The release step runs `prisma migrate deploy`. It only applies **pending, committed** migrations in order; it never resets, never generates SQL and never drops data on its own. If it fails, Railway does not switch traffic to the new deployment.
- Never run `prisma migrate dev`, `migrate reset` or `db push` against production.
- Before a deploy that contains a migration: take a backup (§6) and run `npx prisma migrate status` locally with the production URL (read-only).
- Schema changes follow **expand → migrate → contract**: add nullable columns or tables first, deploy code that writes both, backfill, and only later remove old columns. Each deploy then stays compatible with the previous app version, so app rollback (§7) stays possible.
- CI blocks merges whose `schema.prisma` differs from the migrations (`migrate diff --exit-code`).

## 4. Vercel (web)
1. Add New Project → import the repository.
2. **Root Directory:** `apps/web`. Framework preset: **Next.js**. Keep the default install command; Vercel detects the npm workspace at the repository root. Build command `next build`.
3. Environment variable (Production and Preview): **`API_URL=https://<railway-api-domain>`**. It is read at **build** time by `next.config.ts` rewrites, so **redeploy after changing it**.
4. Deploy. Production builds send CSP, HSTS, Permissions-Policy, X-Frame-Options and nosniff headers, and no `X-Powered-By`.
5. Custom domain (optional): add it in Vercel, then update `BETTER_AUTH_URL` and `WEB_ORIGINS` on **both** Railway services and redeploy them. DNS changes are yours to make.
6. Preview deployments use different origins; they will fail Better Auth's origin checks unless you add them to `WEB_ORIGINS`. For previews, prefer a separate staging API.

## 5. Health checks, logging and basic observability
| Endpoint | Meaning | Used by |
| --- | --- | --- |
| `GET /api/health` | API process alive | Uptime monitors |
| `GET /api/ready` | PostgreSQL **and** Redis reachable (503 otherwise) | Railway deploy health check |
| `GET /api/db-health` | PostgreSQL only | Diagnostics |
| Worker `GET /health` (optional) | DB + Redis + BullMQ consuming | Optional Railway health check |

- Logs are structured JSON (pino) in Railway's log explorer. Useful fields: `service` (`fleqo-api`/`fleqo-worker`), `req.id`/`X-Request-Id` (also in every error response), `clientIp`, `res.statusCode`, `responseTime`, `component`.
- Searches worth saving: `level:50` (errors); `"Enqueue failed"` (Redis trouble, outbox holding work); `"Recovered stale run"`; `"Job attempt failed"`; `"Dispatcher pass failed"`.
- In-app operations view: Dashboard → open dead letters and in-progress runs; Executions → filter `failed`.
- Recommended external uptime checks: `https://<vercel-domain>/sign-in` and `https://<api-domain>/api/ready` every 1–5 minutes.
- Retention: BullMQ keeps completed jobs 24 h (max 5000) and failed jobs 7 days. `execution_log`/`audit_log` grow without limit in the MVP; plan a retention job before data volume matters.

## 6. Backup and recovery
- **PostgreSQL holds all business state.** Enable the provider's automated backups (Railway volume backups or point-in-time recovery on a managed provider) and test a restore before launch.
- Manual logical backup (run from a trusted machine; keep the file encrypted):
  ```bash
  pg_dump --format=custom --no-owner --dbname "$PROD_DATABASE_URL" --file fleqo-$(date +%F).dump
  ```
- Restore drill into a **new** database (never over production while it is live):
  ```bash
  createdb fleqo_restore_check   # or create via the provider
  pg_restore --no-owner --dbname "$RESTORE_DATABASE_URL" fleqo-YYYY-MM-DD.dump
  DATABASE_URL="$RESTORE_DATABASE_URL" npx prisma migrate status   # expect: up to date
  ```
- **Redis loss is recoverable by design:** unfinished runs whose jobs disappeared are re-dispatched from the PostgreSQL outbox by the worker's recovery sweep (verified: reliability S3/S5 and `recovery.test.ts`). After restoring Redis, watch for `Recovered stale run` logs.
- Back up `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` separately from database backups.

## 7. Rollback
| Situation | Action |
| --- | --- |
| Bad web release | Vercel → Deployments → previous deployment → **Instant Rollback** |
| Bad API/worker release (no schema change) | Railway → service → Deployments → previous deployment → **Redeploy** (do API and worker together) |
| Release with a migration | Migrations are forward-only. If expand/contract was followed, roll back the app only. Otherwise restore the pre-deploy backup into a new database, point `DATABASE_URL` at it and redeploy the previous version |
| Leaked `BETTER_AUTH_SECRET` | Rotate it on both services (all sessions are invalidated; users sign in again) |
| Leaked `ENCRYPTION_KEY` | Set a new key on both services, then rotate every Mock Store signing secret (Connections → Rotate secret); old ciphertexts no longer decrypt |
| Stuck runs after an incident | Executions → filter `failed` → Retry (Admin/Owner); unfinished runs are re-dispatched automatically by the recovery sweep |

## 8. Production verification (R6)
Run after an approved deployment. Do not call the deployment complete until every item passes.

1. `https://<vercel-domain>/sign-in` loads over HTTPS. Response headers include CSP, HSTS and X-Frame-Options; no `X-Powered-By`.
2. `https://<api-domain>/api/health` → 200 and `/api/ready` → `{"database":"connected","redis":"connected"}`.
3. Railway pre-deploy log shows `prisma migrate deploy` succeeded.
4. **Smoke test** from your machine: `npm run smoke -- --base-url https://<vercel-domain>` → 13/13. It creates a throwaway tenant, sends signed events, waits for the worker, and checks duplicates and signature rejection.
5. Worker logs show `Job completed` for the smoke test's runs.
6. **E2E against production** (creates throwaway users): `E2E_BASE_URL=https://<vercel-domain> npm run test:e2e`. It covers registration and auth, roles, invite links, import, workflow, retries, dead letter and manual retry, execution logs, mobile layout and **no browser console errors**.
7. **Proxy check:** in the API logs for your own request, `clientIp` must equal your public IP (not a Vercel or Railway address). If it shows a proxy address, adjust `TRUST_PROXY` (1 or 3) and redeploy.
8. **Cookie check:** in the browser devtools, the session cookie is `__Secure-better-auth.session_token`, `HttpOnly`, `Secure`, `SameSite=Lax`, on the Vercel domain.
9. Optional: run `npm run smoke` with `--base-url https://<api-domain> --origin https://<vercel-domain>` to exercise the public API domain directly.
10. Record the results in `docs/production-test-results.md` (new "Live" section) with the deployment IDs.

## 9. Troubleshooting
| Symptom | Likely cause |
| --- | --- |
| `Invalid origin` / 403 on sign-in | `WEB_ORIGINS`/`BETTER_AUTH_URL` on the API do not exactly match the browser origin (scheme, host, no trailing slash) |
| API exits at start with "Unsafe production configuration" | Non-HTTPS origin or `NODE_TLS_REJECT_UNAUTHORIZED=0` — fix the variable |
| `/api/ready` reports `redis: unavailable` | `REDIS_URL` wrong, TLS (`rediss://`) mismatch, or Redis down. Events are still accepted (outbox) and processed once Redis is back |
| Runs stay `queued` | Worker not running or on a different `QUEUE_PREFIX`/`REDIS_URL` from the API |
| All users rate-limited together | `TRUST_PROXY` too low (every request looks like it comes from the proxy IP) |
| Web calls go to localhost | `API_URL` was not set at Vercel **build** time — set it and redeploy |
