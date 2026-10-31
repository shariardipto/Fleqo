import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Defense-in-depth CSRF protection for cookie-authenticated, state-changing requests
 * (SameSite=Lax cookies and CORS are the first line). Requests without cookies carry no
 * ambient credentials and are left to the route's own authentication.
 */
export function requireTrustedOrigin(trustedOrigins: string[]): RequestHandler {
  const allowed = new Set(trustedOrigins.map((origin) => originOf(origin)).filter(Boolean));
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method) || !req.headers.cookie) return next();
    const origin = originOf(req.headers.origin) ?? originOf(req.headers.referer);
    if (!origin || !allowed.has(origin)) {
      throw new AppError("forbidden", "Request origin is not allowed");
    }
    next();
  };
}
