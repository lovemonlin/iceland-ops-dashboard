import {
  METNO_CONCURRENCY,
  METNO_COORDINATE_DECIMALS,
  METNO_FORECAST_URL,
  METNO_USER_AGENT,
  SOURCE_STALE_AFTER_SECONDS,
  SOURCE_TIMEOUT_MS,
  WEATHER_SITES,
  type WeatherSite,
} from "@/config/sources";
import { evaluateHealth } from "@/health/evaluate";
import type { MonitorHealth } from "@/health/model";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";
import { buildForecastTimes, encodeSiteForecast } from "@/lib/forecastCodec";

/**
 * How far the stored hourly series reaches, in hours.
 *
 * The app's overview timeline runs 0..48 h (WeatherOverviewViewModel.MAX_OFFSET_HOURS) and its
 * per-site dialog shows 24 rows (SiteForecastDialog.HOURS_SHOWN), so 48 covers both. MET's
 * `/complete` is hourly for roughly the first 60 hours and 6-hourly after that, which is why the
 * app stops at 48 — past it the slider would move while the reading did not.
 */
export const METNO_FORECAST_HOURS = 48;

export const METNO_MONITOR_ID = "metno";
export const METNO_MONITOR_NAME = "MET Norway Weather";

/** The site whose current values are shown as the headline reading. */
const PRIMARY_SITE_ID = "reykjavik";

const defaultRequest: DiagnosticFetcher = (url, options) => fetchWithDiagnosticsCore(url, options);

export interface MetnoCheckOptions {
  now?: Date;
  request?: DiagnosticFetcher;
  /** Defaults to the app's full curated list. */
  sites?: WeatherSite[];
}

/** The instant values the app reads out of `/complete`. */
interface SiteReading {
  site: WeatherSite;
  httpStatus?: number;
  updatedAt: Date;
  temperatureC?: number;
  windMps?: number;
  windGustMps?: number;
  cloudLowPercent?: number;
  cloudMediumPercent?: number;
  cloudHighPercent?: number;
  cloudTotalPercent?: number;
  /** Degrees the wind blows *from*, the meteorological convention the app's arrow rotates by 180. */
  windFromDirection?: number;
  /** MET Norway's own condition code, e.g. "clearsky_night". Never derived here. */
  symbolCode?: string;
  /** The forecast series the same response already carried. Nothing here is synthesised. */
  hours: HourlyReading[];
}

/** One hour of the response, kept verbatim. Absent values stay absent. */
interface HourlyReading {
  time: string;
  temperatureC?: number;
  windMps?: number;
  windFromDirection?: number;
  cloudLowPercent?: number;
  cloudMediumPercent?: number;
  cloudHighPercent?: number;
  cloudTotalPercent?: number;
  symbolCode?: string;
}

type SiteResult = { ok: true; reading: SiteReading } | { ok: false; site: WeatherSite; detail: string };

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** MET Norway asks for at most four decimals so its cache is not fragmented. */
function coordinate(value: number) {
  return value.toFixed(METNO_COORDINATE_DECIMALS);
}

function siteUrl(site: WeatherSite) {
  return `${METNO_FORECAST_URL}?lat=${coordinate(site.lat)}&lon=${coordinate(site.lon)}`;
}

/**
 * Validates the parts of Locationforecast the app depends on: an issue time and a first timeseries
 * entry carrying instant details. A 200 with no timeseries is a failure, not an empty forecast.
 */
