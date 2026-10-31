export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorBody["details"];
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

/** Same-origin JSON client for the Fleqo API (proxied through Next.js at /api). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "include",
    signal: init.signal,
  });
  if (response.status === 204) return undefined as T;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const body: ApiErrorBody = data?.error ?? { code: "http_error", message: `Request failed (${response.status})` };
    throw new ApiError(response.status, body);
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.details?.map((d) => `${d.path}: ${d.message}`).join("; ");
    return detail ? `${error.message} — ${detail}` : error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
