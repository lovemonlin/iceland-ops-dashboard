import { SOURCE_STALE_AFTER_SECONDS } from "@/config/sources";
import { evaluateHealth } from "@/health/evaluate";
import { decodeOvationGrid, type OvationGrid } from "@/lib/ovationGrid";
import { isNoaaKpForecastData, type SnapshotSource } from "@/snapshot/types";

const HOUR_MS = 3_600_000;
const KP_FORECAST_HOURS = 48;

function utcIso(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const hasZone = /(?:Z|[+-]\d\d:?\d\d)$/.test(value);
  const normalized = hasZone
    ? value
    : value.endsWith(" UTC")
      ? `${value.slice(0, -4).replace(" ", "T")}Z`
      : undefined;
  if (!normalized) return undefined;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function sourceIsUsable(source: SnapshotSource | undefined): source is SnapshotSource {
  return source?.status === "ok" || source?.status === "info";
}

/** A source returned by `auroraSourceAt` may be a stale display overlay. */
export function isCurrentAuroraSource(source: SnapshotSource | undefined) {
  return sourceIsUsable(source);
}

function dataAgeSeconds(source: SnapshotSource, now: Date) {
  const dataTime = utcIso(source.dataTime);
  if (!dataTime) return undefined;
  return (now.getTime() - Date.parse(dataTime)) / 1000;
}

function forecastIsCurrent(source: SnapshotSource, now: Date) {
  const data = source.data;
  if (!isNoaaKpForecastData(data)) return false;
  const finalStart = Math.max(...data.points.map((point) => Date.parse(point.time)));
  return Number.isFinite(finalStart) && finalStart + 3 * HOUR_MS >= now.getTime() + KP_FORECAST_HOURS * HOUR_MS;
}

/**
 * Re-evaluates the time-sensitive NOAA values when a static snapshot remains open. The original
 * snapshot is never changed: a failed collection stays failed, while old last-good data receives
 * an in-memory STALE overlay so consumers cannot mistake it for a current reading.
 */
export function auroraSourceAt(source: SnapshotSource | undefined, now: Date): SnapshotSource | undefined {
  // Preserve the monitor's own non-healthy answer for display and diagnostics. Consumers use
  // `isCurrentAuroraSource` before reading its values into an assessment.
  if (!source || !sourceIsUsable(source)) return source;
  if (source.id === "noaaKpForecast") {
    if (forecastIsCurrent(source, now)) return source;
    return {
      ...source,
      status: "stale",
      errorType: "STALE_DATA",
      errorMessage: "Kp 預報未覆蓋未來 48 小時。",
    };
  }

  if (source.id === "ovation") {
    const state = ovationState(source, now);
    if (state.current) return source;
    return {
      ...source,
      status: "stale",
      errorType: "STALE_DATA",
      errorMessage: "OVATION 預報有效時間已過或時間資料無效。",
    };
  }

  const staleAfter = SOURCE_STALE_AFTER_SECONDS[source.id as keyof typeof SOURCE_STALE_AFTER_SECONDS];
  if (staleAfter === undefined) return source;
  const ageSeconds = dataAgeSeconds(source, now);
  if (ageSeconds === undefined || ageSeconds < 0) {
    return {
      ...source,
      status: "stale",
      errorType: "STALE_DATA",
      errorMessage: "來源資料時間無效。",
    };
  }
  const result = evaluateHealth({
    id: source.id,
    name: source.name,
    checkedAt: now.toISOString(),
    provenance: source.provenance,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    httpStatus: source.diagnostics?.httpStatus ?? 200,
    recordCount: source.diagnostics?.recordCount ?? 1,
    data: source.data,
    dataTime: utcIso(source.dataTime),
    lastSuccess: source.lastSuccessAt,
    ageSeconds,
    staleAfter,
  });
  return result.status === "ok" ? source : {
    ...source,
    status: result.status,
    errorType: result.errorType,
    errorMessage: result.errorMessage,
  };
}

export interface OvationState {
  current: boolean;
  label: string;
  observedAt?: string;
  forecastAt?: string;
  fetchedAt?: string;
  checkedAt?: string;
  grid?: OvationGrid;
}

/** Keeps an old grid available for honest historical display, but never calls it current. */
export function ovationState(source: SnapshotSource | undefined, now: Date): OvationState {
  const data = source?.data;
  const observedAt = utcIso(data?.observationTime === undefined ? source?.dataTime : data.observationTime);
  const forecastAt = utcIso(data?.forecastTime);
  const fetchedAt = utcIso(data?.fetchedAt === undefined ? source?.lastSuccessAt : data.fetchedAt);
  const checkedAt = utcIso(source?.lastAttemptAt);
  const grid = decodeOvationGrid(data?.grid);
  const observedMs = observedAt === undefined ? Number.NaN : Date.parse(observedAt);
  const forecastMs = forecastAt === undefined ? Number.NaN : Date.parse(forecastAt);
  const ageSeconds = (now.getTime() - observedMs) / 1000;
  const current = sourceIsUsable(source)
    && grid !== undefined
    && Number.isFinite(observedMs)
    && Number.isFinite(forecastMs)
    && ageSeconds >= 0
    && ageSeconds <= SOURCE_STALE_AFTER_SECONDS.ovation
    && forecastMs >= observedMs
    && forecastMs > now.getTime();
  const label = current
    ? "目前預報有效"
    : source === undefined
      ? "尚無 OVATION 資料"
      : source.status !== "ok" && source.status !== "info"
        ? "來源目前不可用；顯示最後保留資料"
        : !grid ? "格網資料無效或缺漏"
          : !Number.isFinite(observedMs) || !Number.isFinite(forecastMs) || ageSeconds < 0 || forecastMs < observedMs
            ? "來源資料時間無效"
            : ageSeconds > SOURCE_STALE_AFTER_SECONDS.ovation ? "觀測資料過舊；顯示歷史資料"
              : "OVATION 預報已過期；顯示歷史資料";
  return { current, label, observedAt, forecastAt, fetchedAt, checkedAt, grid };
}
