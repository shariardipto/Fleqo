import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, client, joinAsMember, PASSWORD, signUp, signUpWithOrg } from "./helpers/app.ts";
import { resetDatabase } from "./helpers/db.ts";

const app = buildApp();

describe("release security controls", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("signs in with the right password only, and the session persists until sign-out", async () => {
    const { email } = await signUp(app);
    const fresh = client(app);
    expect((await fresh.post("/api/auth/sign-in/email", { email, password: "wrong-password-123" })).status).toBe(401);
    expect((await fresh.get("/api/me")).status).toBe(401);

    expect((await fresh.post("/api/auth/sign-in/email", { email, password: PASSWORD })).status).toBe(200);
    expect((await fresh.get("/api/me")).body.user.email).toBe(email);
    expect((await fresh.get("/api/me")).status).toBe(200); // cookie reused across requests

    expect((await fresh.post("/api/auth/sign-out")).status).toBe(200);
    expect((await fresh.get("/api/me")).status).toBe(401);
  });

  it("never exposes invitations by (unverified) email; only the invite-link ID works, and only for the recipient", async () => {
    const owner = await signUpWithOrg(app, "Invite Co");
    const invited = await owner.client.post("/api/team/invitations", { email: "victim@example.test", role: "admin" });
    const invitationId = invited.body.invitation.id as string;

    // An attacker registers the invitee's address (emails are not verified in the MVP)...
    const squatter = await signUp(app, "victim@example.test");
    // ...but cannot discover the invitation through Fleqo or directly through Better Auth.
    expect((await squatter.client.get("/api/invitations")).status).toBe(404);
    expect((await squatter.client.get("/api/auth/organization/list-user-invitations")).status).toBe(404);

    // A different user who somehow learns the ID cannot read or accept it.
    const other = await signUp(app, "other@example.test");
    expect((await other.client.get(`/api/invitations/${invitationId}`)).status).toBe(403);
    expect((await other.client.post(`/api/invitations/${invitationId}/accept`)).status).toBe(403);
    expect(await prisma.member.count({ where: { organizationId: owner.organizationId } })).toBe(1);
  });

  it("rejects cookie-authenticated state changes from untrusted or missing origins (CSRF defense in depth)", async () => {
    const owner = await signUpWithOrg(app);
    const cookie = (await request(app).post("/api/auth/sign-in/email").set("Origin", "http://localhost:3000").send({
      email: owner.email,
      password: PASSWORD,
    })).headers["set-cookie"];

    const evil = await request(app).post("/api/connections").set("Cookie", cookie).set("Origin", "https://evil.example").send({ provider: "mock_crm" });
    expect(evil.status).toBe(403);
    const noOrigin = await request(app).post("/api/connections").set("Cookie", cookie).send({ provider: "mock_crm" });
    expect(noOrigin.status).toBe(403);
    const refererOnly = await request(app)
      .post("/api/connections")
      .set("Cookie", cookie)
      .set("Referer", "http://localhost:3000/connections")
      .send({ provider: "mock_crm" });
    expect(refererOnly.status).toBe(201);
    // Safe methods are unaffected.
    expect((await request(app).get("/api/connections").set("Cookie", cookie).set("Origin", "https://evil.example")).status).toBe(200);
    expect(await prisma.integrationConnection.count()).toBe(1);
  });

  it("marks API responses as non-cacheable and does not reveal the framework", async () => {
    const owner = await signUpWithOrg(app);
    const res = await owner.client.get("/api/me");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("does not allow deleting an organization (would erase execution history)", async () => {
    const owner = await signUpWithOrg(app);
    const res = await owner.client.post("/api/auth/organization/delete", { organizationId: owner.organizationId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.organization.count({ where: { id: owner.organizationId } })).toBe(1);
  });

  it("returns sanitized errors without internals", async () => {
    const owner = await signUpWithOrg(app);
    const missing = await owner.client.get("/api/workflows/does-not-exist");
    expect(missing.status).toBe(404);
    expect(Object.keys(missing.body.error).sort()).toEqual(["code", "message", "requestId"]);
    const malformed = await request(app).post("/api/organizations").set("Origin", "http://localhost:3000").set("Content-Type", "application/json").send("{bad json");
    expect([400, 401]).toContain(malformed.status);
    expect(JSON.stringify(malformed.body)).not.toMatch(/stack|prisma|at \w+ \(/i);
  });

  it("admin role can manage but members stay read-only through the invite flow", async () => {
    const owner = await signUpWithOrg(app);
    const admin = await joinAsMember(app, owner.client, "admin@example.test", "admin");
    expect((await admin.client.post("/api/connections", { provider: "mock_crm" })).status).toBe(201);
    const member = await joinAsMember(app, owner.client, "member@example.test");
    expect((await member.client.post("/api/connections", { provider: "mock_sheet" })).status).toBe(403);
    expect((await member.client.get("/api/audit-logs")).status).toBe(403);
    expect((await admin.client.get("/api/audit-logs")).status).toBe(200);
  });
});
