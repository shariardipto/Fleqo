# Fleqo — Authentication, Organizations and Email

Fleqo uses [Better Auth](https://www.better-auth.com) (1.7) mounted on the Express API at `/api/auth/*`, with its Organization plugin for teams. The browser reaches it through the web app's same-origin `/api` proxy. Security rationale: [security.md](./security.md).

| Feature | Default | Enabled by |
| --- | --- | --- |
| Email + password sign-up / sign-in | On | — |
| Organizations, roles, invite links | On | — |
| Google / GitHub / Apple / X sign-in | Off | Client ID **and** secret on the API (§4) |
| Password reset, email verification | Off | An email provider on the API (§3) |

The live demo uses email and password only.

## 1. Sessions and organizations
- Sessions are stored in PostgreSQL, last 7 days (refreshed daily) and are revoked on sign-out. Cookies are HttpOnly, `SameSite=Lax`, and `Secure` with the `__Secure-` prefix in production.
- Each session has an **active organization**. Every protected API route resolves the tenant from it and re-checks the membership (`requireOrg`).
- Users create organizations (up to 10) on `/onboarding` or from the organization switcher. The creator is **Owner**. Organization deletion is disabled.

| Role | Can |
| --- | --- |
| **Owner** / **Admin** | Manage connections and workflows, import demo data, run the simulator, retry failed runs, read the audit log, manage members and invitations (as Better Auth allows for the role) |
| **Member** | Read connections, workflows and executions; run the simulator |

The UI hides controls a role cannot use, but the API enforces every permission (`src/lib/permissions.ts`, shared with Better Auth's own organization endpoints).

## 2. Invitations
Admins and Owners invite by email and role on **Team**. Fleqo shows an **invite link** (`/invite/<random id>`) to share. No invitation email is sent, and invitations are never listed by email. The invitee opens the link; signed out, they create an account or sign in and return to the link; then they accept. Any other account sees "This invitation cannot be used". Invitations expire after 48 hours. With `REQUIRE_EMAIL_VERIFICATION=true`, accepting also requires a verified address.

## 3. Email verification and password reset (optional)
Off until an email provider is configured. Without one, no email is sent, **Forgot password?** is hidden and addresses stay unverified.

| Flow | Behaviour |
| --- | --- |
| Sign-up, `REQUIRE_EMAIL_VERIFICATION=true` | Account created without a session; "Check your inbox" with **Resend email**. The link (24 h) verifies, signs in and lands on `/verify-email` → **Continue** (or back to an invite link) |
| Sign-in before verifying | Refused with a clear message; a fresh link is sent |
| Sign-up for an existing address | Same response as a new sign-up (no enumeration); the real owner is emailed a notice instead |
| Forgot password | `/forgot-password` always answers "If an account exists…". The link (1 h, single use) opens `/reset-password`; afterwards **every session is signed out** |
| Provider set, verification not required | Sign-up signs in immediately and sends a verification link; reset works |

**Configuration (API only).**

| Variable | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` (the only one accepted in production). `log` prints messages to the API log and `file` writes JSON for tests; both expose tokens |
| `EMAIL_FROM` | An address on a domain verified in Resend, e.g. `Fleqo <no-reply@mail.example.com>` |
| `RESEND_API_KEY` | Resend key with sending access only |
| `REQUIRE_EMAIL_VERIFICATION` | `true` once sending works |

Startup refuses inconsistent settings, such as a provider without `EMAIL_FROM`, Resend without a key, or verification required without a provider. The transport is Resend's HTTPS API, a single `fetch` in `src/lib/mailer.ts`. SMTP isn't used because hosts such as Render's free tier block SMTP ports.

**Setting up Resend.**
1. Add a sending domain (ideally a subdomain such as `mail.example.com`), publish the SPF, DKIM and MX records Resend shows, and wait for **Verified**. Until then Resend only delivers to your own address. Add a DMARC record (`p=none` to start).
2. Create a sending-only API key; set `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `RESEND_API_KEY` on the API and redeploy.
3. Check that **Forgot password?** appears and a reset email arrives (inbox, not spam). Then set `REQUIRE_EMAIL_VERIFICATION=true` and test a new sign-up. Existing unverified users are asked to verify at their next sign-in.

**Security.**
- No account enumeration: responses are identical, and emails are sent after the response, so timing gives nothing away.
- Signed 24 h verification links; random single-use 1 h reset tokens.
- Sessions revoked on reset.
- `redirectTo`/`callbackURL` restricted to trusted origins (off-site → 403).
- 3 requests/min per IP on the email endpoints in production.
- Failed sends log only the HTTP status, never the message, which contains a token.

## 4. Social sign-in (optional)
Google, GitHub, Apple and X (Twitter) are implemented with Better Auth's `socialProviders`. A provider's button appears on `/sign-in` and `/sign-up` only when the API has **both** its client ID and secret (`GET /api/public/auth-providers` lists them); a half-configured pair stops the API at startup. Secrets live only on the API service, never the worker or Vercel.

**Flow.**
1. The browser calls `POST /api/auth/sign-in/social` (proxied). Better Auth validates `callbackURL`, `newUserCallbackURL` and `errorCallbackURL` against the trusted origins, stores `state` and a PKCE (S256) verifier, and returns the provider's authorize URL.
2. The provider redirects to `<BETTER_AUTH_URL>/api/auth/callback/<provider>`, which is on the **web** origin and proxied to the API.
3. New users land on `/onboarding` (or their invite link); returning users on `/dashboard` (or `next`). Failures return to `/sign-in?error=<code>`, which shows a fixed, friendly message; the raw value is never rendered.

**Account linking** is `requireLocalEmailVerified: true`, `trustedProviders: []`, `allowDifferentEmails: false`. A social identity joins an existing account only if the provider says the email is verified **and** the local account's email is verified. An unverified password account, possibly pre-registered by an attacker, can therefore never capture someone's Google/GitHub identity; the user is told to sign in with their password instead (`apps/api/test/social-auth.test.ts`).

**Exact values to register** for a web origin `https://app.example.com` (it must equal `BETTER_AUTH_URL`: `https`, no trailing slash):

| | Google OAuth client (Web application) | GitHub OAuth App |
| --- | --- | --- |
| Origin / homepage | Authorized JavaScript origin `https://app.example.com` | Homepage URL `https://app.example.com` |
| Callback | Authorized redirect URI `https://app.example.com/api/auth/callback/google` | Authorization callback URL `https://app.example.com/api/auth/callback/github` |
| Local development | Also `http://localhost:3000` and `http://localhost:3000/api/auth/callback/google` | A separate OAuth App (one callback per app) |
| Scopes | `openid`, `email`, `profile` | `read:user`, `user:email` |
| API variables | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

- **Google:** Cloud Console → APIs & Services → OAuth consent screen (External; add test users while in Testing) → Credentials → OAuth client ID (Web application) with the values above. Publish the consent screen for production; Fleqo requests no sensitive scopes.
- **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App with the values above; generate a client secret.
- **Apple** (needs a paid Apple Developer membership and an HTTPS domain; no localhost): create an App ID with Sign in with Apple, a Services ID (`APPLE_CLIENT_ID`) with return URL `<web-origin>/api/auth/callback/apple`, and a Sign in with Apple key (`.p8`). The client secret (`APPLE_CLIENT_SECRET`) is an ES256 JWT (`iss` Team ID, `sub` Services ID, `aud` `https://appleid.apple.com`, `exp` ≤ 6 months) signed locally with the key; regenerate it before it expires. `https://appleid.apple.com` is trusted for its form POST only while Apple is configured.
- **X:** developer.x.com → app → User authentication settings: OAuth 2.0, Web App, callback `<web-origin>/api/auth/callback/twitter`, and **Request email from users** (needs privacy policy and terms URLs). Without it users get an unverified placeholder email that never links. Check that your API tier allows user sign-in.

**Live check before announcing a provider:**
1. The button shows on sign-in and sign-up.
2. A new identity lands on `/onboarding` and can create an organization.
3. Signing in again lands on `/dashboard` with no duplicate user.
4. Cancelling on the consent screen shows "Sign-in was cancelled".
5. A provider sign-in for an address that already has an unverified password account is refused and **not** linked.
6. The invite-link flow works with the provider.

## 5. Where it lives
| Concern | Code |
| --- | --- |
| Better Auth configuration (sessions, linking, rate limits, organization plugin) | `apps/api/src/lib/auth.ts` |
| Providers from the environment | `apps/api/src/lib/social-providers.ts`, `src/config/env.ts` |
| Email transport and templates | `apps/api/src/lib/mailer.ts`, `src/lib/emails.ts` |
| Roles and permissions | `apps/api/src/lib/permissions.ts`, `src/middleware/auth.ts` |
| Auth pages | `apps/web/src/features/auth/`, `apps/web/src/app/(auth)/` |
| Tests | `apps/api/test/{auth-tenancy,security,social-auth,email-auth}.test.ts`, `apps/web/e2e/{social-auth,password-reset,connections-permissions}.spec.ts` |
