import { IRCA_DATASETS, IRCA_MANIFEST_URL, type IrcaDatasetKey } from "@/config/irca";
import { checkSanityFloors, type IrcaManifest, validateIrcaManifest } from "@/monitors/irca/manifest";
import { countTrafficStations, validateFeatureCollection } from "@/monitors/irca/datasets";
import type { FeatureCollection } from "geojson";

export const ROAD_POLL_MS = 5 * 60_000;
const ROAD_FETCH_TIMEOUT_MS = 20_000;

export type RoadFeatureCollection = FeatureCollection;

export interface RoadBundle {
  /** The publisher's unmodified generated_at string. */
  version: string;
  manifest: IrcaManifest;
  data: Record<IrcaDatasetKey, RoadFeatureCollection>;
}

export interface RoadFastLaneOptions {
  onBundle: (bundle: RoadBundle) => void | Promise<void>;
  onError: (error: unknown) => void;
  fetcher?: typeof fetch;
  visibility?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
}

function cacheBustedUrl(url: string, key: "t" | "v", value: string) {
  const next = new URL(url);
  next.searchParams.set(key, value);
  return next.toString();
}

function fail(message: string): never {
  throw new Error(message);
}

function isPosition(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && value.every((part) => typeof part === "number" && Number.isFinite(part));
}

function hasValidGeometry(feature: Record<string, unknown>): boolean {
  if (feature.type !== "Feature") return false;
  const geometry = feature.geometry;
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return false;
  const value = geometry as Record<string, unknown>;
  if (typeof value.type !== "string") return false;
  if (value.type === "GeometryCollection") {
    return Array.isArray(value.geometries) && value.geometries.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      return hasValidGeometry({ type: "Feature", geometry: item });
    });
  }
  const coordinates = value.coordinates;
  switch (value.type) {
    case "Point":
      return isPosition(coordinates);
    case "MultiPoint":
      return Array.isArray(coordinates) && coordinates.every(isPosition);
    case "LineString":
      return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(isPosition);
    case "MultiLineString":
      return Array.isArray(coordinates) && coordinates.every((line) => Array.isArray(line) && line.length >= 2 && line.every(isPosition));
    case "Polygon":
      return Array.isArray(coordinates) && coordinates.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition));
    case "MultiPolygon":
      return Array.isArray(coordinates) && coordinates.every((polygon) => Array.isArray(polygon) && polygon.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition)));
    default:
      return false;
  }
}

function validateBundle(manifest: IrcaManifest, raw: Record<IrcaDatasetKey, unknown>): Record<IrcaDatasetKey, RoadFeatureCollection> {
  const data = {} as Record<IrcaDatasetKey, RoadFeatureCollection>;
  const checkedFeatures = {} as Record<IrcaDatasetKey, Record<string, unknown>[]>;
  const checkedCounts = {} as Record<IrcaDatasetKey, number>;

  for (const dataset of IRCA_DATASETS) {
    const check = validateFeatureCollection(raw[dataset.key], dataset.label);
    if (!check.ok) fail(check.message);
    if (check.count !== manifest.counts[dataset.key]) {
      fail(`Manifest reports ${manifest.counts[dataset.key]} ${dataset.key} features, but ${dataset.label} contains ${check.count}.`);
    }
    if (!check.features.every(hasValidGeometry)) fail(`${dataset.label} contains a feature with invalid geometry.`);
    checkedFeatures[dataset.key] = check.features;
    checkedCounts[dataset.key] = check.count;
    data[dataset.key] = raw[dataset.key] as RoadFeatureCollection;
  }

  const trafficStations = countTrafficStations(checkedFeatures.stations);
  if (trafficStations !== undefined && trafficStations !== manifest.trafficStationCount) {
    fail(`Manifest reports ${manifest.trafficStationCount} traffic stations, but road-stations.geojson contains ${trafficStations}.`);
  }
  const sanity = checkSanityFloors({
    roads: checkedCounts.roads,
    stations: checkedCounts.stations,
    trafficStations: trafficStations ?? manifest.trafficStationCount,
  });
  if (sanity) fail(sanity.message);
  return data;
}

async function readJson(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { cache: "no-store", signal });
  if (!response.ok) fail(`Road Fast Lane request failed (${response.status}) for ${url}.`);
  return response.json();
}

function readManifestVersion(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as Record<string, unknown>).generated_at !== "string") {
    fail("Manifest is missing generated_at.");
  }
  return (raw as Record<string, string>).generated_at;
}

/**
 * Polls only the published IRCA bundle. A version is committed only after all three files and a
 * second manifest read agree, so a publisher rollover can never mix old and new GeoJSON.
 */
export function startRoadFastLane({ onBundle, onError, fetcher = fetch, visibility = document }: RoadFastLaneOptions): () => void {
  let stopped = false;
  let active = false;
  let version: string | undefined;
  let controller: AbortController | undefined;

  const check = async () => {
    if (stopped || active || visibility.hidden) return;
    active = true;
    controller = new AbortController();
    const attemptController = controller;
    const timeout = setTimeout(() => attemptController.abort(), ROAD_FETCH_TIMEOUT_MS);

    try {
      const manifestRaw = await readJson(fetcher, cacheBustedUrl(IRCA_MANIFEST_URL, "t", String(Date.now())), attemptController.signal);
      const nextVersion = readManifestVersion(manifestRaw);
      const manifestCheck = validateIrcaManifest(manifestRaw, new Date());
      if (!manifestCheck.ok) fail(manifestCheck.message);
      if (nextVersion === version) return;

      const results = await Promise.allSettled(
        IRCA_DATASETS.map((dataset) =>
          readJson(
            fetcher,
            cacheBustedUrl(manifestCheck.manifest.urls[dataset.key], "v", nextVersion),
            attemptController.signal,
          ),
        ),
      );
      const failedDownload = results.find((result) => result.status === "rejected");
      if (failedDownload?.status === "rejected") throw failedDownload.reason;
      const rawData = {} as Record<IrcaDatasetKey, unknown>;
      for (const [index, dataset] of IRCA_DATASETS.entries()) rawData[dataset.key] = (results[index] as PromiseFulfilledResult<unknown>).value;
      const data = validateBundle(manifestCheck.manifest, rawData);

      const finalManifestRaw = await readJson(fetcher, cacheBustedUrl(IRCA_MANIFEST_URL, "t", String(Date.now())), attemptController.signal);
      if (readManifestVersion(finalManifestRaw) !== nextVersion) fail("Road Fast Lane manifest changed while downloading its GeoJSON bundle.");
      const finalManifestCheck = validateIrcaManifest(finalManifestRaw, new Date());
      if (!finalManifestCheck.ok) fail(finalManifestCheck.message);

      if (stopped || attemptController.signal.aborted) return;
      // The final read is a rollover guard. The first manifest remains the metadata validated with this bundle.
      const bundle: RoadBundle = { version: nextVersion, manifest: manifestCheck.manifest, data };
      await onBundle(bundle);
      if (!stopped && controller === attemptController) version = nextVersion;
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      clearTimeout(timeout);
      if (controller === attemptController) controller = undefined;
      active = false;
    }
  };

  const onVisibilityChange = () => {
    if (!visibility.hidden) void check();
  };
  const interval = setInterval(() => void check(), ROAD_POLL_MS);
  visibility.addEventListener("visibilitychange", onVisibilityChange);
  void check();

  return () => {
    stopped = true;
    clearInterval(interval);
    visibility.removeEventListener("visibilitychange", onVisibilityChange);
    controller?.abort();
  };
}
