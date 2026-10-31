import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, client, signUp, signUpWithOrg } from "./helpers/app.ts";
import { resetDatabase } from "./helpers/db.ts";

const app = buildApp();

describe("authentication and organizations (M2)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("rejects unauthenticated access to protected routes", async () => {
    const anon = client(app);
    for (const url of ["/api/me", "/api/organization", "/api/team"]) {
      const res = await anon.get(url);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
    }
  });

  it("signs up, requires an organization, then creates one as owner", async () => {
    const { client: user } = await signUp(app);
    const me = await user.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.activeOrganization).toBeNull();

    const noOrg = await user.get("/api/organization");
    expect(noOrg.status).toBe(409);
    expect(noOrg.body.error.code).toBe("no_active_organization");

    const created = await user.post("/api/organizations", { name: "Acme Store" });
    expect(created.status).toBe(201);

    const after = await user.get("/api/me");
    expect(after.body.activeOrganization).toMatchObject({ name: "Acme Store", role: "owner" });
    expect(after.body.activeOrganization.permissions.workflow).toEqual(["read", "manage"]);

    const audit = await prisma.auditLog.findMany({ where: { organizationId: created.body.organization.id } });
    expect(audit.map((entry) => entry.action)).toContain("organization.created");
  });

  it("signs out and invalidates the session", async () => {
    const { client: user } = await signUpWithOrg(app);
    expect((await user.post("/api/auth/sign-out")).status).toBe(200);
    expect((await user.get("/api/me")).status).toBe(401);
  });

  it("prevents a user from switching into or reading another organization", async () => {
    const alice = await signUpWithOrg(app, "Alice Co");
    const bob = await signUpWithOrg(app, "Bob Co");

    const hijack = await bob.client.post("/api/organizations/active", { organizationId: alice.organizationId });
    expect(hijack.status).toBe(404);

    // Calling Better Auth directly is refused too, and it fails closed by clearing the active organization.
    const direct = await bob.client.post("/api/auth/organization/set-active", { organizationId: alice.organizationId });
    expect(direct.status).toBe(403);
    expect((await bob.client.get("/api/team")).status).toBe(409);

    expect((await bob.client.post("/api/organizations/active", { organizationId: bob.organizationId })).status).toBe(200);
    const team = await bob.client.get("/api/team");
    expect(team.status).toBe(200);
    expect(team.body.members).toHaveLength(1);
    expect(team.body.members[0].user.email).toBe(bob.email);

    const org = await bob.client.get("/api/organization");
    expect(org.body.organization.id).toBe(bob.organizationId);
  });

  it("enforces roles: invited member cannot administer, owner can change roles and remove", async () => {
    const owner = await signUpWithOrg(app, "Role Co");
    const invited = await owner.client.post("/api/team/invitations", { email: "member@example.test", role: "member" });
    expect(invited.status).toBe(201);

    // Invite-link flow: the recipient opens the link (invitation ID), sees details, accepts.
    const member = await signUp(app, "member@example.test");
    const details = await member.client.get(`/api/invitations/${invited.body.invitation.id}`);
    expect(details.status).toBe(200);
    expect(details.body.invitation).toMatchObject({ role: "member", organization: { id: owner.organizationId, name: "Role Co" } });
    const accepted = await member.client.post(`/api/invitations/${invited.body.invitation.id}/accept`);
    expect(accepted.status).toBe(200);

    const me = await member.client.get("/api/me");
    expect(me.body.activeOrganization).toMatchObject({ id: owner.organizationId, role: "member" });

    expect((await member.client.post("/api/team/invitations", { email: "x@example.test", role: "member" })).status).toBe(403);
    expect((await member.client.patch("/api/organization", { name: "Hacked" })).status).toBe(403);

    const team = await owner.client.get("/api/team");
    const memberRow = team.body.members.find((m: { user: { email: string } }) => m.user.email === "member@example.test");
    expect((await owner.client.patch(`/api/team/members/${memberRow.id}`, { role: "admin" })).status).toBe(200);
    expect((await member.client.patch("/api/organization", { name: "Renamed by admin" })).status).toBe(200);

    expect((await owner.client.delete(`/api/team/members/${memberRow.id}`)).status).toBe(204);
    // The removed user's session still points at the org, but membership is re-checked on every request.
    const afterRemoval = await member.client.get("/api/organization");
    expect([403, 409]).toContain(afterRemoval.status);
  });

  it("validates input with machine-readable errors", async () => {
    const { client: user } = await signUp(app);
    const res = await user.post("/api/organizations", { name: "" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.details[0].path).toBe("name");
  });
});
