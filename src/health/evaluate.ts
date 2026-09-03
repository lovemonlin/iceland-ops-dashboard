import type { HealthStatus, MonitorErrorType, MonitorHealth } from "@/health/model";
export type HealthInput = Omit<MonitorHealth, "status" | "errorType" | "errorMessage"> & { partialFailure?: boolean; allowEmpty?: boolean; staleAfter?: number; errorType?: MonitorErrorType; errorMessage?: string };
export function evaluateHealth(input: HealthInput): MonitorHealth {
  const { partialFailure, allowEmpty, staleAfter, ...base } = input;
  if (!input.networkOk) return { ...base, status: "error", errorType: input.errorType ?? "NETWORK_ERROR", errorMessage: input.errorMessage ?? "Request could not be completed." };
  if (input.httpStatus === undefined || input.httpStatus >= 400) return { ...base, status: "error", errorType: input.errorType ?? "HTTP_ERROR", errorMessage: input.errorMessage ?? "Request returned an invalid HTTP status." };
  if (!input.parseOk) return { ...base, status: "error", errorType: "PARSE_ERROR", errorMessage: input.errorMessage ?? "Response could not be parsed." };
  if (input.schemaOk === false) return { ...base, status: "error", errorType: "SCHEMA_ERROR", errorMessage: input.errorMessage ?? "Required fields are missing." };
  if (input.recordCount === 0 && !allowEmpty) return { ...base, status: "error", errorType: "EMPTY_DATA", errorMessage: input.errorMessage ?? "Dataset returned zero records." };
  if (partialFailure) return { ...base, status: "degraded", errorType: input.errorType, errorMessage: input.errorMessage };
  if (input.ageSeconds !== undefined && staleAfter !== undefined && input.ageSeconds > staleAfter) return { ...base, status: "stale", fresh: false, errorType: "STALE_DATA", errorMessage: input.errorMessage ?? "Data is older than the configured threshold." };
  return { ...base, status: "ok", fresh: input.fresh ?? true, errorType: input.errorType, errorMessage: input.errorMessage };
}
export function getSystemStatus(monitors: Pick<MonitorHealth, "status">[]): HealthStatus {
  if (monitors.some((monitor) => monitor.status === "error")) return "error";
  if (monitors.some((monitor) => monitor.status === "degraded")) return "degraded";
  if (monitors.some((monitor) => monitor.status === "stale")) return "stale";
  return "ok";
}
