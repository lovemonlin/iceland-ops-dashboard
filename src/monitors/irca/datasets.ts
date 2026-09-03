import type { IrcaDatasetKey } from "@/config/irca";
import type { MonitorErrorType } from "@/health/model";
import type { IrcaManifest } from "@/monitors/irca/manifest";

export type FeatureCollectionCheck =
  | { ok: true; count: number; features: Record<string, unknown>[] }
  | { ok: false; errorType: MonitorErrorType; message: string };

/**
 * Validates only the structural contract the dashboard depends on: a real FeatureCollection with a
 * features array. Individual feature properties are deliberately not audited, and how many features
 * are *enough* is decided in one place, by `checkSanityFloors`.
 */
export function validateFeatureCollection(raw: unknown, label: string): FeatureCollectionCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errorType: "SCHEMA_ERROR", message: `${label} is not a JSON object.` };
  }

  const value = raw as Record<string, unknown>;
  if (value.type !== "FeatureCollection") {
    return { ok: false, errorType: "SCHEMA_ERROR", message: `${label} is not a FeatureCollection.` };
  }
  if (!Array.isArray(value.features)) {
    return { ok: false, errorType: "SCHEMA_ERROR", message: `${label} has no features array.` };
  }

  const features = value.features as Record<string, unknown>[];
  return { ok: true, count: features.length, features };
}

/**
 * Traffic stations are the station features whose publisher-set `has_traffic` flag is true —
 * exactly how the pipeline computes `traffic_station_count`.
 * Returns undefined when no feature carries the flag at all, so a schema change downgrades this
 * cross-check to "not derivable" instead of reporting a false mismatch.
 */
export function countTrafficStations(features: Record<string, unknown>[]) {
  let flagged = 0;
  let present = false;
  for (const feature of features) {
    const properties = feature.properties;
    if (!properties || typeof properties !== "object") continue;
    const hasTraffic = (properties as Record<string, unknown>).has_traffic;
    if (typeof hasTraffic !== "boolean") continue;
    present = true;
    if (hasTraffic) flagged += 1;
  }
  return present ? flagged : undefined;
}

/** What a full download-and-validate pass concluded, independent of transport. */
export interface IrcaContentResult {
  counts: Record<IrcaDatasetKey, number>;
  /** undefined when the stations schema no longer exposes has_traffic. */
  trafficStations?: number;
  failure?: { errorType: MonitorErrorType; message: string };
}

/**
 * Server-process memory only. The publisher is all-or-nothing, so the GeoJSON files cannot change
 * without the manifest changing — which makes the manifest identity a safe cache key and keeps
 * the 1.3 MB road file off every 60-second check.
 */
export interface IrcaContentCache {
  key?: string;
  result?: IrcaContentResult;
}

export function createIrcaContentCache(): IrcaContentCache {
  return {};
}

export function manifestCacheKey(manifest: IrcaManifest) {
  return [
    manifest.schemaVersion,
    manifest.generatedAt.toISOString(),
    manifest.counts.roads,
    manifest.counts.incidents,
    manifest.counts.stations,
    manifest.trafficStationCount,
  ].join("|");
}
