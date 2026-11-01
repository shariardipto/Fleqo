# Fleqo v1.0 — Security Audit (+ v1.1 addendum, §8)

**Date:** 2026-11-01 · **Reviewer role:** release security review · **Basis:** OWASP Top 10 (2021) and OWASP ASVS-style control checks, applied to the code in this repository.
Every "Verified" item names the automated test or command that proves it ([production-test-results.md](./production-test-results.md)).

## 1. Summary
- **Fixed during this audit:** invitation takeover through unverified email (High), CSRF defense in depth, a webhook rate-limit bypass, production guards against disabled TLS verification and non-HTTPS origins, `Cache-Control: no-store`, web security headers (CSP/HSTS/Permissions-Policy), organization deletion disabled.
- **Dependency audit:** `npm audit --omit=dev` → **0** vulnerabilities; full tree (including dev tooling) → **0**.
- **Open risks:** listed in §7. None are known critical. The highest residual risks are unverified email addresses (account-squatting of addresses, though it no longer grants org access), and in-memory rate limiting, which is per instance.

## 2. OWASP Top 10 (2021) mapping

| Category | Controls in Fleqo | Status / evidence |
| --- | --- | --- |
| **A01 Broken Access Control** | The tenant comes from the server-side session's `activeOrganizationId`, never from request input. Membership and role are re-read on every request (`requireOrg`). Every query filters by `id` **and** `organizationId`; cross-tenant access returns 404. The webhook tenant comes from the verified connection only. Invitations accept only through the invitation ID and only for the recipient's email. | Verified — `auth-tenancy`, `workflows`, `connections-import`, `worker`, `webhooks`, `security` tests; E2E invite-link test |
| **A02 Cryptographic Failures** | Passwords hashed by Better Auth (scrypt). Webhook secrets AES-256-GCM encrypted with `ENCRYPTION_KEY` (versioned `v1.` format), shown once. HMAC-SHA256 signatures. HTTPS enforced in production (startup guard + HSTS). `__Secure-` HttpOnly cookies in production. | Verified — `connections-import` (ciphertext ≠ secret, decrypts), production-image guard tests |
| **A03 Injection** | Prisma parameterized queries. The only raw SQL (outbox claim) uses `Prisma.sql` tagged templates and `Prisma.join`. Zod validation on every body, query and param; the ID param pattern is `^[\w-]+$`. No dynamic code execution, no shell. | Verified by review; `webhooks` tests (422 with paths) |
| **A04 Insecure Design** | Transactional outbox, idempotency keys and run leases (correctness under retries). Fault injection only through signed, tenant-owned synthetic events affecting mock adapters. The invite-link design avoids unverified-email trust. | Verified — batch, reliability S1–S8 |
| **A05 Security Misconfiguration** | Env validated with Zod at startup; production guards (HTTPS origins, TLS verification). Helmet on the API. CSP/HSTS/XFO/Permissions-Policy on the web. `x-powered-by` disabled on both. CORS allow-list with no wildcard. Organization deletion disabled. Generated files and secrets git-ignored. | Verified — header inspection; production-image guard tests |
| **A06 Vulnerable Components** | Exact pins for key deps (better-auth 1.7.14, bullmq 6.5.3, ioredis 6.0.0, express-rate-limit 8.7.2, pino 10.4.0); lockfile. CI gate `npm audit --omit=dev --audit-level=high`. | `npm audit`: 0 / 0 |
| **A07 Identification & Authentication Failures** | Better Auth sessions (7 days, refreshed daily, stored in DB, revoked on sign-out). Password length 8–128. Better Auth's built-in rate limiting in production (100/min + stricter sign-in rules). Generic credential errors. | Verified — `security.test.ts` (wrong password 401, persistence, sign-out) |
| **A08 Software & Data Integrity Failures** | Webhook HMAC over the **raw** body before parsing, constant-time compare, ±300 s replay window, event-ID dedupe and canonical-hash conflict detection (409). `npm ci` from the lockfile in CI and Docker. | Verified — `webhooks.test.ts` (10 cases), batch (5 forged → 401) |
| **A09 Security Logging & Monitoring Failures** | Structured pino logs with request IDs and `clientIp`. Redaction of `authorization`, `cookie`, `set-cookie`, `x-fleqo-signature`, `*.secret/password/token`. Audit log of configuration and membership changes. Execution logs per attempt. | Verified — log review; audit tests |
| **A10 SSRF** | The only outbound HTTP is to fixed DummyJSON URLs (10 s timeout, Zod-validated). No user-supplied URLs are ever fetched. | Verified by review |

