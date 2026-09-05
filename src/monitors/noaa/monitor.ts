import {
  SOURCE_STALE_AFTER_SECONDS,
  SOURCE_TIMEOUT_MS,
  SWPC_KP_URL,
  SWPC_OVATION_URL,
  SWPC_SOLAR_WIND_MAG_URL,
  SWPC_SOLAR_WIND_SPEED_URL,
} from "@/config/sources";
import { evaluateHealth, type HealthInput } from "@/health/evaluate";
import type { MonitorErrorType, MonitorHealth } from "@/health/model";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher, type DiagnosticResult } from "@/lib/fetchWithDiagnosticsCore";
import { encodeOvationGrid } from "@/lib/ovationGrid";

const defaultRequest: DiagnosticFetcher = (url, options) => fetchWithDiagnosticsCore(url, options);

const PROVENANCE = { mode: "production" as const, provider: "NOAA SWPC" };

export interface NoaaCheckOptions {
  now?: Date;
  request?: DiagnosticFetcher;
}

function swpcGet<T>(url: string, request: DiagnosticFetcher) {
  return request<T>(url, {
    init: { method: "GET", headers: { Accept: "application/json" } },
    responseType: "json",
    timeoutMs: SOURCE_TIMEOUT_MS,
  });
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** SWPC timestamps are UTC but written without a zone designator. */
function parseSwpcTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalised = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

function utcMinute(date: Date) {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Turns a transport failure into the monitor's health, without inventing data. */
function transportFailure(
  base: { id: string; name: string },
  checkedAt: string,
  result: Extract<DiagnosticResult<unknown>, { ok: false }>,
  endpoint: string,
): MonitorHealth {
  const network = result.errorType === "NETWORK_ERROR" || result.errorType === "TIMEOUT";
  return evaluateHealth({
    ...base,
    checkedAt,
    provenance: PROVENANCE,
    latencyMs: result.diagnostics.latencyMs,
    httpStatus: result.diagnostics.httpStatus,
    networkOk: !network,
    parseOk: result.errorType !== "PARSE_ERROR",
    errorType: result.errorType,
    errorMessage: `Request failed — ${result.message}`,
    details: { endpoint },
  });
}

function schemaFailure(
  base: { id: string; name: string },
  checkedAt: string,
  result: Extract<DiagnosticResult<unknown>, { ok: true }>,
  errorType: MonitorErrorType,
  message: string,
  endpoint: string,
): HealthInput {
  return {
    ...base,
    checkedAt,
    provenance: PROVENANCE,
    latencyMs: result.diagnostics.latencyMs,
    httpStatus: result.diagnostics.httpStatus,
    networkOk: true,
    parseOk: true,
    schemaOk: false,
    errorType,
    errorMessage: message,
    details: { endpoint },
  };
}

// ── Planetary K index ─────────────────────────────────────────────────────────

/**
 * `planetary_k_index_1m.json` is a list of one-minute samples; the app reads the newest entry and
 * accepts either `estimated_kp` or the integer `kp_index`.
 */
export async function checkNoaaKp(options: NoaaCheckOptions = {}): Promise<MonitorHealth> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const checkedAt = now.toISOString();
  const base = { id: "noaaKp", name: "NOAA Kp" };

  const response = await swpcGet<unknown>(SWPC_KP_URL, request);
  if (!response.ok) return transportFailure(base, checkedAt, response, SWPC_KP_URL);

  if (!Array.isArray(response.data)) {
    return evaluateHealth(schemaFailure(base, checkedAt, response, "SCHEMA_ERROR", "Kp response is not an array.", SWPC_KP_URL));
  }
  if (response.data.length === 0) {
    return evaluateHealth(schemaFailure(base, checkedAt, response, "EMPTY_DATA", "Kp response contains no samples.", SWPC_KP_URL));
  }

  const latest = response.data[response.data.length - 1] as Record<string, unknown>;
  const observedAt = parseSwpcTime(latest.time_tag);
  if (!observedAt) {
    return evaluateHealth(
      schemaFailure(base, checkedAt, response, "INVALID_TIMESTAMP", "Newest Kp sample has no valid time_tag.", SWPC_KP_URL),
    );
  }

  const estimated = number(latest.estimated_kp);
  const index = number(latest.kp_index);
  const kp = estimated ?? index;
  if (kp === undefined) {
    return evaluateHealth(
      schemaFailure(
        base,
        checkedAt,
        response,
        "SCHEMA_ERROR",
        "Newest Kp sample carries neither estimated_kp nor kp_index as a number.",
        SWPC_KP_URL,
      ),
    );
  }

  const data: Record<string, unknown> = {
    kp: Number(kp.toFixed(2)),
    observedAt: utcMinute(observedAt),
    samples: response.data.length,
  };
  if (index !== undefined) data.kpIndex = index;
  if (typeof latest.kp === "string" && latest.kp.trim()) data.kpLabel = latest.kp;

  return evaluateHealth({
    ...base,
    checkedAt,
    provenance: PROVENANCE,
    latencyMs: response.diagnostics.latencyMs,
    httpStatus: response.diagnostics.httpStatus,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: response.data.length,
    dataTime: observedAt.toISOString(),
    lastSuccess: checkedAt,
    ageSeconds: (now.getTime() - observedAt.getTime()) / 1000,
    staleAfter: SOURCE_STALE_AFTER_SECONDS.noaaKp,
    data,
    details: { ...data, endpoint: SWPC_KP_URL },
  });
}

// ── Solar wind ────────────────────────────────────────────────────────────────

/**
 * The magnetic field summary carries Bt and Bz and is required; the speed summary is a second,
 * optional request — the app tolerates it failing, so losing it is DEGRADED rather than ERROR.
 */
export async function checkSolarWind(options: NoaaCheckOptions = {}): Promise<MonitorHealth> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const checkedAt = now.toISOString();
  const base = { id: "solarWind", name: "NOAA Solar Wind" };

  const magResponse = await swpcGet<unknown>(SWPC_SOLAR_WIND_MAG_URL, request);
  if (!magResponse.ok) return transportFailure(base, checkedAt, magResponse, SWPC_SOLAR_WIND_MAG_URL);

  if (!Array.isArray(magResponse.data) || magResponse.data.length === 0) {
    return evaluateHealth(
      schemaFailure(
        base,
        checkedAt,
        magResponse,
        Array.isArray(magResponse.data) ? "EMPTY_DATA" : "SCHEMA_ERROR",
        "Solar wind magnetic field summary is not a non-empty array.",
        SWPC_SOLAR_WIND_MAG_URL,
      ),
    );
  }

  const mag = magResponse.data[magResponse.data.length - 1] as Record<string, unknown>;
  const observedAt = parseSwpcTime(mag.time_tag);
  if (!observedAt) {
    return evaluateHealth(
      schemaFailure(
        base,
        checkedAt,
        magResponse,
        "INVALID_TIMESTAMP",
        "Newest magnetic field sample has no valid time_tag.",
        SWPC_SOLAR_WIND_MAG_URL,
      ),
    );
  }

  const bt = number(mag.bt);
  const bz = number(mag.bz_gsm);
  if (bt === undefined && bz === undefined) {
    return evaluateHealth(
      schemaFailure(
        base,
        checkedAt,
        magResponse,
        "SCHEMA_ERROR",
        "Newest magnetic field sample carries neither bt nor bz_gsm as a number.",
        SWPC_SOLAR_WIND_MAG_URL,
      ),
    );
  }

  const speedResponse = await swpcGet<unknown>(SWPC_SOLAR_WIND_SPEED_URL, request);
  let speedKms: number | undefined;
  let speedProblem: string | undefined;
  if (!speedResponse.ok) {
    speedProblem = `speed summary unavailable — ${speedResponse.errorType} ${speedResponse.message}`;
  } else if (Array.isArray(speedResponse.data) && speedResponse.data.length > 0) {
    const speed = speedResponse.data[speedResponse.data.length - 1] as Record<string, unknown>;
    speedKms = number(speed.proton_speed);
    if (speedKms === undefined) speedProblem = "speed summary carries no numeric proton_speed";
  } else {
    speedProblem = "speed summary is empty";
  }

  const data: Record<string, unknown> = { observedAt: utcMinute(observedAt) };
  if (speedKms !== undefined) data.speedKms = Number(speedKms.toFixed(1));
  if (bt !== undefined) data.btNt = bt;
  if (bz !== undefined) data.bzNt = bz;

  return evaluateHealth({
    ...base,
    checkedAt,
    provenance: PROVENANCE,
    latencyMs: magResponse.diagnostics.latencyMs,
    httpStatus: magResponse.diagnostics.httpStatus,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: magResponse.data.length,
    dataTime: observedAt.toISOString(),
    lastSuccess: checkedAt,
    ageSeconds: (now.getTime() - observedAt.getTime()) / 1000,
    staleAfter: SOURCE_STALE_AFTER_SECONDS.solarWind,
    partialFailure: speedProblem !== undefined,
    errorType: speedProblem !== undefined ? "HTTP_ERROR" : undefined,
    errorMessage:
      speedProblem === undefined
        ? undefined
        : `Magnetic field values were collected, but the ${speedProblem}.`,
    data,
    details: { ...data, magEndpoint: SWPC_SOLAR_WIND_MAG_URL, speedEndpoint: SWPC_SOLAR_WIND_SPEED_URL },
  });
}

