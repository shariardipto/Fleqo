import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.ts";
import { createOrgFixture, createUserFixture, resetDatabase } from "./helpers/db.ts";

async function expectUniqueViolation(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "P2002" });
}

async function seedGraph() {
  const org = await createOrgFixture("Constraint Org");
  const store = await prisma.integrationConnection.create({
    data: { organizationId: org.id, provider: "mock_store", name: "Store", publicId: `conn_${org.id.slice(0, 8)}_s` },
  });
  const crm = await prisma.integrationConnection.create({
    data: { organizationId: org.id, provider: "mock_crm", name: "CRM", publicId: `conn_${org.id.slice(0, 8)}_c` },
  });
  const workflow = await prisma.workflow.create({
    data: { organizationId: org.id, name: "Order Sync", status: "active" },
  });
  const action = await prisma.workflowAction.create({
    data: {
      workflowId: workflow.id,
      organizationId: org.id,
      position: 1,
      provider: "mock_crm",
      actionType: "upsert_customer",
      connectionId: crm.id,
      mapping: {},
    },
  });
  const event = await prisma.incomingEvent.create({
    data: {
      organizationId: org.id,
      connectionId: store.id,
      provider: "mock_store",
      externalEventId: "evt_1",
      eventType: "order.created",
      payload: {},
      payloadSha256: "x",
      signedAt: new Date(),
    },
  });
  const run = await prisma.workflowRun.create({
    data: { organizationId: org.id, workflowId: workflow.id, incomingEventId: event.id },
  });
  return { org, store, crm, workflow, action, event, run };
}

describe("database constraints (M1)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("allows one membership per user per organization", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture();
    const member = { organizationId: org.id, userId: user.id, role: "owner", createdAt: new Date() };
    await prisma.member.create({ data: { id: "m1", ...member } });
    await expectUniqueViolation(prisma.member.create({ data: { id: "m2", ...member } }));
  });

  it("deduplicates incoming events per organization/provider/externalEventId but not across tenants", async () => {
    const { org, store } = await seedGraph();
    const duplicate = {
      organizationId: org.id,
      connectionId: store.id,
      provider: "mock_store" as const,
      externalEventId: "evt_1",
      eventType: "order.created",
      payload: {},
      payloadSha256: "x",
      signedAt: new Date(),
    };
    await expectUniqueViolation(prisma.incomingEvent.create({ data: duplicate }));

    const otherOrg = await createOrgFixture("Other Org");
    const otherStore = await prisma.integrationConnection.create({
      data: { organizationId: otherOrg.id, provider: "mock_store", name: "Store", publicId: "conn_other_store" },
    });
    await expect(
      prisma.incomingEvent.create({
        data: { ...duplicate, organizationId: otherOrg.id, connectionId: otherStore.id },
      }),
    ).resolves.toBeTruthy();
  });

  it("allows one run per workflow and event, one action run per run/action, one dispatch per run", async () => {
    const { org, workflow, event, run, action } = await seedGraph();
    await expectUniqueViolation(
      prisma.workflowRun.create({ data: { organizationId: org.id, workflowId: workflow.id, incomingEventId: event.id } }),
    );

    const actionRun = {
      organizationId: org.id,
      workflowRunId: run.id,
      workflowActionId: action.id,
      position: 1,
      provider: "mock_crm" as const,
      actionType: "upsert_customer",
    };
    await prisma.actionRun.create({ data: actionRun });
    await expectUniqueViolation(prisma.actionRun.create({ data: actionRun }));

    const dispatch = { organizationId: org.id, incomingEventId: event.id, workflowRunId: run.id };
    await prisma.eventDispatch.create({ data: dispatch });
    await expectUniqueViolation(prisma.eventDispatch.create({ data: dispatch }));
  });

  it("enforces mock destination idempotency keys", async () => {
    const { org, crm, action, event, run } = await seedGraph();
    const customer = {
      organizationId: org.id,
      connectionId: crm.id,
      customerExternalId: "cust_1",
      email: "a@example.test",
      createdByActionRunId: "ar",
      updatedByActionRunId: "ar",
    };
    await prisma.mockCustomer.create({ data: customer });
    await expectUniqueViolation(prisma.mockCustomer.create({ data: customer }));

    const row = {
      organizationId: org.id,
      connectionId: crm.id,
      workflowActionId: action.id,
      sheetName: "Orders",
      orderExternalId: "order_1",
      customerEmail: "a@example.test",
      totalMinor: 1000,
      currency: "USD",
      incomingEventId: event.id,
      actionRunId: run.id,
    };
    await prisma.mockSheetRow.create({ data: row });
    await expectUniqueViolation(prisma.mockSheetRow.create({ data: row }));
  });

  it("rejects invalid money values via CHECK constraints", async () => {
    const { org, crm, action, event, run } = await seedGraph();
    const row = {
      organizationId: org.id,
      connectionId: crm.id,
      workflowActionId: action.id,
      sheetName: "Orders",
      customerEmail: "a@example.test",
      incomingEventId: event.id,
      actionRunId: run.id,
    };
    await expect(
      prisma.mockSheetRow.create({ data: { ...row, orderExternalId: "neg", totalMinor: -1, currency: "USD" } }),
    ).rejects.toThrow();
    await expect(
      prisma.mockSheetRow.create({ data: { ...row, orderExternalId: "cur", totalMinor: 1, currency: "usd" } }),
    ).rejects.toThrow();
  });

  it("keeps imports repeatable by organization/source/sourceRecordId", async () => {
    const org = await createOrgFixture();
    const record = {
      organizationId: org.id,
      source: "dummyjson",
      sourceRecordId: "users/1",
      kind: "customer",
      data: {},
      isSynthetic: false,
    };
    await prisma.importedRecord.create({ data: record });
    await expectUniqueViolation(prisma.importedRecord.create({ data: record }));
  });
});
