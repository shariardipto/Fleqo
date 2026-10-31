import type { Logger } from "pino";
import { orderCreatedEventSchema } from "../../contracts/order-event.ts";
import { dispatchPending } from "../../engine/dispatcher.ts";
import type { RunQueue } from "../../engine/queue.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { env } from "../../config/env.ts";
import { canonicalJson, decryptSecret, sha256Hex, verifyWebhookSignature } from "../../lib/crypto.ts";
import { AppError } from "../../lib/errors.ts";
import { prisma } from "../../lib/prisma.ts";

export const WEBHOOK_HEADERS = {
  connection: "x-fleqo-connection-id",
  timestamp: "x-fleqo-timestamp",
  signature: "x-fleqo-signature",
} as const;

export interface IngestRequest {
  rawBody: Buffer;
  connectionPublicId: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  source: "webhook" | "simulator";
}

export interface IngestResult {
  status: "accepted" | "duplicate";
  eventId: string;
  incomingEventId: string;
  matchedWorkflows: number;
  runIds: string[];
}

/** Resolve the connection and verify timestamp + HMAC over the exact raw bytes before trusting anything. */
async function verify(request: IngestRequest) {
  const { connectionPublicId, timestamp, signature } = request;
  if (!connectionPublicId || !timestamp || !signature) {
    throw new AppError("invalid_signature", "Missing X-Fleqo-Connection-Id, X-Fleqo-Timestamp or X-Fleqo-Signature header");
  }

  const connection = await prisma.integrationConnection.findUnique({ where: { publicId: connectionPublicId.slice(0, 64) } });
  if (!connection || connection.provider !== "mock_store" || connection.status !== "active" || !connection.secretCiphertext) {
    throw new AppError("unknown_connection", "Unknown or inactive connection");
  }

  const seconds = /^\d{1,12}$/.test(timestamp) ? Number(timestamp) : NaN;
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > env.WEBHOOK_TOLERANCE_SECONDS) {
    throw new AppError("stale_timestamp", "Timestamp is outside the allowed replay window");
  }

  const secret = decryptSecret(connection.secretCiphertext);
  if (!verifyWebhookSignature(secret, seconds, request.rawBody, signature.toLowerCase())) {
    throw new AppError("invalid_signature", "Signature does not match the request body");
  }
  return { connection, signedAt: new Date(seconds * 1000) };
}

function parsePayload(rawBody: Buffer) {
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError("bad_request", "Body is not valid JSON");
  }
  const parsed = orderCreatedEventSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError(
      "validation_failed",
      "Event payload failed validation",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return { json: json as Prisma.InputJsonValue, event: parsed.data };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Verifies, validates and durably records an `order.created` event.
 * The event, one run per matching active workflow, their action runs and outbox rows commit in one
 * transaction BEFORE we acknowledge. Enqueueing afterwards is best-effort; the dispatcher recovers failures.
 */
export async function ingestOrderEvent(request: IngestRequest, queue: RunQueue, logger?: Logger): Promise<IngestResult> {
  const { connection, signedAt } = await verify(request);
  const { json, event } = parsePayload(request.rawBody);
  // Hash of canonical JSON, so a re-sent event with different whitespace or key order is still a duplicate.
  const payloadSha256 = sha256Hex(canonicalJson(json));
  const organizationId = connection.organizationId;

  let created: { incomingEventId: string; runIds: string[]; dispatchIds: string[] };
  try {
    created = await prisma.$transaction(async (tx) => {
      const incoming = await tx.incomingEvent.create({
        data: {
          organizationId,
          connectionId: connection.id,
          provider: "mock_store",
          externalEventId: event.eventId,
          eventType: event.type,
          payload: json,
          payloadSha256,
          occurredAt: new Date(event.occurredAt),
          signedAt,
          isSynthetic: event.synthetic,
          source: request.source,
        },
      });

      const workflows = await tx.workflow.findMany({
        where: {
          organizationId,
          status: "active",
          trigger: { provider: "mock_store", eventType: event.type, connectionId: connection.id },
        },
        include: { actions: { orderBy: { position: "asc" } } },
      });

      const runIds: string[] = [];
      const dispatchIds: string[] = [];
      for (const workflow of workflows) {
        const run = await tx.workflowRun.create({
          data: {
            organizationId,
            workflowId: workflow.id,
            incomingEventId: incoming.id,
            actionRuns: {
              create: workflow.actions.map((action) => ({
                organizationId,
                workflowActionId: action.id,
                position: action.position,
                provider: action.provider,
                actionType: action.actionType,
              })),
            },
            logs: {
              create: {
                organizationId,
                level: "info",
                message: `Event ${event.eventId} received (${request.source}); run queued with ${workflow.actions.length} action(s)`,
              },
            },
          },
        });
        const dispatch = await tx.eventDispatch.create({
          data: { organizationId, incomingEventId: incoming.id, workflowRunId: run.id },
        });
        runIds.push(run.id);
        dispatchIds.push(dispatch.id);
      }

      await tx.incomingEvent.update({ where: { id: incoming.id }, data: { matchedWorkflowCount: workflows.length } });
      return { incomingEventId: incoming.id, runIds, dispatchIds };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return acknowledgeDuplicate(organizationId, event.eventId, payloadSha256);
  }

  // Best effort: the rows are already committed, so an outage here only delays execution.
  try {
    await dispatchPending(queue, { ids: created.dispatchIds, logger });
  } catch (error) {
    logger?.warn({ err: error }, "Immediate dispatch failed; outbox dispatcher will retry");
  }

  return {
    status: "accepted",
    eventId: event.eventId,
    incomingEventId: created.incomingEventId,
    matchedWorkflows: created.runIds.length,
    runIds: created.runIds,
  };
}

/** Duplicate delivery: acknowledge without creating runs or side effects. */
async function acknowledgeDuplicate(organizationId: string, externalEventId: string, payloadSha256: string): Promise<IngestResult> {
  const existing = await prisma.incomingEvent.findUniqueOrThrow({
    where: { organizationId_provider_externalEventId: { organizationId, provider: "mock_store", externalEventId } },
    include: { runs: { select: { id: true } } },
  });
  if (existing.payloadSha256 !== payloadSha256) {
    throw new AppError("conflict", "This event ID was already received with a different payload");
  }
  await prisma.incomingEvent.update({
    where: { id: existing.id },
    data: { duplicateCount: { increment: 1 }, lastDuplicateAt: new Date() },
  });
  return {
    status: "duplicate",
    eventId: externalEventId,
    incomingEventId: existing.id,
    matchedWorkflows: existing.matchedWorkflowCount,
    runIds: existing.runs.map((run) => run.id),
  };
}
