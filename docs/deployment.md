# Fleqo — Production Deployment Guide (Render + Vercel)

**Status (2026-11-01): prepared, NOT deployed.** Every artifact below was verified locally (production Docker image, migrations from an empty database, health checks, smoke test). Render facts were checked against Render's documentation on 2026-11-01 (links inline). Nothing here has been provisioned, purchased or published.

## 1. Architecture

```
Browser ──HTTPS──▶ Vercel (Next.js, apps/web) ──rewrite /api/*──▶ Render Web Service "fleqo-api"  (node dist/server.js)
                                                                        │   ▲
External webhook senders ──HTTPS──▶ Render "fleqo-api" /api/webhooks    │   │ outbox / jobs
                                                                        ▼   │
                                       Render Postgres   ◀──── Render Background Worker "fleqo-worker" (node dist/worker.js)
                                       Render Key Value  ◀────┘   (Redis-compatible, used by BullMQ)
```
- One Docker image (`apps/api/Dockerfile`, built from the repository root) serves both Render services; only the start command differs.
- Browsers only talk to the Vercel origin. `/api/*` is proxied, so Better Auth cookies are first-party: no cross-site cookies, no wildcard CORS.
- PostgreSQL is the source of truth (events, runs, outbox, destination records). Key Value carries BullMQ jobs and can be rebuilt from the outbox (see §6).
- All Render resources must be in the **same region and workspace**: internal database URLs only work there ([Render private network](https://render.com/docs/private-network)).

## 2. Prerequisites (owner)
- GitHub repository `shariardipto/Fleqo` with this code pushed, connected to Render and Vercel.
- Render and Vercel accounts. Plans and costs are your decision. Plan limits that matter for Fleqo ([Render free instances](https://render.com/docs/free)):
  - **Background workers have no free instance type**, so `fleqo-worker` needs a paid instance.
  - The **pre-deploy command** (used for migrations) is available only on paid services ([deploys](https://render.com/docs/deploys)). A free-tier alternative is in §3.3.
  - A free web service **spins down after 15 minutes without traffic** and takes about a minute to wake: webhooks and the first page load wait.
  - Free Postgres **expires 30 days after creation** and has no backups; free Key Value **does not persist data** across restarts. Use paid instances for anything you want to keep.
  - Free web services cannot use SMTP ports. Fleqo sends email over HTTPS (Resend), so this does not affect it.
- Generate two secrets locally and store them **only** in Render:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # BETTER_AUTH_SECRET
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
  ```
  **Back up `ENCRYPTION_KEY`** in a password manager: losing it makes stored webhook secrets unrecoverable (they can be rotated, see §7).

## 3. Render (API, worker, Postgres, Key Value)
Create everything by hand in the Render dashboard, in one region, in this order.

### 3.1 Data services
1. **Postgres**: New → Postgres (PostgreSQL 16 or newer). After it is ready, copy the **Internal Database URL** for the services. Keep the **External Database URL** for running migrations or backups from your own machine; external connections require `sslmode=require` ([Postgres connections](https://render.com/docs/postgresql-creating-connecting)).
2. **Key Value**: New → Key Value. Set **Maxmemory Policy** to **`noeviction`**. Render recommends it for job queues, and eviction would silently drop BullMQ jobs; the Blueprint spec lists `allkeys-lru` as the default, so check the field ([Key Value](https://render.com/docs/key-value)). On a paid instance, enable persistence (Render recommends *Journal + Snapshot* for non-caching use). Copy the **Internal Key Value URL** (`redis://…`). Internal connections need no password by default and stay on Render's private network.

### 3.2 Environment Group (shared by API and worker)
Env Groups → New → `fleqo-shared`, then link it to both services. Then the API and worker can never disagree about secrets or origins ([environment groups](https://render.com/docs/configure-environment-variables)):

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `QUEUE_PREFIX` | `fleqo` |
| `DATABASE_URL` | Postgres **Internal Database URL** |
| `REDIS_URL` | Key Value **Internal Key Value URL** |
| `BETTER_AUTH_URL` | Public **web** origin (Vercel), e.g. `https://app.example.com`, with no trailing slash |
| `WEB_ORIGINS` | Same origin (comma-separated if several) |
| `BETTER_AUTH_SECRET` | Generated secret |
| `ENCRYPTION_KEY` | Generated key |
| `WORKFLOW_MAX_ATTEMPTS` / `WORKFLOW_BACKOFF_MS` | `4` / `2000` |

A variable set on a service overrides the same name in a linked group. Changing a group redeploys every linked service that has auto-deploy on. Render also passes environment variables to Docker builds as build arguments. Fleqo's Dockerfile declares no `ARG`s, so nothing is baked into the image.

### 3.3 Web Service `fleqo-api`
New → Web Service → the repository, branch `main`, runtime **Docker**.

| Setting | Value |
| --- | --- |
| Root Directory | *(empty: repository root)* |
| Dockerfile Path | `apps/api/Dockerfile` |
| Docker build context (if the form shows the field) | *(empty or `.`: the repository root, Render's default, which the Dockerfile needs)* |
| Docker Command | *(empty: the image's `CMD` is `node dist/server.js`)* |
| Pre-Deploy Command | **`npm run db:deploy`** (paid instances): runs `prisma migrate deploy` with the Prisma CLI inside the image. It runs after the build, before traffic moves; if it fails, the deploy fails and the previous version keeps serving. Do not use `npx prisma …`: outside `/app` it silently downloads the newest Prisma release instead (seen in testing: `prisma@8.0.0-rc.29`) |
| Health Check Path | **`/api/health`** (see below) |
| Environment | Link `fleqo-shared`, then add the API-only variables from [`deploy/env/api.production.env.example`](../deploy/env/api.production.env.example): `FLEQO_SERVICE=fleqo-api`, `TRUST_PROXY=2`, rate limits, `WEBHOOK_TOLERANCE_SECONDS`, and optionally OAuth (§3.6) and email (§3.7) |
| Auto-Deploy | On commit to `main` (Render's default) |

- **Why `/api/health` and not `/api/ready`:** Render health-checks every few seconds for the service's whole life. After 15 s of failures it stops routing traffic, and after 60 s it restarts the instance ([health checks](https://render.com/docs/health-checks)). `/api/ready` answers 503 while Redis is down, but Fleqo is designed to keep accepting webhooks then (the outbox stores them). Use `/api/ready` for your own uptime monitoring instead (§5).
- `PORT` is set by Render (default `10000`); the API binds to it on all interfaces. Do not set `PORT` or `NODE_TLS_REJECT_UNAUTHORIZED` (the API refuses to start with `0`).
- Shutdown: Render sends `SIGTERM` and, after a default 30 s, `SIGKILL` ([deploys](https://render.com/docs/deploys)). The API drains well within that.
- **Free instance (no pre-deploy command):** either run migrations from your machine before each deploy that contains one (from the repository root: `DATABASE_URL="<External Database URL>?sslmode=require" npm run db:deploy`; make sure the variable is set, or the local `apps/api/.env` database is migrated instead), or set the Docker Command to `sh -c "npm run db:deploy && exec node dist/server.js"`. With the latter, a failed migration stops the new instance from starting, so the deploy fails and the previous version keeps running.
- After the first deploy, note the service URL (`https://<name>.onrender.com`). Vercel's `API_URL` and external webhook senders use it. A custom domain is optional.

### 3.4 Background Worker `fleqo-worker`
New → Background Worker → same repository and branch, runtime **Docker**, **paid instance** (no free type).

| Setting | Value |
| --- | --- |
| Dockerfile Path / build context | Same as the API (`apps/api/Dockerfile`, repository root) |
| Docker Command | `node dist/worker.js` |
| Pre-Deploy Command | *(none: the API runs migrations)* |
| Environment | Link `fleqo-shared`, then add [`deploy/env/worker.production.env.example`](../deploy/env/worker.production.env.example): `FLEQO_SERVICE=fleqo-worker`, `WORKER_CONCURRENCY`, `DISPATCH_POLL_MS`, `RUN_LEASE_MS`. No OAuth or email variables |

- Background workers receive no inbound traffic and Render does not health-check them, so `WORKER_HEALTH_PORT` is not needed. Watch the worker's logs (§5).
- The default 30 s shutdown delay lets in-flight jobs finish. If needed, the delay (1–300 s, `maxShutdownDelaySeconds`) can be changed through the Render API.
- Scaling: more worker instances are safe (run leases and action states guarantee single execution). `WORKER_CONCURRENCY` (default 5) is per instance.

### 3.5 Migrations — safety rules
- The pre-deploy step runs `prisma migrate deploy`. It only applies **pending, committed** migrations in order; it never resets, never generates SQL and never drops data on its own. If it fails, Render keeps the previous deploy live.
- Never run `prisma migrate dev`, `migrate reset` or `db push` against production.
- Before a deploy that contains a migration: take a backup (§6) and run `npx prisma migrate status` locally with the External Database URL (read-only).
- Schema changes follow **expand → migrate → contract**: add nullable columns or tables first, deploy code that writes both, backfill, and only later remove old columns. Each deploy then stays compatible with the previous app version, so app rollback (§7) stays possible.
- CI blocks merges whose `schema.prisma` differs from the migrations (`migrate diff --exit-code`).

### 3.6 Google and GitHub sign-in (optional)
OAuth callbacks go to the **web** origin (Vercel), which proxies `/api/*` to the API, **never** to the `onrender.com` domain. With `BETTER_AUTH_URL=https://app.example.com` the values to register are exactly:

| Provider | Field | Value |
| --- | --- | --- |
| Google (OAuth client, type *Web application*) | Authorized JavaScript origins | `https://app.example.com` |
| | Authorized redirect URIs | `https://app.example.com/api/auth/callback/google` |
| GitHub (OAuth App) | Homepage URL | `https://app.example.com` |
| | Authorization callback URL | `https://app.example.com/api/auth/callback/github` |

Replace `app.example.com` with your real web host (custom domain or `<project>.vercel.app`). The value must match `BETTER_AUTH_URL` exactly: `https`, no trailing slash, no `www.` difference. Vercel preview URLs change per deployment and cannot complete OAuth. Then set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` on `fleqo-api` only. Step-by-step console instructions and the live verification checklist: [social-auth.md](./social-auth.md).

### 3.7 Email verification and password reset (optional)
Set `EMAIL_PROVIDER=resend`, `EMAIL_FROM` (an address on a domain verified in Resend) and `RESEND_API_KEY` on `fleqo-api`. Prove that a password-reset email arrives, then set `REQUIRE_EMAIL_VERIFICATION=true` so public registration needs a verified address. DNS records, rollout order and the security design: [email.md](./email.md).

## 4. Vercel (web)
1. Add New Project → import the repository.
2. **Root Directory:** `apps/web`. Framework preset: **Next.js**. Keep the default install command; Vercel detects the npm workspace at the repository root. Build command `next build`.
3. Environment variables (Production and Preview): **`API_URL=https://<name>.onrender.com`** (the `fleqo-api` URL) and **`NEXT_PUBLIC_SITE_URL=https://<your-web-domain>`** (canonical, Open Graph and sitemap URLs). Both are read at **build** time (`next.config.ts` rewrites, metadata), so **redeploy after changing them**. Template: [`deploy/env/web.production.env.example`](../deploy/env/web.production.env.example). No OAuth or email secret ever goes into Vercel.
4. Deploy. Production builds send CSP, HSTS, Permissions-Policy, X-Frame-Options and nosniff headers, and no `X-Powered-By`.
5. Custom domain (optional): add it in Vercel, then update `BETTER_AUTH_URL` and `WEB_ORIGINS` in the `fleqo-shared` group (both services redeploy), update `NEXT_PUBLIC_SITE_URL` on Vercel and redeploy it, and add the new redirect URIs at each OAuth provider. DNS changes are yours to make.
6. Preview deployments use different origins; they will fail Better Auth's origin checks unless you add them to `WEB_ORIGINS`. For previews, prefer a separate staging API.

## 5. Health checks, logging and basic observability
| Endpoint | Meaning | Used by |
| --- | --- | --- |
| `GET /api/health` | API process alive | Render health check |
| `GET /api/ready` | PostgreSQL **and** Redis reachable (503 otherwise) | Your uptime monitor |
| `GET /api/db-health` | PostgreSQL only | Diagnostics |

- Logs are structured JSON (pino) in each service's **Logs** tab. Useful fields: `service` (`fleqo-api`/`fleqo-worker`), `req.id`/`X-Request-Id` (also in every error response), `clientIp`, `res.statusCode`, `responseTime`, `component`.
- Searches worth saving: `"level":50` (errors); `"Enqueue failed"` (Redis trouble, outbox holding work); `"Recovered stale run"`; `"Job attempt failed"`; `"Dispatcher pass failed"`. For the worker, also check that `Fleqo worker started` appears after each deploy.
- In-app operations view: Dashboard → open dead letters and in-progress runs; Executions → filter `failed`.
- Recommended external uptime checks: `https://<vercel-domain>/sign-in` and `https://<name>.onrender.com/api/ready` every 1–5 minutes.
- Retention: BullMQ keeps completed jobs 24 h (max 5000) and failed jobs 7 days. `execution_log`/`audit_log` grow without limit in the MVP; plan a retention job before data volume matters.

## 6. Backup and recovery
- **PostgreSQL holds all business state.** Use a paid Render Postgres instance (free ones have no backups and expire), confirm its backup/restore options for your plan, and test a restore before launch.
- Manual logical backup (run from a trusted machine with the External Database URL; keep the file encrypted):
  ```bash
  pg_dump --format=custom --no-owner --dbname "$PROD_DATABASE_URL" --file fleqo-$(date +%F).dump
  ```
- Restore drill into a **new** database (never over production while it is live):
  ```bash
  createdb fleqo_restore_check   # or create a new Render Postgres instance
  pg_restore --no-owner --dbname "$RESTORE_DATABASE_URL" fleqo-YYYY-MM-DD.dump
  DATABASE_URL="$RESTORE_DATABASE_URL" npx prisma migrate status   # expect: up to date
  ```
- **Redis loss is recoverable by design:** unfinished runs whose jobs disappeared are re-dispatched from the PostgreSQL outbox by the worker's recovery sweep (verified: reliability S3/S5 and `recovery.test.ts`). After a Key Value restart, watch for `Recovered stale run` logs.
- Back up `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` separately from database backups.

## 7. Rollback
| Situation | Action |
| --- | --- |
| Bad web release | Vercel → Deployments → previous deployment → **Instant Rollback** |
| Bad API/worker release (no schema change) | Render → service → **Deploys** → an earlier successful deploy → **Rollback** (do API and worker together). A dashboard rollback turns auto-deploy off; turn it back on after the fix ([rollbacks](https://render.com/docs/rollbacks)) |
| Release with a migration | Migrations are forward-only. If expand/contract was followed, roll back the app only. Otherwise restore the pre-deploy backup into a new database, point `DATABASE_URL` (in `fleqo-shared`) at it and roll back |
| Leaked `BETTER_AUTH_SECRET` | Rotate it in `fleqo-shared` (all sessions are invalidated; users sign in again) |
| Leaked `ENCRYPTION_KEY` | Set a new key in `fleqo-shared`, then rotate every Mock Store signing secret (Connections → Rotate secret); old ciphertexts no longer decrypt |
| Stuck runs after an incident | Executions → filter `failed` → Retry (Admin/Owner); unfinished runs are re-dispatched automatically by the recovery sweep |

## 8. Production verification
Run after the deployment. Do not call the deployment complete until every item passes.

1. `https://<vercel-domain>/` (landing page) and `/sign-in` load over HTTPS. Response headers include CSP, HSTS and X-Frame-Options; no `X-Powered-By`. View source: the canonical and `og:url` use `NEXT_PUBLIC_SITE_URL`; `/robots.txt` and `/sitemap.xml` point to the same domain.
2. `https://<name>.onrender.com/api/health` → 200 and `/api/ready` → `{"database":"connected","redis":"connected"}`.
3. The `fleqo-api` deploy log shows the pre-deploy `prisma migrate deploy` succeeded (or you ran it yourself, §3.3).
4. **Smoke test** from your machine: `npm run smoke -- --base-url https://<vercel-domain>` → 13/13. It creates a throwaway tenant, sends signed events, waits for the worker, and checks duplicates and signature rejection.
5. Worker logs show `Job completed` for the smoke test's runs.
6. **E2E against production** (creates throwaway users): `E2E_BASE_URL=https://<vercel-domain> npm run test:e2e`. It covers registration and auth, roles, invite links, import, workflow, retries, dead letter and manual retry, execution logs, mobile layout and **no browser console errors**. (The password-reset spec runs only against an API with the `file` email transport, so it skips here.)
7. **Proxy check:** in the API logs for your own request, `clientIp` must equal your public IP (not a Vercel or Render address). Render does not document how many proxies sit in front of a service, so this check decides `TRUST_PROXY`: if a proxy address shows, adjust it (1 or 3) and redeploy.
8. **Cookie check:** in the browser devtools, the session cookie is `__Secure-better-auth.session_token`, `HttpOnly`, `Secure`, `SameSite=Lax`, on the Vercel domain.
9. **Email** (if configured): `/sign-in` shows **Forgot password?**; a reset email arrives within a minute and the link works once. With `REQUIRE_EMAIL_VERIFICATION=true`, a new sign-up shows "Check your inbox" and the emailed link signs the user in ([email.md §3](./email.md#3-setting-up-resend-owner)).
10. **Social sign-in** (only for providers you configured): `/sign-in` shows exactly those buttons; then run the live checklist in [social-auth.md §6](./social-auth.md#6-live-verification-checklist-needs-real-credentials) and mark a provider as live-verified only after it passes.
11. Optional: run `npm run smoke` with `--base-url https://<name>.onrender.com --origin https://<vercel-domain>` to exercise the API domain directly.
12. Record the results in `docs/production-test-results.md` (new "Live" section) with the deploy IDs.

## 9. Troubleshooting
| Symptom | Likely cause |
| --- | --- |
| `Invalid origin` / 403 on sign-in | `WEB_ORIGINS`/`BETTER_AUTH_URL` do not exactly match the browser origin (scheme, host, no trailing slash) |
| API exits at start with "Unsafe production configuration" | Non-HTTPS origin or `NODE_TLS_REJECT_UNAUTHORIZED=0`; fix the variable |
| Docker build fails with missing `package-lock.json` or workspace files | The build context is not the repository root; clear Root Directory / Docker Build Context Directory and keep Dockerfile Path `apps/api/Dockerfile` |
| Pre-deploy fails with `ENOENT … /package.json` | Render started the command outside the image's working directory; use `sh -c "cd /app/apps/api && npm run db:deploy"` |
| Worker log shows `IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"` | Key Value **Maxmemory Policy** was left at the default; set it to `noeviction` (§3.1) |
| Deploy cancelled after 15 minutes | The health check never passed: wrong Health Check Path, or the API crashed at start (check the logs for configuration errors) |
| `/api/ready` reports `redis: unavailable` | `REDIS_URL` wrong, Key Value in another region, or Key Value down. Events are still accepted (outbox) and processed once it is back |
| Jobs disappear under load | Key Value **Maxmemory Policy** is not `noeviction` |
| Runs stay `queued` | Worker not running, or a different `QUEUE_PREFIX`/`REDIS_URL` from the API (both should come from `fleqo-shared`) |
| Database connection refused from your machine | Use the **External** Database URL with `sslmode=require`; internal URLs only resolve inside Render |
| First request after a while takes ~1 minute | Free web service spin-down; use a paid instance for production |
| All users rate-limited together | `TRUST_PROXY` too low (every request looks like it comes from the proxy IP) |
| Web calls go to localhost | `API_URL` was not set at Vercel **build** time; set it and redeploy |
| Provider shows `redirect_uri_mismatch` | The provider's registered redirect URI is not exactly `<BETTER_AUTH_URL>/api/auth/callback/<provider>` |
| Social button missing | The provider's variables were set on the worker or Vercel instead of `fleqo-api`, or the API was not redeployed after adding them |
| Canonical / OG URLs show `localhost` | `NEXT_PUBLIC_SITE_URL` was not set at Vercel build time |
| API exits with "Invalid email configuration" | `EMAIL_PROVIDER` without `EMAIL_FROM`, `resend` without `RESEND_API_KEY`, or `REQUIRE_EMAIL_VERIFICATION=true` without a provider |
| Reset/verification emails never arrive | Resend domain not verified yet (Resend then only delivers to your own address), or the API log shows `Email could not be sent` with the HTTP status |
| "Forgot password?" missing on `/sign-in` | No `EMAIL_PROVIDER` on `fleqo-api` (the link is shown only when emails can be sent) |
