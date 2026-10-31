import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchPending } from "../src/engine/dispatcher.ts";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, connectAll, fakeQueue, joinAsMember, orderSync, signUpWithOrg } from "./helpers/app.ts";
import { resetDatabase } from "./helpers/db.ts";
import { deliver, orderEvent } from "./helpers/events.ts";

const queue = fakeQueue();
const app = buildApp(queue);

async function tenantWithWorkflow(name = "Store A", enabled = true) {
  const owner = await signUpWithOrg(app, name);
  const { signingSecret, publicId } = await connectAll(owner.client);
  await owner.client.post("/api/workflows", { ...orderSync, enabled });
  return { ...owner, secret: signingSecret, publicId };
}

describe("signed webhook ingestion and outbox (M5)", () => {
  beforeEach(async () => {
    await resetDatabase();
    queue.jobs.length = 0;
    queue.failing = false;
  });
  afterAll(() => prisma.$disconnect());

  it("accepts a valid signed event and durably creates run, action runs and dispatch", async () => {
    const tenant = await tenantWithWorkflow();
    const res = await deliver(app, { ...tenant, body: orderEvent(1) });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "accepted", eventId: "demo_evt_0001", matchedWorkflows: 1 });

    const run = await prisma.workflowRun.findUniqueOrThrow({
      where: { id: res.body.runIds[0] },
      include: { actionRuns: { orderBy: { position: "asc" } }, dispatch: true, incomingEvent: true },
    });
    expect(run.organizationId).toBe(tenant.organizationId);
    expect(run.status).toBe("queued");
    expect(run.actionRuns.map((a) => [a.actionType, a.status])).toEqual([
      ["upsert_customer", "queued"],
      ["append_order", "queued"],
    ]);
    expect(run.dispatch?.status).toBe("dispatched");
    expect(run.incomingEvent).toMatchObject({ isSynthetic: true, source: "webhook", payloadSha256: expect.any(String) });
    expect(queue.jobs).toEqual([{ workflowRunId: run.id, dispatchId: run.dispatch!.id, generation: 1 }]);
  });

  it("rejects missing, invalid and tampered signatures without storing anything", async () => {
    const tenant = await tenantWithWorkflow();
    const body = JSON.stringify(orderEvent(1));

    const missing = await request(app).post("/api/webhooks/mock-store").set("Content-Type", "application/json").send(body);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("invalid_signature");

    const wrongSecret = await deliver(app, { ...tenant, secret: "whsec_wrong", body });
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.body.error.code).toBe("invalid_signature");

    const tampered = body.replace("12999", "1");
    const altered = await deliver(app, { ...tenant, body: tampered, signedBody: body });
    expect(altered.status).toBe(401);

    const garbage = await deliver(app, { ...tenant, body, signature: "not-hex" });
    expect(garbage.status).toBe(401);

    expect(await prisma.incomingEvent.count()).toBe(0);
  });

  it("rejects stale and future timestamps (replay window)", async () => {
    const tenant = await tenantWithWorkflow();
    const now = Math.floor(Date.now() / 1000);
    const stale = await deliver(app, { ...tenant, body: orderEvent(1), timestamp: now - 301 });
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe("stale_timestamp");
    const future = await deliver(app, { ...tenant, body: orderEvent(1), timestamp: now + 301 });
    expect(future.status).toBe(401);
    expect(await prisma.incomingEvent.count()).toBe(0);
  });

  it("rejects unknown and disabled connections", async () => {
    const tenant = await tenantWithWorkflow();
    const unknown = await deliver(app, { ...tenant, publicId: "conn_doesnotexist", body: orderEvent(1) });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("unknown_connection");

    const connections = await tenant.client.get("/api/connections");
    const store = connections.body.connections.find((c: { provider: string }) => c.provider === "mock_store");
    await tenant.client.patch(`/api/connections/${store.id}`, { status: "disabled" });
    expect((await deliver(app, { ...tenant, body: orderEvent(1) })).status).toBe(401);
  });

  it("rejects malformed JSON, invalid payloads, wrong content type and oversized bodies", async () => {
    const tenant = await tenantWithWorkflow();
    const malformed = await deliver(app, { ...tenant, body: "{not json" });
    expect(malformed.status).toBe(400);

    const badCurrency = orderEvent(1);
    badCurrency.data.order.currency = "usd";
    const invalid = await deliver(app, { ...tenant, body: badCurrency });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details[0].path).toBe("data.order.currency");

    const negative = orderEvent(2);
    negative.data.order.totalMinor = -5;
    expect((await deliver(app, { ...tenant, body: negative })).status).toBe(422);

    const wrongType = await request(app)
      .post("/api/webhooks/mock-store")
      .set("Content-Type", "text/plain")
      .set("X-Fleqo-Connection-Id", tenant.publicId)
      .send("hello");
    expect(wrongType.status).toBe(400);

    const huge = orderEvent(3, { data: { ...orderEvent(3).data, customer: { ...orderEvent(3).data.customer, name: "x".repeat(70_000) } } });
    expect((await deliver(app, { ...tenant, body: huge })).status).toBe(413);

    expect(await prisma.incomingEvent.count()).toBe(0);
  });

  it("acknowledges duplicates without new runs and rejects event ID reuse with a different payload", async () => {
    const tenant = await tenantWithWorkflow();
    const first = await deliver(app, { ...tenant, body: orderEvent(7) });
    const replay = await deliver(app, { ...tenant, body: orderEvent(7) });
    const reformatted = await deliver(app, { ...tenant, body: JSON.stringify(orderEvent(7), null, 2) });
    expect(first.status).toBe(202);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ status: "duplicate", runIds: first.body.runIds });
    expect(reformatted.body.status).toBe("duplicate");

    expect(await prisma.workflowRun.count()).toBe(1);
    expect(queue.jobs).toHaveLength(1);
    const event = await prisma.incomingEvent.findFirstOrThrow();
    expect(event.duplicateCount).toBe(2);

    const changed = orderEvent(7);
    changed.data.order.totalMinor = 1;
    const conflict = await deliver(app, { ...tenant, body: changed });
    expect(conflict.status).toBe(409);
  });

  it("derives the tenant only from the verified connection", async () => {
    const a = await tenantWithWorkflow("Tenant A");
    const b = await tenantWithWorkflow("Tenant B");
    // B's connection ID with A's secret is rejected.
    expect((await deliver(app, { publicId: b.publicId, secret: a.secret, body: orderEvent(1) })).status).toBe(401);

    // A body claiming another organization is ignored: the event belongs to the signer.
    const res = await deliver(app, { ...b, body: { ...orderEvent(1), organizationId: a.organizationId } });
    expect(res.status).toBe(202);
    const event = await prisma.incomingEvent.findUniqueOrThrow({ where: { id: res.body.incomingEventId } });
    expect(event.organizationId).toBe(b.organizationId);

    // The same external event ID is independent per tenant.
    expect((await deliver(app, { ...a, body: orderEvent(1) })).status).toBe(202);
  });

  it("keeps event intent when Redis is down and recovers it through the outbox dispatcher", async () => {
    const tenant = await tenantWithWorkflow();
    queue.failing = true;
    const res = await deliver(app, { ...tenant, body: orderEvent(42) });
    expect(res.status).toBe(202);

    const pending = await prisma.eventDispatch.findFirstOrThrow();
    expect(pending.status).toBe("pending");
    expect(pending.lastError).toContain("Simulated Redis outage");
    expect(queue.jobs).toHaveLength(0);

    // Redis comes back; make the backoff due and run the dispatcher (as the worker's poller does).
    queue.failing = false;
    await prisma.eventDispatch.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date() } });
    const result = await dispatchPending(queue);
    expect(result).toEqual({ dispatched: 1, failed: 0 });
    expect((await prisma.eventDispatch.findFirstOrThrow()).status).toBe("dispatched");
    expect(queue.jobs).toHaveLength(1);

    // A second pass finds nothing to do.
    expect(await dispatchPending(queue)).toEqual({ dispatched: 0, failed: 0 });
  });

  it("records events with no matching active workflow but creates no runs", async () => {
    const tenant = await tenantWithWorkflow("Idle", false);
    const res = await deliver(app, { ...tenant, body: orderEvent(1) });
    expect(res.status).toBe(202);
    expect(res.body.matchedWorkflows).toBe(0);
    expect(await prisma.workflowRun.count()).toBe(0);
  });

  it("simulates signed synthetic orders through the same ingestion path (members allowed)", async () => {
    const tenant = await tenantWithWorkflow();
    expect((await tenant.client.post("/api/demo/simulate-order", { count: 1 })).status).toBe(409);
    await tenant.client.post("/api/demo/import", { source: "fleqo_synthetic", limit: 5 });

    const res = await tenant.client.post("/api/demo/simulate-order", { count: 3 });
    expect(res.status).toBe(202);
    expect(res.body.deliveries).toHaveLength(3);
    expect(res.body.deliveries.every((d: { status: string }) => d.status === "accepted")).toBe(true);

    const events = await prisma.incomingEvent.findMany();
    expect(events.every((event) => event.isSynthetic && event.source === "simulator")).toBe(true);

    const resend = await tenant.client.post("/api/demo/simulate-order", { duplicateOfEventId: events[0].externalEventId });
    expect(resend.body.deliveries[0].status).toBe("duplicate");
    expect(await prisma.workflowRun.count()).toBe(3);

    const member = await joinAsMember(app, tenant.client, "sim@example.test");
    expect((await member.client.post("/api/demo/simulate-order", { count: 1 })).status).toBe(202);
  });
});
