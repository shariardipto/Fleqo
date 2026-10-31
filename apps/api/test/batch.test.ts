import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderCreatedEvent } from "../src/contracts/order-event.ts";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, connectAll, orderSync, signUpWithOrg } from "./helpers/app.ts";
import { resetDatabase } from "./helpers/db.ts";
import { deliver } from "./helpers/events.ts";
import { clearTestQueue, startTestWorkers, waitForRunsFinished } from "./helpers/worker.ts";

/**
 * Repeatable 100-event batch (requirements §15):
 *  - 100 unique signed order.created events over real HTTP, sent concurrently (10 in flight)
 *  - 30 distinct customers (CRM upserts must collapse to 30 rows)
 *  - 25 duplicate re-deliveries (20 identical + 5 reformatted JSON)
 *  - 10 events with injected transient failures (5 CRM x1, 5 Sheet x2)
 *  - 5 forged deliveries (bad signature) that must be rejected
 *  - two competing worker processes
 */
const UNIQUE = 100;
const CUSTOMERS = 30;

function batchEvent(index: number): OrderCreatedEvent {
  const id = String(index).padStart(3, "0");
  const customer = index % CUSTOMERS;
  const failures =
    index < 5
      ? { "mock_crm.upsert_customer": 1 }
      : index < 10
        ? { "mock_sheet.append_order": 2 }
        : undefined;
  return {
    eventId: `batch_evt_${id}`,
    type: "order.created",
    occurredAt: new Date(Date.UTC(2026, 9, 31, 12, 0, index)).toISOString(),
    synthetic: true,
    data: {
      order: { id: `batch_order_${id}`, totalMinor: 1000 + index * 37, currency: "USD" },
      customer: {
        externalId: `batch_customer_${String(customer).padStart(2, "0")}`,
        email: `batch.customer.${customer}@example.test`,
        name: `Batch Customer ${customer}`,
      },
    },
    ...(failures ? { simulation: { failures } } : {}),
  };
}

async function inParallel<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  const results: unknown[] = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return results;
}

describe("100-event batch with duplicates and transient failures", () => {
  let workers: ReturnType<typeof startTestWorkers>;

  beforeAll(async () => {
    await resetDatabase();
    await clearTestQueue();
    workers = startTestWorkers(2);
  });
  afterAll(async () => {
    await workers.close();
    await prisma.$disconnect();
  });

  it("processes every unique order exactly once", async () => {
    const app = buildApp(workers.runQueue);
    const owner = await signUpWithOrg(app, "Batch Store");
    const { signingSecret: secret, publicId } = await connectAll(owner.client);
    expect((await owner.client.post("/api/workflows", orderSync)).status).toBe(201);

    const events = Array.from({ length: UNIQUE }, (_, i) => batchEvent(i));
    const started = Date.now();

    // Unique events, concurrently.
    const unique = (await inParallel(events, 10, (event) => deliver(app, { publicId, secret, body: event }))) as {
      status: number;
    }[];
    // Duplicates: 20 identical re-sends + 5 reformatted, interleaved while runs are executing.
    const duplicates = (await inParallel(
      [
        ...events.slice(0, 20).map((event) => JSON.stringify(event)),
        ...events.slice(20, 25).map((event) => JSON.stringify(event, null, 2)),
      ],
      10,
      (body) => deliver(app, { publicId, secret, body }),
    )) as { status: number; body: { status: string } }[];
    // Forged deliveries.
    const forged = (await inParallel(events.slice(0, 5), 5, (event) =>
      deliver(app, { publicId, secret: "whsec_forged", body: { ...event, eventId: `${event.eventId}_forged` } }),
    )) as { status: number }[];
    const ingestMs = Date.now() - started;

    expect(unique.filter((r) => r.status === 202)).toHaveLength(UNIQUE);
    expect(duplicates.every((r) => r.status === 200 && r.body.status === "duplicate")).toBe(true);
    expect(forged.every((r) => r.status === 401)).toBe(true);

    await waitForRunsFinished(UNIQUE, 90_000);
    const totalMs = Date.now() - started;

    const [eventCount, runs, actionRuns, customers, rows, deadLetters, dupSum] = await Promise.all([
      prisma.incomingEvent.count(),
      prisma.workflowRun.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.actionRun.findMany({ include: { workflowRun: { include: { incomingEvent: true } } } }),
      prisma.mockCustomer.count(),
      prisma.mockSheetRow.findMany(),
      prisma.deadLetterEvent.count(),
      prisma.incomingEvent.aggregate({ _sum: { duplicateCount: true } }),
    ]);

    expect(eventCount).toBe(UNIQUE);
    expect(runs).toEqual([{ status: "succeeded", _count: { _all: UNIQUE } }]);
    expect(customers).toBe(CUSTOMERS);
    expect(rows).toHaveLength(UNIQUE);
    expect(new Set(rows.map((row) => row.orderExternalId)).size).toBe(UNIQUE);
    expect(rows.reduce((sum, row) => sum + row.totalMinor, 0)).toBe(events.reduce((sum, e) => sum + e.data.order.totalMinor, 0));
    expect(deadLetters).toBe(0);
    expect(dupSum._sum.duplicateCount).toBe(25);

    // Attempt accounting: injected failures retried, everything else ran exactly once.
    const attemptsFor = (eventIndex: number, actionType: string) =>
      actionRuns.find(
        (a) => a.actionType === actionType && a.workflowRun.incomingEvent.externalEventId === events[eventIndex].eventId,
      )!.attempts;
    for (let i = 0; i < 5; i++) {
      expect(attemptsFor(i, "upsert_customer")).toBe(2);
      expect(attemptsFor(i, "append_order")).toBe(1);
    }
    for (let i = 5; i < 10; i++) {
      expect(attemptsFor(i, "upsert_customer")).toBe(1);
      expect(attemptsFor(i, "append_order")).toBe(3);
    }
    const untouched = actionRuns.filter((a) => {
      const index = events.findIndex((e) => e.eventId === a.workflowRun.incomingEvent.externalEventId);
      return index >= 10;
    });
    expect(untouched).toHaveLength((UNIQUE - 10) * 2);
    expect(untouched.every((a) => a.status === "succeeded" && a.attempts === 1)).toBe(true);

    const summary = {
      generatedAt: new Date().toISOString(),
      uniqueEventsSent: UNIQUE,
      duplicateDeliveries: duplicates.length,
      forgedDeliveriesRejected: forged.length,
      distinctCustomers: CUSTOMERS,
      eventsWithInjectedTransientFailures: 10,
      results: {
        incomingEvents: eventCount,
        runsSucceeded: UNIQUE,
        mockCustomers: customers,
        mockSheetRows: rows.length,
        deadLetters,
        duplicatesAcknowledged: dupSum._sum.duplicateCount,
        totalActionAttempts: actionRuns.reduce((sum, a) => sum + a.attempts, 0),
      },
      timingsMs: { ingestion: ingestMs, endToEnd: totalMs },
      environment: { workers: 2, concurrencyPerWorker: 5, backoffBaseMs: Number(process.env.WORKFLOW_BACKOFF_MS) },
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/batch-summary.json", `${JSON.stringify(summary, null, 2)}\n`);
    console.info(`[batch] ${JSON.stringify(summary)}`);
  });
});
