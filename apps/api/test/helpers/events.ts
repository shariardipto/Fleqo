import type { Express } from "express";
import request from "supertest";
import type { OrderCreatedEvent } from "../../src/contracts/order-event.ts";
import { signWebhook } from "../../src/lib/crypto.ts";

export function orderEvent(index: number, overrides: Partial<OrderCreatedEvent> = {}): OrderCreatedEvent {
  const id = String(index).padStart(4, "0");
  return {
    eventId: `demo_evt_${id}`,
    type: "order.created",
    occurredAt: "2026-10-31T12:00:00.000Z",
    synthetic: true,
    data: {
      order: { id: `demo_order_${id}`, totalMinor: 12999, currency: "USD" },
      customer: { externalId: `demo_customer_${String(index % 20).padStart(3, "0")}`, email: `customer${index % 20}@example.test`, name: "Demo Customer" },
    },
    ...overrides,
  };
}

interface DeliveryOptions {
  publicId: string;
  secret: string;
  body: string | object;
  timestamp?: number;
  signature?: string;
  /** Sign this body but send `body` (tampering test). */
  signedBody?: string;
}

/** Sends a signed webhook over real HTTP, exactly as an external Mock Store sender would. */
export function deliver(app: Express, options: DeliveryOptions) {
  const body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = options.signature ?? signWebhook(options.secret, timestamp, options.signedBody ?? body);
  return request(app)
    .post("/api/webhooks/mock-store")
    .set("Content-Type", "application/json")
    .set("X-Fleqo-Connection-Id", options.publicId)
    .set("X-Fleqo-Timestamp", String(timestamp))
    .set("X-Fleqo-Signature", signature)
    .send(body);
}
