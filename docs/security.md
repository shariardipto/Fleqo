# Fleqo — Security

How Fleqo protects tenants, credentials and webhooks, mapped to the OWASP Top 10 (2021). Each control names the code or test that enforces it. Authentication, OAuth and email flows are covered in [authentication.md](./authentication.md).

## 1. Controls

| Area | Controls | Enforced / verified by |
| --- | --- | --- |
| **Access control (A01)** | Tenant = the session's `activeOrganizationId`, never request input. Membership and role re-read on every protected request (`requireOrg`). Every query filters by resource ID **and** `organizationId`; cross-tenant access returns 404. The webhook tenant comes only from the verified connection. One permission model shared by Better Auth's organization endpoints and Fleqo's routes (`src/lib/permissions.ts`). | `auth-tenancy`, `workflows`, `connections-import`, `worker`, `webhooks`, `security` tests; invite-link E2E |
| **Cryptography (A02)** | Passwords hashed by Better Auth (scrypt). Connection signing secrets AES-256-GCM encrypted with `ENCRYPTION_KEY` (versioned `v1.` format) and shown once. HMAC-SHA256 webhook signatures. HTTPS enforced in production (startup guard + HSTS); `__Secure-` HttpOnly cookies. | `connections-import` (ciphertext ≠ secret), startup guards |
| **Injection (A03)** | Prisma parameterized queries; the only raw SQL (outbox claim) uses `Prisma.sql` tagged templates. Zod validation of every body, query and route parameter. No dynamic code execution or shell. | Review; `webhooks` (422 with field paths) |
| **Insecure design (A04)** | Transactional outbox, idempotency keys and run leases keep retries correct. Fault injection only through signed, tenant-owned synthetic events, and only in mock adapters. Invitations by link, not by email (§2). | 100-event batch, reliability scenarios |
| **Misconfiguration (A05)** | Environment validated with Zod at startup; production refuses non-HTTPS origins and `NODE_TLS_REJECT_UNAUTHORIZED=0`. Helmet on the API; CSP, HSTS, X-Frame-Options and Permissions-Policy on the production web; `x-powered-by` off. CORS allow-list without wildcard. Organization deletion disabled (it would cascade-delete history). | Header checks; startup guards |
| **Vulnerable components (A06)** | Lockfile installs (`npm ci`) in CI and Docker; exact pins for key dependencies; CI gate `npm audit --omit=dev --audit-level=high`. | CI |
| **Authentication (A07)** | DB-backed Better Auth sessions (7 days, refreshed daily, revoked on sign-out); password length 8–128; generic credential errors; Better Auth rate limits in production; optional email verification and password reset. | `security`, `email-auth`, `social-auth` tests |
| **Integrity (A08)** | Webhook HMAC over the **raw** body before parsing, constant-time comparison, ±300 s replay window, event-ID deduplication with canonical-hash conflict detection (409). | `webhooks` (10 cases), batch (forged → 401) |
| **Logging (A09)** | Structured pino logs with request IDs and `clientIp`; redaction of `authorization`, cookies, `set-cookie`, `x-fleqo-signature` and `*.secret/password/token`. Audit log of configuration and membership changes; per-attempt execution logs. | Review; audit tests |
| **SSRF (A10)** | Outbound HTTP only to fixed DummyJSON URLs (10 s timeout, Zod-validated) and the configured email API. No user-supplied URL is ever fetched. | Review |

**Browser and session details**
- Cookies are `HttpOnly`, `SameSite=Lax` and `Secure` with the `__Secure-` prefix in production. The browser reaches the API through the web app's same-origin `/api` proxy, so cookies are first-party.
- CSRF protection has four layers:
  - SameSite cookies;
  - CORS, which blocks cross-origin JSON;
  - Better Auth's origin checks;
  - Fleqo's `requireTrustedOrigin`, which rejects cookie-authenticated POST/PATCH/PUT/DELETE requests whose `Origin`/`Referer` is not in `WEB_ORIGINS`.
- Every `/api` response carries `Cache-Control: no-store`. Errors are sanitized: `{ error: { code, message, details?, requestId } }`, with no stack traces.
- Rate limits are per IP: the API (600/min) and webhooks (1200/min, keyed by IP only so a rotated connection ID cannot bypass it). Better Auth adds its own limits in production, including 3/min on the email-sending endpoints.
- Body limits: 256 KB JSON, 64 KB webhooks.

## 2. Invitations without email trust
Email/password addresses are unverified unless an email provider is configured, so Fleqo never trusts an address to grant access. Invitations are reachable only through the **invite link**: the 32-character random invitation ID that the inviter shares out of band. Listing invitations by email is removed, Better Auth's `/organization/list-user-invitations` is disabled, and reading or accepting an invitation with any other account returns 403.

The rationale: if invitations were listed by email, anyone who registered an invitee's address could accept the invitation and join with the invited role. With `REQUIRE_EMAIL_VERIFICATION=true`, accepting additionally requires a verified address.

## 3. Secrets and configuration
- Secrets (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, OAuth client secrets, `RESEND_API_KEY`) live only in the API's environment. Templates in [`deploy/`](../deploy) contain placeholders only; `.env` files are git-ignored.
- The browser receives only provider IDs and names (`GET /api/public/auth-providers`). Half-configured OAuth pairs and inconsistent email settings stop the API at startup.
- Docker builds declare no `ARG`s, so platform variables passed as build arguments are never baked into the image.
- Losing `ENCRYPTION_KEY` makes stored webhook secrets undecryptable. Recovery is to set a new key and rotate every connection's secret (Connections → Rotate secret).

## 4. Residual risks
| Risk | Severity | Mitigation / recommendation |
| --- | --- | --- |
| Without an email provider, addresses are unverified: someone can register an address they do not own (it grants no organization access, §2) | Medium | Configure Resend and set `REQUIRE_EMAIL_VERIFICATION=true` ([authentication.md](./authentication.md)) |
| Rate limits are in memory, per API instance | Low (single instance) | Use a Redis store (`rate-limit-redis`, Better Auth `secondaryStorage`) before running several API replicas |
| Requests sent straight to the API domain bypass the web proxy, so `X-Forwarded-For` could be spoofed toward IP limits | Low | Keep `TRUST_PROXY` exact (verify `clientIp` in logs); optionally restrict non-webhook paths on the API domain |
| CSP allows `'unsafe-inline'` scripts (Next.js and next-themes inline scripts) | Low | Nonce-based CSP via Next.js middleware |
| One `ENCRYPTION_KEY`, no automatic re-encryption | Low | Rotate connection secrets after a key change; the `v1.` prefix leaves room for key IDs |
| `unknown_connection` vs `invalid_signature` reveals whether a public connection ID exists | Info | Accepted: public IDs (96-bit random) identify, never authorize |
| Social providers are tested offline only; Apple client secrets expire after ≤ 6 months | Low | Live checklist in [authentication.md](./authentication.md) before enabling a provider; calendar reminder for Apple |
| Free-tier demo: Key Value internal connections are unauthenticated by default | Low | Keep Key Value unreachable externally (Render's default) and in the same workspace and region |
