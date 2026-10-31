# Fleqo — Software Requirements Specification (SRS)

**Project:** Fleqo — Integration & Workflow Automation Hub  
**Version:** 0.1 (MVP baseline)  
**Status:** Initial specification  
**Audience:** Solo developer, demo users, technical reviewers  
**Document language:** English (implementation terminology), with contextual Bengali notes where useful  

## 1. Problem Statement

Small online businesses frequently transfer new-order information manually between an e-commerce store, CRM, and spreadsheet. Repetitive copy-paste causes delays, duplicate records, missed updates, and poor visibility into failures. Fleqo automates these transfers and makes every execution traceable and retry-safe.

## 2. Product Goal

Build a multi-organization web application in which a user configures a predefined **new order → CRM customer upsert → spreadsheet order append** workflow, triggers it with a validated event, and monitors the result. For its first release, Fleqo will use publicly available e-commerce data and locally controlled mock destination services. It will not require paid integrations.

## 3. Target Users and Roles

| Role | MVP permissions |
| --- | --- |
| Owner | Manage organization, memberships, connections, workflows, executions |
| Admin | Manage connections, workflows and execution monitoring, but not ownership |
| Member | View permitted workflows/executions and run authorized test events; no permission administration |

Each user belongs to one or more organizations. **All organization-owned data must be accessed using verified membership and organization scope on the backend.**

## 4. MVP Scope (In Scope)

1. Email/password signup, sign-in, sign-out and session management using Better Auth.
2. Organization creation, membership and role-based authorization.
3. Connection management for **mock_store**, **mock_crm** and **mock_sheet**.
4. Guided form-based workflow creation, viewing, enabling/disabling, and deletion/archiving.
5. Exactly one trigger in MVP: `mock_store.order.created`.
6. Two actions in MVP, run sequentially: `mock_crm.upsert_customer` and `mock_sheet.append_order`.
7. Import and normalize public sample products, customers, carts or order records; synthesize demo orders when the data source does not expose a suitable order event.
8. Webhook receiver: signed test events, request validation, timestamp handling and persistent event ingestion.
9. BullMQ worker: workflow matching, field mapping, ordered action execution and persisted run status.
10. Idempotency at event and action levels; bounded retries with exponential backoff; dead-letter/failed-state visibility and manual retry.
11. Dashboard showing workflow counts, runs by status, and recent activity.
12. Execution detail view with per-action logs, timestamps, error messages and retry information.
13. Automated tests for permissions, webhook validation, duplicate events, retries, and successful synchronization.
14. Live deployment and technical portfolio documentation.

## 5. Out of Scope for MVP

- Drag-and-drop workflow canvas; conditional branching; generic no-code scripting.
- Real Shopify/WooCommerce/Google Sheets OAuth integrations.
- Payment collection, billing and subscriptions.
- AI workflow creation or AI-powered suggestions.
- High-volume production scale guarantees, real-time collaboration and multi-region infrastructure.
- Sending live customer emails or messages.

These are potential post-MVP milestones, not initial commitments.

## 6. Primary User Journey

1. A user creates an account and an organization.
2. The user opens Connections and enables the mock store, CRM, and sheet services.
3. The user creates a workflow named **Order Sync** with trigger `order.created`.
4. The user maps source fields (e.g., `customer.email`, `order.id`, `order.total`) to the CRM and sheet action schemas.
5. The user enables the workflow.
6. Sample e-commerce data is imported, and an Order Event Simulator emits a signed `order.created` webhook.
7. Fleqo validates and persists the event, then queues matching workflow runs.
8. A worker upserts the customer in mock CRM and appends the order to mock Sheet.
9. Each action and the overall run are recorded and visible in Execution Monitor.
10. A repeated event does not duplicate downstream records. Temporary failures can be retried safely.

## 7. Example Event Contract (Fleqo-generated; not a provider payload)

