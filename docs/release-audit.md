# Fleqo v1.0 — Release Audit

**Date:** 2026-11-01 · **Scope:** release phases R1–R5 (R6 needs deployment approval) · **Baseline:** MVP M0–M8, uncommitted working tree on `master` (last commit `380fca2`).

Related documents: [security-audit.md](./security-audit.md) · [production-test-results.md](./production-test-results.md) · [deployment.md](./deployment.md) · [agent-progress.md](./agent-progress.md)

## 1. Method
1. Re-read `docs/AGENTS.md`, `README.md` and every document under `docs/`, then reviewed the API, worker, web app, Prisma schema and migrations, Dockerfile, Railway configs and CI workflow.
2. Read-only checks against the developer database: `prisma migrate status`, a drift check (`prisma migrate diff --from-config-datasource --to-schema`), and SQL integrity queries inside `BEGIN READ ONLY`.
3. Reproduced reported issues in a real browser (Playwright, light and dark mode, Owner and Member roles).
4. Every fix was verified by an automated test before moving on. Destructive and fault-injection tests used isolated databases and throwaway containers only (`fleqo_test`, `fleqo_e2e`, `fleqo-rel-*`, `fleqo-imgcheck-*`).

## 2. Findings and fixes

| ID | Area | Severity | Finding | Fix | Verified by |
| --- | --- | --- | --- | --- | --- |
| F1 | Web / Connections | Medium (UX) | "Active" badge next to a switch that **looks off**: (a) in dark mode the neutral theme's "on" colour is near-white; (b) for Members the switch was rendered disabled at 50 % opacity; (c) the label always read "Enabled", even for a disabled connection. **The state itself was correct** — `data-state` always matched the database. | `Switch` gains `tone="success"` (green on-state in both themes); the label follows the state; read-only roles get a "View only" note instead of a disabled switch; only the switch being saved is locked. Same treatment on the workflow detail page. | `e2e/connections-permissions.spec.ts` (state/label/badge agreement, contrast ≥ 3:1 and green track in light **and** dark, toggle round-trip, member view-only) |
| F2 | Auth / Invitations | **High** (security) | Invitations were listed **by email** (`GET /api/invitations`, and Better Auth's `/organization/list-user-invitations`). Emails are not verified in the MVP, so anyone could register an invitee's address, see the invitation and join the organization with the invited role. | Invite-link flow: the random invitation ID is the shared secret (Team page shows and copies the link, new `/invite/[id]` page). Email listing removed; Better Auth path disabled via `disabledPaths`. | `test/security.test.ts` (squatter gets 404 on both list endpoints, another user gets 403 on read/accept); `test/auth-tenancy.test.ts`; E2E invite-link test |
| F3 | API / CSRF | Medium | No server-side origin check on Fleqo's own cookie-authenticated mutations (relied on SameSite=Lax + CORS only). | `requireTrustedOrigin` middleware: POST/PATCH/PUT/DELETE carrying cookies must come from an `Origin` (or `Referer`) in `WEB_ORIGINS`. | `security.test.ts` (foreign origin → 403, missing origin → 403, trusted referer → 201, GET unaffected) |
| F4 | Webhooks / abuse | Medium | Webhook rate-limit key included the attacker-chosen `X-Fleqo-Connection-Id`, so rotating it bypassed the limit and forced a DB lookup per request. | Keyed by client IP only (`ipKeyGenerator`, IPv6-safe). | Code review + `webhooks.test.ts` still green |
| F5 | Worker / recovery | Medium | Stale-run recovery skipped any run whose BullMQ job *existed*. A job ending `failed`/`completed` while the DB run stayed unfinished (worker dying while recording its final attempt) would never be recovered. | Recovery checks the job **state**: only `waiting/active/delayed/prioritized/waiting-children` are left to BullMQ; `failed/completed/unknown` are re-dispatched. | `test/recovery.test.ts` (7 cases) |
| F6 | Config / TLS | **High** (environment) | `NODE_TLS_REJECT_UNAUTHORIZED=0` and `NODE_ENV=production` are present in the developer agent's process environment. | API/worker **refuse to start in production** with TLS verification disabled or non-HTTPS public origins (localhost excepted); a warning is printed in development. OS settings were **not** changed — see [security-audit.md §5](./security-audit.md#5-developer-environment-findings). | Production image refused both unsafe configs (`production-test-results.md` §6) |
| F7 | API / caching | Low | API responses had no `Cache-Control`; behind a CDN proxy, private JSON could in principle be cached. | `Cache-Control: no-store` on every `/api` response. | `security.test.ts`; header seen through the web proxy |
| F8 | Web / headers | Low | No CSP/HSTS/Permissions-Policy; `X-Powered-By: Next.js` exposed. | Production-only CSP (same-origin, `frame-ancestors 'none'`), HSTS, Permissions-Policy; `poweredByHeader: false`. | Headers inspected on the production build; all E2E pass with CSP and a console-error guard |
| F9 | Auth / data safety | Low | Better Auth exposes organization deletion to owners; it would cascade-delete the tenant's whole execution history and is not an MVP feature. | `disableOrganizationDeletion: true`. | `security.test.ts` |
| F10 | Docker | Low (cost) | Image was 1.34 GB (all devDependencies, plus Next.js through the npm workspace install). | Three-stage build; runtime has production deps only (`prisma` CLI moved to dependencies for `migrate deploy`), the web workspace pruned and peer-only packages dropped. **725 MB**, non-root user. | Image built, migrations from empty DB, smoke 13/13, graceful SIGTERM |
| F11 | Repo | Low | Generated Prisma client was tracked in git; `prisma generate` required `DATABASE_URL` (the Docker build needed a placeholder). | `apps/api/src/generated/` git-ignored; `predev`, `predev:worker`, `pretypecheck`, `pretest`, `predb:seed` and `build` regenerate it; `prisma.config.ts` makes the URL optional for `generate` (migrate commands still fail clearly without it). **Owner action:** `git rm -r --cached apps/api/src/generated`. | `DATABASE_URL= npx prisma generate` succeeds; `migrate status` without URL → "Connection url is empty" |
| F12 | CI | Medium | CI lacked a schema-drift guard, a dependency audit gate, server logs on failure and process-level reliability tests. | Added the drift guard (`migrate diff --exit-code`), `npm audit --omit=dev --audit-level=high`, explicit service start with logs, a test-results artifact (14 days), a `reliability` job and an image-size report. | `actionlint` 1.7.7 clean; ShellCheck clean |
| F13 | Observability | Low | Request logs did not show the client IP as resolved through `TRUST_PROXY`, so proxy settings could not be verified after deployment. | `clientIp` added to every request log line. | Visible in API logs |
| F14 | Railway | Low | No draining window on redeploy. | `drainingSeconds`: API 15 s, worker 30 s (validated against Railway's published schema). | Schema check |

**No defects found** in: migrations (applied, no drift), workflow execution semantics, idempotency keys, tenant scoping of queries, webhook verification order, error sanitization, logging redaction, the batch results, or the developer data the owner reported (verified read-only: Demo Store has 60 succeeded runs, 60 sheet rows, 41 CRM customers, 2 duplicates ignored, 0 failed/open runs, 0 duplicate rows).

## 3. Component status

| Component | Status | Evidence / blocker |
| --- | --- | --- |
| Authentication (sign-up, sign-in, sign-out, session persistence) | **VERIFIED** | `security.test.ts`, `auth-tenancy.test.ts`, E2E, reliability S7 (session survives API restart) |
| Organizations (create, switch) and RBAC (Owner/Admin/Member) | **VERIFIED** | API tests, `e2e/organizations.spec.ts`, invite-link E2E |
| Tenant isolation | **VERIFIED** | 404s across tenants in 5 test files; webhook tenant only from the verified connection |
| Connections (mock store/CRM/sheet) incl. F1 fix | **VERIFIED** | API tests + regression E2E |
| Workflow configuration | **VERIFIED** | `workflows.test.ts`, E2E |
| Public (DummyJSON) + synthetic import | **VERIFIED** | Synthetic: tests + E2E + smoke. DummyJSON: normalizer tested with captured real response shapes; live endpoint reachable during M3 |
| Signed webhooks, replay window, duplicates | **VERIFIED** | `webhooks.test.ts` (10), batch, smoke |
| Worker execution, retries, dead letters, manual retry | **VERIFIED** | `worker.test.ts`, batch, E2E, reliability S4 |
| Outbox and recovery (Redis outage, worker crash, restarts) | **VERIFIED** | Reliability S2–S6, `recovery.test.ts` |
| Production Docker image (API + worker) | **VERIFIED** (locally) | Built, migrated an empty DB, smoke 13/13, guards, SIGTERM |
| CI workflow | **IMPLEMENTED BUT NOT VERIFIED** | Lint-clean (actionlint) and each step run locally; not run on GitHub (no authorization to push; `gh` not installed) |
| Railway configuration | **IMPLEMENTED BUT NOT VERIFIED** | Schema-valid; needs a Railway project |
| Vercel configuration | **IMPLEMENTED BUT NOT VERIFIED** | Production build verified locally; needs a Vercel project |
| `TRUST_PROXY=2` behind Vercel + Railway | **IMPLEMENTED BUT NOT VERIFIED** | Must be confirmed from `clientIp` in live logs (deployment.md §8) |
| Live production deployment (R6) | **BLOCKED** | Needs cloud credentials and explicit deployment approval |
| Developer machine env (`NODE_TLS_REJECT_UNAUTHORIZED=0`) | **BLOCKED** (owner action) | OS/agent configuration must be changed by the owner |
| Removal of the 31.8 MB installer from git history | **BLOCKED** (owner approval) | Requires a history rewrite + force-push |

Nothing is classified **FAILED**.

## 4. Proposed commit structure
The working tree contains M0–M8 and this release work, all uncommitted. A reviewable history (run the `git rm --cached` first so the generated client leaves the index):

```bash
git rm -r --cached apps/api/src/generated          # F11: stop tracking the generated client
git rm --cached docs/node-v24.22.2-x64.msi 2>/dev/null || true   # already deleted in the working tree
```

| # | Message | Paths |
| --- | --- | --- |
| 1 | `chore: stabilize monorepo tooling (prisma.config.ts, env validation, scripts, lint)` | root `package.json`, `.gitignore`, `.dockerignore`, `.env.example`, `apps/api/{package.json,prisma.config.ts,tsconfig*.json,eslint.config.js,.env.example}`, `apps/api/src/{config,lib/logger.ts,lib/errors.ts,lib/http.ts,lib/redis.ts}`, `package-lock.json` |
| 2 | `feat(db): Fleqo schema, Better Auth models and init migration` | `apps/api/prisma/**` |
| 3 | `feat(api): auth, organizations, RBAC and tenant middleware` | `apps/api/src/{lib/auth.ts,lib/permissions.ts,middleware/**,modules/organizations,modules/audit,types}` |
| 4 | `feat(api): connections, mock integrations, public data import` | `src/{lib/crypto.ts,integrations,modules/connections,modules/demo,contracts}` |
| 5 | `feat(api): workflows, signed webhooks, outbox, worker and recovery` | `src/{engine,modules/{workflows,webhooks,executions,dashboard},app.ts,server.ts,worker.ts}` |
| 6 | `test(api): integration, security, recovery and 100-event batch suites` | `apps/api/{test/**,vitest.config.ts}` |
| 7 | `feat(web): operator UI, invite links, read-only states` | `apps/web/**` except `e2e/` and `playwright.config.ts` |
| 8 | `test(web): Playwright E2E with console guard` | `apps/web/{e2e/**,playwright.config.ts}` |
| 9 | `build: production Dockerfile, Railway configs, env templates` | `apps/api/Dockerfile`, `deploy/**` |
| 10 | `ci: GitHub Actions verify, reliability and image jobs` | `.github/**`, `scripts/**`, `apps/api/src/scripts/**` |
| 11 | `docs: README, architecture, ERD, API/UI specs, release audit and deployment guide` | `README.md`, `docs/**` |

Before pushing: `git status` should show no `.env`, `test-results/`, `playwright-report/` or `src/generated/` files (all git-ignored), and `npm run lint && npm run typecheck && npm test` should pass.
