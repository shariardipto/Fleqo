import type { Prisma } from "../../generated/prisma/client.ts";
import type { prisma, Tx } from "../../lib/prisma.ts";

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Append-only audit trail. Pass a transaction client to commit the entry with the change it describes. */
export async function recordAudit(db: typeof prisma | Tx, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    },
  });
}
