# Fleqo — Database ERD and Data Model

**Version:** 0.2, reconciled with the implemented schema (migration `20261031155142_init`)
**Database:** PostgreSQL 18 · **ORM:** Prisma 7.10 (`prisma-client` generator, `@prisma/adapter-pg`)
**Source of truth:** [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)

> Version 0.1 of this document was a proposal. This version describes what is implemented. Differences from the proposal are listed in [§7](#7-changes-from-the-v01-proposal).

## 1. Entity-relationship diagram

```mermaid
erDiagram
  user ||--o{ session : has
  user ||--o{ account : has
  user ||--o{ member : "belongs via"
  user ||--o{ invitation : "invited (inviterId)"
  organization ||--o{ member : has
  organization ||--o{ invitation : has
  organization ||--o{ integration_connection : owns
  organization ||--o{ workflow : owns
  organization ||--o{ incoming_event : receives
  organization ||--o{ workflow_run : runs
  organization ||--o{ mock_customer : has
  organization ||--o{ mock_sheet_row : has
  organization ||--o{ imported_record : stores
  organization ||--o{ audit_log : logs
  workflow ||--|| workflow_trigger : "has one"
  workflow ||--o{ workflow_action : "ordered actions"
  integration_connection ||--o{ workflow_trigger : "store connection"
  integration_connection ||--o{ workflow_action : "destination connection"
  integration_connection ||--o{ incoming_event : "verified sender"
  incoming_event ||--o{ workflow_run : initiates
  incoming_event ||--o{ event_dispatch : schedules
  workflow ||--o{ workflow_run : runs
  workflow_run ||--|| event_dispatch : "outbox row"
  workflow_run ||--o{ action_run : contains
  workflow_action ||--o{ action_run : executes
  workflow_run ||--o{ execution_log : logs
  action_run ||--o{ execution_log : logs
  workflow_run ||--o{ dead_letter_event : "may fail into"
  workflow_action ||--o{ mock_sheet_row : writes
  integration_connection ||--o{ mock_customer : writes
  integration_connection ||--o{ mock_sheet_row : writes

  organization { string id PK  string name  string slug UK }
  member { string id PK  string organizationId FK  string userId FK  string role }
  integration_connection { string id PK  string organizationId FK  enum provider  enum status  string publicId UK  string secretCiphertext }
  workflow { string id PK  string organizationId FK  string name  enum status }
  workflow_trigger { string id PK  string workflowId FK_UK  enum provider  string eventType  string connectionId FK }
  workflow_action { string id PK  string workflowId FK  int position  enum provider  string actionType  json mapping  json config }
  incoming_event { string id PK  string organizationId FK  string connectionId FK  string externalEventId  json payload  string payloadSha256 }
  event_dispatch { string id PK  string workflowRunId FK_UK  enum status  int generation  datetime nextAttemptAt }
  workflow_run { string id PK  string workflowId FK  string incomingEventId FK  enum status  int attempts  datetime leaseExpiresAt }
  action_run { string id PK  string workflowRunId FK  string workflowActionId FK  enum status  int attempts  string errorKind }
  execution_log { string id PK  string workflowRunId FK  string actionRunId FK  enum level  string message }
  dead_letter_event { string id PK  string workflowRunId FK  string reason  datetime resolvedAt }
  mock_customer { string id PK  string organizationId FK  string customerExternalId  string email }
  mock_sheet_row { string id PK  string organizationId FK  string workflowActionId FK  string orderExternalId  int totalMinor  char3 currency }
  imported_record { string id PK  string organizationId FK  string source  string sourceRecordId  string kind  bool isSynthetic }
  audit_log { string id PK  string organizationId FK  string actorUserId  string action }
```

Mermaid entities list key columns only. `verification` (Better Auth) has no relations and is omitted.

## 2. Schema groups

| Group | Tables | Owner |
| --- | --- | --- |
| Identity | `user`, `session` (+`activeOrganizationId`), `account`, `verification` | Better Auth (generated with `npx auth@1.7.14 generate`) |
| Organizations | `organization`, `member`, `invitation` | Better Auth Organization plugin (Fleqo adds `@@unique([organizationId, userId])` on `member`) |
| Configuration | `integration_connection`, `workflow`, `workflow_trigger`, `workflow_action` | Fleqo |
| Ingestion | `incoming_event`, `event_dispatch` (transactional outbox) | Fleqo |
| Execution | `workflow_run`, `action_run`, `execution_log`, `dead_letter_event` | Fleqo |
| Mock destinations | `mock_customer`, `mock_sheet_row` | Fleqo |
| Demo / import | `imported_record` | Fleqo |
| Audit | `audit_log` | Fleqo |

Enums: `ConnectionProvider` (mock_store, mock_crm, mock_sheet), `ConnectionStatus` (active, disabled), `WorkflowStatus` (active, inactive, archived), `RunStatus` (queued, running, retrying, succeeded, failed — used by runs **and** action runs), `DispatchStatus` (pending, dispatched), `LogLevel` (info, warn, error). Fleqo primary keys are UUIDv7 (`@default(uuid(7))`, time-ordered, used for cursor pagination); Better Auth generates its own IDs.

## 3. Constraints and indexes (implemented)

| Table | Constraint / index | Purpose |
| --- | --- | --- |
| member | `UNIQUE (organizationId, userId)` | One membership per user per organization |
| organization | `UNIQUE (slug)` | Better Auth |
| integration_connection | `UNIQUE (publicId)` | Identify the signing connection from `X-Fleqo-Connection-Id` |
| integration_connection | `UNIQUE (organizationId, provider)` | MVP: one connection per mock provider per organization |
| workflow_trigger | `UNIQUE (workflowId)` | Exactly one trigger per workflow |
| workflow_action | `UNIQUE (workflowId, position)`, `CHECK (position >= 1)` | Stable action order |
| incoming_event | `UNIQUE (organizationId, provider, externalEventId)` | Event-level idempotency |
| event_dispatch | `UNIQUE (workflowRunId)`; `INDEX (status, nextAttemptAt)` | One outbox row per run; dispatcher scan |
| workflow_run | `UNIQUE (workflowId, incomingEventId)`; `CHECK (attempts >= 0)` | One run per workflow and event |
| action_run | `UNIQUE (workflowRunId, workflowActionId)`; `CHECK (attempts >= 0)`; `CHECK (errorKind IN ('transient','permanent'))` | Durable state of each logical action |
| mock_customer | `UNIQUE (organizationId, provider, customerExternalId)` | CRM upsert key |
| mock_sheet_row | `UNIQUE (organizationId, workflowActionId, orderExternalId)`; `CHECK (totalMinor >= 0)`; `CHECK (currency ~ '^[A-Z]{3}$')` | One row per order and action; money integrity |
| imported_record | `UNIQUE (organizationId, source, sourceRecordId)` | Repeatable imports (`sourceRecordId` = `users/5`, `products/12`, `carts/3`, `customers/7`) |
| workflow_run | `INDEX (organizationId, createdAt)`, `(organizationId, status)`, `(status, createdAt)`, `(workflowId, createdAt)` | Monitoring queries |
| incoming_event | `INDEX (organizationId, receivedAt)` | Event history |
| action_run | `INDEX (status, updatedAt)` | Retry / monitoring |
| execution_log | `INDEX (workflowRunId, createdAt)` | Run log timeline |
| dead_letter_event | `INDEX (organizationId, resolvedAt)` | Open dead letters |
| audit_log | `INDEX (organizationId, createdAt)` | Audit trail |

The CHECK constraints are written by hand at the end of the init migration because Prisma cannot model them. Uniqueness and CHECK behaviour is covered by `apps/api/test/schema-constraints.test.ts`.

## 4. Tenancy rules
- Every Fleqo table that holds tenant data has `organizationId`, and the API always queries by `id` **and** `organizationId`, where the organization comes from the session's server-side `activeOrganizationId` after re-verifying `member`.
- Webhooks set `organizationId` from the **verified connection**; any organization ID inside the JSON body is ignored.
- The worker reads organization scope from the persisted run and event, never from the job payload (the job only carries the run ID, dispatch ID and generation).
- `onDelete: Cascade` from `organization` removes tenant data. Connections use `Restrict` from events, triggers, actions and destination rows, so history cannot be orphaned; workflows are archived, never deleted, from the UI.

## 5. Money, event data and provenance
- `mock_sheet_row.totalMinor` is an integer in minor units with `currency CHAR(3)`; event validation limits values to the int32 range.
- `incoming_event.payload` keeps the received JSON (JSONB). `payloadSha256` hashes **canonical (key-sorted) JSON**, so re-deliveries match even after JSONB reorders keys, and a different payload under the same event ID is rejected (409).
- `isSynthetic` is stored on events, customers, sheet rows and imported records. `imported_record` stores `source`, `sourceUrl`, `license` and the raw source record.
- Timestamps: `receivedAt`, `signedAt`, `occurredAt` on events; `startedAt` / `finishedAt` / `updatedAt` on runs and action runs; one `execution_log` row per state transition and attempt.

## 6. Idempotency at a glance
| Layer | Mechanism |
| --- | --- |
| Event | `UNIQUE (organizationId, provider, externalEventId)`; duplicate → 200 with no new runs |
| Run | `UNIQUE (workflowId, incomingEventId)`; run **lease** (`leaseExpiresAt`) taken by a conditional UPDATE |
| Dispatch | `UNIQUE (workflowRunId)`; `generation` bumped for manual retry or recovery; job ID `run-<id>-g<generation>` |
| Action | `UNIQUE (workflowRunId, workflowActionId)`; succeeded actions are skipped; success committed with `UPDATE … WHERE status='running' AND attempts=<n>` |
| Destination | Customer upsert key; sheet insert-or-keep key; write + action success in **one transaction** |

## 7. Changes from the v0.1 proposal
| Proposal | Implemented | Reason |
| --- | --- | --- |
| `OrganizationMember` table | Better Auth `member` (+ `invitation`) | Owner decision: use the official Organization plugin; no duplicate tables |
| Status as free text | PostgreSQL enums; runs and action runs share `RunStatus` | Database-level validation |
| No log table | `execution_log` | Action-level, per-attempt logs required by the execution detail view |
| `MockCustomer` key only | Plus `createdByActionRunId` / `updatedByActionRunId` / `lastOrderExternalId` | Shows whether an upsert created or updated, and traceability |
| `ImportedRecord` 3-column key | Same key; `kind` is a separate column and `sourceRecordId` carries the source path | Avoids ID collisions between users, products and carts without changing the key |
| — | `integration_connection UNIQUE (organizationId, provider)` | MVP simplification: one mock connection per provider |
| — | Hand-written CHECK constraints | Money and counter integrity |
