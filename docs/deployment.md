# Fleqo — Production Deployment Guide

**Status (2026-11-01): prepared, NOT deployed.** Every artifact below was verified locally (production Docker image, migrations from an empty database, health checks, smoke test, Railway IaC type-check). The live deployment needs your cloud credentials and explicit approval. Nothing here has been provisioned, purchased or published.

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
- GitHub repository `shariardipto/Fleqo` with this code pushed, and the Railway GitHub app allowed to read it.
- Railway account and project; Vercel account. Plans and costs are your decision; this guide assumes no specific plan. Note that Railway's Free/Trial plans cannot use the `Always` restart policy the worker asks for, and allow outbound SMTP only on Pro (Fleqo sends email over HTTPS, so that does not matter).
- **Railway CLI 5.42.1 or newer** (the Infrastructure-as-Code engine ships in the CLI; `railway upgrade` updates it).
- Generate two secrets locally and store them **only** in Railway:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
  ```
  **Back up `ENCRYPTION_KEY`** in a password manager: losing it makes stored webhook secrets unrecoverable (they can be rotated, see §7).

## 3. Railway (Infrastructure as Code)

**Why this changed (checked 2026-11-01):** Railway deprecated Config as Code (`railway.json` / `railway.toml`). New services cannot opt into it, and existing files stop being read on **2026-12-01**. The replacement is Infrastructure as Code in [`.railway/railway.ts`](../.railway/railway.ts) ([Railway IaC docs](https://docs.railway.com/infrastructure-as-code), [Config as Code deprecation](https://docs.railway.com/config-as-code/reference)). Fleqo's former `deploy/railway/api.json` and `worker.json` were translated setting by setting and removed.

Railway does **not** read `.railway/railway.ts` during deploys. You apply it with the CLI, and it describes the whole project: PostgreSQL, Redis, `fleqo-api` and `fleqo-worker`. The file is type-checked against the official `railway` SDK in CI (`npm run railway:check`, part of `npm run typecheck`), which catches wrong keys and misspelled variable references without a Railway account. Planning and applying need the CLI and your login.

### 3.1 First deployment
1. `railway login`, create an empty project (dashboard or `railway init`), then from the repository root `railway link`.
2. **Shared variables** (Project Settings → Shared Variables). Both services reference them, so the API and worker can never disagree:
   | Name | Value |
   | --- | --- |
   | `BETTER_AUTH_URL` | Public **web** origin (Vercel), e.g. `https://app.example.com`, with no trailing slash |
   | `WEB_ORIGINS` | Same origin (comma-separated if several) |
   | `BETTER_AUTH_SECRET` | Generated secret (**seal** it) |
   | `ENCRYPTION_KEY` | Generated key (**seal** it) |
