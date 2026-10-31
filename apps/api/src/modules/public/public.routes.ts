import { Router } from "express";
import { socialProviders } from "../../lib/social-providers.ts";

/** Unauthenticated, non-sensitive configuration for the public website and auth pages. */
export function publicRouter() {
  const router = Router();

  // Only providers with complete server-side credentials are listed; secrets never leave the server.
  router.get("/public/auth-providers", (_req, res) => {
    res.json({ emailPassword: true, providers: socialProviders.enabled });
  });

  return router;
}
