import { IMO_ACTIVE_WARNINGS_URL, IMO_API_VERSION, SOURCE_TIMEOUT_MS } from "@/config/sources";
import { evaluateHealth } from "@/health/evaluate";
import type { MonitorHealth } from "@/health/model";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";

export const IMO_MONITOR_ID = "imo";
export const IMO_MONITOR_NAME = "IMO Warnings";

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

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Parses the CAP broker's active-warning body, the way the app does: as raw text.
 *
 * "No active warnings" has several shapes in practice — an empty body (the broker answers
 * `204 No Content`), the JSON string `""`, or `[]`. All of them are healthy empty answers, not
 * broken ones, so they are reported separately from a malformed response.
 */
export function parseActiveWarnings(
  body: string,
): { ok: true; warnings: Record<string, unknown>[] } | { ok: false; message: string } {
  const trimmed = body.trim();
  if (trimmed === "" || trimmed === '""' || trimmed === "[]") return { ok: true, warnings: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: "Active warnings body is not valid JSON." };
  }

  if (raw === "" || raw === null) return { ok: true, warnings: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "Active warnings payload is neither an array nor an empty string." };

  const warnings: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "An active warning entry is not an object." };
    }
    const warning = entry as Record<string, unknown>;
    if (!text(warning.identifier)) return { ok: false, message: "An active warning has no identifier." };
    warnings.push(warning);
  }
  return { ok: true, warnings };
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

  const { warnings } = parsed;
  const sentTimes = warnings.map((warning) => timestamp(warning.sent)).filter((value): value is Date => value !== undefined);
  const newestSent = sentTimes.length > 0 ? new Date(Math.max(...sentTimes.map((date) => date.getTime()))) : undefined;

  const areas = warnings
    .map((warning) => text(warning.area_en) ?? text(warning.area) ?? text(warning.area_id))
    .filter((value): value is string => value !== undefined);
  const events = warnings.map((warning) => text(warning.event_en)).filter((value): value is string => value !== undefined);

  const data: Record<string, unknown> = { activeWarnings: warnings.length };
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
    details: { ...data, endpoint: IMO_ACTIVE_WARNINGS_URL },
  });
}