// ── OVATION aurora oval ───────────────────────────────────────────────────────

const ICELAND_LATITUDES = [63, 64, 65, 66, 67];

/**
 * `ovation_aurora_latest.json` is a 1°x1° global grid of `[longitude, latitude, probability]`.
 * The dashboard keeps a summary rather than the whole grid: its size, its two timestamps, and the
 * strongest probability over Iceland, which is the part the app actually shows.
 */
export async function checkOvation(options: NoaaCheckOptions = {}): Promise<MonitorHealth> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const checkedAt = now.toISOString();
  const base = { id: "ovation", name: "NOAA OVATION" };

  const response = await swpcGet<unknown>(SWPC_OVATION_URL, request);
  if (!response.ok) return transportFailure(base, checkedAt, response, SWPC_OVATION_URL);

  const payload = response.data as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return evaluateHealth(
      schemaFailure(base, checkedAt, response, "SCHEMA_ERROR", "OVATION response is not an object.", SWPC_OVATION_URL),
    );
  }

  const observationTime = parseSwpcTime(payload["Observation Time"]);
  const forecastTime = parseSwpcTime(payload["Forecast Time"]);
  if (!observationTime || !forecastTime) {
    return evaluateHealth(
      schemaFailure(
        base,
        checkedAt,
        response,
        "INVALID_TIMESTAMP",
        "OVATION response is missing a valid Observation Time or Forecast Time.",
        SWPC_OVATION_URL,
      ),
    );
  }

  const coordinates = payload.coordinates;
  if (!Array.isArray(coordinates)) {
    return evaluateHealth(
      schemaFailure(base, checkedAt, response, "SCHEMA_ERROR", "OVATION response has no coordinates array.", SWPC_OVATION_URL),
    );
  }
  if (coordinates.length === 0) {
    return evaluateHealth(
      schemaFailure(base, checkedAt, response, "EMPTY_DATA", "OVATION coordinate grid is empty.", SWPC_OVATION_URL),
    );
  }

  let icelandPeak = 0;
  let icelandCells = 0;
  let malformed = 0;
  for (const entry of coordinates) {
    if (!Array.isArray(entry) || entry.length < 3) {
      malformed += 1;
      continue;
    }
    const [, latitude, probability] = entry as number[];
    if (typeof latitude !== "number" || typeof probability !== "number") {
      malformed += 1;
      continue;
    }
    if (ICELAND_LATITUDES.includes(latitude)) {
      icelandCells += 1;
      if (probability > icelandPeak) icelandPeak = probability;
    }
  }

  if (malformed > 0) {
    return evaluateHealth(
      schemaFailure(
        base,
        checkedAt,
        response,
        "SCHEMA_ERROR",
        `${malformed} OVATION grid cells are not [longitude, latitude, probability] triples.`,
        SWPC_OVATION_URL,
      ),
    );
  }

  const data = {
    gridCells: coordinates.length,
    observationTime: utcMinute(observationTime),
    forecastTime: utcMinute(forecastTime),
    icelandLatitudeCells: icelandCells,
    icelandPeakProbabilityPercent: icelandPeak,
    /**
     * The aurora position map's own copy of the model, taken from this same response.
     *
     * Purely additive: every field above is unchanged, and the browser still never calls NOAA.
     * Only the latitude band the map draws is kept, row-major -- see `@/lib/ovationGrid`.
     */
    grid: encodeOvationGrid(coordinates),
  };

  return evaluateHealth({
    ...base,
    checkedAt,
    provenance: PROVENANCE,
    latencyMs: response.diagnostics.latencyMs,
    httpStatus: response.diagnostics.httpStatus,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: coordinates.length,
    dataTime: observationTime.toISOString(),
    lastSuccess: checkedAt,
    ageSeconds: (now.getTime() - observationTime.getTime()) / 1000,
    staleAfter: SOURCE_STALE_AFTER_SECONDS.ovation,
    data,
    details: { ...data, endpoint: SWPC_OVATION_URL },
  });
}
