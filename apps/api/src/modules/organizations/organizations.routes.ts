import { Router } from "express";
import { z } from "zod";
import { auth } from "../../lib/auth.ts";
import { AppError } from "../../lib/errors.ts";
import { idParam } from "../../lib/http.ts";
import { roleHasPermission, roles, statement, type PermissionRequest, type Resource } from "../../lib/permissions.ts";
import { prisma } from "../../lib/prisma.ts";
import { authHeaders, orgOf, requireOrg, requireSession, sessionOf } from "../../middleware/auth.ts";

const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens");

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema.optional(),
});

const updateOrganizationSchema = z.object({ name: z.string().trim().min(2).max(80) });
const setActiveSchema = z.object({ organizationId: z.string().min(1) });
const inviteSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["admin", "member"]),
});
const roleSchema = z.object({ role: z.enum(["owner", "admin", "member"]) });

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Flattened permission map for the UI. Server routes still enforce every check themselves. */
function permissionsFor(role: string) {
  const result: Record<string, string[]> = {};
  for (const resource of Object.keys(statement) as Resource[]) {
    result[resource] = statement[resource].filter((action) =>
      roleHasPermission(role, { [resource]: [action] } as PermissionRequest),
    );
  }
  return result;
}

export function organizationsRouter() {
  const router = Router();

  // Current user, memberships and the active organization's role/permissions.
  router.get("/me", requireSession, async (req, res) => {
    const session = sessionOf(req);
    const memberships = await prisma.member.findMany({
      where: { userId: session.userId },
      include: { organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "asc" },
    });
    const active = memberships.find((m) => m.organizationId === session.activeOrganizationId) ?? null;
    res.json({
      user: session.user,
      activeOrganization: active
        ? { ...active.organization, role: active.role, permissions: permissionsFor(active.role) }
        : null,
      organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
    });
  });

  router.post("/organizations", requireSession, async (req, res) => {
    const input = createOrganizationSchema.parse(req.body);
    const org = await auth.api.createOrganization({
      body: { name: input.name, slug: input.slug ?? slugify(input.name) },
      headers: authHeaders(req),
    });
    if (!org) throw new AppError("internal_error", "Organization could not be created");
    // Make the new organization the session's tenant context.
    await auth.api.setActiveOrganization({ body: { organizationId: org.id }, headers: authHeaders(req) });
    res.status(201).json({ organization: { id: org.id, name: org.name, slug: org.slug, role: "owner" } });
  });

  router.post("/organizations/active", requireSession, async (req, res) => {
    const { organizationId } = setActiveSchema.parse(req.body);
    const session = sessionOf(req);
    const member = await prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId: session.userId } },
    });
    // Same response for "does not exist" and "not a member" so org IDs cannot be probed.
    if (!member) throw new AppError("not_found", "Organization not found");
    await auth.api.setActiveOrganization({ body: { organizationId }, headers: authHeaders(req) });
    res.json({ activeOrganizationId: organizationId });
  });

  router.get("/organization", requireOrg(), async (req, res) => {
    const ctx = orgOf(req);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { id: true, name: true, slug: true, createdAt: true },
    });
    res.json({ organization: { ...org, role: ctx.role, permissions: permissionsFor(ctx.role) } });
  });

  router.patch("/organization", requireOrg({ organization: ["update"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = updateOrganizationSchema.parse(req.body);
    await auth.api.updateOrganization({
      body: { organizationId: ctx.organizationId, data: { name: input.name } },
      headers: authHeaders(req),
    });
    res.json({ organization: { id: ctx.organizationId, name: input.name } });
  });

  // ── Team ────────────────────────────────────────────────────────────────
  router.get("/team", requireOrg(), async (req, res) => {
    const ctx = orgOf(req);
    const [members, invitations] = await Promise.all([
      prisma.member.findMany({
        where: { organizationId: ctx.organizationId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      }),
      roleHasPermission(ctx.role, { invitation: ["create"] })
        ? prisma.invitation.findMany({
            where: { organizationId: ctx.organizationId, status: "pending" },
            orderBy: { createdAt: "desc" },
            select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);
    res.json({
      members: members.map((m) => ({ id: m.id, role: m.role, createdAt: m.createdAt, user: m.user })),
      invitations,
      roles: Object.keys(roles),
    });
  });

  router.post("/team/invitations", requireOrg({ invitation: ["create"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = inviteSchema.parse(req.body);
    const invitation = await auth.api.createInvitation({
      body: { email: input.email, role: input.role, organizationId: ctx.organizationId },
      headers: authHeaders(req),
    });
    res.status(201).json({ invitation });
  });

  router.delete("/team/invitations/:id", requireOrg({ invitation: ["cancel"] }), async (req, res) => {
    const ctx = orgOf(req);
    const invitation = await prisma.invitation.findFirst({
      where: { id: idParam(req), organizationId: ctx.organizationId },
    });
    if (!invitation) throw new AppError("not_found", "Invitation not found");
    await auth.api.cancelInvitation({ body: { invitationId: invitation.id }, headers: authHeaders(req) });
    res.status(204).end();
  });

  router.patch("/team/members/:id", requireOrg({ member: ["update"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = roleSchema.parse(req.body);
    const member = await prisma.member.findFirst({ where: { id: idParam(req), organizationId: ctx.organizationId } });
    if (!member) throw new AppError("not_found", "Member not found");
    await auth.api.updateMemberRole({
      body: { memberId: member.id, role: input.role, organizationId: ctx.organizationId },
      headers: authHeaders(req),
    });
    res.json({ member: { id: member.id, role: input.role } });
  });

  router.delete("/team/members/:id", requireOrg({ member: ["delete"] }), async (req, res) => {
    const ctx = orgOf(req);
    const member = await prisma.member.findFirst({ where: { id: idParam(req), organizationId: ctx.organizationId } });
    if (!member) throw new AppError("not_found", "Member not found");
    await auth.api.removeMember({
      body: { memberIdOrEmail: member.id, organizationId: ctx.organizationId },
      headers: authHeaders(req),
    });
    res.status(204).end();
  });

  // Invitations are accepted via an invite link carrying the invitation ID, shared by the inviter.
  // Email addresses are not verified in the MVP, so pending invitations are never listed by email:
  // otherwise anyone could register an invitee's address and join the organization.
  router.get("/invitations/:id", requireSession, async (req, res) => {
    const invitation = await auth.api.getInvitation({ query: { id: idParam(req) }, headers: authHeaders(req) });
    res.json({
      invitation: {
        id: invitation.id,
        role: invitation.role,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        organization: { id: invitation.organizationId, name: invitation.organizationName },
        inviterEmail: invitation.inviterEmail,
      },
    });
  });

  router.post("/invitations/:id/accept", requireSession, async (req, res) => {
    const result = await auth.api.acceptInvitation({
      body: { invitationId: idParam(req) },
      headers: authHeaders(req),
    });
    const organizationId = result?.invitation.organizationId;
    if (organizationId) {
      await auth.api.setActiveOrganization({ body: { organizationId }, headers: authHeaders(req) });
    }
    res.json({ organizationId });
  });

  return router;
}