3. `railway config plan` (read-only). Review that it creates `Postgres`, `Redis`, `fleqo-api` and `fleqo-worker` with the settings in §3.2. Variable values print as `«hidden»`.
4. `railway config apply` and confirm. **This creates billable resources; it is the step that needs your approval.**
5. `fleqo-api` → Settings → Networking → **Generate Domain** (generated domains are not part of IaC). Vercel's `API_URL` and external webhook senders use it. If you use a custom domain, add it to the `domains` key of `fleqo-api` instead.
6. Optional API secrets (OAuth §3.5, email [email.md](./email.md)) are set on the `fleqo-api` service and kept by `preserve()` in the file. Never put them in the file.
7. Redis check: `redis-cli -u "$REDIS_URL" CONFIG GET maxmemory-policy` must print `noeviction` (Redis's default; BullMQ requires it). Run it with `railway connect Redis` or from a service shell.

Later changes: edit `.railway/railway.ts`, run `npm run railway:check`, then `railway config plan` and `railway config apply`. Code changes still deploy automatically on push to `main`.

### 3.2 Service settings (also the dashboard-only equivalent)
If you prefer not to use IaC, configure these by hand in each service's Settings; the result is identical.

| Setting | `fleqo-api` | `fleqo-worker` |
| --- | --- | --- |
| Source | GitHub `shariardipto/Fleqo`, branch `main`, root directory = repository root | same |
| Builder | Dockerfile `apps/api/Dockerfile` (built from the repository root; dashboard alternative: variable `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`) | same image |
| Watch paths | `apps/api/**`, `package.json`, `package-lock.json` | same |
| Start command | `node dist/server.js` | `node dist/worker.js` |
| Pre-deploy command | `npx prisma migrate deploy` (failure stops the deploy) | none |
| Healthcheck | `/api/ready`, timeout 60 s (deploy-time only on Railway) | none (optional `/health`, see below) |
| Restart policy | On failure, max 5 | Always |
| Draining (SIGTERM → SIGKILL) | 15 s | 30 s, so in-flight jobs finish |
| Public networking | Generated or custom domain | none |
| Variables | [`deploy/env/api.production.env.example`](../deploy/env/api.production.env.example) | [`deploy/env/worker.production.env.example`](../deploy/env/worker.production.env.example) |

- `DATABASE_URL`/`REDIS_URL` reference the database services (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`), which use Railway's private network.
- **Private network and IPv6:** Railway environments created before 2025-10-16 resolve private hosts over IPv6 only, and ioredis looks up IPv4 by default (`ENOTFOUND redis.railway.internal`). Fleqo's Redis connections set `family: 0` (dual stack), so this works in old and new environments ([Railway troubleshooting](https://docs.railway.com/databases/troubleshooting/enotfound-redis-railway-internal)).
- Do **not** set `NODE_TLS_REJECT_UNAUTHORIZED` (the API refuses to start with `0`). `PORT` is injected by Railway.
- Worker health endpoint (optional): set `PORT=8080` and `WORKER_HEALTH_PORT=8080` on the worker and add `healthcheckPath: "/health"` to its `deploy` block.
- Scaling: more worker replicas are safe (run leases and action states guarantee single execution). `WORKER_CONCURRENCY` (default 5) is per replica.

### 3.3 Services created earlier with `railway.json`
If services were created from the old JSON files, move them before 2026-12-01: run `railway config migrate` (Railway's guided migration), or clear each service's **Config file path** setting by hand. Then run `railway config plan`; it refuses to plan while a service is still managed by Config as Code. Since Fleqo removed the JSON files, a service still pointing at them would build with Railway's defaults.

### 3.4 Migrations — safety rules
- The release step runs `prisma migrate deploy`. It only applies **pending, committed** migrations in order; it never resets, never generates SQL and never drops data on its own. If it fails, Railway does not switch traffic to the new deployment.
- Never run `prisma migrate dev`, `migrate reset` or `db push` against production.
- Before a deploy that contains a migration: take a backup (§6) and run `npx prisma migrate status` locally with the production URL (read-only).
- Schema changes follow **expand → migrate → contract**: add nullable columns or tables first, deploy code that writes both, backfill, and only later remove old columns. Each deploy then stays compatible with the previous app version, so app rollback (§7) stays possible.
- CI blocks merges whose `schema.prisma` differs from the migrations (`migrate diff --exit-code`).

### 3.5 Google and GitHub sign-in (optional)
OAuth callbacks go to the **web** origin (Vercel), which proxies `/api/*` to the API, **never** to the Railway domain. With `BETTER_AUTH_URL=https://app.example.com` the values to register are exactly:

| Provider | Field | Value |
| --- | --- | --- |
| Google (OAuth client, type *Web application*) | Authorized JavaScript origins | `https://app.example.com` |
| | Authorized redirect URIs | `https://app.example.com/api/auth/callback/google` |
| GitHub (OAuth App) | Homepage URL | `https://app.example.com` |
| | Authorization callback URL | `https://app.example.com/api/auth/callback/github` |

Replace `app.example.com` with your real web host (custom domain or `<project>.vercel.app`). The value must match `BETTER_AUTH_URL` exactly: `https`, no trailing slash, no `www.` difference. Vercel preview URLs change per deployment and cannot complete OAuth. Then set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` on `fleqo-api` only (seal the secrets) and redeploy it. Step-by-step console instructions and the live verification checklist: [social-auth.md](./social-auth.md).

### 3.6 Email verification and password reset (optional)
Set `EMAIL_PROVIDER=resend`, `EMAIL_FROM` (an address on a domain verified in Resend) and `RESEND_API_KEY` (sealed) on `fleqo-api`. Prove that a password-reset email arrives, then set `REQUIRE_EMAIL_VERIFICATION=true` so public registration needs a verified address. DNS records, rollout order and the security design: [email.md](./email.md).

## 4. Vercel (web)
1. Add New Project → import the repository.
2. **Root Directory:** `apps/web`. Framework preset: **Next.js**. Keep the default install command; Vercel detects the npm workspace at the repository root. Build command `next build`.
3. Environment variables (Production and Preview): **`API_URL=https://<railway-api-domain>`** and **`NEXT_PUBLIC_SITE_URL=https://<your-web-domain>`** (canonical, Open Graph and sitemap URLs of the public landing page). Both are read at **build** time (`next.config.ts` rewrites, metadata), so **redeploy after changing them**. No OAuth secret ever goes into Vercel.
4. Deploy. Production builds send CSP, HSTS, Permissions-Policy, X-Frame-Options and nosniff headers, and no `X-Powered-By`.
5. Custom domain (optional): add it in Vercel, then update the `BETTER_AUTH_URL` and `WEB_ORIGINS` shared variables in Railway and redeploy both services, update `NEXT_PUBLIC_SITE_URL` on Vercel, and add the new redirect URIs at each OAuth provider. DNS changes are yours to make.
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

1. `https://<vercel-domain>/` (landing page) and `/sign-in` load over HTTPS. Response headers include CSP, HSTS and X-Frame-Options; no `X-Powered-By`. View source: the canonical and `og:url` use `NEXT_PUBLIC_SITE_URL`; `/robots.txt` and `/sitemap.xml` point to the same domain.
2. `https://<api-domain>/api/health` → 200 and `/api/ready` → `{"database":"connected","redis":"connected"}`.
3. Railway pre-deploy log shows `prisma migrate deploy` succeeded.
4. **Smoke test** from your machine: `npm run smoke -- --base-url https://<vercel-domain>` → 13/13. It creates a throwaway tenant, sends signed events, waits for the worker, and checks duplicates and signature rejection.
5. Worker logs show `Job completed` for the smoke test's runs.
6. **E2E against production** (creates throwaway users): `E2E_BASE_URL=https://<vercel-domain> npm run test:e2e`. It covers registration and auth, roles, invite links, import, workflow, retries, dead letter and manual retry, execution logs, mobile layout and **no browser console errors**.
7. **Proxy check:** in the API logs for your own request, `clientIp` must equal your public IP (not a Vercel or Railway address). If it shows a proxy address, adjust `TRUST_PROXY` (1 or 3) and redeploy.
8. **Cookie check:** in the browser devtools, the session cookie is `__Secure-better-auth.session_token`, `HttpOnly`, `Secure`, `SameSite=Lax`, on the Vercel domain.
9. **Email** (if configured): `/sign-in` shows **Forgot password?**; a reset email arrives within a minute and the link works once. With `REQUIRE_EMAIL_VERIFICATION=true`, a new sign-up shows "Check your inbox" and the emailed link signs the user in ([email.md §3](./email.md#3-setting-up-resend-owner)).
10. **Social sign-in** (only for providers you configured): `/sign-in` shows exactly those buttons; then run the live checklist in [social-auth.md §6](./social-auth.md#6-live-verification-checklist-needs-real-credentials) and mark a provider as live-verified only after it passes.
11. Optional: run `npm run smoke` with `--base-url https://<api-domain> --origin https://<vercel-domain>` to exercise the public API domain directly.
12. Record the results in `docs/production-test-results.md` (new "Live" section) with the deployment IDs.

## 9. Troubleshooting
| Symptom | Likely cause |
| --- | --- |
| `Invalid origin` / 403 on sign-in | `WEB_ORIGINS`/`BETTER_AUTH_URL` on the API do not exactly match the browser origin (scheme, host, no trailing slash) |
| API exits at start with "Unsafe production configuration" | Non-HTTPS origin or `NODE_TLS_REJECT_UNAUTHORIZED=0` — fix the variable |
| `/api/ready` reports `redis: unavailable` | `REDIS_URL` wrong, TLS (`rediss://`) mismatch, or Redis down. Events are still accepted (outbox) and processed once Redis is back |
| Runs stay `queued` | Worker not running or on a different `QUEUE_PREFIX`/`REDIS_URL` from the API |
| All users rate-limited together | `TRUST_PROXY` too low (every request looks like it comes from the proxy IP) |
| Web calls go to localhost | `API_URL` was not set at Vercel **build** time — set it and redeploy |
| Provider shows `redirect_uri_mismatch` | The provider's registered redirect URI is not exactly `<BETTER_AUTH_URL>/api/auth/callback/<provider>` |
| Social button missing | The provider's variables were set on the worker or Vercel instead of the API service, or the API was not redeployed after adding them |
| Canonical / OG URLs show `localhost` | `NEXT_PUBLIC_SITE_URL` was not set at Vercel build time |
| Deploy log says "Config as Code (railway.json / railway.toml) is deprecated" | The service still points at a config file path; clear it or run `railway config migrate` (§3.3) |
| `railway config plan` stops and names a service to migrate | Same cause as above |
| `ENOTFOUND redis.railway.internal` / `postgres.railway.internal` | Service and database are in different environments, or `REDIS_URL` is hard-coded instead of a reference. (The IPv6-only case is already handled by `family: 0`) |
| API exits with "Invalid email configuration" | `EMAIL_PROVIDER` without `EMAIL_FROM`, `resend` without `RESEND_API_KEY`, or `REQUIRE_EMAIL_VERIFICATION=true` without a provider |
| Reset/verification emails never arrive | Resend domain not verified yet (Resend then only delivers to your own address), or the API log shows `Email could not be sent` with the HTTP status |
| "Forgot password?" missing on `/sign-in` | No `EMAIL_PROVIDER` on the API service (the link is shown only when emails can be sent) |
