export type RunStatus = "queued" | "running" | "retrying" | "succeeded" | "failed";
export type Provider = "mock_store" | "mock_crm" | "mock_sheet";

export interface Me {
  user: { id: string; email: string; name: string };
  activeOrganization: {
    id: string;
    name: string;
    slug: string;
    role: string;
    permissions: Record<string, string[]>;
  } | null;
  organizations: { id: string; name: string; slug: string; role: string }[];
}

export interface Connection {
  id: string;
  provider: Provider;
  providerLabel: string;
  name: string;
  status: "active" | "disabled";
  publicId: string;
  hasSigningSecret: boolean;
  secretLast4: string | null;
  secretRotatedAt: string | null;
  createdAt: string;
  stats?: { events: number; customers: number; rows: number; lastEventAt: string | null };
}

export interface CatalogField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  defaultSource: string;
}

export interface Catalog {
  trigger: { provider: string; eventType: string; label: string };
  sources: { path: string; type: string; label: string }[];
  actions: {
    key: string;
    provider: Provider;
    actionType: string;
    label: string;
    description: string;
    fields: CatalogField[];
    defaultMapping: Record<string, string>;
  }[];
  connections: { id: string; provider: Provider; name: string; status: string }[];
}

export interface WorkflowAction {
  id: string;
  key: string;
  label: string;
  position: number;
  provider: Provider;
  actionType: string;
  mapping: Record<string, string>;
  config: { sheetName?: string };
  connection: { id: string; name: string; status: string };
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive" | "archived";
  createdAt: string;
  updatedAt: string;
  trigger: { provider: string; eventType: string; connection: { id: string; name: string; status: string } } | null;
  actions: WorkflowAction[];
  stats?: {
    runs: Partial<Record<RunStatus, number>>;
    lastRunAt?: string | null;
    recentRuns?: { id: string; status: RunStatus; createdAt: string; finishedAt: string | null; incomingEvent: { externalEventId: string } }[];
  };
}

export interface ExecutionListItem {
  id: string;
  status: RunStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workflow: { id: string; name: string };
  incomingEvent: { id: string; externalEventId: string; isSynthetic: boolean; source: string };
  order: { id: string; totalMinor: number; currency: string } | null;
  actionRuns: { id: string; position: number; provider: Provider; actionType: string; status: RunStatus; attempts: number }[];
}

export interface ExecutionDetail {
  id: string;
  status: RunStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workflow: { id: string; name: string; status: string };
  incomingEvent: {
    id: string;
    externalEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    isSynthetic: boolean;
    source: string;
    receivedAt: string;
    signedAt: string;
    duplicateCount: number;
    lastDuplicateAt: string | null;
  };
  actionRuns: {
    id: string;
    position: number;
    provider: Provider;
    actionType: string;
    status: RunStatus;
    attempts: number;
    input: Record<string, unknown> | null;
    output: Record<string, unknown> | null;
    lastError: string | null;
    errorKind: "transient" | "permanent" | null;
    startedAt: string | null;
    finishedAt: string | null;
  }[];
  logs: { id: string; level: "info" | "warn" | "error"; message: string; attempt: number | null; actionRunId: string | null; createdAt: string; metadata: Record<string, unknown> }[];
  deadLetters: { id: string; reason: string; errorMessage: string; attempts: number; resolvedAt: string | null; createdAt: string }[];
  dispatch: { status: string; generation: number; attempts: number; lastError: string | null; dispatchedAt: string | null } | null;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}
