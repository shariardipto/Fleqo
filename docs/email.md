# Fleqo — Email Verification and Password Reset

**Status (2026-11-01): implemented and tested; off until an email provider is configured.** Without `EMAIL_PROVIDER`, Fleqo behaves exactly as before: no email is sent, "Forgot password?" is hidden and addresses stay unverified.

## 1. What it does
| Flow | Behaviour |
| --- | --- |
| **Sign-up** (`REQUIRE_EMAIL_VERIFICATION=true`) | The account is created but gets **no session**. The page shows "Check your inbox" with **Resend email**. The emailed link (24 h) verifies the address, signs the user in and lands on `/verify-email` → **Continue** to the app (or back to the invite link they came from). |
| **Sign-in before verifying** | Refused with "Verify your email to sign in"; a fresh link is sent automatically. |
| **Sign-up with an address that already has an account** | Same response as a new sign-up (no account enumeration). The real owner gets an "Someone tried to create a Fleqo account with your email" notice instead. |
| **Forgot password** | `/sign-in` → **Forgot password?** → `/forgot-password`. The answer is always "If an account exists…", whether or not it does. The link (1 h, single use) opens `/reset-password`. After the change **every other session is signed out** and the user returns to `/sign-in` with a confirmation. Expired or reused links show "This link has expired" with a way to request a new one. |
| **Optional mode** (`EMAIL_PROVIDER` set, verification not required) | Sign-up signs in immediately and also sends a verification link; password reset works. |
| **Invitations** | With verification required, accepting an invitation also needs a verified address (`requireEmailVerificationOnInvitation`). |
| **Social sign-in** | Unchanged. Once an email/password account is verified, a provider-verified Google/GitHub identity with the same address can be linked to it (`requireLocalEmailVerified`). Unverified accounts still never link. |

## 2. Configuration (API service only)
| Variable | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` in production. `log` (prints messages and links to the API log) and `file` (writes JSON files, used by E2E) are **refused in production** because they would expose sign-in tokens |
| `EMAIL_FROM` | `Fleqo <no-reply@mail.your-domain.com>`: an address on a domain verified in Resend |
| `RESEND_API_KEY` | Resend API key with **sending access only**; store it sealed |
| `REQUIRE_EMAIL_VERIFICATION` | `true` to require verified addresses for public registration (recommended once sending is proven) |
| `EMAIL_FILE_DIR` | Only for `file`; default `tmp/emails` (gitignored) |

Startup validation refuses inconsistent settings: a provider without `EMAIL_FROM`, `resend` without a key, `REQUIRE_EMAIL_VERIFICATION=true` without a provider (nobody could finish signing up), and `log`/`file` in production.

**Why Resend over HTTPS, not SMTP:** Railway allows outbound SMTP only on the Pro plan and recommends HTTPS email APIs on every plan. The transport is a single `fetch` call (no new dependency) in `apps/api/src/lib/mailer.ts`. Another HTTPS provider (Postmark, SendGrid, Mailgun) is a ~15-line addition there.

## 3. Setting up Resend (owner)
1. Create a Resend account and add a sending domain, preferably a subdomain such as `mail.your-domain.com`.
2. Add the DNS records Resend shows (SPF `TXT`, DKIM `CNAME`/`TXT`, and the MX record for bounces) at your DNS provider. Wait until Resend marks the domain **Verified**. Until then Resend only delivers to your own account address.
3. Recommended: add a DMARC record (`_dmarc.your-domain.com`, start with `p=none`) so receivers trust the domain.
4. Create an API key with **Sending access** for that domain only.
5. On the Railway `fleqo-api` service set `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `RESEND_API_KEY` (seal it). Keep `REQUIRE_EMAIL_VERIFICATION` unset for now and redeploy.
6. Test: `/sign-in` now shows **Forgot password?**. Request a reset for your own account, check the email arrives (inbox, not spam), and complete the reset.
7. Then set `REQUIRE_EMAIL_VERIFICATION=true` and redeploy. Create a throwaway account and finish the verification flow. Record both results in `production-test-results.md`.

Existing accounts created before step 7 stay unverified. With verification required they are asked to verify at their next sign-in (a link is sent automatically).

## 4. Security design
| Concern | Control |
| --- | --- |
| Account enumeration | Reset requests and sign-ups for existing addresses return the same response as for new ones. Emails are sent **after** the response, so timing does not reveal accounts either (`mailer.dispatch`) |
| Token theft / reuse | Better Auth tokens: verification links are signed and expire after 24 h; reset tokens are random, stored server-side, expire after 1 h and are deleted on use |
| Session hijack after compromise | `revokeSessionsOnPasswordReset: true`: a reset signs out every session |
| Open redirects | `redirectTo` / `callbackURL` must be relative or a trusted origin (Better Auth origin check, enforced in tests too); off-site values return 403 |
| Email flooding | Better Auth rate limits in production: 3 requests/min per IP for `/request-password-reset` and `/send-verification-email` (100/min elsewhere) |
| Secrets and logs | The Resend key is server-side only. Failed sends log only the status, never the message (it contains a token). The `log` transport is refused in production |
| Links | Built from `BETTER_AUTH_URL` (the public web origin), so they work through the Vercel proxy |

## 5. Tests
- `apps/api/test/email-auth.test.ts` (8 tests, required-verification mode with the `file` transport): capabilities, no session before verification, sign-in blocked and link re-sent, link verifies and signs in, tampered link, enumeration-safe sign-up with owner notice, single-use reset with session revocation, identical responses for unknown addresses, off-site redirects refused, configuration validation.
- `apps/web/e2e/password-reset.spec.ts`: the full browser flow (forgot → email → reset → old password refused → new password works → link reused shows "expired"). CI runs the API with `EMAIL_PROVIDER=file` for it.
- The required-verification browser flow (Check your inbox → blocked sign-in → link → Email verified → Continue) was run against a local stack with `REQUIRE_EMAIL_VERIFICATION=true` (production-test-results.md §10).
