# Fleqo — $0/month Demo Deployment

**Vercel Hobby + Render Free (API and worker in one container) + Neon Free + Render Free Key Value**

For a low-traffic portfolio demo that may sleep when nobody uses it. It is **not** a production setup: for production, keep the separate API and worker services in [deployment.md](./deployment.md), which this document does not change. Facts about the free tiers were checked against the providers' documentation on 2026-11-01 (links in §2).

**Live:** [fleqo-web.vercel.app](https://fleqo-web.vercel.app) runs this setup, with email and password sign-in only (no OAuth providers or email service configured).

## 1. Architecture

```
Browser ──▶ Vercel Hobby (Next.js, apps/web) ──rewrite /api/*──▶ Render Free Web Service "fleqo-demo"
                                                                 node dist/single-service.js
                                                                 ├─ 1. migrations (only when pending)
                                                                 ├─ 2. API     dist/server.js  (PORT 10000, /api/health)
                                                                 └─ 3. worker  dist/worker.js  (lower CPU priority)
                                                                      │                         │
                                              Neon Free PostgreSQL (TLS, direct connection)   Render Free Key Value
                                                                                               (same region, noeviction)
```
- **Same image as production** (`apps/api/Dockerfile`); only the Docker Command differs. `dist/single-service.js` ([source](../apps/api/src/single-service.ts)) is a small supervisor that runs the unchanged `server.js` and `worker.js` as two child processes.
- **Startup:** it compares the migrations in the image with `_prisma_migrations` (about 1.5 s on 0.1 CPU). Only when something is pending does it run `prisma migrate deploy` with the bundled CLI (about 20–25 s on 0.1 CPU). Then it starts the API, waits until it answers, and starts the worker at a lower CPU priority (nice 10), so visitors' requests win the CPU.
- **Database waking up:** the migration step is retried 5 times (3, 6, 9, 12 s apart), which covers Neon resuming from scale-to-zero. If it still fails, the service exits before taking traffic, so a deploy fails and the previous version keeps running.
- **Overlapping deploys:** Render starts the new instance before stopping the old one. Prisma's migration advisory lock prevents concurrent migrations.
- **Crashes:** a child that exits unexpectedly is restarted after 1, 2, 4, 8 or 16 s. After 6 crashes within 5 minutes, the supervisor stops everything with exit code 1, so Render restarts the whole service.
- **Shutdown:** on `SIGTERM` (spin-down, redeploy) both children get it at once and have 25 s before `SIGKILL`; Render's own limit is 30 s. The worker finishes jobs in progress; anything unfinished is picked up after the next start (outbox + recovery sweep).

## 2. The free tiers and what they mean for Fleqo
| Service | Free-tier facts | Consequence |
| --- | --- | --- |
| [Render Free web service](https://render.com/docs/free) | 0.1 CPU, 512 MB ([compute plans](https://render.com/docs/compute-plans)); spins down after **15 minutes without inbound traffic**; waking takes about a minute; 750 instance hours per workspace per month; may be restarted at any time; no pre-deploy command ([deploys](https://render.com/docs/deploys)); outbound SMTP ports blocked | The whole backend sleeps, **including the worker**: no background processing while asleep. The first request after a pause waits for the wake-up. Migrations run at start instead of pre-deploy. Email must use HTTPS (Resend), which Fleqo already does |
| [Render Free Key Value](https://render.com/docs/key-value) | 25 MB, 50 connections, Valkey 8; **no persistence**; may be restarted at any time (data lost); one per workspace | Queue contents can vanish. Fleqo's PostgreSQL outbox re-dispatches unfinished runs (tested in §6). Fleqo uses 4 connections and at most about 7 MB |
| [Neon Free](https://neon.com/docs/introduction/plans) | 1 GB storage per project; 100 CU-hours per month (~400 h at 0.25 CU); **scales to zero after 5 minutes idle (cannot be disabled)**; 97 direct connections at 0.25 CU ([pooling](https://neon.com/docs/connect/connection-pooling)); TLS with publicly trusted certificates ([connect securely](https://neon.com/docs/connect/connect-securely)) | While the Render service is awake, the worker's outbox poll keeps Neon awake too; both sleep together. Prisma Migrate needs the **direct** (non-pooled) connection string ([Neon + Prisma](https://neon.com/docs/guides/prisma)) |
| [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Non-commercial personal use only; proxied requests to an external origin time out after **120 s** ([limits](https://vercel.com/docs/limits)) | While the backend wakes (about a minute plus Fleqo's own start, §6), Render can answer the first requests with an immediate 502 page instead of holding them (seen on the live demo). The first sign-in after a pause may therefore fail; warm the backend first (§3.6) |

## 3. Manual deployment (exact settings)
Create everything in **one region** for Render (e.g. Oregon), and pick the nearest Neon region (e.g. AWS US West 2 for Oregon).

### 3.1 Neon (PostgreSQL)
1. Create a project (PostgreSQL 17) in the region closest to your Render region.
2. Dashboard → **Connect** → choose the database and role, set **Connection pooling: off**, and copy the connection string. It looks like `postgresql://neondb_owner:…@ep-…-….us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`. Use it unchanged as `DATABASE_URL`.
   - Direct, not pooled: Prisma Migrate needs a direct connection, and Fleqo opens only a handful of connections (§6), far below the free limit.

### 3.2 Render Key Value (Free)
New → **Key Value** → instance type **Free**, same region as the web service, **Maxmemory Policy: `noeviction`**. Copy the **Internal Key Value URL** (`redis://red-…:6379`).

### 3.3 Render Web Service `fleqo-demo` (Free)
New → **Web Service** → the GitHub repository, branch `main`, runtime **Docker**, instance type **Free**.

| Setting | Value |
| --- | --- |
| Root Directory | *(empty: repository root)* |
| Dockerfile Path | `apps/api/Dockerfile` |
| Docker Command | **`node dist/single-service.js`** |
| Pre-Deploy Command | *(not available on Free; the service migrates at start)* |
| Health Check Path | `/api/health` |
| Auto-Deploy | On commit (default) |
| Environment | From [`deploy/demo/render-single-service.env.example`](../deploy/demo/render-single-service.env.example): `NODE_ENV=production`, `DATABASE_URL` (Neon, direct), `REDIS_URL` (Key Value, internal), `QUEUE_PREFIX=fleqo`, `BETTER_AUTH_URL` and `WEB_ORIGINS` (your Vercel URL), `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `TRUST_PROXY=2`, `WORKER_CONCURRENCY=2`, `DISPATCH_POLL_MS=5000`, `DB_TRANSACTION_TIMEOUT_MS=30000`, `DB_TRANSACTION_MAX_WAIT_MS=10000`, `DEMO_MIGRATE_ON_START=true` |

Do not set `PORT` (Render sets 10000) or `WORKER_HEALTH_PORT`. Generate the two secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

### 3.4 Vercel Hobby (web)
New Project → the repository → **Root Directory `apps/web`**, framework **Next.js**. Environment variables: `API_URL=https://fleqo-demo.onrender.com` (your Render URL) and `NEXT_PUBLIC_SITE_URL=https://<project>.vercel.app`. Deploy. Then make sure `BETTER_AUTH_URL`/`WEB_ORIGINS` on Render are exactly this Vercel URL, with no trailing slash.

### 3.5 First deploy and check
1. The first Render deploy applies the migrations (the log shows `Applying migrations` then `Migrations applied`), then `API and worker running`.
2. `https://<render-url>/api/health` → 200 and `/api/ready` → database and Redis connected.
3. From your machine: `npm run smoke -- --base-url https://<project>.vercel.app` → 13/13.
4. Sign up in the browser, connect the mock services, create the workflow and send simulated orders from **Demo data**.

### 3.6 Before showing the demo
The backend sleeps after 15 minutes. About two minutes beforehand, open `https://<render-url>/api/health` and reload until it returns 200; a 502 page in the meantime only means the instance is still spinning up. The landing page is static on Vercel and loads instantly even while the backend sleeps; only signing in and the app need the API.

## 4. Configuration reference
| Variable | Demo value | Why |
| --- | --- | --- |
| `DEMO_MIGRATE_ON_START` | `true` | Migrations at start (pre-deploy is unavailable). With `false`, run `DATABASE_URL="<Neon direct URL>" npm run db:deploy` from your machine before every deploy that adds a migration |
| `WORKER_CONCURRENCY` | `2` | 0.1 CPU; more parallel jobs only add contention |
| `DISPATCH_POLL_MS` | `5000` | Outbox safety-net poll; events are normally queued immediately. Fewer polls means less CPU |
| `DB_TRANSACTION_TIMEOUT_MS` / `DB_TRANSACTION_MAX_WAIT_MS` | `30000` / `10000` | On 0.1 CPU, sign-up (password hashing plus several queries) took 7.8 s in testing, longer than Prisma's 5 s default. Production keeps the defaults |
| `TRUST_PROXY` | `2` | Vercel's proxy and Render's load balancer; verify with `clientIp` in the logs ([deployment.md §8](./deployment.md#8-production-verification)) |

## 5. Limitations
- **No background processing while asleep.** A request that arrives while the service sleeps starts the wake-up but may itself get a 502 or time out, so external webhook senders must retry. The in-app simulator is the intended way to demo.
- **Slow on 0.1 CPU.** A wake-up is Render's own spin-up (about a minute) plus about 20 s for Fleqo (§6); the very first deploy adds about 20 s for the migration. Sign-in and sign-up take a few seconds (password hashing). Runs are fast once awake (40 runs with retries in 7 s in testing).
- **Key Value is volatile and small (25 MB).** A restart loses queued jobs (recovered from PostgreSQL within about 3 minutes in testing) and BullMQ's job history; Fleqo's own run history is in PostgreSQL and unaffected. At ~0.9 KB per retained job, the default retention needs about 7 MB. With `noeviction`, a full instance would reject new jobs instead of dropping old ones, and the outbox would retry them.
- **Neon compute hours.** The database stays awake as long as the Render service is awake. Long sessions consume the 100 CU-hours; Neon suspends compute for the rest of the month if they run out.
- **Render instance hours and suspensions.** 750 hours per workspace per month are shared with other free services. Render may suspend free services that generate unusually high outbound traffic; the demo's database traffic is small.
- **Single instance.** The API and worker share 0.1 CPU and 512 MB. No horizontal scaling and no pre-deploy migrations.
- **Vercel Hobby** is for non-commercial use only.
- **Email and OAuth** work as in production (Resend over HTTPS; callbacks on the Vercel URL), but Render Free blocks SMTP, so only HTTPS email providers work.

## 6. Measured results (local emulation of the free tiers)
The production image ran with `node dist/single-service.js` under Render Free's limits (`--cpus 0.1 --memory 512m`, no swap, `PORT=10000`). The database was PostgreSQL 17 with TLS and a Neon-style URL (no port, `sslmode=require&channel_binding=require`, certificate signed by a test CA trusted via `NODE_EXTRA_CA_CERTS`, as Neon's are publicly trusted). Key Value was Valkey 8 with `--maxmemory 25mb --maxmemory-policy noeviction`, no persistence, 50 clients. Values from the demo template. Real Render/Neon timings will differ; Render's own wake-up (about a minute) comes on top.

| Check | Result |
| --- | --- |
| First start on an empty database (migration applied) | `/api/health` 200 after **36–40 s** (migration 19–20 s); worker running 1.5 s later |
| Wake-up start, nothing to migrate (fast check) | `/api/health` 200 after **19.8 s**; schema check **0.8 s** instead of ~20 s for the Prisma CLI |
| Same with `DEMO_MIGRATE_ON_START=false` | 17.8 s |
| Memory, idle → peak under load | **145 MiB → 190 MiB** of 512 MiB (container); RSS supervisor ~75 MB, API 113–148 MB, worker 117–127 MB (RSS counts shared pages in each process) |
| CPU while idle | ~0% of the 0.1-CPU quota |
| Smoke test | **13/13** |
| Jobs and retries: 20 orders with one injected Sheet failure + 20 clean orders | **40/40 succeeded in 7 s**; Sheet `x2` attempts for exactly the 20 failed ones; CRM step once per order (retries never repeat a completed action) |
| Database connections | 1 idle → **13 under load** (two pools of at most 10), all TLS; Neon Free allows 97 |
| Key Value | 4 clients; **~0.9 KB per retained job** plus a bounded event stream (~1.2 MB max), so the default retention (≤ 5000 completed jobs for 24 h) needs about 7 MB of the 25 MB |
| Key Value restart (queue wiped) with 10 runs waiting for retries | All recovered from the PostgreSQL outbox and **succeeded within 161 s**; 52 succeeded runs = 52 sheet rows; no CRM action repeated |
| Worker killed (`SIGKILL`) | Restarted by the supervisor; next 3 runs succeeded in 12 s |
| API killed (`SIGKILL`) | Answering again after **15.3 s** |
| PostgreSQL restarted (like a Neon compute restart) | No process crashed; the next runs succeeded in 4 s |
| Database unreachable for the first 12 s of a start | 2 retries (3 s, 6 s), then a normal start (healthy after 42.9 s) |
| Crash loop (worker killed 6 times) | 5 restarts with backoff, then `The worker keeps crashing…` and **exit code 1** |
| `SIGTERM` with 5 runs in flight (`docker stop -t 30`) | Stopped in **0.6 s**, exit code 0; the 5 runs finished after the next start |
| `/api/ready` on 0.1 CPU | 9/10 OK while idle; can report `redis: unavailable` briefly after a database reconnect (cosmetic, §8) |
| Sign-up on 0.1 CPU without the raised transaction timeout | **Failed** (`FAILED_TO_CREATE_USER`: the transaction took 7.8 s, Prisma's limit is 5 s). Fixed by `DB_TRANSACTION_TIMEOUT_MS=30000` (smoke 13/13 above) |

## 7. Moving to production
Nothing in this demo setup changes the production architecture. Use [deployment.md](./deployment.md): a Render Web Service with Docker Command empty (`node dist/server.js`) and Pre-Deploy Command `npm run db:deploy`, a separate Background Worker with `node dist/worker.js`, paid Postgres and Key Value with persistence, and the default `DB_TRANSACTION_*`/`DISPATCH_POLL_MS` values.

## 8. Troubleshooting
| Symptom | Likely cause |
| --- | --- |
| First request after a pause hangs for about a minute, or returns a 502 page (sign-in fails) | The service was asleep and is still waking; expected on Render Free. Retry after 1–2 minutes (§3.6) |
| `ROUTER_EXTERNAL_TARGET_ERROR` from Vercel | The backend took more than 120 s to answer (wake-up plus a migration on the first deploy). Reload once it is up |
| Log: `Migration step failed; retrying` | Neon was resuming or unreachable; it retries 5 times, then the service exits |
| Log: `The worker keeps crashing; stopping…` | The worker crashed 6 times in 5 minutes; check the lines before it (often `REDIS_URL` or Key Value region) |
| Worker log: `IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"` | Key Value Maxmemory Policy is not `noeviction` |
| Sign-up fails with `FAILED_TO_CREATE_USER` and the log mentions an expired transaction | `DB_TRANSACTION_TIMEOUT_MS` is not set (Prisma's 5 s default is too short on 0.1 CPU) |
| `/api/ready` reports `redis: unavailable` while everything works | Its ping has a 1 s limit; on a starved 0.1 CPU the reply can arrive late. Render's health check uses `/api/health`, so this does not take the service down |
| `prisma:error … P1001` / TLS errors | `DATABASE_URL` is not Neon's direct connection string with `sslmode=require` |
