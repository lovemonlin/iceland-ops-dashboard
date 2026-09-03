import type { HealthStatus, MonitorErrorType, MonitorHealth } from "@/health/model";

export type HealthInput = Omit<MonitorHealth, "status" | "errorType" | "errorMessage" | "note"> & {
  /** Some sub-checks failed while others succeeded. */
  partialFailure?: boolean;
  /** Zero records is a legitimate answer for this source (e.g. IMO with no active warnings). */
  allowEmpty?: boolean;
  staleAfter?: number;
  /**
   * Caller-determined staleness, for sources whose freshness is not a plain age threshold.
   * ECMWF uses it: "behind the production model-cycle schedule" cannot be expressed as an age.
   */
  stale?: boolean;
  /** Healthy, but worth telling the maintainer: promotes "ok" to "info". */
  infoNote?: string;
  /**
   * A source-specific fatal condition the generic rules cannot express — for example a forecast
   * whose frames have all expired, or a source whose sampled assets are all unavailable.
   * Checked after transport and schema, but before partial failure and freshness.
   */
  fatalError?: { type: MonitorErrorType; message: string };
  errorType?: MonitorErrorType;
  errorMessage?: string;
};

export function evaluateHealth(input: HealthInput): MonitorHealth {
  const { partialFailure, allowEmpty, staleAfter, stale, infoNote, fatalError, ...base } = input;

  if (!input.networkOk) {
    return {
      ...base,
      status: "error",
      errorType: input.errorType ?? "NETWORK_ERROR",
      errorMessage: input.errorMessage ?? "Request could not be completed.",
    };
  }

  if (input.httpStatus === undefined || input.httpStatus >= 400) {
    return {
      ...base,
      status: "error",
      errorType: input.errorType ?? "HTTP_ERROR",
      errorMessage: input.errorMessage ?? "Request returned an invalid HTTP status.",
    };
  }

  if (!input.parseOk) {
    return {
      ...base,
      status: "error",
      errorType: "PARSE_ERROR",
      errorMessage: input.errorMessage ?? "Response could not be parsed.",
    };
  }

  if (input.schemaOk === false) {
    return {
      ...base,
      status: "error",
      errorType: input.errorType ?? "SCHEMA_ERROR",
      errorMessage: input.errorMessage ?? "Required fields are missing.",
    };
  }

  if (input.recordCount === 0 && !allowEmpty) {
    return {
      ...base,
      status: "error",
      errorType: "EMPTY_DATA",
      errorMessage: input.errorMessage ?? "Dataset returned zero records.",
    };
  }

  if (fatalError) {
    return { ...base, status: "error", errorType: fatalError.type, errorMessage: fatalError.message };
  }

  if (partialFailure) {
    return {
      ...base,
      status: "degraded",
      errorType: input.errorType,
      errorMessage: input.errorMessage,
    };
  }

  const tooOld = input.ageSeconds !== undefined && staleAfter !== undefined && input.ageSeconds > staleAfter;
  if (stale || tooOld) {
    return {
      ...base,
      status: "stale",
      fresh: false,
      errorType: "STALE_DATA",
      errorMessage: input.errorMessage ?? "Data is older than the configured threshold.",
    };
  }

  if (infoNote) {
    return { ...base, status: "info", fresh: input.fresh ?? true, note: infoNote };
  }

  return {
    ...base,
    status: "ok",
    fresh: input.fresh ?? true,
    errorType: input.errorType,
    errorMessage: input.errorMessage,
  };
}

/** INFO never degrades the overall system status. */
export function getSystemStatus(monitors: Pick<MonitorHealth, "status">[]): HealthStatus {
  if (monitors.some((monitor) => monitor.status === "error")) return "error";
  if (monitors.some((monitor) => monitor.status === "degraded")) return "degraded";
  if (monitors.some((monitor) => monitor.status === "stale")) return "stale";
  return "ok";
}
