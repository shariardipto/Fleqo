import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { env, isProduction } from "../config/env.ts";
import { recordAudit } from "../modules/audit/audit.service.ts";
import { ac, roles } from "./permissions.ts";
import { prisma } from "./prisma.ts";

export const auth = betterAuth({
  appName: "Fleqo",
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.WEB_ORIGINS,
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  // Emails are not verified in the MVP, so invitations must never be discoverable by email.
  // Invitees accept through an invite link (the random invitation ID) shared by the inviter.
  disabledPaths: ["/organization/list-user-invitations"],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: isProduction,
    window: 60,
    max: 100,
  },
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  databaseHooks: {
    session: {
      create: {
        // Start each session in the user's oldest organization so the dashboard has a tenant context.
        before: async (session) => {
          const membership = await prisma.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: "asc" },
            select: { organizationId: true },
          });
          return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
      invitationExpiresIn: 60 * 60 * 48,
      // Not offered in the MVP; deleting an organization would cascade-delete its whole execution history.
      disableOrganizationDeletion: true,
      // MVP sends no email: invitees sign up with the invited address and accept from the Team page.
      sendInvitationEmail: async () => {},
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org, user }) => {
          await recordAudit(prisma, {
            organizationId: org.id,
            actorUserId: user.id,
            action: "organization.created",
            targetType: "organization",
            targetId: org.id,
            metadata: { name: org.name, slug: org.slug },
          });
        },
        afterAddMember: async ({ member, user, organization: org }) => {
          await recordAudit(prisma, {
            organizationId: org.id,
            actorUserId: null,
            action: "member.added",
            targetType: "member",
            targetId: member.id,
            metadata: { userId: user.id, role: member.role },
          });
        },
        afterRemoveMember: async ({ member, organization: org }) => {
          await recordAudit(prisma, {
            organizationId: org.id,
            actorUserId: null,
            action: "member.removed",
            targetType: "member",
            targetId: member.id,
            metadata: { userId: member.userId },
          });
        },
        afterUpdateMemberRole: async ({ member, previousRole, organization: org }) => {
          await recordAudit(prisma, {
            organizationId: org.id,
            actorUserId: null,
            action: "member.role_updated",
            targetType: "member",
            targetId: member.id,
            metadata: { previousRole, role: member.role },
          });
        },
        afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
          await recordAudit(prisma, {
            organizationId: org.id,
            actorUserId: inviter.id,
            action: "invitation.created",
            targetType: "invitation",
            targetId: invitation.id,
            metadata: { email: invitation.email, role: invitation.role },
          });
        },
        afterAcceptInvitation: async ({ invitation, user, organization: org }) => {
          await recordAudit(prisma, {
            organizationId: org.id,
            actorUserId: user.id,
            action: "invitation.accepted",
            targetType: "invitation",
            targetId: invitation.id,
            metadata: { role: invitation.role },
          });
        },
      },
    }),
  ],
});

export type Auth = typeof auth;
