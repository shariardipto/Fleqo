import type { Tx } from "../lib/prisma.ts";
import { PermanentActionError, TransientActionError } from "./errors.ts";

/**
 * PostgreSQL-backed mock CRM and Sheet adapters. They never call external URLs.
 * Each runs inside the caller's transaction together with the action's success-state update,
 * so a crash or injected failure rolls back the side effect and a retry cannot duplicate it.
 */
export interface ActionContext {
  tx: Tx;
  organizationId: string;
  connection: { id: string; status: "active" | "disabled" };
  workflowActionId: string;
  actionRunId: string;
  incomingEventId: string;
  attempt: number;
  isSynthetic: boolean;
  config: Record<string, unknown>;
  injectedFailure?: number | "permanent";
}

function assertConnectionActive(ctx: ActionContext, label: string) {
  if (ctx.connection.status !== "active") throw new PermanentActionError(`${label} connection is disabled`);
}

/** Simulated provider faults, raised after the write so the transaction proves the rollback. */
function applyInjectedFailure(ctx: ActionContext, label: string) {
  const failure = ctx.injectedFailure;
  if (failure === "permanent") throw new PermanentActionError(`${label} rejected the request (simulated permanent error)`);
  if (typeof failure === "number" && ctx.attempt <= failure) {
    throw new TransientActionError(`${label} temporarily unavailable (simulated outage ${ctx.attempt}/${failure})`);
  }
}

export interface CustomerInput {
  externalId: string;
  email: string;
  name?: string;
}

export async function upsertCustomer(ctx: ActionContext, input: CustomerInput, orderExternalId: string | null) {
  assertConnectionActive(ctx, "Mock CRM");
  const customer = await ctx.tx.mockCustomer.upsert({
    where: {
      organizationId_provider_customerExternalId: {
        organizationId: ctx.organizationId,
        provider: "mock_crm",
        customerExternalId: input.externalId,
      },
    },
    create: {
      organizationId: ctx.organizationId,
      connectionId: ctx.connection.id,
      customerExternalId: input.externalId,
      email: input.email,
      name: input.name ?? null,
      lastOrderExternalId: orderExternalId,
      isSynthetic: ctx.isSynthetic,
      createdByActionRunId: ctx.actionRunId,
      updatedByActionRunId: ctx.actionRunId,
    },
    update: {
      email: input.email,
      ...(input.name ? { name: input.name } : {}),
      lastOrderExternalId: orderExternalId,
      updatedByActionRunId: ctx.actionRunId,
    },
  });
  applyInjectedFailure(ctx, "Mock CRM");
  return {
    customerId: customer.id,
    operation: customer.createdByActionRunId === ctx.actionRunId ? ("created" as const) : ("updated" as const),
  };
}

export interface SheetRowInput {
  orderId: string;
  customerEmail: string;
  customerName?: string;
  customerExternalId?: string;
  totalMinor: number;
  currency: string;
  orderedAt?: string;
}

export async function appendOrderRow(ctx: ActionContext, input: SheetRowInput) {
  assertConnectionActive(ctx, "Mock Sheet");
  const sheetName = typeof ctx.config.sheetName === "string" && ctx.config.sheetName ? ctx.config.sheetName : "Orders";
  // Insert-or-keep: the unique (organization, action, order) key makes re-appends a no-op.
  const row = await ctx.tx.mockSheetRow.upsert({
    where: {
      organizationId_workflowActionId_orderExternalId: {
        organizationId: ctx.organizationId,
        workflowActionId: ctx.workflowActionId,
        orderExternalId: input.orderId,
      },
    },
    create: {
      organizationId: ctx.organizationId,
      connectionId: ctx.connection.id,
      workflowActionId: ctx.workflowActionId,
      sheetName,
      orderExternalId: input.orderId,
      customerExternalId: input.customerExternalId ?? null,
      customerEmail: input.customerEmail,
      customerName: input.customerName ?? null,
      totalMinor: input.totalMinor,
      currency: input.currency,
      orderedAt: input.orderedAt ? new Date(input.orderedAt) : null,
      incomingEventId: ctx.incomingEventId,
      actionRunId: ctx.actionRunId,
      isSynthetic: ctx.isSynthetic,
    },
    update: {},
  });
  applyInjectedFailure(ctx, "Mock Sheet");
  return {
    rowId: row.id,
    sheetName: row.sheetName,
    operation: row.actionRunId === ctx.actionRunId ? ("appended" as const) : ("already_present" as const),
  };
}
