import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { env, isProduction } from "../config/env.ts";
import { recordAudit } from "../modules/audit/audit.service.ts";
import { existingAccountEmail, passwordResetEmail, verificationEmail } from "./emails.ts";
import { mailer } from "./mailer.ts";
import { ac, roles } from "./permissions.ts";
import { prisma } from "./prisma.ts";
import { socialProviders } from "./social-providers.ts";

export const auth = betterAuth({
  appName: "Fleqo",
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  // Apple returns from sign-in with a form POST from its own origin.
  trustedOrigins: socialProviders.providers.apple ? [...env.WEB_ORIGINS, "https://appleid.apple.com"] : env.WEB_ORIGINS,
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  // Email/password addresses are unverified unless an email provider is configured, so invitations
  // are never discoverable by email: invitees accept through an invite link (the random invitation ID).
  disabledPaths: ["/organization/list-user-invitations"],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    // With REQUIRE_EMAIL_VERIFICATION, sign-up creates no session until the link is opened, and a
    // sign-up for an existing address returns a look-alike response (no account enumeration).
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    ...(mailer.enabled && {
      sendResetPassword: async ({ user, url }) => mailer.dispatch(passwordResetEmail(user, url), "password-reset"),
      onExistingUserSignUp: async ({ user }) =>
        mailer.dispatch(existingAccountEmail(user, `${env.BETTER_AUTH_URL}/sign-in`), "existing-account"),
    }),
  },
  ...(mailer.enabled && {
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => mailer.dispatch(verificationEmail(user, url), "verification"),
      sendOnSignUp: true,
      // Re-send when an unverified user tries to sign in (only blocked when verification is required).
      sendOnSignIn: env.REQUIRE_EMAIL_VERIFICATION,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
    },
  }),
  socialProviders: socialProviders.providers,
  account: {
    accountLinking: {
      enabled: true,
      // A social identity is only merged into an existing account when BOTH sides prove the email:
      // the provider says it is verified and the local account's email is verified. An unverified
      // email/password account (possibly pre-registered by an attacker) can therefore never capture
      // someone's Google/GitHub/Apple/X identity.
      requireLocalEmailVerified: true,
      trustedProviders: [],
      allowDifferentEmails: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: isProduction,
    window: 60,
    max: 100,
    // Each of these sends an email to an address the caller chooses.
    customRules: {
      "/request-password-reset": { window: 60, max: 3 },
      "/send-verification-email": { window: 60, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
    // Better Auth skips origin/callbackURL validation when it detects a test runner. Enforce it
    // everywhere so tests exercise the same open-redirect and CSRF protection as production.
    disableOriginCheck: false,
    disableCSRFCheck: false,
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
      // Invitations are shared as links by the inviter; no invitation email is sent.
      sendInvitationEmail: async () => {},
      // When public registration requires verified emails, so does accepting an invitation.
      requireEmailVerificationOnInvitation: env.REQUIRE_EMAIL_VERIFICATION,
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
