-- CreateEnum
CREATE TYPE "ConnectionProvider" AS ENUM ('mock_store', 'mock_crm', 'mock_sheet');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'retrying', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('pending', 'dispatched');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('info', 'warn', 'error');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "ConnectionProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'active',
    "publicId" TEXT NOT NULL,
    "secretCiphertext" TEXT,
    "secretLast4" TEXT,
    "secretRotatedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'inactive',
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_trigger" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "ConnectionProvider" NOT NULL,
    "eventType" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_action" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "provider" "ConnectionProvider" NOT NULL,
    "actionType" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "ConnectionProvider" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3) NOT NULL,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "matchedWorkflowCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "lastDuplicateAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incoming_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_dispatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incomingEventId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'pending',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "incomingEventId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "workflowActionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "provider" "ConnectionProvider" NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "lastError" TEXT,
    "errorKind" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "actionRunId" TEXT,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "attempt" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "actionRunId" TEXT,
    "reason" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letter_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "ConnectionProvider" NOT NULL DEFAULT 'mock_crm',
    "customerExternalId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "lastOrderExternalId" TEXT,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdByActionRunId" TEXT NOT NULL,
    "updatedByActionRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_sheet_row" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "workflowActionId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "orderExternalId" TEXT NOT NULL,
    "customerExternalId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "totalMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "orderedAt" TIMESTAMP(3),
    "incomingEventId" TEXT NOT NULL,
    "actionRunId" TEXT NOT NULL,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_sheet_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "raw" JSONB,
    "isSynthetic" BOOLEAN NOT NULL,
    "sourceUrl" TEXT,
    "license" TEXT,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imported_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "member_organizationId_userId_key" ON "member"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_publicId_key" ON "integration_connection"("publicId");

-- CreateIndex
CREATE INDEX "integration_connection_organizationId_idx" ON "integration_connection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_organizationId_provider_key" ON "integration_connection"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "workflow_organizationId_status_idx" ON "workflow"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_trigger_workflowId_key" ON "workflow_trigger"("workflowId");

-- CreateIndex
CREATE INDEX "workflow_trigger_organizationId_provider_eventType_idx" ON "workflow_trigger"("organizationId", "provider", "eventType");

-- CreateIndex
CREATE INDEX "workflow_action_organizationId_idx" ON "workflow_action"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_action_workflowId_position_key" ON "workflow_action"("workflowId", "position");

-- CreateIndex
CREATE INDEX "incoming_event_organizationId_receivedAt_idx" ON "incoming_event"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_event_organizationId_provider_externalEventId_key" ON "incoming_event"("organizationId", "provider", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_dispatch_workflowRunId_key" ON "event_dispatch"("workflowRunId");

-- CreateIndex
CREATE INDEX "event_dispatch_status_nextAttemptAt_idx" ON "event_dispatch"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "workflow_run_organizationId_createdAt_idx" ON "workflow_run"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_run_organizationId_status_idx" ON "workflow_run"("organizationId", "status");

-- CreateIndex
CREATE INDEX "workflow_run_status_createdAt_idx" ON "workflow_run"("status", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_run_workflowId_createdAt_idx" ON "workflow_run"("workflowId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_run_workflowId_incomingEventId_key" ON "workflow_run"("workflowId", "incomingEventId");

-- CreateIndex
CREATE INDEX "action_run_status_updatedAt_idx" ON "action_run"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "action_run_workflowRunId_workflowActionId_key" ON "action_run"("workflowRunId", "workflowActionId");

-- CreateIndex
CREATE INDEX "execution_log_workflowRunId_createdAt_idx" ON "execution_log"("workflowRunId", "createdAt");

-- CreateIndex
CREATE INDEX "dead_letter_event_organizationId_resolvedAt_idx" ON "dead_letter_event"("organizationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "mock_customer_organizationId_email_idx" ON "mock_customer"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "mock_customer_organizationId_provider_customerExternalId_key" ON "mock_customer"("organizationId", "provider", "customerExternalId");

-- CreateIndex
CREATE INDEX "mock_sheet_row_organizationId_createdAt_idx" ON "mock_sheet_row"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mock_sheet_row_organizationId_workflowActionId_orderExterna_key" ON "mock_sheet_row"("organizationId", "workflowActionId", "orderExternalId");

-- CreateIndex
CREATE INDEX "imported_record_organizationId_kind_idx" ON "imported_record"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "imported_record_organizationId_source_sourceRecordId_key" ON "imported_record"("organizationId", "source", "sourceRecordId");

-- CreateIndex
CREATE INDEX "audit_log_organizationId_createdAt_idx" ON "audit_log"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_trigger" ADD CONSTRAINT "workflow_trigger_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_trigger" ADD CONSTRAINT "workflow_trigger_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_event" ADD CONSTRAINT "incoming_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_event" ADD CONSTRAINT "incoming_event_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_dispatch" ADD CONSTRAINT "event_dispatch_incomingEventId_fkey" FOREIGN KEY ("incomingEventId") REFERENCES "incoming_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_dispatch" ADD CONSTRAINT "event_dispatch_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_incomingEventId_fkey" FOREIGN KEY ("incomingEventId") REFERENCES "incoming_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_run" ADD CONSTRAINT "action_run_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_run" ADD CONSTRAINT "action_run_workflowActionId_fkey" FOREIGN KEY ("workflowActionId") REFERENCES "workflow_action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_log" ADD CONSTRAINT "execution_log_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_log" ADD CONSTRAINT "execution_log_actionRunId_fkey" FOREIGN KEY ("actionRunId") REFERENCES "action_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_event" ADD CONSTRAINT "dead_letter_event_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_customer" ADD CONSTRAINT "mock_customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_customer" ADD CONSTRAINT "mock_customer_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_sheet_row" ADD CONSTRAINT "mock_sheet_row_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_sheet_row" ADD CONSTRAINT "mock_sheet_row_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_sheet_row" ADD CONSTRAINT "mock_sheet_row_workflowActionId_fkey" FOREIGN KEY ("workflowActionId") REFERENCES "workflow_action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_record" ADD CONSTRAINT "imported_record_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fleqo integrity checks (not expressible in Prisma schema)
ALTER TABLE "mock_sheet_row" ADD CONSTRAINT "mock_sheet_row_totalMinor_nonnegative" CHECK ("totalMinor" >= 0);
ALTER TABLE "mock_sheet_row" ADD CONSTRAINT "mock_sheet_row_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_attempts_nonnegative" CHECK ("attempts" >= 0);
ALTER TABLE "action_run" ADD CONSTRAINT "action_run_attempts_nonnegative" CHECK ("attempts" >= 0);
ALTER TABLE "action_run" ADD CONSTRAINT "action_run_errorKind_valid" CHECK ("errorKind" IS NULL OR "errorKind" IN ('transient', 'permanent'));
ALTER TABLE "workflow_action" ADD CONSTRAINT "workflow_action_position_positive" CHECK ("position" >= 1);
