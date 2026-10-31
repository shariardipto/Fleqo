import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchPending } from "../src/engine/dispatcher.ts";
import { recoverStaleRuns } from "../src/engine/recovery.ts";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, connectAll, fakeQueue, joinAsMember, orderSync, signUpWithOrg } from "./helpers/app.ts";
import { resetDatabase } from "./helpers/db.ts";
import { deliver, orderEvent } from "./helpers/events.ts";
import { clearTestQueue, startTestWorkers, waitFor, waitForRunsFinished } from "./helpers/worker.ts";

let workers: ReturnType<typeof startTestWorkers>;
let app: ReturnType<typeof buildApp>;

async function tenant(name = "Worker Co") {
  const owner = await signUpWithOrg(app, name);
  const { signingSecret, publicId } = await connectAll(owner.client);
  await owner.client.post("/api/workflows", orderSync);
  return { ...owner, secret: signingSecret, publicId };
}

const runWithActions = (id: string) =>
  prisma.workflowRun.findUniqueOrThrow({
    where: { id },
    include: { actionRuns: { orderBy: { position: "asc" } }, deadLetters: true, logs: true },
  });

describe("worker execution, idempotency and recovery (M6)", () => {
  beforeAll(async () => {
    await clearTestQueue();
    workers = startTestWorkers();
    app = buildApp(workers.runQueue);
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await workers.close();
    await prisma.$disconnect();
  });

  it("executes CRM upsert then Sheet append and records action-level logs", async () => {
    const t = await tenant();
    const res = await deliver(app, { ...t, body: orderEvent(1) });
    await waitForRunsFinished(1);

    const run = await runWithActions(res.body.runIds[0]);
    expect(run.status).toBe("succeeded");
    expect(run.actionRuns.map((a) => [a.actionType, a.status, a.attempts])).toEqual([
      ["upsert_customer", "succeeded", 1],
      ["append_order", "succeeded", 1],
    ]);
    expect(run.actionRuns[0].output).toMatchObject({ operation: "created" });
    expect(run.logs.some((log) => log.message.includes("Run succeeded"))).toBe(true);

    expect(await prisma.mockCustomer.count()).toBe(1);
    const row = await prisma.mockSheetRow.findFirstOrThrow();
    expect(row).toMatchObject({ orderExternalId: "demo_order_0001", totalMinor: 12999, currency: "USD", sheetName: "Orders" });
  });

  it("does not re-execute duplicate events", async () => {
    const t = await tenant();
    await deliver(app, { ...t, body: orderEvent(1) });
    await waitForRunsFinished(1);
    const again = await deliver(app, { ...t, body: orderEvent(1) });
    expect(again.body.status).toBe("duplicate");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await prisma.workflowRun.count()).toBe(1);
    expect(await prisma.mockSheetRow.count()).toBe(1);
  });

  it("retries transient failures with backoff and never repeats the completed CRM action", async () => {
    const t = await tenant();
    const res = await deliver(app, {
      ...t,
      body: orderEvent(2, { simulation: { failures: { "mock_sheet.append_order": 2 } } }),
    });
    await waitForRunsFinished(1);

    const run = await runWithActions(res.body.runIds[0]);
    expect(run.status).toBe("succeeded");
    expect(run.attempts).toBe(3);
    expect(run.actionRuns.map((a) => [a.actionType, a.attempts])).toEqual([
      ["upsert_customer", 1],
      ["append_order", 3],
    ]);
    expect(run.logs.filter((log) => log.message.includes("already succeeded; not repeated"))).toHaveLength(2);
    expect(run.logs.filter((log) => log.level === "warn")).toHaveLength(2);
    expect(await prisma.mockCustomer.count()).toBe(1);
    expect(await prisma.mockSheetRow.count()).toBe(1);
  });

  it("dead-letters exhausted runs, then a manual retry completes only the failed action", async () => {
    const t = await tenant();
    const res = await deliver(app, {
      ...t,
      body: orderEvent(3, { simulation: { failures: { "mock_sheet.append_order": 5 } } }),
    });
    const runId = res.body.runIds[0];
    await waitForRunsFinished(1);

    let run = await runWithActions(runId);
    expect(run.status).toBe("failed");
    expect(run.actionRuns.map((a) => [a.status, a.attempts])).toEqual([
      ["succeeded", 1],
      ["failed", 4],
    ]);
    expect(run.deadLetters).toHaveLength(1);
    expect(run.deadLetters[0]).toMatchObject({ reason: "retries_exhausted", attempts: 4, resolvedAt: null });
    expect(await prisma.mockSheetRow.count()).toBe(0);

    // Members may not retry; another tenant cannot even see the run.
    const member = await joinAsMember(app, t.client, "ops@example.test");
    expect((await member.client.post(`/api/executions/${runId}/retry`)).status).toBe(403);
    const outsider = await signUpWithOrg(app, "Outsider");
    expect((await outsider.client.get(`/api/executions/${runId}`)).status).toBe(404);
    expect((await outsider.client.post(`/api/executions/${runId}/retry`)).status).toBe(404);

    const retry = await t.client.post(`/api/executions/${runId}/retry`);
    expect(retry.status).toBe(202);
    expect((await t.client.post(`/api/executions/${runId}/retry`)).status).toBe(409);

    await waitFor(async () => (await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } })).status === "succeeded");
    run = await runWithActions(runId);
    expect(run.actionRuns.map((a) => [a.status, a.attempts])).toEqual([
      ["succeeded", 1],
      ["succeeded", 6],
    ]);
    expect(run.deadLetters[0].resolvedAt).not.toBeNull();
    expect(await prisma.mockSheetRow.count()).toBe(1);
    expect(await prisma.mockCustomer.count()).toBe(1);

    const detail = await t.client.get(`/api/executions/${runId}`);
    expect(detail.body.execution.dispatch.generation).toBe(2);
    expect(detail.body.execution.logs.length).toBeGreaterThan(5);
  });

  it("fails permanently without retrying and skips later actions", async () => {
    const t = await tenant();
    const res = await deliver(app, {
      ...t,
      body: orderEvent(4, { simulation: { failures: { "mock_crm.upsert_customer": "permanent" } } }),
    });
    await waitForRunsFinished(1);
    const run = await runWithActions(res.body.runIds[0]);
    expect(run.status).toBe("failed");
    expect(run.attempts).toBe(1);
    expect(run.actionRuns.map((a) => [a.status, a.attempts, a.errorKind])).toEqual([
      ["failed", 1, "permanent"],
      ["queued", 0, null],
    ]);
    expect(run.deadLetters[0].reason).toBe("permanent_error");
    expect(await prisma.mockCustomer.count()).toBe(0);
  });

  it("recovers end-to-end from a Redis outage at ingestion time", async () => {
    const t = await tenant();
    const outage = fakeQueue();
    outage.failing = true;
    const appDuringOutage = buildApp(outage);
    const res = await deliver(appDuringOutage, { ...t, body: orderEvent(5) });
    expect(res.status).toBe(202);
    expect((await prisma.eventDispatch.findFirstOrThrow()).status).toBe("pending");

    await prisma.eventDispatch.updateMany({ data: { nextAttemptAt: new Date() } });
    expect(await dispatchPending(workers.runQueue)).toEqual({ dispatched: 1, failed: 0 });
    await waitForRunsFinished(1);
    expect((await runWithActions(res.body.runIds[0])).status).toBe("succeeded");
    expect(await prisma.mockSheetRow.count()).toBe(1);
  });

  it("tolerates duplicate jobs for the same run (only one execution commits)", async () => {
    const t = await tenant();
    const res = await deliver(app, { ...t, body: orderEvent(6) });
    const runId = res.body.runIds[0];
    const dispatch = await prisma.eventDispatch.findFirstOrThrow();
    // Simulate a double-dispatch race with extra jobs for other generations.
    await Promise.all([
      workers.runQueue.enqueue({ workflowRunId: runId, dispatchId: dispatch.id, generation: 98 }),
      workers.runQueue.enqueue({ workflowRunId: runId, dispatchId: dispatch.id, generation: 99 }),
    ]);
    await waitForRunsFinished(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const run = await runWithActions(runId);
    expect(run.status).toBe("succeeded");
    expect(run.actionRuns.every((a) => a.attempts === 1)).toBe(true);
    expect(await prisma.mockSheetRow.count()).toBe(1);
  });

  it("re-dispatches a run whose worker crashed after its lease expired", async () => {
    const t = await tenant();
    const outage = fakeQueue();
    outage.failing = true;
    const res = await deliver(buildApp(outage), { ...t, body: orderEvent(7) });
    const runId = res.body.runIds[0];
    // State left behind by a worker that crashed mid-run with no job left in Redis.
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { status: "running", leaseExpiresAt: new Date(Date.now() - 60_000), attempts: 1 },
    });
    await prisma.eventDispatch.updateMany({ data: { status: "dispatched" } });

    expect(await recoverStaleRuns(workers.runQueue)).toBe(1);
    const dispatch = await prisma.eventDispatch.findFirstOrThrow();
    expect(dispatch).toMatchObject({ status: "pending", generation: 2 });

    await dispatchPending(workers.runQueue);
    await waitFor(async () => (await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } })).status === "succeeded");
    expect(await prisma.mockSheetRow.count()).toBe(1);
  });
});