## 3. Specific controls requested

| Control | Implementation | Status |
| --- | --- | --- |
| Session security | HttpOnly, `SameSite=Lax`, `Secure` + `__Secure-` prefix in production; DB-backed sessions; sign-out revokes | Verified |
| Better Auth configuration | `trustedOrigins = WEB_ORIGINS`, `baseURL` = public web origin, rate limit in production, `disabledPaths: ["/organization/list-user-invitations"]`, `disableOrganizationDeletion`, invitation expiry 48 h, org limit 10, email/password only | Verified (tests) |
| CORS & reverse proxy | CORS allow-list with credentials. The browser uses the same-origin Next.js `/api` rewrite. `TRUST_PROXY` (0 locally, 2 behind Vercel + Railway). | Locally verified; `TRUST_PROXY=2` must be confirmed live (deployment.md §8) |
| CSRF | SameSite=Lax cookies; CORS blocks cross-origin JSON; Better Auth origin checks; **plus** Fleqo `requireTrustedOrigin` for cookie-bearing mutations | Verified |
| Secure cookies & HTTPS | Production refuses non-HTTPS origins; HSTS on the web; Vercel/Railway terminate TLS | Guard verified; live TLS pending (R6) |
| Input validation | Zod everywhere; bodies 256 KB (JSON) / 64 KB (webhooks) | Verified |
| SQL injection | See A03 | Verified |
| Webhook signature, timing-safe compare | `crypto.timingSafeEqual` over equal-length buffers; format pre-check `^[0-9a-f]{64}$` | Verified |
| Replay protection | Timestamp window ±`WEBHOOK_TOLERANCE_SECONDS` + unique event ID per tenant | Verified |
| Rate limiting | API 600/min/IP; webhooks 1200/min/IP (fixed bypass); Better Auth limits in production | Verified locally; in-memory per instance (see §7) |
| Credential encryption & keys | AES-256-GCM, 32-byte `ENCRYPTION_KEY` from env; secrets never returned after creation/rotation; rotation endpoint | Verified |
| Sensitive data in logs | Redaction list above; webhook bodies and secrets never logged; the 181-file secret scan found 0 leaks (M8) | Verified |
| Error disclosure | `{error:{code,message,details?,requestId}}`; internal errors → generic 500; no stack traces | Verified (`security.test.ts`) |
| Production env variables | Templates in `deploy/env/*.example` with placeholders only; startup validation + guards | Verified |

