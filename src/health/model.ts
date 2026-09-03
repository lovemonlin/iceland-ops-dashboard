export type HealthStatus = "ok" | "info" | "stale" | "degraded" | "error";

export type MonitorErrorType =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "PARSE_ERROR"
  | "SCHEMA_ERROR"
  | "EMPTY_DATA"
  | "STALE_DATA"
  | "INVALID_TIMESTAMP"
  /** A CI workflow ran and did not succeed. */
  | "WORKFLOW_FAILED"
  /** A scheduled workflow has not produced a run when one was due. */
  | "WORKFLOW_NOT_RUN"
  /** The workflow exists but GitHub has it in a non-active state, so it cannot be triggered. */
  | "WORKFLOW_DISABLED"
  | "UNKNOWN";

export interface MonitorHealth {
  id: string;
  name: string;
  status: HealthStatus;
  /** ISO 8601. When this check ran. */
  checkedAt: string;
  /** ISO 8601. Timestamp carried by the data itself, never the browser clock. */
  dataTime?: string;
  /** ISO 8601. Last check that produced usable data. */
  lastSuccess?: string;
  ageSeconds?: number;
  latencyMs?: number;
  httpStatus?: number;
  networkOk: boolean;
  parseOk: boolean;
  schemaOk?: boolean;
  fresh?: boolean;
  recordCount?: number;
  errorType?: MonitorErrorType;
  errorMessage?: string;
  /** Healthy-but-worth-saying note that turns "ok" into "info" (see status INFO). */
  note?: string;
  /**
   * The values actually collected from the source this attempt, and nothing else.
   * Its presence is the definition of "this collection succeeded": a snapshot keeps the previous
   * `data` whenever a later attempt produces none. Diagnostics belong in `details`, not here.
   */
  data?: Record<string, unknown>;
  details?: Record<string, unknown>;
}