```json
{
  "eventId": "demo_evt_0001",
  "type": "order.created",
  "occurredAt": "2026-10-31T12:00:00.000Z",
  "data": {
    "order": { "id": "demo_order_0001", "totalMinor": 12999, "currency": "USD" },
    "customer": { "externalId": "demo_customer_001", "email": "customer@example.test", "name": "Demo Customer" }
  }
}
```

**Assumptions:** Amounts are integer minor units; currency is explicit; email/name values in this example are synthetic. Event IDs are unique per organization and provider. Preserve raw event payload for audit/debugging subject to retention controls.

## 8. Public Data Strategy

| Data source | Intended use | Caveat |
| --- | --- | --- |
| DummyJSON (`https://dummyjson.com/docs`) | Product, user, cart samples | Create/update operations may be simulated rather than persistent |
| Fake Store API (`https://fakestoreapi.com/`) | Alternative catalog/cart samples | Not a real-time merchant webhook source |
| JSONPlaceholder (`https://jsonplaceholder.typicode.com/`) | HTTP client/request test scenarios | Not an order/CRM system |
| Olist public e-commerce dataset | Historical order-like records for sample import | Check license, attribution, dataset availability and fields before using |
| Fleqo Event Simulator | `order.created`, duplicates, failures, replay | Clearly label generated events as synthetic |

**Rule:** Public data powers demo inputs. Mock CRM, Sheet and run results are stored in Fleqo-managed PostgreSQL tables. No real customer private data or paid API is required for MVP.

## 9. Main Pages

| Route | Function |
| --- | --- |
| `/sign-in`, `/sign-up` | Authentication |
| `/dashboard` | KPI summary and recent runs |
| `/connections` | Mock service connection configuration |
| `/workflows` | Workflow list, status, controls |
| `/workflows/new` | Guided trigger/action form |
| `/workflows/[id]` | Workflow detail and configuration |
| `/executions` | Runs with search/filter |
| `/executions/[id]` | Action logs and retry information |
| `/team` | Organization members/roles |
| `/settings` | Organization settings |

## 10. Initial Data Model

**Auth:** User, Session, Account, Verification (Better Auth-managed fields).  
**Multi-tenancy:** Organization, OrganizationMember.  
**Configuration:** IntegrationConnection, Workflow, WorkflowTrigger, WorkflowAction.  
**Event ingestion:** IncomingEvent.  
**Execution:** WorkflowRun, ActionRun, RetryJob/DeadLetterEvent (as required).  
**Mock destinations:** MockCustomer, MockSheetRow.  
**Observability:** AuditLog.

Core relationships:
- Organization 1→many Workflows / Connections / IncomingEvents / Runs.
- Workflow 1→one Trigger and 1→many ordered Actions.
- IncomingEvent 1→many WorkflowRuns (one per matching workflow).
- WorkflowRun 1→many ActionRuns.

Key safeguards:
- Unique `(organizationId, provider, externalEventId)` on incoming events.
- Unique `(workflowId, incomingEventId)` on workflow runs.
- Unique logical action execution key `(workflowId, incomingEventId, workflowActionId)` or equivalent for downstream idempotency.
- Required foreign keys and indexes on organizationId, workflowId, createdAt and status.
- Never accept a client-provided organization ID as sufficient authorization; verify membership server-side.

## 11. API Scope (Draft)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health status |
| * | `/api/auth/*` | Better Auth handlers |
| POST | `/api/organizations` | Create organization |
| GET/POST | `/api/connections` | List/create connection |
| GET/POST | `/api/workflows` | List/create workflow |
| GET/PATCH | `/api/workflows/:id` | Get/update workflow |
| POST | `/api/webhooks/mock-store` | Receive signed order event |
| POST | `/api/demo/import` | Admin-only public-data import |
| POST | `/api/demo/simulate-order` | Authorized synthetic event |
| GET | `/api/executions` | Filter runs |
| GET | `/api/executions/:id` | Run detail |
| POST | `/api/executions/:id/retry` | Retry recoverable run |
| GET | `/api/dashboard/summary` | Summary metrics |