## 4. Fixes made in this audit
See [release-audit.md §2](./release-audit.md#2-findings-and-fixes) (F2–F9, F13). The **High** one in detail:

**Invitation takeover via unverified email (fixed).** Before: `GET /api/invitations` (and Better Auth's `/organization/list-user-invitations`) listed pending invitations for the signed-in user's email. Emails are not verified in the MVP, so an attacker who knew or guessed an invitee's address could sign up with it, see the invitation and accept it, joining the organization with the invited role (possibly Admin). After: invitations are only reachable through the invite link (the 32-character random invitation ID, shared by the inviter out of band). The list endpoints are removed or disabled; reading or accepting with any other account returns 403. This is the pattern Better Auth itself relies on: it only requires email verification for invitation actions when IDs are guessable.

## 5. Developer environment findings
**Observed** (read-only inspection, 2026-11-01): in the process environment of the Claude Code agent session (`Code.exe → extension host → claude.exe → shell`):
```
NODE_ENV                       Process = production
NODE_TLS_REJECT_UNAUTHORIZED   Process = 0
```
Neither variable is set at **User** or **Machine** scope, in the PowerShell profiles, in VS Code `settings.json`, or in the Claude settings files. They are therefore injected into the agent's process tree at launch, not configured system-wide. Your own terminals may not have them.

**Impact.** `NODE_TLS_REJECT_UNAUTHORIZED=0` disables TLS certificate verification for every Node process that inherits it: npm installs, Prisma, outbound fetches. Man-in-the-middle attacks on dependency downloads or API calls become possible. `NODE_ENV=production` makes `npm install` silently skip devDependencies and can make tools behave as in production.

**Recommended fix** (the owner should apply it; nothing was changed):
```powershell
# 1. Check your own terminal (and a fresh VS Code terminal):
$env:NODE_ENV; $env:NODE_TLS_REJECT_UNAUTHORIZED
[Environment]::GetEnvironmentVariable('NODE_TLS_REJECT_UNAUTHORIZED','User')
[Environment]::GetEnvironmentVariable('NODE_TLS_REJECT_UNAUTHORIZED','Machine')

# 2. If either is set persistently, remove it (User scope; Machine scope needs an elevated shell):
[Environment]::SetEnvironmentVariable('NODE_TLS_REJECT_UNAUTHORIZED', $null, 'User')
[Environment]::SetEnvironmentVariable('NODE_ENV', $null, 'User')

# 3. Remove them from wherever VS Code / the Claude Code extension is launched (shortcut, launcher
#    script, or the extension's environment-variable setting), then restart VS Code.

# 4. If a corporate proxy needs a custom CA, trust it instead of disabling verification:
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', 'C:\path\to\corporate-root-ca.pem', 'User')
```
**Safeguard added in code:** the API and worker refuse to start with `NODE_ENV=production` and `NODE_TLS_REJECT_UNAUTHORIZED=0`, and print a warning in development. Verified in the production image ([production-test-results.md §6](./production-test-results.md#6-production-image)).

## 6. Dependency audit
| Command | Result (2026-11-01) |
| --- | --- |
| `npm audit --omit=dev` | found 0 vulnerabilities |
| `npm audit` (incl. dev tooling) | found 0 vulnerabilities (the 6 shadcn-CLI advisories reported at M7 no longer appear) |
| `npm ls --all` | only `UNMET OPTIONAL` peers (Better Auth framework integrations not used) |

No dependency upgrades were needed; no breaking upgrades were applied.

## 7. Residual risks and recommendations
| Risk | Severity | Recommendation |
| --- | --- | --- |
| Email addresses are not verified **until an email provider is configured**. Without it, anyone can register an unused address; a later real owner of that address cannot sign up. **No longer grants organization access.** | Medium → Low once enabled | Implemented (§9): configure Resend and set `REQUIRE_EMAIL_VERIFICATION=true` (this also requires verification for invitations) |
| Rate limits (express-rate-limit, Better Auth) are in-memory per API instance. | Low (single instance) | Before scaling the API horizontally, use a Redis store (`rate-limit-redis`) and Better Auth `secondaryStorage` |
| Direct requests to the Railway API domain bypass Vercel. `X-Forwarded-For` could then be spoofed toward the IP-based limits. | Low | Keep `TRUST_PROXY` exact. Optionally block non-webhook paths on the public API domain, or give webhooks their own domain |
| CSP allows `'unsafe-inline'` scripts (Next.js/next-themes inline scripts). | Low | Move to a nonce-based CSP via Next.js middleware |
| Single `ENCRYPTION_KEY`, no built-in rotation of stored ciphertexts. | Low | Procedure: rotate every connection's signing secret after changing the key; the `v1.` prefix leaves room for key IDs |
| `unknown_connection` vs `invalid_signature` responses reveal whether a public connection ID exists. | Info | Accepted: public IDs identify, never authorize (96-bit random) |
| No antivirus or file upload surface; no user-provided URLs. | — | — |
| The live configuration (TLS, `TRUST_PROXY`, cookie domain, headers on Vercel) is not yet verified. | — | R6 checklist in deployment.md §8 |
| Social providers (v1.1) are tested offline only; no sign-in against a real Google/GitHub/Apple/X app has been done. | Low | Run the live checklist in [social-auth.md §6](./social-auth.md#6-live-verification-checklist-needs-real-credentials) per provider before announcing it |
| Apple's client secret is a JWT that expires after at most 6 months; an expired one breaks Apple sign-in. | Low (only if Apple is enabled) | Calendar reminder; regenerate before expiry |

## 8. v1.1 review — social sign-in and public website (2026-11-01)
Scope: the new OAuth sign-in (`apps/api/src/lib/social-providers.ts`, `lib/auth.ts`, `modules/public`), the redesigned auth pages, the public landing page and docs, and the theme system.

| Control | Implementation | Status / evidence |
| --- | --- | --- |
| OAuth client secrets | Read from the API environment only (`env.ts`). The browser receives only `{id, name}` from `GET /api/public/auth-providers`. A provider with only one of ID/secret stops startup (`Incomplete OAuth configuration`). `grep` of the web build output for the fake test secrets: no matches | Verified — `social-auth.test.ts`; env validation |
| Login CSRF / code injection | OAuth `state` stored server-side + PKCE S256 (Better Auth). Tampered or missing state → `/sign-in?error=state_mismatch`-style redirect, no session | Verified — `social-auth.test.ts` (tampered state, cancelled consent) |
| Open redirects | `callbackURL`, `newUserCallbackURL`, `errorCallbackURL` validated against `trustedOrigins`. Better Auth skips this check when it detects a test environment, so Fleqo sets `advanced.disableOriginCheck: false` (and `disableCSRFCheck: false`) explicitly: the check now runs in tests too. The web form only passes same-site relative `next` values (`safeNext`) | Verified — external `callbackURL` → **403** (`social-auth.test.ts`) |
| Account pre-hijacking / takeover by linking | `accountLinking: { requireLocalEmailVerified: true, trustedProviders: [], allowDifferentEmails: false }`. An attacker who registers victim@example.com with a password cannot later receive the victim's Google identity; the social sign-in is refused with "account not linked" and the existing account keeps only its `credential` row | Verified — `social-auth.test.ts` (unverified local account, provider email verified → not linked) |
| Duplicate accounts | Returning social users are matched on `(providerId, accountId)` → same user, same session flow, no duplicate | Verified — `social-auth.test.ts` |
| Provider email trust | Only provider-verified emails are marked `emailVerified` (GitHub verified primary; X `confirmed_email`; Google/Apple `email_verified`) | Better Auth behaviour; Google path verified by test |
| Apple form-POST callback | `https://appleid.apple.com` is trusted only while Apple is configured | By review |
| Error display | OAuth error codes map to fixed messages; unknown codes show a generic message, so query-string text is never rendered | By review; E2E cancelled-flow test |
| Public endpoint | `/api/public/auth-providers` returns no user or tenant data, is rate-limited by the API limiter and is `no-store` | By review |
| Public landing and docs | Static pages; the interactive demo runs entirely in the browser (asserted: no API calls besides the session check) and uses a published demo secret that is never used by the server. External links use `rel="noopener noreferrer"` (E2E link checker) | Verified — `landing.spec.ts` |
| Headers | Production CSP/HSTS/Permissions-Policy unchanged and applied to the new routes; no new third-party origins (fonts self-hosted, screenshots local) | Verified — production build with CSP; console guard reports no CSP violations |

No new dependencies at runtime (`@axe-core/playwright` is a dev dependency). `npm audit --omit=dev` → **0** vulnerabilities after v1.1.

## 9. Addendum — CI, Railway and email (2026-11-01)
| Area | Change | Evidence |
| --- | --- | --- |
| Supply chain (CI) | GitHub Actions moved from v4 (Node 20, deprecated) to `actions/checkout`, `setup-node` and `upload-artifact` **v7** (Node 24); runners pinned to `ubuntu-24.04`. Workflow permissions stay `contents: read`; secrets are still generated per run | GitHub run 41290735002: three jobs green, no annotations; actionlint 1.7.12 clean |
| Deployment config | Railway Config as Code replaced by Infrastructure as Code (`.railway/railway.ts`). The file holds **no secrets**: shared variables (`ctx.shared`) and `preserve()` keep values in Railway, where they should be sealed. Type-checked against the official SDK in CI | `npm run railway:check`; a negative test confirmed misspelled keys fail |
| Dependency | `railway@3.16.0` added as a **dev** dependency only (DSL types; the IaC engine runs in the Railway CLI). Not in the API image | `npm audit --omit=dev` 0 vulnerabilities |
| Email verification | Optional `requireEmailVerification`: no session before the emailed link; sign-up for an existing address returns a look-alike response and notifies the owner (no enumeration); invitations also require verification | `email-auth.test.ts` (8 tests); browser flow run locally |
| Password reset | Single-use token (1 h), `revokeSessionsOnPasswordReset`, same response for unknown addresses, emails sent after the response (no timing oracle), `redirectTo` validated (off-site → 403) | `email-auth.test.ts`, `password-reset.spec.ts` |
| Abuse limits | Better Auth custom rate limits in production: 3/min per IP for `/request-password-reset` and `/send-verification-email` | Configuration review (rate limits are disabled in test mode) |
| Email transport | Resend over HTTPS, key server-side only; failed sends log the status only (the message holds a token); `log`/`file` transports refused in production; inconsistent settings refused at startup | `emailConfigProblems` unit test; production guard |
| Redis on Railway | ioredis `family: 0` (dual-stack DNS) so the private network works in IPv6-only environments | API suite 66/66 locally with the change; CI green |

New residual items: no real email has been sent (no Resend account or domain yet), so deliverability (SPF/DKIM/DMARC) is unverified, and Railway `plan`/`apply` has not been run (needs the CLI login and approval).
