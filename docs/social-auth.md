# Fleqo — Social Authentication

**Library:** Better Auth 1.7.14 (built-in `socialProviders`) · **Status date:** 2026-11-01

Email/password sign-in is unchanged. Social providers are **optional** and appear on `/sign-in` and `/sign-up` only when the API has **both** the client ID and the client secret for that provider (`GET /api/public/auth-providers`). Secrets live only in the API's environment.

## 1. Provider status

| Provider | Code | Automated verification | Live sign-in with the real provider |
| --- | --- | --- | --- |
| **Google** | Implemented | API tests drive the full OAuth callback offline (token endpoint stubbed) and E2E drives the browser flow up to Google | **Configured but not live-verified** — no Google OAuth client was provided |
| **GitHub** | Implemented | Listed and rendered when configured (API + E2E) | **Configured but not live-verified** |
| **Apple** | Implemented | Config-gated; hidden when not configured | **Blocked** — needs a paid Apple Developer Program membership, a Services ID, a verified HTTPS domain and a client-secret JWT. Apple does not accept `localhost` redirect URIs |
| **X (Twitter)** | Implemented | Config-gated; hidden when not configured | **Blocked / optional** — needs an X developer app with OAuth 2.0 and, for email, the "Request email from users" permission. Without it, Better Auth stores an unverified placeholder email |

"Configured but not live-verified" means the code paths are tested, but nobody has completed a login against the real provider. **Do not treat a provider as verified until §6 has been done with real credentials.**

## 2. How the flow works
1. The browser (on the web origin) calls `authClient.signIn.social({ provider, callbackURL, newUserCallbackURL, errorCallbackURL })` → `POST /api/auth/sign-in/social`, proxied to the API.
2. Better Auth validates the three URLs against `trustedOrigins` (relative paths allowed, external hosts rejected → **no open redirects**). It stores `state` and a PKCE verifier, then returns the provider's authorize URL.
3. The provider redirects to `https://<web-origin>/api/auth/callback/<provider>`, which the web app proxies to the API. Better Auth checks `state`, exchanges the code (PKCE) and reads the profile.
4. **New user** → account created and session cookie set → `newUserCallbackURL` (`/onboarding`, or the invite link the user came from). **Returning user** → `callbackURL` (`/dashboard` or `next`). **Failure** (cancelled, state mismatch, account conflict) → `/sign-in?error=<code>`, shown as a friendly message. Unknown codes get a generic message and the raw value is never rendered.

## 3. Security design
| Concern | Control |
| --- | --- |
| Client secrets | Server env only; the browser gets provider IDs and names from `/api/public/auth-providers`. Half-configured providers (ID without secret) stop the API at startup |
| CSRF / login CSRF | OAuth `state` + PKCE (S256), Better Auth origin checks, SameSite=Lax HttpOnly cookies |
| Open redirects | `callbackURL`, `newUserCallbackURL` and `errorCallbackURL` must be relative or trusted-origin. Fleqo sets `advanced.disableOriginCheck: false`, so this also holds in test runs (Better Auth skips it in test environments by default) |
| Account takeover via linking | `accountLinking: { requireLocalEmailVerified: true, trustedProviders: [], allowDifferentEmails: false }`. A social identity is merged into an existing account only when the provider says the email is verified **and** the local account's email is verified. Email/password accounts stay unverified unless email verification is enabled ([email.md](./email.md)), so a pre-registered account (possibly an attacker's) can never capture someone's Google/GitHub/Apple/X identity. The user is told to sign in with their password instead. Proven by `apps/api/test/social-auth.test.ts` |
| Unverified provider emails | GitHub uses only a verified primary email. X marks email verified only for `confirmed_email`. Google and Apple use the `email_verified` claim |
| Apple form POST | `https://appleid.apple.com` is added to `trustedOrigins` only when Apple is configured; Better Auth converts the POST callback to a GET internally |
| Sessions, tenant isolation, CSRF on the app API | Unchanged: social sessions are ordinary Better Auth sessions; Fleqo's origin check and RBAC apply as before |

## 4. Environment variables (API only)
| Variable | Notes |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (Web application) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth App |
| `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_APP_BUNDLE_IDENTIFIER` (optional) | Services ID + ES256 client-secret JWT |
| `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | X OAuth 2.0 client |

The redirect URI for every provider is **`<BETTER_AUTH_URL>/api/auth/callback/<provider>`**, where `BETTER_AUTH_URL` is the public **web** origin (the web app proxies `/api`):
- local: `http://localhost:3000/api/auth/callback/google`
- production: `https://<your-web-domain>/api/auth/callback/google`

Set them on the **API service only**. The worker never handles sign-in, so leave them unset there; the secrets then live in one place.

