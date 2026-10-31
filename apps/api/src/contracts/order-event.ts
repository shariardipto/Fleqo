import { z } from "zod";

export const ACTION_KEYS = ["mock_crm.upsert_customer", "mock_sheet.append_order"] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

const MAX_INT32 = 2_147_483_647;

/**
 * Fleqo-generated `order.created` event (requirements §7). Not a real provider payload.
 * Amounts are integer minor units with an explicit ISO 4217 currency code.
 */
export const orderCreatedEventSchema = z.object({
  eventId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[\w.:-]+$/, "eventId may contain letters, digits, '_', '.', ':' and '-'"),
  type: z.literal("order.created"),
  occurredAt: z.iso.datetime({ offset: true }),
  synthetic: z.boolean().default(false),
  data: z.object({
    order: z.object({
      id: z.string().min(1).max(128),
      totalMinor: z.number().int().min(0).max(MAX_INT32),
      currency: z.string().regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 code such as USD"),
      items: z
        .array(
          z.object({
            sku: z.string().min(1).max(64),
            name: z.string().min(1).max(200),
            quantity: z.number().int().min(1).max(1000),
            unitPriceMinor: z.number().int().min(0).max(MAX_INT32),
          }),
        )
        .max(100)
        .optional(),
    }),
    customer: z.object({
      externalId: z.string().min(1).max(128),
      email: z.email().max(254),
      name: z.string().min(1).max(200).optional(),
    }),
  }),
  /**
   * Fault injection for mock providers only: fail the first N attempts of an action
   * with a transient error, or "permanent" to fail without retry.
   */
  simulation: z
    .object({
      failures: z.partialRecord(z.enum(ACTION_KEYS), z.union([z.number().int().min(0).max(20), z.literal("permanent")])),
    })
    .optional(),
});

export type OrderCreatedEvent = z.infer<typeof orderCreatedEventSchema>;
