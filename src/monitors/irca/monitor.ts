import {
  IRCA_DATASETS,
  IRCA_DATASET_DOWNLOAD_TIMEOUT_MS,
  IRCA_ERROR_AFTER_SECONDS,
  IRCA_HEAD_PROBE_TIMEOUT_MS,
  IRCA_MANIFEST_URL,
  IRCA_STALE_AFTER_SECONDS,
  IRCA_WORKFLOW_INTERVAL_MINUTES,
  type IrcaDatasetKey,
} from "@/config/irca";
import { evaluateHealth } from "@/health/evaluate";
import type { MonitorErrorType, MonitorHealth } from "@/health/model";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";
import {
  countTrafficStations,
  createIrcaContentCache,
  manifestCacheKey,
  validateFeatureCollection,
  type IrcaContentCache,
  type IrcaContentResult,
} from "@/monitors/irca/datasets";
import { checkSanityFloors, validateIrcaManifest, type IrcaManifest } from "@/monitors/irca/manifest";

export const IRCA_MONITOR_ID = "irca";
export const IRCA_MONITOR_NAME = "IRCA Roads";

const base = { id: IRCA_MONITOR_ID, name: IRCA_MONITOR_NAME };

const defaultRequest: DiagnosticFetcher = (url, options) => fetchWithDiagnosticsCore(url, options);

/** Shared across checks in one server process; lost on restart, which is fine. */
const sharedCache = createIrcaContentCache();

export interface IrcaCheckOptions {
  now?: Date;
  request?: DiagnosticFetcher;
  manifestUrl?: string;
  /** Injectable so tests can observe and isolate caching. */
  cache?: IrcaContentCache;
}

