/**
 * The app's ECMWF cloud-forecast viewer, ported.
 *
 * Read out of `C:\dev\iceland-aurora` (read-only) and reproduced rather than re-designed:
 *
 *   ui/map/MapStyleFactory.kt              forecast palette, image bounds, raster paint
 *   ui/map/MapViewModel.kt                 MAX_FORECAST_HOURS, cloudForecastColor
 *   ui/map/MapScreen.kt                    control panel order, timing info, legend, wording
 *   data/remote/EcmwfCloudForecast.kt      frameAt()
 *
 * The publisher keeps 17 frames out to +48 h. The app deliberately shows only the first 24 h,
 * so this does too — the extra frames exist for the pipeline, not for the reader.
 */

import type { WeatherHour } from "@/lib/weatherMap";

/** `MapViewModel.MAX_FORECAST_HOURS`. The publisher's +48 h is deliberately not exposed. */
export const CLOUD_FORECAST_MAX_HOURS = 24;

/** Published frames are three hours apart; the slider is not restricted to those steps. */
export const CLOUD_FRAME_STEP_HOURS = 3;

/**
 * `EcmwfCloudManifest.frameAt` accepts a frame only within 90 minutes of the wanted time.
 *
 * Frames are 3 h apart, so half a step is 90 minutes: every moment inside the covered range has
 * exactly one frame within tolerance, and a moment past the end has none rather than silently
 * showing the last frame published hours earlier.
 */
export const CLOUD_FRAME_TOLERANCE_SECONDS = 90 * 60;

export interface CloudFrame {
  /** Hours from the model run, as the publisher names the file. */
  leadHours: number;
  validAt: string;
  imageUrl: string;
}

/**
 * `EcmwfCloudManifest.frameAt(time)` — the frame whose valid time is nearest, and only if it is
 * within tolerance. `minByOrNull` keeps the first on a tie, so an exact midpoint takes the
 * earlier frame; this reproduces that.
 */
export function frameAt(frames: CloudFrame[] | undefined, time: Date): CloudFrame | undefined {
  if (!frames || frames.length === 0) return undefined;
  const target = time.getTime();
  let best: CloudFrame | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const parsed = Date.parse(frame.validAt);
    if (Number.isNaN(parsed)) continue;
    const distance = Math.abs(parsed - target);
    // Strictly less-than keeps the earlier frame when two are equidistant.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = frame;
    }
  }
  if (!best) return undefined;
  return bestDistance <= CLOUD_FRAME_TOLERANCE_SECONDS * 1000 ? best : undefined;
}

// ── Forecast palette (MapStyleFactory.kt:55-57) ───────────────────────────────

export const FORECAST_OCEAN_COLOR = "#294D61";
export const FORECAST_LAND_COLOR = "#4D625E";
export const FORECAST_COAST_COLOR = "#B8CDD2";

/** The published PNGs cover exactly this box (MapStyleFactory.kt:32-35). */
export const CLOUD_IMAGE_LAT_MIN = 63.4;
export const CLOUD_IMAGE_LAT_MAX = 66.54;
export const CLOUD_IMAGE_LON_MIN = -24.54;
export const CLOUD_IMAGE_LON_MAX = -13.5;

/** The app's corner order: top-left, top-right, bottom-right, bottom-left. */
export const CLOUD_IMAGE_COORDINATES: [number, number][] = [
  [CLOUD_IMAGE_LON_MIN, CLOUD_IMAGE_LAT_MAX],
  [CLOUD_IMAGE_LON_MAX, CLOUD_IMAGE_LAT_MAX],
  [CLOUD_IMAGE_LON_MAX, CLOUD_IMAGE_LAT_MIN],
  [CLOUD_IMAGE_LON_MIN, CLOUD_IMAGE_LAT_MIN],
];

export const CLOUD_RASTER_OPACITY = 0.62;
export const CLOUD_RASTER_FADE_MS = 250;
export const CLOUD_ATTRIBUTION = "ECMWF © CC BY 4.0";

/** `cloudForecastColor` (MapViewModel.kt:288-293). */
export function cloudForecastColor(obstruction: number | undefined): string {
  if (obstruction === undefined) return "#64748B";
  if (obstruction <= 20) return "#4ADE80";
  if (obstruction <= 50) return "#FDE047";
  if (obstruction <= 75) return "#FB923C";
  return "#F87171";
}

/** `CloudForecastLegend` (MapScreen.kt:675-687), with the app's own zh-TW labels. */
export const CLOUD_LEGEND: { color: string; label: string }[] = [
  { color: "#4ADE80", label: "少雲 0–20%" },
  { color: "#FDE047", label: "20–50%" },
  { color: "#FB923C", label: "50–75%" },
  { color: "#F87171", label: "75–100%" },
];

// ── Wording (values-zh-rTW/strings.xml) ───────────────────────────────────────

export const CLOUD_FORECAST_TITLE = "未來雲量預報（各地點）";
export const CLOUD_FORECAST_NOW = "預測現在 · 0 小時後";
export const CLOUD_FRAME_AVAILABLE = "ECMWF 總雲量覆蓋層：每 3 小時一格，預報未來 24 小時。";
export const CLOUD_FRAME_UNAVAILABLE = "尚未設定 ECMWF 區域雲圖服務；地點預報仍可使用。";
export const CLOUD_FORECAST_NOTE =
  "地點顏色代表預測雲層遮蔽率；衛星影像與極光帶不是 24 小時預報，因此在此模式隱藏。";
