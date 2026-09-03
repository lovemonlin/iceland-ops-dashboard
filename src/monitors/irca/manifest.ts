import { IRCA_DATASETS, IRCA_PUBLIC_BASE_URL, IRCA_SANITY_FLOORS, type IrcaDatasetKey } from "@/config/irca";
import type { MonitorErrorType } from "@/health/model";

/**
 * Shape actually published by `iceland-aurora-cloud` (verified read-only against production):
 *
 * { schema_version: 2,
 *   generated_at, road_data_at, incident_data_at, measurement_data_at,
 *   road_count, incident_count, station_count, traffic_station_count,
 *   roads_url, incidents_url, stations_url,
 *   attribution, source_url }
 *
 * Required: schema_version, generated_at, the four counts and the three URLs.
 * Informational: the per-source timestamps, attribution and source_url.
 */
export interface IrcaManifest {
  schemaVersion: number;
  /** When the pipeline published this output — the freshness signal. */
  generatedAt: Date;
  roadDataAt?: Date;
  incidentDataAt?: Date;
  measurementDataAt?: Date;
  counts: Record<IrcaDatasetKey, number>;
  trafficStationCount: number;
  urls: Record<IrcaDatasetKey, string>;
}

export type IrcaManifestCheck =
  | { ok: true; manifest: IrcaManifest }
  | { ok: false; errorType: MonitorErrorType; message: string };

function fail(errorType: MonitorErrorType, message: string): IrcaManifestCheck {
  return { ok: false, errorType, message };
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Dataset URLs come from an external file, so they are never trusted as request targets until
 * they are proven to point back at our own public output.
 */
function isPublishedUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${IRCA_PUBLIC_BASE_URL}/`);
}

export function validateIrcaManifest(raw: unknown, now: Date): IrcaManifestCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("SCHEMA_ERROR", "Manifest is not a JSON object.");
  }

  const value = raw as Record<string, unknown>;

  if (typeof value.schema_version !== "number") {
    return fail("SCHEMA_ERROR", "Manifest is missing a numeric schema_version.");
  }

  if (typeof value.generated_at !== "string") return fail("SCHEMA_ERROR", "Manifest is missing generated_at.");
  const generatedAt = parseTimestamp(value.generated_at);
  if (!generatedAt) return fail("INVALID_TIMESTAMP", `generated_at "${value.generated_at}" is not a valid timestamp.`);
  if (generatedAt.getTime() > now.getTime()) {
    return fail("INVALID_TIMESTAMP", `generated_at ${generatedAt.toISOString()} is in the future.`);
  }

  const optionalTimestamps: [string, keyof IrcaManifest][] = [
    ["road_data_at", "roadDataAt"],
    ["incident_data_at", "incidentDataAt"],
    ["measurement_data_at", "measurementDataAt"],
  ];
  const parsedOptional: Partial<Record<keyof IrcaManifest, Date>> = {};
  for (const [field, key] of optionalTimestamps) {
    if (value[field] === undefined) continue;
    const parsed = parseTimestamp(value[field]);
    if (!parsed) return fail("INVALID_TIMESTAMP", `${field} "${String(value[field])}" is not a valid timestamp.`);
    parsedOptional[key] = parsed;
  }

  const counts = {} as Record<IrcaDatasetKey, number>;
  const urls = {} as Record<IrcaDatasetKey, string>;
  for (const dataset of IRCA_DATASETS) {
    const count = value[dataset.countField];
    if (!isCount(count)) {
      return fail("SCHEMA_ERROR", `Manifest ${dataset.countField} is not a non-negative integer.`);
    }
    if (!isPublishedUrl(value[dataset.urlField])) {
      return fail("SCHEMA_ERROR", `Manifest ${dataset.urlField} does not point at the published output.`);
    }
    counts[dataset.key] = count;
    urls[dataset.key] = value[dataset.urlField] as string;
  }

  if (!isCount(value.traffic_station_count)) {
    return fail("SCHEMA_ERROR", "Manifest traffic_station_count is not a non-negative integer.");
  }
  if (value.traffic_station_count > counts.stations) {
    return fail(
      "SCHEMA_ERROR",
      `Manifest reports ${value.traffic_station_count} traffic stations but only ${counts.stations} stations.`,
    );
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: value.schema_version,
      generatedAt,
      roadDataAt: parsedOptional.roadDataAt,
      incidentDataAt: parsedOptional.incidentDataAt,
      measurementDataAt: parsedOptional.measurementDataAt,
      counts,
      trafficStationCount: value.traffic_station_count,
      urls,
    },
  };
}

/**
 * Anomaly check against the publisher's own declared counts.
 * Returns a maintainer-readable message, never a bare "invalid data".
 */
export function checkSanityFloors(counts: {
  roads: number;
  stations: number;
  trafficStations: number;
}): { errorType: MonitorErrorType; message: string } | undefined {
  const checks: [number, number, string, string][] = [
    [counts.roads, IRCA_SANITY_FLOORS.roads, "road", "road-conditions.geojson"],
    [counts.stations, IRCA_SANITY_FLOORS.stations, "station", "road-stations.geojson"],
    [counts.trafficStations, IRCA_SANITY_FLOORS.trafficStations, "traffic station", "road-stations.geojson"],
  ];

  for (const [actual, floor, noun, file] of checks) {
    if (actual >= floor) continue;
    if (actual === 0) {
      return {
        errorType: "EMPTY_DATA",
        message:
          `The IRCA ${noun} dataset is empty. The public files are reachable, but the ${noun} count ` +
          `dropped to 0 in ${file}. Production history normally carries well over ${floor}.`,
      };
    }
    return {
      errorType: "EMPTY_DATA",
      message:
        `Expected at least ${floor} ${noun} features, received ${actual}. The public files are ` +
        `reachable, but ${file} is far below its normal production size.`,
    };
  }

  return undefined;
}
