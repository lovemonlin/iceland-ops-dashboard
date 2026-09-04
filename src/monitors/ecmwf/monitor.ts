import {
  ECMWF_EXPECTED_FRAME_COUNT,
  ECMWF_FORECAST_HORIZON_HOURS,
  ECMWF_IMAGE_PROBE_TIMEOUT_MS,
  ECMWF_MANIFEST_URL,
} from "@/config/ecmwf";
import { evaluateHealth } from "@/health/evaluate";
import type { MonitorHealth } from "@/health/model";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";
import { validateEcmwfManifest } from "@/monitors/ecmwf/manifest";
import {
  expectedModelRun,
  formatDeadlineClock,
  formatModelRun,
  publicationDeadline,
} from "@/monitors/ecmwf/schedule";

export const ECMWF_MONITOR_ID = "ecmwf";
export const ECMWF_MONITOR_NAME = "ECMWF Cloud Forecast";

const defaultRequest: DiagnosticFetcher = (url, options) => fetchWithDiagnosticsCore(url, options);

export interface EcmwfCheckOptions {
  now?: Date;
  request?: DiagnosticFetcher;
  manifestUrl?: string;
}

const base = {
  id: ECMWF_MONITOR_ID,
  name: ECMWF_MONITOR_NAME,
  provenance: { mode: "production" as const, provider: "iceland-aurora-cloud GitHub Pages (ECMWF IFS Open Data)" },
};

function utcMinute(date: Date) {
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/**
 * Probes one published frame with a HEAD request: enough to prove the image is really there,
 * without downloading it. GitHub Pages answers HEAD with the real status and Content-Length.
 */
async function probeImage(url: string, request: DiagnosticFetcher) {
  const result = await request<string>(url, {
    init: { method: "HEAD" },
    responseType: "text",
    timeoutMs: ECMWF_IMAGE_PROBE_TIMEOUT_MS,
  });
  return {
    url,
    ok: result.ok,
    httpStatus: result.diagnostics.httpStatus,
    latencyMs: result.diagnostics.latencyMs,
    detail: result.ok ? undefined : `${result.diagnostics.safeUrl} ${result.errorType}: ${result.message}`,
    transportFailure: !result.ok && (result.errorType === "NETWORK_ERROR" || result.errorType === "TIMEOUT"),
  };
}

/**
 * Read-only health check of the ECMWF cloud forecast published by `iceland-aurora-cloud`.
 * It reads the public manifest and probes two frames; it never writes, rebuilds or triggers anything.
 */
export async function checkEcmwf(options: EcmwfCheckOptions = {}): Promise<MonitorHealth> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const manifestUrl = options.manifestUrl ?? ECMWF_MANIFEST_URL;
  const checkedAt = now.toISOString();

  const expectedRun = expectedModelRun(now);
  const expectedDeadline = publicationDeadline(expectedRun);
  const scheduleDetails = {
    expectedRun: formatModelRun(expectedRun),
    expectedBy: formatDeadlineClock(expectedDeadline),
  };

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
      details: { ...scheduleDetails, manifest: response.diagnostics.safeUrl },
    });
  }

  const transport = {
    checkedAt,
    latencyMs: response.diagnostics.latencyMs,
    httpStatus: response.diagnostics.httpStatus,
    networkOk: true,
    parseOk: true,
  };

  const check = validateEcmwfManifest(response.data, now);
  if (!check.ok) {
    return evaluateHealth({
      ...base,
      ...transport,
      schemaOk: false,
      errorType: check.errorType,
      errorMessage: `Manifest schema check failed — ${check.message}`,
      details: { ...scheduleDetails, contentType: response.diagnostics.contentType },
    });
  }

  const { manifest } = check;
  const frames = manifest.frames;
  const latestValid = frames[frames.length - 1].validAt;
  const behindSchedule = manifest.runAt.getTime() < expectedRun.getTime();

  // Only the first and last frame are sampled: enough to catch a broken publish without
  // pulling all 17 images on every check.
  const probes = await Promise.all([
    probeImage(frames[0].imageUrl, request),
    probeImage(frames[frames.length - 1].imageUrl, request),
  ]);
  const availableImages = probes.filter((probe) => probe.ok).length;
  const failedProbes = probes.filter((probe) => !probe.ok);

  // What was actually collected from the source. Kept apart from diagnostics because a later
  // failed attempt preserves this and discards those.
  const data: Record<string, unknown> = {
    modelRun: formatModelRun(manifest.runAt),
    expectedRun: scheduleDetails.expectedRun,
    frames: `${frames.length} / ${ECMWF_EXPECTED_FRAME_COUNT}`,
    coverage: `run → +${ECMWF_FORECAST_HORIZON_HOURS}h`,
    latestValid: utcMinute(latestValid),
    images: `${availableImages} / ${probes.length} sampled OK`,
    model: manifest.model,
  };
  if (manifest.generatedAt) data.generatedAt = utcMinute(manifest.generatedAt);

  const details: Record<string, unknown> = {
    ...data,
    expectedBy: scheduleDetails.expectedBy,
    imageProbeLatency: `${probes.map((probe) => probe.latencyMs).join(" / ")} ms`,
  };
  if (failedProbes.length > 0) {
    details.failedImages = failedProbes.map((probe) => probe.detail).join("; ");
  }

  // A run that no longer reaches the present is useless to the app, however well-formed it is.
  const expiredCoverage = latestValid.getTime() < now.getTime();
  const partialImages = availableImages > 0 && availableImages < probes.length;
  const probeSummary = failedProbes.map((probe) => probe.detail).join("; ");

  const fatalError = expiredCoverage
    ? {
        type: "STALE_DATA" as const,
        message:
          `Forecast no longer covers the present: the latest valid time ${utcMinute(latestValid)} is ` +
          `already in the past, so no frame is usable.`,
      }
    : availableImages === 0
      ? {
          type: failedProbes.every((probe) => probe.transportFailure) ? ("NETWORK_ERROR" as const) : ("HTTP_ERROR" as const),
          message: `Manifest is healthy but neither sampled frame could be retrieved — ${probeSummary}`,
        }
      : undefined;

  let errorType: "HTTP_ERROR" | undefined;
  let errorMessage: string | undefined;
  if (partialImages) {
    errorType = "HTTP_ERROR";
    errorMessage =
      `Manifest and model run are healthy, but ${probes.length - availableImages} of ${probes.length} ` +
      `sampled frames are unavailable — ${probeSummary}`;
  } else if (behindSchedule) {
    // Consumed by the STALE branch of evaluateHealth, which supplies the STALE_DATA error type.
    errorMessage =
      `The API is healthy; the cloud pipeline has not caught up with the current model cycle. ` +
      `Expected ${formatModelRun(expectedRun)}, currently published ${formatModelRun(manifest.runAt)}, ` +
      `expected publication deadline ${formatDeadlineClock(expectedDeadline)}.`;
  }

  return evaluateHealth({
    ...base,
    ...transport,
    schemaOk: true,
    recordCount: frames.length,
    dataTime: manifest.runAt.toISOString(),
    lastSuccess: checkedAt,
    ageSeconds: (now.getTime() - manifest.runAt.getTime()) / 1000,
    // Freshness is schedule-based, not age-based: the run is late only once the next cycle was due.
    stale: behindSchedule,
    fatalError,
    partialFailure: partialImages,
    errorType,
    errorMessage,
    data,
    details,
  });
}
