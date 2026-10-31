import "express";

export interface SessionContext {
  userId: string;
  sessionId: string;
  user: { id: string; email: string; name: string };
  activeOrganizationId: string | null;
}

export interface OrgContext extends SessionContext {
  organizationId: string;
  memberId: string;
  role: string;
}

declare module "express-serve-static-core" {
  interface Request {
    sessionContext?: SessionContext;
    orgContext?: OrgContext;
  }
}