function parseForecast(site: WeatherSite, raw: unknown, httpStatus?: number): SiteResult {
  if (!raw || typeof raw !== "object") return { ok: false, site, detail: `${site.id}: response is not an object` };
  const properties = (raw as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") {
    return { ok: false, site, detail: `${site.id}: response has no properties` };
  }

  const { meta, timeseries } = properties as { meta?: { updated_at?: unknown }; timeseries?: unknown };
  const updatedAtRaw = meta?.updated_at;
  const updatedAtMs = typeof updatedAtRaw === "string" ? Date.parse(updatedAtRaw) : Number.NaN;
  if (Number.isNaN(updatedAtMs)) return { ok: false, site, detail: `${site.id}: meta.updated_at is missing or invalid` };

  if (!Array.isArray(timeseries) || timeseries.length === 0) {
    return { ok: false, site, detail: `${site.id}: timeseries is empty` };
  }

  type Entry = {
    time?: unknown;
    data?: {
      instant?: { details?: unknown };
      next_1_hours?: { summary?: { symbol_code?: unknown } };
    };
  };

  const entries = timeseries as Entry[];
  const first = entries[0];
  const details = first?.data?.instant?.details;
  if (!details || typeof details !== "object") {
    return { ok: false, site, detail: `${site.id}: first timeseries entry has no instant details` };
  }

  const values = details as Record<string, unknown>;
  const temperatureC = number(values.air_temperature);
  if (temperatureC === undefined) {
    return { ok: false, site, detail: `${site.id}: air_temperature is missing or not numeric` };
  }

  /**
   * Everything from the first entry out to the horizon, at whatever resolution MET published.
   *
   * Timestamps are the entries' own `time`, never the array index: the series is hourly early on
   * and coarser later, so counting positions would silently mislabel the far end.
   */
  const startMs = Date.parse(String(entries[0]?.time));
  const horizonMs = Number.isNaN(startMs) ? Number.NaN : startMs + METNO_FORECAST_HOURS * 3_600_000;
  const hours: HourlyReading[] = [];
  for (const entry of entries) {
    const timeMs = typeof entry.time === "string" ? Date.parse(entry.time) : Number.NaN;
    if (Number.isNaN(timeMs)) continue;
    if (!Number.isNaN(horizonMs) && timeMs > horizonMs) break;
    const hourly = entry.data?.instant?.details as Record<string, unknown> | undefined;
    if (!hourly || typeof hourly !== "object") continue;
    hours.push({
      time: new Date(timeMs).toISOString(),
      temperatureC: number(hourly.air_temperature),
      windMps: number(hourly.wind_speed),
      windFromDirection: number(hourly.wind_from_direction),
      cloudLowPercent: number(hourly.cloud_area_fraction_low),
      cloudMediumPercent: number(hourly.cloud_area_fraction_medium),
      cloudHighPercent: number(hourly.cloud_area_fraction_high),
      cloudTotalPercent: number(hourly.cloud_area_fraction),
      // The app reads its condition code from next_1_hours only; the six-hourly tail therefore has
      // none, and it renders the default symbol rather than borrowing a wider summary.
      symbolCode:
        typeof entry.data?.next_1_hours?.summary?.symbol_code === "string"
          ? entry.data.next_1_hours.summary.symbol_code
          : undefined,
    });
  }

  return {
    ok: true,
    reading: {
      site,
      httpStatus,
      updatedAt: new Date(updatedAtMs),
      hours,
      temperatureC,
      windMps: number(values.wind_speed),
      windGustMps: number(values.wind_speed_of_gust),
      cloudLowPercent: number(values.cloud_area_fraction_low),
      cloudMediumPercent: number(values.cloud_area_fraction_medium),
      cloudHighPercent: number(values.cloud_area_fraction_high),
      cloudTotalPercent: number(values.cloud_area_fraction),
      windFromDirection: number(values.wind_from_direction),
      // The app reads the condition code from next_1_hours, not from the instant block.
      symbolCode:
        typeof first.data?.next_1_hours?.summary?.symbol_code === "string"
          ? first.data.next_1_hours.summary.symbol_code
          : undefined,
    },
  };
}

/** Runs `worker` over `items` a few at a time rather than firing 32 requests at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Read-only health check of MET Norway Locationforecast, using the app's own endpoint and its
 * curated site list. A partial outage is visible: the snapshot records how many sites were checked,
 * how many answered, and which did not.
 */
