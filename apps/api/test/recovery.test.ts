import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { jobIdFor } from "../src/engine/queue.ts";
import { recoverStaleRuns } from "../src/engine/recovery.ts";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, connectAll, fakeQueue, orderSync, signUpWithOrg } from "./helpers/app.ts";
import { resetDatabase } from "./helpers/db.ts";
import { deliver, orderEvent } from "./helpers/events.ts";

const queue = fakeQueue();
const app = buildApp(queue);

/** A run that a crashed worker left in `running` with an expired lease and a dispatched outbox row. */
async function strandedRun() {
  const owner = await signUpWithOrg(app);
  const { signingSecret, publicId } = await connectAll(owner.client);
  await owner.client.post("/api/workflows", orderSync);
  const res = await deliver(app, { publicId, secret: signingSecret, body: orderEvent(1) });
  const runId = res.body.runIds[0] as string;
  await prisma.workflowRun.update({
    where: { id: runId },
    data: { status: "running", leaseExpiresAt: new Date(Date.now() - 60_000), attempts: 4 },
  });
  const dispatch = await prisma.eventDispatch.findUniqueOrThrow({ where: { workflowRunId: runId } });
  return { runId, job: { workflowRunId: runId, dispatchId: dispatch.id, generation: dispatch.generation } };
}

describe("stale-run recovery decisions", () => {
  beforeEach(async () => {
    await resetDatabase();
    queue.jobs.length = 0;
    queue.states.clear();
  });
  afterAll(() => prisma.$disconnect());

  it.each(["waiting", "active", "delayed"] as const)("leaves a run alone while BullMQ still owns its job (%s)", async (state) => {
    const { job } = await strandedRun();
    queue.states.set(jobIdFor(job), state);
    expect(await recoverStaleRuns(queue)).toBe(0);
    expect((await prisma.eventDispatch.findFirstOrThrow()).status).toBe("dispatched");
  });

  it.each(["failed", "completed", "unknown"] as const)("re-dispatches an unfinished run whose job is %s", async (state) => {
    const { runId, job } = await strandedRun();
    queue.states.set(jobIdFor(job), state);
    expect(await recoverStaleRuns(queue)).toBe(1);
    const dispatch = await prisma.eventDispatch.findFirstOrThrow();
    expect(dispatch).toMatchObject({ status: "pending", generation: 2 });
    expect(dispatch.lastError).toContain(state);
    const log = await prisma.executionLog.findFirstOrThrow({ where: { workflowRunId: runId, level: "warn" } });
    expect(log.message).toContain("re-dispatching");
  });

  it("never touches finished runs", async () => {
    const { runId, job } = await strandedRun();
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "succeeded", leaseExpiresAt: null } });
    queue.states.set(jobIdFor(job), "unknown");
    expect(await recoverStaleRuns(queue)).toBe(0);
  });
});