This is the planned contract; request/response schemas will be finalized before implementing each route.

## 12. Tech Stack (Confirmed)

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui.
- **Frontend data:** TanStack Query; Zustand only if shared client UI state requires it.
- **Backend:** Node.js, Express.js, TypeScript, Zod, Better Auth.
- **Database:** PostgreSQL, Prisma ORM.
- **Queue/worker:** Redis, BullMQ, separate Node.js worker process.
- **Testing:** Vitest, Supertest, Playwright.
- **Infrastructure:** Docker for local databases/services; Vercel for frontend; Railway or an equivalent long-running host for API and worker.

**Version policy:** Before initialization, use currently stable compatible package releases, pin direct dependency versions and confirm Better Auth ↔ Prisma adapter compatibility.

## 13. Security and Reliability Requirements

- Authentication and server-side organization role checks for every private resource.
- Webhook HMAC verification using raw request body, with timestamp/replay window for signed demo events.
- Request validation, payload-size limits, basic rate limiting and sanitized error responses.
- Secrets only in environment variables or server-side secrets management.
- Database-backed idempotency; worker retries must not repeat completed side effects.
- An incoming event must be persisted before acknowledging successful receipt; queue dispatch failures must be recoverable (e.g., re-enqueue pending persisted events).
- Structured logs without credential leakage; durable execution audit trails.
- Use synthetic data where possible; data-source license/attribution checks before importing public datasets.

## 14. Non-Functional Requirements

- Local development must run on a single developer machine with Dockerized PostgreSQL and Redis.
- UI must be responsive and usable on desktop/mobile, with loading/error/empty states.
- Workflow runs and actions must have explicit statuses: `queued`, `running`, `succeeded`, `failed` (and `retrying` where appropriate).
- API errors should be machine-readable and traceable by request/run identifier.
- Seed data must be reproducible and marked as demo content.
- Production API/worker should run independently; frontend hosting must not be responsible for continuous worker execution.

## 15. Acceptance Criteria (Definition of Done)

Status as of 2026-10-31. Evidence is in [`agent-progress.md`](./agent-progress.md#acceptance-checklist-requirements-15).

- [x] New account can sign in and create an organization.
- [x] Org member cannot access another organization's resources.
- [x] Public example data can be imported, and generated orders are labeled synthetic.
- [x] User can configure and enable the Order Sync workflow.
- [x] Valid signed `order.created` events are accepted and processed.
- [x] Invalid signature and malformed payload are rejected.
- [x] One unique order creates/updates the expected mock CRM customer and mock Sheet row.
- [x] Re-sending the same event does **not** create duplicate records.
- [x] Temporary destination failure triggers retry; already completed actions are not repeated.
- [x] Failed and successful runs are visible with action-level logs.
- [x] A repeatable test batch containing at least 100 generated events (plus duplicate/failure scenarios) passes its assertions.
- [ ] Frontend, backend, worker and database are deployed and smoke-tested. — **Blocked (external):** no cloud credentials or deployment approval yet. The deployable configuration is complete, and the production Docker image passed the smoke test locally (13/13).
- [x] GitHub README documents architecture, setup, design tradeoffs and real test results.

## 16. Delivery Phases

0. Planning and design
1. Environment / monorepo / Docker
2. PostgreSQL / Prisma models and migrations
3. Better Auth / organizations / RBAC
4. Public data import and normalization
5. Mock store / CRM / Sheet services
6. Workflow configuration
7. Secure webhook event ingestion
8. Queue worker and action execution
9. Retries, deduplication, recovery
10. Dashboard and frontend workflows
11. Test automation, security, verification
12. Live deployment and portfolio presentation

## 17. Immediate Next Step

Create `docs/architecture.md` containing:
1. Component diagram (browser, API, DB, Redis, worker, public source, mock destinations).
2. Event-to-action sequence diagram.
3. Organization and authorization boundary notes.
4. Deployment split (Vercel vs API/worker host).

After architecture review, proceed to Phase 01 environment setup.
