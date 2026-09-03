export type HealthStatus = "ok" | "info" | "stale" | "degraded" | "error";
export type MonitorErrorType = "NETWORK_ERROR" | "TIMEOUT" | "HTTP_ERROR" | "PARSE_ERROR" | "SCHEMA_ERROR" | "EMPTY_DATA" | "STALE_DATA" | "INVALID_TIMESTAMP" | "UNKNOWN";
export interface MonitorHealth {
  id: string; name: string; status: HealthStatus; checkedAt: string; dataTime?: string; lastSuccess?: string; ageSeconds?: number; latencyMs?: number; httpStatus?: number; networkOk: boolean; parseOk: boolean; schemaOk?: boolean; fresh?: boolean; recordCount?: number; errorType?: MonitorErrorType; errorMessage?: string; details?: Record<string, unknown>;
}