export const CLOUD_GENERATED_PENDING = "資料更新時間：等待下一次雲圖發布";

/** `map_forecast_offset`: 預測 %1$s · %2$d 小時後 */
export function formatForecastOffset(time: string, offsetHours: number): string {
  return `預測 ${time} · ${offsetHours} 小時後`;
}

export const formatGeneratedAt = (value: string) => `資料更新時間：冰島當地 ${value}`;
export const formatRunAt = (value: string) => `模型起報時間：冰島當地 ${value}`;
export const formatValidAt = (value: string) => `目前預報時間：冰島當地 ${value}`;

/** Iceland's clock, as the trip is planned in — the same choice as the weather timeline. */
export const CLOUD_TIME_ZONE = "Atlantic/Reykjavik";

function icelandParts(iso: string) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return undefined;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLOUD_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(parsed));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

/** `formatForecastTime()` — "%d/%d %02d:%02d", month and day unpadded. */
export function formatForecastTime(iso: string): string {
  const parts = icelandParts(iso);
  if (!parts) return "—";
  return `${Number(parts.month)}/${Number(parts.day)} ${parts.hour}:${parts.minute}`;
}

/** `formatIcelandDateTime()` — "%02d/%02d %02d:%02d", zero-padded. */
export function formatIcelandDateTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const parts = icelandParts(iso);
  if (!parts) return undefined;
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

// ── The map style (MapStyleFactory.build, forecastMode = true) ────────────────

export interface CloudSiteMarker {
  id: string;
  nameZh: string;
  color: string;
  score: number;
  lat: number;
  lon: number;
}

export function siteFeatureCollection(markers: CloudSiteMarker[]) {
  return {
    type: "FeatureCollection" as const,
    features: markers.map((marker) => ({
      type: "Feature" as const,
      properties: { id: marker.id, name: marker.nameZh, color: marker.color, score: marker.score },
      geometry: { type: "Point" as const, coordinates: [marker.lon, marker.lat] },
    })),
  };
}

/**
 * The app's forecast-mode style.
 *
 * The satellite raster and the aurora oval are deliberately absent: neither is a 24-hour
 * forecast, and the app hides both in this mode for that reason (`map_forecast_note`).
 *
 * The coastline is drawn over the cloud image — without it a heavy frame swallows the island.
 */
export function buildCloudForecastStyle(
  icelandUrl: string,
  imageUrl: string | undefined,
  markers: CloudSiteMarker[],
) {
  const sources: Record<string, unknown> = {
    iceland: { type: "geojson", data: icelandUrl },
    sites: { type: "geojson", data: siteFeatureCollection(markers) },
  };
  if (imageUrl) {
    sources["ecmwf-cloud-forecast"] = {
      type: "image",
      url: imageUrl,
      coordinates: CLOUD_IMAGE_COORDINATES,
      attribution: CLOUD_ATTRIBUTION,
    };
  }

  const layers: Record<string, unknown>[] = [
    { id: "background", type: "background", paint: { "background-color": FORECAST_OCEAN_COLOR } },
    { id: "land-fill", type: "fill", source: "iceland", paint: { "fill-color": FORECAST_LAND_COLOR, "fill-opacity": 1 } },
  ];
  if (imageUrl) {
    layers.push({
      id: "ecmwf-cloud-forecast",
      type: "raster",
      source: "ecmwf-cloud-forecast",
      paint: { "raster-opacity": CLOUD_RASTER_OPACITY, "raster-fade-duration": CLOUD_RASTER_FADE_MS },
    });
  }
  layers.push(
    { id: "coastline", type: "line", source: "iceland", paint: { "line-color": FORECAST_COAST_COLOR, "line-width": 1.4 } },
    // MapStyleFactory.siteCircleLayer(), unchanged.
    {
      id: "site-circles",
      type: "circle",
      source: "sites",
      paint: {
        "circle-radius": 7,
        "circle-color": ["to-color", ["get", "color"]],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#F8FAFC",
        "circle-opacity": 0.95,
      },
    },
  );

  return { version: 8, name: "Iceland cloud forecast", sources, layers };
}

/**
 * `MapViewModel.cloudForecastMarkersAt` — each site coloured by the cloud obstruction its own
 * hourly forecast gives for the selected time. A site with no reading at that hour keeps the
 * app's neutral colour and a score of 0 rather than being coloured as if it were clear.
 */
export function cloudForecastMarkersAt(
  sites: { id: string; nameZh: string; name: string; lat: number; lon: number; hours?: WeatherHour[] }[],
  time: Date,
  obstructionOf: (hour: WeatherHour | undefined) => number | undefined,
  hourFor: (hours: WeatherHour[] | undefined, at: Date) => WeatherHour | undefined,
): CloudSiteMarker[] {
  return sites.map((site) => {
    const obstruction = obstructionOf(hourFor(site.hours, time));
    return {
      id: site.id,
      nameZh: site.nameZh || site.name,
      lat: site.lat,
      lon: site.lon,
      color: cloudForecastColor(obstruction),
      score: obstruction === undefined ? 0 : Math.min(100, Math.max(0, Math.trunc(100 - obstruction))),
    };
  });
}
