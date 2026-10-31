import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TransientActionError } from "../src/integrations/errors.ts";
import { appendOrderRow, upsertCustomer, type ActionContext } from "../src/integrations/mock-providers.ts";
import { prisma } from "../src/lib/prisma.ts";
import { createOrgFixture, resetDatabase } from "./helpers/db.ts";

async function setup() {
  const org = await createOrgFixture();
  const crm = await prisma.integrationConnection.create({
    data: { organizationId: org.id, provider: "mock_crm", name: "CRM", publicId: `conn_${org.id}_crm` },
  });
  const store = await prisma.integrationConnection.create({
    data: { organizationId: org.id, provider: "mock_store", name: "Store", publicId: `conn_${org.id}_store` },
  });
  const workflow = await prisma.workflow.create({ data: { organizationId: org.id, name: "WF" } });
  const action = await prisma.workflowAction.create({
    data: {
      workflowId: workflow.id,
      organizationId: org.id,
      position: 2,
      provider: "mock_sheet",
      actionType: "append_order",
      connectionId: crm.id,
      mapping: {},
    },
  });
  const event = await prisma.incomingEvent.create({
    data: {
      organizationId: org.id,
      connectionId: store.id,
      provider: "mock_store",
      externalEventId: "e1",
      eventType: "order.created",
      payload: {},
      payloadSha256: "x",
      signedAt: new Date(),
    },
  });
  const base = (tx: ActionContext["tx"], actionRunId: string, attempt = 1): ActionContext => ({
    tx,
    organizationId: org.id,
    connection: { id: crm.id, status: "active" },
    workflowActionId: action.id,
    actionRunId,
    incomingEventId: event.id,
    attempt,
    isSynthetic: true,
    config: { sheetName: "Orders" },
  });
  return { org, base };
}

const row = { orderId: "order_1", customerEmail: "a@example.test", totalMinor: 1299, currency: "USD" };

describe("mock CRM and Sheet adapters (M3)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("upserts customers: create once, then update in place", async () => {
    const { base } = await setup();
    const first = await prisma.$transaction((tx) =>
      upsertCustomer(base(tx, "run-a"), { externalId: "c1", email: "old@example.test", name: "Ann" }, "o1"),
    );
    const second = await prisma.$transaction((tx) =>
      upsertCustomer(base(tx, "run-b"), { externalId: "c1", email: "new@example.test" }, "o2"),
    );
    expect(first.operation).toBe("created");
    expect(second.operation).toBe("updated");
    expect(second.customerId).toBe(first.customerId);

    const customers = await prisma.mockCustomer.findMany();
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ email: "new@example.test", name: "Ann", lastOrderExternalId: "o2" });
  });

  it("appends one sheet row per order even when re-run", async () => {
    const { base } = await setup();
    const first = await prisma.$transaction((tx) => appendOrderRow(base(tx, "run-a"), row));
    const again = await prisma.$transaction((tx) => appendOrderRow(base(tx, "run-b"), { ...row, totalMinor: 1 }));
    expect(first.operation).toBe("appended");
    expect(again.operation).toBe("already_present");
    const rows = await prisma.mockSheetRow.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].totalMinor).toBe(1299);
  });

  it("rolls back the write when an injected transient failure fires, then succeeds once on retry", async () => {
    const { base } = await setup();
    const failing = prisma.$transaction((tx) => appendOrderRow({ ...base(tx, "run-a", 1), injectedFailure: 1 }, row));
    await expect(failing).rejects.toBeInstanceOf(TransientActionError);
    expect(await prisma.mockSheetRow.count()).toBe(0);

    const retry = await prisma.$transaction((tx) => appendOrderRow({ ...base(tx, "run-a", 2), injectedFailure: 1 }, row));
    expect(retry.operation).toBe("appended");
    expect(await prisma.mockSheetRow.count()).toBe(1);
  });

  it("rejects writes through a disabled connection", async () => {
    const { base } = await setup();
    await expect(
      prisma.$transaction((tx) => appendOrderRow({ ...base(tx, "run-a"), connection: { id: "x", status: "disabled" } }, row)),
    ).rejects.toMatchObject({ kind: "permanent" });
  });
});
