import { Router } from "express";
import { z } from "zod";
import type { RunQueue } from "../../engine/queue.ts";
import { prisma } from "../../lib/prisma.ts";
import { orgOf, requireOrg } from "../../middleware/auth.ts";
import { recordAudit } from "../audit/audit.service.ts";
import { IMPORT_SOURCES, runImport, type FetchJson } from "./import.service.ts";
import { simulateOrders } from "./simulator.service.ts";

const failureSchema = z.union([z.number().int().min(0).max(20), z.literal("permanent")]);
const simulateSchema = z.object({
  count: z.number().int().min(1).max(100).default(1),
  customerExternalId: z.string().max(128).optional(),
  failures: z.object({ crm: failureSchema.optional(), sheet: failureSchema.optional() }).optional(),
  duplicateOfEventId: z.string().max(128).optional(),
});

const importSchema = z.object({
  source: z.enum(["dummyjson", "fleqo_synthetic"]).default("fleqo_synthetic"),
  limit: z.number().int().min(1).max(100).default(30),
});

const listSchema = z.object({
  kind: z.enum(["customer", "product", "cart"]).optional(),
  source: z.enum(["dummyjson", "fleqo_synthetic"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(64).optional(),
});

export interface DemoRouterDeps {
  runQueue: RunQueue;
  fetchJson?: FetchJson;
}

export function demoRouter(deps: DemoRouterDeps) {
  const router = Router();

  router.post("/demo/simulate-order", requireOrg({ demo: ["simulate"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = simulateSchema.parse(req.body);
    const deliveries = await simulateOrders({ organizationId: ctx.organizationId, ...input }, deps.runQueue, req.log);
    await recordAudit(prisma, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.duplicateOfEventId ? "demo.event_resent" : "demo.orders_simulated",
      targetType: "incoming_event",
      metadata: {
        count: deliveries.length,
        accepted: deliveries.filter((d) => d.status === "accepted").length,
        duplicates: deliveries.filter((d) => d.status === "duplicate").length,
        failures: input.failures ?? null,
      },
    });
    res.status(202).json({ deliveries });
  });

  router.get("/demo/sources", requireOrg({ connection: ["read"] }), (_req, res) => {
    res.json({ sources: Object.entries(IMPORT_SOURCES).map(([id, info]) => ({ id, ...info })) });
  });

  router.post("/demo/import", requireOrg({ demo: ["import"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = importSchema.parse(req.body);
    const result = await runImport({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      source: input.source,
      limit: input.limit,
      fetchJson: deps.fetchJson,
    });
    res.json({ import: result });
  });

  router.get("/demo/records", requireOrg({ connection: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const query = listSchema.parse(req.query);
    const where = { organizationId, ...(query.kind ? { kind: query.kind } : {}), ...(query.source ? { source: query.source } : {}) };
    const [items, counts] = await Promise.all([
      prisma.importedRecord.findMany({
        where,
        orderBy: { id: "asc" },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          source: true,
          sourceRecordId: true,
          kind: true,
          data: true,
          isSynthetic: true,
          sourceUrl: true,
          license: true,
          importedAt: true,
        },
      }),
      prisma.importedRecord.groupBy({ by: ["source", "kind"], where: { organizationId }, _count: { _all: true } }),
    ]);
    res.json({
      items: items.slice(0, query.limit),
      nextCursor: items.length > query.limit ? items[query.limit - 1].id : null,
      counts: counts.map((row) => ({ source: row.source, kind: row.kind, count: row._count._all })),
    });
  });

  return router;
}
