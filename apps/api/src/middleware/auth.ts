import { fromNodeHeaders } from "better-auth/node";
import type { Request, RequestHandler } from "express";
import { auth } from "../lib/auth.ts";
import { AppError } from "../lib/errors.ts";
import { roleHasPermission, type PermissionRequest } from "../lib/permissions.ts";
import { prisma } from "../lib/prisma.ts";
import type { OrgContext, SessionContext } from "../types/context.ts";

async function loadSession(req: Request): Promise<SessionContext> {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!result) throw new AppError("unauthenticated", "Sign in to continue");

  req.sessionContext = {
    userId: result.user.id,
    sessionId: result.session.id,
    user: { id: result.user.id, email: result.user.email, name: result.user.name },
    activeOrganizationId: result.session.activeOrganizationId ?? null,
  };
  return req.sessionContext;
}

export const requireSession: RequestHandler = async (req, _res, next) => {
  await loadSession(req);
  next();
};

/**
 * Resolves the tenant from the server-side session (never from request input),
 * re-verifies membership in the database on every request, then checks the role's permissions.
 */
export function requireOrg(permission?: PermissionRequest): RequestHandler {
  return async (req, _res, next) => {
    const session = await loadSession(req);
    if (!session.activeOrganizationId) {
      throw new AppError("no_active_organization", "Create or select an organization first");
    }

    const member = await prisma.member.findUnique({
      where: { organizationId_userId: { organizationId: session.activeOrganizationId, userId: session.userId } },
      select: { id: true, role: true },
    });
    if (!member) throw new AppError("forbidden", "You are not a member of this organization");

    if (permission && !roleHasPermission(member.role, permission)) {
      throw new AppError("forbidden", "Your role does not allow this action");
    }

    req.orgContext = { ...session, organizationId: session.activeOrganizationId, memberId: member.id, role: member.role };
    next();
  };
}

export function sessionOf(req: Request): SessionContext {
  if (!req.sessionContext) throw new AppError("unauthenticated", "Sign in to continue");
  return req.sessionContext;
}

export function orgOf(req: Request): OrgContext {
  if (!req.orgContext) throw new AppError("forbidden", "Organization context missing");
  return req.orgContext;
}

export const authHeaders = (req: Request) => fromNodeHeaders(req.headers);