function utcMinute(date: Date) {
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

function minutes(seconds: number) {
  return `${Math.floor(seconds / 60)} min`;
}

interface Probe {
  key: IrcaDatasetKey;
  label: string;
  core: boolean;
  ok: boolean;
  detail?: string;
  transportFailure: boolean;
  latencyMs: number;
}

/** Availability probe only: HEAD never pulls the 1.3 MB road file. */
async function probeDataset(
  dataset: (typeof IRCA_DATASETS)[number],
  url: string,
  request: DiagnosticFetcher,
): Promise<Probe> {
  const result = await request<string>(url, {
    init: { method: "HEAD" },
    responseType: "text",
    timeoutMs: IRCA_HEAD_PROBE_TIMEOUT_MS,
  });
  return {
    key: dataset.key,
    label: dataset.label,
    core: dataset.core,
    ok: result.ok,
    detail: result.ok ? undefined : `${dataset.label} ${result.errorType}: ${result.message}`,
    transportFailure: !result.ok && (result.errorType === "NETWORK_ERROR" || result.errorType === "TIMEOUT"),
    latencyMs: result.diagnostics.latencyMs,
  };
}

/**
 * Downloads and validates the three GeoJSON files, then cross-checks them against the manifest.
 * Only called when the manifest identity has changed since the last successful validation.
 */
async function validateContent(
  manifest: IrcaManifest,
  request: DiagnosticFetcher,
): Promise<{ result?: IrcaContentResult; transportFailure?: { errorType: MonitorErrorType; message: string } }> {
  const downloads = await Promise.all(
    IRCA_DATASETS.map(async (dataset) => ({
      dataset,
      response: await request<unknown>(manifest.urls[dataset.key], {
        responseType: "json",
        timeoutMs: IRCA_DATASET_DOWNLOAD_TIMEOUT_MS,
      }),
    })),
  );

  const failedDownload = downloads.find(({ response }) => !response.ok);
  if (failedDownload && !failedDownload.response.ok) {
    // Never cached: a transport hiccup must be retried on the next check.
    return {
      transportFailure: {
        errorType: failedDownload.response.errorType,
        message: `${failedDownload.dataset.label} could not be downloaded — ${failedDownload.response.message}`,
      },
    };
  }

  const counts = {} as Record<IrcaDatasetKey, number>;
  let trafficStations: number | undefined;

  for (const { dataset, response } of downloads) {
    if (!response.ok) continue;
    const check = validateFeatureCollection(response.data, dataset.label);
    if (!check.ok) {
      return { result: { counts: { ...manifest.counts }, failure: { errorType: check.errorType, message: check.message } } };
    }
    counts[dataset.key] = check.count;
    if (dataset.key === "stations") trafficStations = countTrafficStations(check.features);
  }

  // The published counts are a claim; the files are the evidence. They must agree exactly.
  for (const dataset of IRCA_DATASETS) {
    if (counts[dataset.key] === manifest.counts[dataset.key]) continue;
    return {
      result: {
        counts,
        trafficStations,
        failure: {
          errorType: "SCHEMA_ERROR",
          message:
            `Manifest reports ${manifest.counts[dataset.key]} ${dataset.key} features, ` +
            `but ${dataset.label} contains ${counts[dataset.key]}.`,
        },
      },
    };
  }

  if (trafficStations !== undefined && trafficStations !== manifest.trafficStationCount) {
    return {
      result: {
        counts,
        trafficStations,
        failure: {
          errorType: "SCHEMA_ERROR",
          message:
            `Manifest reports ${manifest.trafficStationCount} traffic stations, but road-stations.geojson ` +
            `contains ${trafficStations} features flagged has_traffic.`,
        },
      },
    };
  }

  const floors = checkSanityFloors({
    roads: counts.roads,
    stations: counts.stations,
    trafficStations: trafficStations ?? manifest.trafficStationCount,
  });

  return { result: { counts, trafficStations, failure: floors } };
}

/**
 * Read-only health check of the IRCA road data published by `iceland-aurora-cloud`.
 *
 * HTTP 200 on these files proves nothing: the publisher keeps the previous successful output when
 * IRCA fails upstream, so freshness, availability and count sanity carry the whole diagnosis.
 */
export async function checkIrca(options: IrcaCheckOptions = {}): Promise<MonitorHealth> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const manifestUrl = options.manifestUrl ?? IRCA_MANIFEST_URL;
  const cache = options.cache ?? sharedCache;
  const checkedAt = now.toISOString();

  const response = await request<unknown>(manifestUrl, { responseType: "json" });

  if (!response.ok) {
    const transportFailure = response.errorType === "NETWORK_ERROR" || response.errorType === "TIMEOUT";
    return evaluateHealth({
      ...base,
      checkedAt,
      latencyMs: response.diagnostics.latencyMs,
      httpStatus: response.diagnostics.httpStatus,
      networkOk: !transportFailure,
      parseOk: response.errorType !== "PARSE_ERROR",
      errorType: response.errorType,
      errorMessage: `Manifest request failed — ${response.message}`,
      details: { manifest: response.diagnostics.safeUrl },
    });
  }

  const transport = {
    checkedAt,
    latencyMs: response.diagnostics.latencyMs,
    httpStatus: response.diagnostics.httpStatus,
    networkOk: true,
    parseOk: true,
  };

  const manifestCheck = validateIrcaManifest(response.data, now);
  if (!manifestCheck.ok) {
    return evaluateHealth({
      ...base,
      ...transport,
      schemaOk: false,
      errorType: manifestCheck.errorType,
      errorMessage: `Manifest schema check failed — ${manifestCheck.message}`,
    });
  }

  const { manifest } = manifestCheck;
  const ageSeconds = (now.getTime() - manifest.generatedAt.getTime()) / 1000;

  const probes = await Promise.all(
    IRCA_DATASETS.map((dataset) => probeDataset(dataset, manifest.urls[dataset.key], request)),
  );
  const unavailable = probes.filter((probe) => !probe.ok);
  const coreUnavailable = unavailable.some((probe) => probe.core);

  // Content is only downloaded when everything is reachable and the manifest identity changed.
  let content: IrcaContentResult | undefined;
  let downloadFailure: { errorType: MonitorErrorType; message: string } | undefined;
  let contentSource = "skipped (dataset unavailable)";
  if (unavailable.length === 0) {
    const key = manifestCacheKey(manifest);
    if (cache.key === key && cache.result) {
      content = cache.result;
      contentSource = "cached (manifest unchanged)";
    } else {
      const validated = await validateContent(manifest, request);
      if (validated.transportFailure) {
        downloadFailure = validated.transportFailure;
        contentSource = "download failed";
      } else if (validated.result) {
        content = validated.result;
        cache.key = key;
        cache.result = validated.result;
        contentSource = "downloaded and validated";
      }
    }
  }

  const counts = content?.counts ?? manifest.counts;
  const trafficStations = content?.trafficStations ?? manifest.trafficStationCount;

  // What was actually collected. A later failed attempt keeps this and drops the diagnostics.
  const data: Record<string, unknown> = {
    lastPublished: utcMinute(manifest.generatedAt),
    roads: counts.roads,
    incidents: counts.incidents,
    stations: counts.stations,
    trafficStations,
    schemaVersion: manifest.schemaVersion,
  };

  const details: Record<string, unknown> = {
    ...data,
    expectedRefresh: `${IRCA_WORKFLOW_INTERVAL_MINUTES} min`,
    datasets: `${probes.length - unavailable.length} / ${probes.length} available`,
    contentCheck: contentSource,
  };
  if (content?.trafficStations === undefined && unavailable.length === 0) {
    details.trafficStationSource = "manifest only (has_traffic not derivable)";
  }
  if (unavailable.length > 0) details.unavailable = unavailable.map((probe) => probe.detail).join("; ");
  if (manifest.roadDataAt) data.roadDataAt = details.roadDataAt = utcMinute(manifest.roadDataAt);
  if (manifest.measurementDataAt) {
    data.measurementDataAt = details.measurementDataAt = utcMinute(manifest.measurementDataAt);
  }

  // A broken GeoJSON or a count that contradicts the manifest is a schema failure, not a transport one.
  if (content?.failure && content.failure.errorType === "SCHEMA_ERROR") {
    return evaluateHealth({
      ...base,
      ...transport,
      schemaOk: false,
      dataTime: manifest.generatedAt.toISOString(),
      ageSeconds,
      errorType: content.failure.errorType,
      errorMessage: content.failure.message,
      data,
      details,
    });
  }

  const fatalError = resolveFatalError({
    unavailable,
    coreUnavailable,
    downloadFailure,
    contentFailure: content?.failure,
    manifestFloors: checkSanityFloors({
      roads: manifest.counts.roads,
      stations: manifest.counts.stations,
      trafficStations: manifest.trafficStationCount,
    }),
    ageSeconds,
  });

  const partialFailure = unavailable.length === 1 && !coreUnavailable;

  return evaluateHealth({
    ...base,
    ...transport,
    schemaOk: true,
    dataTime: manifest.generatedAt.toISOString(),
    lastSuccess: checkedAt,
    ageSeconds,
    // Emptiness is owned by the sanity floors, which explain the number instead of just failing.
    recordCount: counts.roads,
    allowEmpty: true,
    fatalError,
    partialFailure,
    stale: !fatalError && ageSeconds > IRCA_STALE_AFTER_SECONDS,
    errorType: partialFailure ? "HTTP_ERROR" : undefined,
    errorMessage: partialFailure
      ? `Road data is complete, but ${unavailable.length} of ${probes.length} published datasets is unavailable — ${unavailable
          .map((probe) => probe.detail)
          .join("; ")}`
      : ageSeconds > IRCA_STALE_AFTER_SECONDS
        ? `The published files are readable, but the last successful publish was ${minutes(ageSeconds)} ago and the ` +
          `pipeline republishes about every ${IRCA_WORKFLOW_INTERVAL_MINUTES} min, so at least one scheduled update ` +
          `did not reach production.`
        : undefined,
    data,
    details,
  });
}

