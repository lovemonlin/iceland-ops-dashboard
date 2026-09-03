import { freshnessThresholds } from "@/config/freshness";
import type { MockMonitorId } from "@/config/monitors";
import { evaluateHealth, type HealthInput } from "@/health/evaluate";
import type { MonitorHealth } from "@/health/model";

/**
 * Fixed baseline used for server render and for the first client render, so that
 * hydration is deterministic. The dashboard replaces it with the real clock after mount.
 */
export const MOCK_BASELINE_CHECKED_AT = "2026-09-03T08:52:13.000Z";

type MockSpec = Omit<HealthInput, "id" | "checkedAt" | "dataTime" | "lastSuccess" | "ageSeconds" | "staleAfter"> & {
  id: MockMonitorId;
  /** Age of the data itself at check time, in seconds. Omit when no data was obtained. */
  dataAgeSeconds?: number;
  /** Age of the last check that produced usable data, in seconds. */
  lastSuccessAgeSeconds?: number;
};

/**
 * Placeholder data for the sources that are not wired to production yet.
 * ECMWF and IRCA are absent on purpose: they are real monitors now (`src/monitors/`).
 *
 * Deliberately covers ok, info, degraded and error.
 * Every status below is derived by `evaluateHealth`, never hand-written, so the
 * mock exercises the same rules a production monitor will.
 */
const specs: MockSpec[] = [
  {
    id: "metno",
    name: "MET Norway Weather",
    dataAgeSeconds: 3133,
    lastSuccessAgeSeconds: 0,
    latencyMs: 432,
    httpStatus: 200,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: 4,
    details: { locations: "4/4", temperatureC: 8, windMps: 6.4, lowCloudPercent: 42, mediumCloudPercent: 21, highCloudPercent: 9 },
  },
  {
    id: "noaaKp",
    name: "NOAA Kp",
    lastSuccessAgeSeconds: 10333,
    latencyMs: 276,
    httpStatus: 200,
    networkOk: true,
    parseOk: true,
    schemaOk: false,
    errorMessage: "HTTP 200, but the required numeric Kp field is missing from the response.",
  },
  {
    id: "solarWind",
    name: "NOAA Solar Wind",
    dataAgeSeconds: 313,
    lastSuccessAgeSeconds: 0,
    latencyMs: 218,
    httpStatus: 200,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: 1,
    details: { speedKms: 514, btNt: 6.8, bzNt: -3.1 },
  },
  {
    id: "ovation",
    name: "NOAA OVATION",
    dataAgeSeconds: 3133,
    lastSuccessAgeSeconds: 0,
    latencyMs: 361,
    httpStatus: 200,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: 29,
    partialFailure: true,
    errorType: "HTTP_ERROR",
    errorMessage: "29 coordinate records loaded; 3 forecast regions returned HTTP 404.",
    details: { successfulRegions: 29, failedRegions: 3 },
  },
  {
    id: "imo",
    name: "IMO Warnings",
    dataAgeSeconds: 433,
    lastSuccessAgeSeconds: 0,
    latencyMs: 173,
    httpStatus: 200,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    recordCount: 0,
    allowEmpty: true,
    infoNote: "API healthy. Zero active warnings is a valid answer, not a failure.",
    details: { activeWarnings: 0 },
  },
];

/** A mock that models a failed collection carries no data, exactly like a real failed attempt. */
function collectedData(spec: MockSpec) {
  const failedCollection = spec.networkOk === false || spec.parseOk === false || spec.schemaOk === false;
  return failedCollection ? undefined : spec.details;
}

function shift(checkedAtMs: number, ageSeconds: number | undefined) {
  return ageSeconds === undefined ? undefined : new Date(checkedAtMs - ageSeconds * 1000).toISOString();
}

/** Builds the mock snapshot relative to a check time so refresh visibly moves the clock. */
export function getMockMonitors(checkedAt: string = MOCK_BASELINE_CHECKED_AT): MonitorHealth[] {
  const checkedAtMs = Date.parse(checkedAt);
  return specs.map(({ dataAgeSeconds, lastSuccessAgeSeconds, ...spec }) =>
    evaluateHealth({
      ...spec,
      checkedAt,
      dataTime: shift(checkedAtMs, dataAgeSeconds),
      lastSuccess: shift(checkedAtMs, lastSuccessAgeSeconds),
      ageSeconds: dataAgeSeconds,
      staleAfter: freshnessThresholds[spec.id].staleAfter,
      data: collectedData(spec),
    }),
  );
}
