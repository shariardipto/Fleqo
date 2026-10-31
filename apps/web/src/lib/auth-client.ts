import { createAuthClient } from "better-auth/react";

// Same-origin: Better Auth is reached through the /api proxy, so cookies are first-party.
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
  basePath: "/api/auth",
});