/**
 * Picks the single most important fatal condition.
 * Transport, core-dataset and emptiness failures all outrank age, so a genuine outage is never
 * hidden behind a STALE badge.
 */
function resolveFatalError({
  unavailable,
  coreUnavailable,
  downloadFailure,
  contentFailure,
  manifestFloors,
  ageSeconds,
}: {
  unavailable: Probe[];
  coreUnavailable: boolean;
  downloadFailure?: { errorType: MonitorErrorType; message: string };
  contentFailure?: { errorType: MonitorErrorType; message: string };
  manifestFloors?: { errorType: MonitorErrorType; message: string };
  ageSeconds: number;
}) {
  if (coreUnavailable || unavailable.length >= 2) {
    const summary = unavailable.map((probe) => probe.detail).join("; ");
    return {
      type: unavailable.every((probe) => probe.transportFailure) ? ("NETWORK_ERROR" as const) : ("HTTP_ERROR" as const),
      message: coreUnavailable
        ? `The core road dataset is unavailable, so no current road conditions can be served — ${summary}`
        : `${unavailable.length} of 3 published datasets are unavailable — ${summary}`,
    };
  }

  if (downloadFailure) return { type: downloadFailure.errorType, message: downloadFailure.message };
  if (contentFailure) return { type: contentFailure.errorType, message: contentFailure.message };
  if (manifestFloors) return { type: manifestFloors.errorType, message: manifestFloors.message };

  if (ageSeconds > IRCA_ERROR_AFTER_SECONDS) {
    return {
      type: "STALE_DATA" as const,
      message:
        `The last successful publish was ${minutes(ageSeconds)} ago, past the ${minutes(IRCA_ERROR_AFTER_SECONDS)} ` +
        `limit. This data should no longer be treated as a reliable picture of current road conditions.`,
    };
  }

  return undefined;
}
