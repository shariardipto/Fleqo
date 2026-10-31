import { randomBytes } from "node:crypto";
import type { Logger } from "pino";
import type { OrderCreatedEvent } from "../../contracts/order-event.ts";
import type { RunQueue } from "../../engine/queue.ts";
import { decryptSecret, signWebhook } from "../../lib/crypto.ts";
import { AppError } from "../../lib/errors.ts";
import { prisma } from "../../lib/prisma.ts";
import { ingestOrderEvent, type IngestResult } from "../webhooks/ingest.service.ts";
import type { NormalizedCustomer, NormalizedProduct } from "./import.service.ts";

type Failure = number | "permanent";

export interface SimulateOptions {
  organizationId: string;
  count: number;
  customerExternalId?: string;
  failures?: { crm?: Failure; sheet?: Failure };
  /** Re-deliver an earlier event unchanged (demonstrates duplicate handling). */
  duplicateOfEventId?: string;
}

export interface SimulatedDelivery extends IngestResult {
  orderId: string | null;
}

/** Signs a body exactly as an external Mock Store sender would. */
export function signedDelivery(secret: string, publicId: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    rawBody: Buffer.from(body, "utf8"),
    connectionPublicId: publicId,
    timestamp: String(timestamp),
    signature: signWebhook(secret, timestamp, body),
  };
}

const pickIndex = (length: number) => randomBytes(4).readUInt32BE(0) % length;

/**
 * Generates synthetic `order.created` events from imported demo data, signs them with the
 * tenant's Mock Store secret and sends them through the same verification/ingestion path as HTTP webhooks.
 */
export async function simulateOrders(options: SimulateOptions, queue: RunQueue, logger?: Logger): Promise<SimulatedDelivery[]> {
  const { organizationId } = options;
  const store = await prisma.integrationConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider: "mock_store" } },
  });
  if (!store || store.status !== "active" || !store.secretCiphertext) {
    throw new AppError("conflict", "Connect and enable the Mock Store before simulating orders");
  }
  const secret = decryptSecret(store.secretCiphertext);
  const deliver = async (body: string) =>
    ingestOrderEvent({ ...signedDelivery(secret, store.publicId, body), source: "simulator" }, queue, logger);

  if (options.duplicateOfEventId) {
    const original = await prisma.incomingEvent.findUnique({
      where: {
        organizationId_provider_externalEventId: {
          organizationId,
          provider: "mock_store",
          externalEventId: options.duplicateOfEventId,
        },
      },
    });
    if (!original) throw new AppError("not_found", "Event to re-send was not found");
    const result = await deliver(JSON.stringify(original.payload));
    const orderId = (original.payload as OrderCreatedEvent).data?.order?.id ?? null;
    return [{ ...result, orderId }];
  }

  const [customerRecords, productRecords] = await Promise.all([
    prisma.importedRecord.findMany({ where: { organizationId, kind: "customer" }, select: { data: true } }),
    prisma.importedRecord.findMany({ where: { organizationId, kind: "product" }, select: { data: true } }),
  ]);
  const customers = customerRecords.map((record) => record.data as unknown as NormalizedCustomer);
  const products = productRecords.map((record) => record.data as unknown as NormalizedProduct);
  if (customers.length === 0 || products.length === 0) {
    throw new AppError("conflict", "Import demo customers and products before simulating orders");
  }
  const fixedCustomer = options.customerExternalId
    ? customers.find((customer) => customer.externalId === options.customerExternalId)
    : undefined;
  if (options.customerExternalId && !fixedCustomer) throw new AppError("not_found", "Customer not found in imported data");

  const failures: Record<string, Failure> = {};
  if (options.failures?.crm !== undefined) failures["mock_crm.upsert_customer"] = options.failures.crm;
  if (options.failures?.sheet !== undefined) failures["mock_sheet.append_order"] = options.failures.sheet;

  const batch = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const results: SimulatedDelivery[] = [];
  for (let index = 1; index <= options.count; index++) {
    const customer = fixedCustomer ?? customers[pickIndex(customers.length)];
    const items = Array.from({ length: 1 + pickIndex(3) }, () => {
      const product = products[pickIndex(products.length)];
      return { sku: product.sku, name: product.name, quantity: 1 + pickIndex(3), unitPriceMinor: product.unitPriceMinor };
    });
    const orderId = `sim_order_${batch}_${index}`;
    const event: OrderCreatedEvent = {
      eventId: `sim_evt_${batch}_${index}`,
      type: "order.created",
      occurredAt: new Date().toISOString(),
      synthetic: true,
      data: {
        order: {
          id: orderId,
          totalMinor: items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0),
          currency: "USD",
          items,
        },
        customer: { externalId: customer.externalId, email: customer.email, name: customer.name },
      },
      ...(Object.keys(failures).length > 0 ? { simulation: { failures } } : {}),
    };
    results.push({ ...(await deliver(JSON.stringify(event))), orderId });
  }
  return results;
}