export async function checkMetno(options: MetnoCheckOptions = {}): Promise<MonitorHealth> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const sites = options.sites ?? WEATHER_SITES;
  const checkedAt = now.toISOString();
  const base = { id: METNO_MONITOR_ID, name: METNO_MONITOR_NAME };

  const startedMs = Date.now();
  const results = await mapWithConcurrency(sites, METNO_CONCURRENCY, async (site): Promise<SiteResult> => {
    const response = await request<unknown>(siteUrl(site), {
      init: { method: "GET", headers: { "User-Agent": METNO_USER_AGENT, Accept: "application/json" } },
      responseType: "json",
      timeoutMs: SOURCE_TIMEOUT_MS,
    });
    if (!response.ok) return { ok: false, site, detail: `${site.id}: ${response.errorType} ${response.message}` };
    return parseForecast(site, response.data, response.diagnostics.httpStatus);
  });
  const latencyMs = Date.now() - startedMs;

  const readings = results.flatMap((result) => (result.ok ? [result.reading] : []));
  const failures = results.flatMap((result) => (result.ok ? [] : [result]));

  const shared = {
    ...base,
    checkedAt,
    latencyMs,
    recordCount: readings.length,
    provenance: { mode: "production" as const, provider: "MET Norway Locationforecast 2.0" },
  };

  if (readings.length === 0) {
    return evaluateHealth({
      ...shared,
      networkOk: failures.some((failure) => !failure.detail.includes("NETWORK_ERROR")),
      parseOk: false,
      allowEmpty: true,
      errorType: "NETWORK_ERROR",
      errorMessage: `No MET Norway location could be read (${sites.length} attempted) — ${failures
        .slice(0, 3)
        .map((failure) => failure.detail)
        .join("; ")}`,
      details: { locationsChecked: sites.length, locationsSuccessful: 0, locationsFailed: failures.length },
    });
  }

  // The forecast issue time, taken from the freshest site that answered.
  const issuedAt = new Date(Math.max(...readings.map((reading) => reading.updatedAt.getTime())));
  const primary = readings.find((reading) => reading.site.id === PRIMARY_SITE_ID) ?? readings[0];

  const data: Record<string, unknown> = {
    locations: `${readings.length} / ${sites.length} successful`,
    locationsChecked: sites.length,
    locationsSuccessful: readings.length,
    locationsFailed: failures.length,
    forecastIssued: `${issuedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    primarySite: primary.site.name,
    temperatureC: primary.temperatureC,
    windMps: primary.windMps,
    cloudLowPercent: primary.cloudLowPercent,
    cloudMediumPercent: primary.cloudMediumPercent,
    cloudHighPercent: primary.cloudHighPercent,
  };

  /**
   * The shared time axis for every site's forecast, written once instead of on all 1,568 records.
   *
   * MET issues each point on its own schedule, so a site can start an hour off its neighbours;
   * this is the union of what the sites actually returned, and a site simply has no tuple at a
   * time it did not publish. See `@/lib/forecastCodec` for the tuple's field order.
   */
  const forecastTimes = buildForecastTimes(readings.map((reading) => reading.hours));
  data.forecastTimes = forecastTimes;

  // Every site that answered, so the dashboard can draw the app's map without a second request.
  // Purely additive: the headline fields above are untouched and the summary card still reads them.
  data.sites = readings.map((reading) => ({
    id: reading.site.id,
    name: reading.site.name,
    nameIs: reading.site.nameIs,
    nameZh: reading.site.nameZh,
    lat: reading.site.lat,
    lon: reading.site.lon,
    region: reading.site.region,
    temperatureC: reading.temperatureC,
    windMps: reading.windMps,
    windFromDirection: reading.windFromDirection,
    cloudLowPercent: reading.cloudLowPercent,
    cloudMediumPercent: reading.cloudMediumPercent,
    cloudHighPercent: reading.cloudHighPercent,
    cloudTotalPercent: reading.cloudTotalPercent,
    symbolCode: reading.symbolCode,
    forecast: encodeSiteForecast(reading.hours, forecastTimes),
  }));

  const details: Record<string, unknown> = { ...data, endpoint: METNO_FORECAST_URL };
  if (failures.length > 0) {
    data.failedLocations = failures.map((failure) => failure.site.id).join(", ");
    details.failedLocations = failures.map((failure) => failure.detail).join("; ");
  }

  return evaluateHealth({
    ...shared,
    networkOk: true,
    parseOk: true,
    schemaOk: true,
    // The status of a location that actually answered; a mixed result is reported via partialFailure.
    httpStatus: primary.httpStatus ?? 200,
    dataTime: issuedAt.toISOString(),
    lastSuccess: checkedAt,
    ageSeconds: (now.getTime() - issuedAt.getTime()) / 1000,
    staleAfter: SOURCE_STALE_AFTER_SECONDS.metno,
    partialFailure: failures.length > 0,
    errorType: failures.length > 0 ? "HTTP_ERROR" : undefined,
    errorMessage:
      failures.length > 0
        ? `${failures.length} of ${sites.length} MET Norway locations could not be read — ${failures
            .slice(0, 3)
            .map((failure) => failure.detail)
            .join("; ")}`
        : undefined,
    data,
    details,
  });
}
