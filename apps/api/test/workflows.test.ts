import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, connectAll, joinAsMember, orderSync, signUpWithOrg } from "./helpers/app.ts";
import { resetDatabase } from "./helpers/db.ts";

const app = buildApp();

describe("workflow configuration (M4)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("creates an active Order Sync workflow with default mappings", async () => {
    const owner = await signUpWithOrg(app);
    await connectAll(owner.client);

    const catalog = await owner.client.get("/api/workflows/catalog");
    expect(catalog.body.actions.map((a: { key: string }) => a.key)).toEqual(["mock_crm.upsert_customer", "mock_sheet.append_order"]);

    const res = await owner.client.post("/api/workflows", orderSync);
    expect(res.status).toBe(201);
    expect(res.body.workflow).toMatchObject({
      name: "Order Sync",
      status: "active",
      trigger: { provider: "mock_store", eventType: "order.created" },
    });
    expect(res.body.workflow.actions.map((a: { key: string; position: number }) => [a.position, a.key])).toEqual([
      [1, "mock_crm.upsert_customer"],
      [2, "mock_sheet.append_order"],
    ]);
    expect(res.body.workflow.actions[0].mapping.email).toBe("data.customer.email");

    const list = await owner.client.get("/api/workflows");
    expect(list.body.workflows).toHaveLength(1);
  });

  it("requires the connections the workflow uses", async () => {
    const owner = await signUpWithOrg(app);
    await owner.client.post("/api/connections", { provider: "mock_store" });
    const res = await owner.client.post("/api/workflows", orderSync);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/mock crm/i);
  });

  it("rejects incompatible or incomplete mappings with field-level details", async () => {
    const owner = await signUpWithOrg(app);
    await connectAll(owner.client);

    const wrongType = await owner.client.post("/api/workflows", {
      name: "Bad",
      actions: [{ key: "mock_crm.upsert_customer", mapping: { externalId: "data.customer.externalId", email: "data.order.totalMinor" } }],
    });
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error.details[0].path).toBe("mock_crm.upsert_customer.email");

    const missing = await owner.client.post("/api/workflows", {
      name: "Bad",
      actions: [{ key: "mock_sheet.append_order", mapping: { orderId: "data.order.id" } }],
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.map((d: { path: string }) => d.path)).toContain("mock_sheet.append_order.totalMinor");

    const unknownPath = await owner.client.post("/api/workflows", {
      name: "Bad",
      actions: [{ key: "mock_crm.upsert_customer", mapping: { externalId: "data.secret", email: "data.customer.email" } }],
    });
    expect(unknownPath.status).toBe(422);
  });

  it("updates mappings, toggles status, guards activation and archives", async () => {
    const owner = await signUpWithOrg(app);
    await connectAll(owner.client);
    const created = await owner.client.post("/api/workflows", { ...orderSync, enabled: false });
    const workflow = created.body.workflow;
    expect(workflow.status).toBe("inactive");

    const sheetAction = workflow.actions[1];
    const patched = await owner.client.patch(`/api/workflows/${workflow.id}`, {
      name: "Order Sync v2",
      actions: [{ id: sheetAction.id, mapping: { ...sheetAction.mapping, customerName: "" }, config: { sheetName: "Q4" } }],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.workflow.actions[1].config).toEqual({ sheetName: "Q4" });

    const connections = await owner.client.get("/api/connections");
    const crm = connections.body.connections.find((c: { provider: string }) => c.provider === "mock_crm");
    await owner.client.patch(`/api/connections/${crm.id}`, { status: "disabled" });
    expect((await owner.client.patch(`/api/workflows/${workflow.id}`, { status: "active" })).status).toBe(409);

    await owner.client.patch(`/api/connections/${crm.id}`, { status: "active" });
    expect((await owner.client.patch(`/api/workflows/${workflow.id}`, { status: "active" })).body.workflow.status).toBe("active");

    expect((await owner.client.delete(`/api/workflows/${workflow.id}`)).status).toBe(204);
    expect((await owner.client.get("/api/workflows")).body.workflows).toHaveLength(0);
    expect((await owner.client.get("/api/workflows?includeArchived=true")).body.workflows[0].status).toBe("archived");
    expect((await owner.client.patch(`/api/workflows/${workflow.id}`, { status: "active" })).status).toBe(409);

    const audit = await prisma.auditLog.findMany({ where: { targetId: workflow.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((entry) => entry.action)).toEqual(["workflow.created", "workflow.updated", "workflow.enabled", "workflow.archived"]);
  });

  it("isolates workflows between tenants and limits members to read access", async () => {
    const owner = await signUpWithOrg(app, "Tenant A");
    await connectAll(owner.client);
    const created = await owner.client.post("/api/workflows", orderSync);
    const id = created.body.workflow.id;

    const outsider = await signUpWithOrg(app, "Tenant B");
    expect((await outsider.client.get("/api/workflows")).body.workflows).toHaveLength(0);
    expect((await outsider.client.get(`/api/workflows/${id}`)).status).toBe(404);
    expect((await outsider.client.patch(`/api/workflows/${id}`, { status: "inactive" })).status).toBe(404);
    expect((await outsider.client.delete(`/api/workflows/${id}`)).status).toBe(404);

    const member = await joinAsMember(app, owner.client, "reader@example.test");
    expect((await member.client.get(`/api/workflows/${id}`)).status).toBe(200);
    expect((await member.client.patch(`/api/workflows/${id}`, { status: "inactive" })).status).toBe(403);
    expect((await member.client.post("/api/workflows", orderSync)).status).toBe(403);
  });
});
