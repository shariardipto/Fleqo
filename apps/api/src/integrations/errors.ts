/** Retryable failure (timeouts, upstream 429/5xx, simulated outages). */
export class TransientActionError extends Error {
  readonly kind = "transient" as const;
  constructor(message: string) {
    super(message);
    this.name = "TransientActionError";
  }
}

/** Non-retryable failure (invalid mapping output, disabled connection, simulated permanent error). */
export class PermanentActionError extends Error {
  readonly kind = "permanent" as const;
  constructor(message: string) {
    super(message);
    this.name = "PermanentActionError";
  }
}

export type ActionError = TransientActionError | PermanentActionError;