## 5. Registering each provider

### Google (priority)
1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External, app name "Fleqo", support email, scopes `openid`, `email`, `profile` (Better Auth's defaults). In "Testing" mode, add your test users.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Authorized JavaScript origins: `http://localhost:3000` (dev) and `https://<your-web-domain>`.
4. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` and `https://<your-web-domain>/api/auth/callback/google`.
5. Put the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart the API.
6. Production: publish the consent screen. Google verification is needed only for sensitive scopes, which Fleqo does not request.

### GitHub
1. GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**. Homepage URL: your web origin. Authorization callback URL: `<web-origin>/api/auth/callback/github`. GitHub OAuth Apps allow one callback URL each, so create separate dev and prod apps.
2. Generate a client secret and set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
3. Scopes are requested by Better Auth (`read:user`, `user:email`).

### Apple
Requirements: **Apple Developer Program membership (paid)**, a domain you control over HTTPS, no localhost.
1. Certificates, Identifiers & Profiles → **Identifiers → App ID** with "Sign in with Apple" enabled.
2. **Identifiers → Services ID** (this is `APPLE_CLIENT_ID`, e.g. `com.example.fleqo.web`). Enable Sign in with Apple, then add your domain and return URL `https://<your-web-domain>/api/auth/callback/apple`.
3. **Keys → new key** with Sign in with Apple. Download the `.p8` once; note the Key ID and your Team ID.
4. Generate the client secret: an ES256 JWT with `iss`=Team ID, `sub`=Services ID, `aud`=`https://appleid.apple.com` and `exp` ≤ 6 months, signed with the `.p8` key. Do this locally with any JWT tool (for example a short `jose` script) and never commit the key. Set it as `APPLE_CLIENT_SECRET`.
5. **Rotate before it expires** (6 months at most); set a calendar reminder.

### X (Twitter) — optional
1. developer.x.com → Projects & Apps → your app → **User authentication settings**: OAuth 2.0, type "Web App", callback `<web-origin>/api/auth/callback/twitter`, website URL. Enable **"Request email from users"** (requires privacy policy and terms URLs on the app).
2. Copy the OAuth 2.0 Client ID and Secret into `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET`.
3. X's API access tiers and policies change. Check that your tier allows OAuth 2.0 user sign-in before relying on it. Without email permission, users get an unverified placeholder email that can never be linked to another account.

## 6. Live verification checklist (needs real credentials)
For each configured provider, in a browser:
1. `/sign-in` shows the provider button; `/sign-up` too.
2. A new identity signs in and lands on `/onboarding`; creating an organization works; `/api/me` shows the user.
3. Sign out, then sign in again with the provider → `/dashboard`; no duplicate user (`SELECT count(*) FROM "user" WHERE email = …`).
4. Cancel on the provider's consent screen → `/sign-in` shows "Sign-in was cancelled".
5. Create an email/password account with address X, then try the provider with the same address X → a clear "account already exists" message, and **no link** (only a `credential` row in `account` for that user).
6. Invite-link flow: open an invite link signed out → Create account → choose the provider with the invited email → accept the invitation.
Record the results in `docs/production-test-results.md`.

## 7. Email verification and password reset
**Implemented** (2026-11-01) and off until an email provider is configured; see [email.md](./email.md). With `REQUIRE_EMAIL_VERIFICATION=true`, email/password accounts are verified before their first session. A verified account can then be linked to a provider-verified Google/GitHub identity with the same address, while unverified accounts still never link.

## 8. Production setup checklist (Google and GitHub)
No credentials exist yet; nothing below has been created. The exact values to register, for a web origin `https://app.example.com` (replace it with the real `BETTER_AUTH_URL`):

| | Google OAuth client (Web application) | GitHub OAuth App (production) |
| --- | --- | --- |
| Origin / homepage | Authorized JavaScript origin `https://app.example.com` | Homepage URL `https://app.example.com` |
| Callback | Authorized redirect URI `https://app.example.com/api/auth/callback/google` | Authorization callback URL `https://app.example.com/api/auth/callback/github` |
| Local development (separate entry or app) | `http://localhost:3000` and `http://localhost:3000/api/auth/callback/google` | separate OAuth App with `http://localhost:3000/api/auth/callback/github` |
| Scopes | `openid`, `email`, `profile` | `read:user`, `user:email` |
| Render variables (`fleqo-api` only) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

1. Register as in §5, using the values above.
2. Set the variables on `fleqo-api` and redeploy. `/sign-in` and `/sign-up` show the buttons only when both values of a pair are present.
3. Run the live checklist (§6) and record the result. Until then the provider stays "configured but not live-verified".
4. Google: publish the consent screen (Fleqo requests no sensitive scopes). GitHub: nothing to publish.
