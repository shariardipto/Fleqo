import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { orgOf, requireOrg } from "../../middleware/auth.ts";

export function dashboardRouter() {
  const router = Router();

  // Every figure is a real count from the tenant's persisted data; nothing is estimated.
  router.get("/dashboard/summary", requireOrg({ execution: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const since = new Date(Date.now() - 24 * 3600_000);
    const [workflows, runsAll, runs24h, events, duplicates, deadLetters, customers, sheetRows, recentRuns, connections] =
      await Promise.all([
        prisma.workflow.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
        prisma.workflowRun.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
        prisma.workflowRun.groupBy({ by: ["status"], where: { organizationId, createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.incomingEvent.count({ where: { organizationId } }),
        prisma.incomingEvent.aggregate({ where: { organizationId }, _sum: { duplicateCount: true } }),
        prisma.deadLetterEvent.count({ where: { organizationId, resolvedAt: null } }),
        prisma.mockCustomer.count({ where: { organizationId } }),
        prisma.mockSheetRow.count({ where: { organizationId } }),
        prisma.workflowRun.findMany({
          where: { organizationId },
          orderBy: { id: "desc" },
          take: 8,
          select: {
            id: true,
            status: true,
            createdAt: true,
            finishedAt: true,
            workflow: { select: { name: true } },
            incomingEvent: { select: { externalEventId: true } },
          },
        }),
        prisma.integrationConnection.findMany({ where: { organizationId }, select: { provider: true, status: true } }),
      ]);
    const byStatus = (rows: { status: string; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map((row) => [row.status, row._count._all]));

    res.json({
      workflows: byStatus(workflows),
      runs: { all: byStatus(runsAll), last24h: byStatus(runs24h) },
      events: { total: events, duplicatesIgnored: duplicates._sum.duplicateCount ?? 0 },
      deadLettersOpen: deadLetters,
      destinations: { customers, sheetRows },
      connections,
      recentRuns,
    });
  });

  const auditSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
  router.get("/audit-logs", requireOrg({ audit: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const { limit } = auditSchema.parse(req.query);
    const entries = await prisma.auditLog.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: limit });
    const actorIds = [...new Set(entries.map((entry) => entry.actorUserId).filter((id): id is string => Boolean(id)))];
    const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
    res.json({
      items: entries.map((entry) => ({ ...entry, actor: actors.find((actor) => actor.id === entry.actorUserId) ?? null })),
    });
  });

  return router;
}
