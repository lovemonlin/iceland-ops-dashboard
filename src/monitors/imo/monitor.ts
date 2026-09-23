import { IMO_ACTIVE_WARNINGS_URL, IMO_API_VERSION, SOURCE_TIMEOUT_MS } from "@/config/sources";
import { evaluateHealth } from "@/health/evaluate";
import type { MonitorHealth } from "@/health/model";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";
import { normalizeImoWarnings } from "@/monitors/imo/normalize";
import { parseActiveWarnings } from "@/monitors/imo/parse";

export const IMO_MONITOR_ID = "imo";
export const IMO_MONITOR_NAME = "IMO Warnings";
export { parseActiveWarnings } from "@/monitors/imo/parse";
export type { NormalizedImoWarning } from "@/monitors/imo/normalize";
export { normalizeImoWarning, normalizeImoWarnings } from "@/monitors/imo/normalize";

const defaultRequest: DiagnosticFetcher = (url, options) => fetchWithDiagnosticsCore(url, options);

const PROVENANCE = { mode: "production" as const, provider: "Icelandic Met Office CAP broker" };

export interface ImoCheckOptions {
  now?: Date;
  request?: DiagnosticFetcher;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

/**
 * Read-only health check of the Icelandic Met Office CAP broker, using the app's own endpoint and
 * required API-version header.
 *
 * Zero active warnings is a legitimate answer and reports INFO — never EMPTY_DATA.
 */
export async function checkImo(options: ImoCheckOptions = {}): Promise<MonitorHealth> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const checkedAt = now.toISOString();
  const base = { id: IMO_MONITOR_ID, name: IMO_MONITOR_NAME };

  // Read as text, not JSON: the broker answers 204 with an empty body when nothing is active, and a
  // JSON-typed read would call that a parse error rather than "no warnings".
  const response = await request<string>(IMO_ACTIVE_WARNINGS_URL, {
    init: { method: "GET", headers: { "x-vi-api-version": IMO_API_VERSION, Accept: "application/json" } },
    responseType: "text",
    timeoutMs: SOURCE_TIMEOUT_MS,
  });

  if (!response.ok) {
    const network = response.errorType === "NETWORK_ERROR" || response.errorType === "TIMEOUT";
    return evaluateHealth({
      ...base,
      checkedAt,
      provenance: PROVENANCE,
      latencyMs: response.diagnostics.latencyMs,
      httpStatus: response.diagnostics.httpStatus,
      networkOk: !network,
      parseOk: response.errorType !== "PARSE_ERROR",
      errorType: response.errorType,
      errorMessage: `Active warnings request failed — ${response.message}`,
      details: { endpoint: IMO_ACTIVE_WARNINGS_URL },
    });
  }

  const parsed = parseActiveWarnings(response.data ?? "");
  if (!parsed.ok) {
    return evaluateHealth({
      ...base,
      checkedAt,
      provenance: PROVENANCE,
      latencyMs: response.diagnostics.latencyMs,
      httpStatus: response.diagnostics.httpStatus,
      networkOk: true,
      parseOk: !parsed.message.includes("not valid JSON"),
      schemaOk: false,
      errorMessage: parsed.message,
      details: { endpoint: IMO_ACTIVE_WARNINGS_URL },
    });
  }

  const warnings = normalizeImoWarnings(parsed.warnings);
  const sentTimes = warnings.map((warning) => timestamp(warning.sent)).filter((value): value is Date => value !== undefined);
  const newestSent = sentTimes.length > 0 ? new Date(Math.max(...sentTimes.map((date) => date.getTime()))) : undefined;

  const areas = warnings
    .map((warning) => warning.areaNameEn ?? warning.areaNameIs ?? (warning.areaId !== undefined ? String(warning.areaId) : undefined))
    .filter((value): value is string => value !== undefined);
  const events = warnings.map((warning) => warning.eventEn).filter((value): value is string => value !== undefined);

  const data: Record<string, unknown> = { activeWarnings: warnings.length, warnings };
  if (newestSent) data.newestWarningSent = `${newestSent.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  if (events.length > 0) data.events = [...new Set(events)].join(", ");
  if (areas.length > 0) data.areas = [...new Set(areas)].slice(0, 6).join(", ");

  return evaluateHealth({
    ...base,
    checkedAt,
    provenance: PROVENANCE,
    latencyMs: response.diagnostics.latencyMs,
    httpStatus: response.diagnostics.httpStatus,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: warnings.length,
    // Zero warnings is a valid answer, so an empty list must never become EMPTY_DATA.
    allowEmpty: true,
    dataTime: newestSent?.toISOString(),
    lastSuccess: checkedAt,
    // Freshness is not age-based here: the broker lists what is active now, and an absence of
    // warnings has no timestamp of its own to age against.
    infoNote:
      warnings.length === 0
        ? "The warnings API is healthy and Iceland currently has no active weather warnings."
        : undefined,
    data,
    details: {
      activeWarnings: data.activeWarnings,
      newestWarningSent: data.newestWarningSent,
      events: data.events,
      areas: data.areas,
      endpoint: IMO_ACTIVE_WARNINGS_URL,
    },
  });
}
