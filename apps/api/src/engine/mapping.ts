import { z } from "zod";
import type { ActionKey } from "../contracts/order-event.ts";

type FieldType = "string" | "email" | "integer" | "currency" | "datetime";

/** Event fields a mapping may read from. Anything else is rejected at configuration time. */
export const SOURCE_FIELDS: Record<string, { type: FieldType; label: string }> = {
  eventId: { type: "string", label: "Event ID" },
  occurredAt: { type: "datetime", label: "Event time" },
  "data.order.id": { type: "string", label: "Order ID" },
  "data.order.totalMinor": { type: "integer", label: "Order total (minor units)" },
  "data.order.currency": { type: "currency", label: "Order currency" },
  "data.customer.externalId": { type: "string", label: "Customer ID" },
  "data.customer.email": { type: "email", label: "Customer email" },
  "data.customer.name": { type: "string", label: "Customer name" },
};

interface TargetField {
  label: string;
  type: FieldType;
  required: boolean;
  defaultSource: keyof typeof SOURCE_FIELDS;
}

export interface ActionDefinition {
  key: ActionKey;
  provider: "mock_crm" | "mock_sheet";
  actionType: string;
  label: string;
  description: string;
  fields: Record<string, TargetField>;
  outputSchema: z.ZodType;
}

// Which source types can feed which target types.
const compatible: Record<FieldType, FieldType[]> = {
  string: ["string", "email", "currency", "integer", "datetime"],
  email: ["email"],
  integer: ["integer"],
  currency: ["currency"],
  datetime: ["datetime"],
};

export const ACTIONS: Record<ActionKey, ActionDefinition> = {
  "mock_crm.upsert_customer": {
    key: "mock_crm.upsert_customer",
    provider: "mock_crm",
    actionType: "upsert_customer",
    label: "Mock CRM: upsert customer",
    description: "Creates the customer or updates the existing one with the same customer ID.",
    fields: {
      externalId: { label: "Customer ID", type: "string", required: true, defaultSource: "data.customer.externalId" },
      email: { label: "Email", type: "email", required: true, defaultSource: "data.customer.email" },
      name: { label: "Name", type: "string", required: false, defaultSource: "data.customer.name" },
    },
    outputSchema: z.object({
      externalId: z.string().min(1).max(128),
      email: z.email(),
      name: z.string().max(200).optional(),
    }),
  },
  "mock_sheet.append_order": {
    key: "mock_sheet.append_order",
    provider: "mock_sheet",
    actionType: "append_order",
    label: "Mock Sheet: append order row",
    description: "Appends one row per order. Re-running for the same order never adds a second row.",
    fields: {
      orderId: { label: "Order ID", type: "string", required: true, defaultSource: "data.order.id" },
      customerEmail: { label: "Customer email", type: "email", required: true, defaultSource: "data.customer.email" },
      customerName: { label: "Customer name", type: "string", required: false, defaultSource: "data.customer.name" },
      customerExternalId: {
        label: "Customer ID",
        type: "string",
        required: false,
        defaultSource: "data.customer.externalId",
      },
      totalMinor: { label: "Total (minor units)", type: "integer", required: true, defaultSource: "data.order.totalMinor" },
      currency: { label: "Currency", type: "currency", required: true, defaultSource: "data.order.currency" },
      orderedAt: { label: "Ordered at", type: "datetime", required: false, defaultSource: "occurredAt" },
    },
    outputSchema: z.object({
      orderId: z.string().min(1).max(128),
      customerEmail: z.email(),
      customerName: z.string().max(200).optional(),
      customerExternalId: z.string().max(128).optional(),
      totalMinor: z.number().int().min(0).max(2_147_483_647),
      currency: z.string().regex(/^[A-Z]{3}$/),
      orderedAt: z.iso.datetime({ offset: true }).optional(),
    }),
  },
};

export type Mapping = Record<string, string>;

export function defaultMapping(key: ActionKey): Mapping {
  return Object.fromEntries(Object.entries(ACTIONS[key].fields).map(([target, field]) => [target, field.defaultSource]));
}

export interface MappingIssue {
  field: string;
  message: string;
}

/** Configuration-time validation: known targets, allowed sources, required fields present, compatible types. */
export function validateMapping(key: ActionKey, mapping: Mapping): MappingIssue[] {
  const definition = ACTIONS[key];
  const issues: MappingIssue[] = [];

  for (const [target, source] of Object.entries(mapping)) {
    const field = definition.fields[target];
    if (!field) {
      issues.push({ field: target, message: `Unknown field for ${definition.label}` });
      continue;
    }
    if (source === "") continue;
    const sourceField = SOURCE_FIELDS[source];
    if (!sourceField) {
      issues.push({ field: target, message: `Unknown source path "${source}"` });
    } else if (!compatible[field.type].includes(sourceField.type)) {
      issues.push({ field: target, message: `${sourceField.label} (${sourceField.type}) cannot fill a ${field.type} field` });
    }
  }
  for (const [target, field] of Object.entries(definition.fields)) {
    if (field.required && !mapping[target]) issues.push({ field: target, message: `${field.label} is required` });
  }
  return issues;
}

function readPath(payload: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) return (value as Record<string, unknown>)[key];
    return undefined;
  }, payload);
}

/** Runtime mapping: resolves values from the event and validates the result against the action's input schema. */
export function applyMapping(key: ActionKey, mapping: Mapping, payload: unknown) {
  const definition = ACTIONS[key];
  const input: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(mapping)) {
    if (!source) continue;
    const value = readPath(payload, source);
    if (value === undefined || value === null) continue;
    input[target] = definition.fields[target]?.type === "string" && typeof value !== "string" ? String(value) : value;
  }
  return definition.outputSchema.safeParse(input);
}

/** Catalog for the UI's guided workflow form. */
export function actionCatalog() {
  return {
    trigger: { provider: "mock_store", eventType: "order.created", label: "Mock Store: order created" },
    sources: Object.entries(SOURCE_FIELDS).map(([path, field]) => ({ path, ...field })),
    actions: Object.values(ACTIONS).map((action) => ({
      key: action.key,
      provider: action.provider,
      actionType: action.actionType,
      label: action.label,
      description: action.description,
      fields: Object.entries(action.fields).map(([name, field]) => ({ name, ...field })),
    })),
  };
}
