import { Router } from "express";
import { env } from "../../config/env.ts";
import { mailer } from "../../lib/mailer.ts";
import { socialProviders } from "../../lib/social-providers.ts";

/** Unauthenticated, non-sensitive configuration for the public website and auth pages. */
export function publicRouter() {
  const router = Router();

  // Only providers with complete server-side credentials are listed; secrets never leave the server.
  router.get("/public/auth-providers", (_req, res) => {
    res.json({
      emailPassword: true,
      providers: socialProviders.enabled,
      // The sign-in page offers "Forgot password?" only when reset emails can actually be sent.
      passwordReset: mailer.enabled,
      emailVerification: env.REQUIRE_EMAIL_VERIFICATION ? "required" : mailer.enabled ? "optional" : "off",
    });
  });

  return router;
}
