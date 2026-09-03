/**
 * IRCA road data production contract.
 *
 * The dashboard never talks to IRCA (umferdin.is) directly. It only reads what the
 * `iceland-aurora-cloud` pipeline has already published to GitHub Pages, read-only.
 *
 * The publisher is all-or-nothing: if IRCA is unreachable, returns malformed XML, or returns no
 * measurements, the publish fails and the *previous* successful output stays online. So HTTP 200
 * on these files proves nothing about whether IRCA itself is healthy — only the manifest age,
 * dataset availability and count sanity can tell us that.
 */

export const IRCA_PUBLIC_BASE_URL = "https://lovemonlin.github.io/iceland-aurora-cloud";
export const IRCA_MANIFEST_URL = `${IRCA_PUBLIC_BASE_URL}/road-manifest.json`;

/** The cloud workflow republishes roughly every 30 minutes. */
export const IRCA_WORKFLOW_INTERVAL_MINUTES = 30;

/**
 * Dashboard operational policy, **not** an IRCA or cloud-pipeline SLA.
 *
 * Past 45 minutes there is good reason to suspect the last scheduled publish did not succeed.
 * Past 120 minutes the data should no longer be treated as a live picture of the roads.
 */
export const IRCA_STALE_AFTER_SECONDS = 45 * 60;
export const IRCA_ERROR_AFTER_SECONDS = 120 * 60;

/**
 * Anomaly floors derived from observed production scale (701 roads, 203 stations,
 * 107 traffic stations), not guarantees from IRCA. They exist to catch a publisher that
 * silently collapsed — 701 roads becoming 0, or 203 stations becoming 12 — rather than to
 * assert an exact expected size. Incidents legitimately reach zero and have no floor.
 */
export const IRCA_SANITY_FLOORS = {
  roads: 500,
  stations: 100,
  trafficStations: 50,
} as const;

/** HEAD probes are cheap; a full GeoJSON GET pulls over 1 MB, so it gets a longer budget. */
export const IRCA_HEAD_PROBE_TIMEOUT_MS = 8_000;
export const IRCA_DATASET_DOWNLOAD_TIMEOUT_MS = 20_000;

export type IrcaDatasetKey = "roads" | "incidents" | "stations";

export interface IrcaDatasetSpec {
  key: IrcaDatasetKey;
  label: string;
  /** Manifest field holding this dataset's public URL. */
  urlField: "roads_url" | "incidents_url" | "stations_url";
  /** Manifest field holding this dataset's declared feature count. */
  countField: "road_count" | "incident_count" | "station_count";
  /**
   * Core data: the app cannot show road conditions without it, so losing it alone is an ERROR.
   * Losing a non-core dataset alone is DEGRADED.
   */
  core: boolean;
}

export const IRCA_DATASETS: IrcaDatasetSpec[] = [
  {
    key: "roads",
    label: "road-conditions.geojson",
    urlField: "roads_url",
    countField: "road_count",
    core: true,
  },
  {
    key: "incidents",
    label: "road-incidents.geojson",
    urlField: "incidents_url",
    countField: "incident_count",
    core: false,
  },
  {
    key: "stations",
    label: "road-stations.geojson",
    urlField: "stations_url",
    countField: "station_count",
    core: false,
  },
];
