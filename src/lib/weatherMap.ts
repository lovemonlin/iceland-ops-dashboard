/**
 * The Android weather map, ported.
 *
 * Every constant, colour, threshold and placement rule below was read out of the app
 * (`C:\dev\iceland-aurora`, read-only) and is reproduced verbatim, not re-designed:
 *
 *   ui/home/RegionalWeatherMap.kt   projection, sizes, zoom, label placement
 *   ui/home/WeatherSymbols.kt       symbol_code -> icon and tint
 *   ui/home/WeatherDetailScreen.kt  ObstructionZones -> dot colour
 *   data/model/SiteWeather.kt       effectiveObstruction
 *   data/sites/IcelandOutline.kt    outline parsing and bounds
 *   ui/theme/Theme.kt               the dark colour scheme the map draws on
 *
 * Compose dp and CSS px are both 1/160 inch at scale 1, so the numbers carry across unchanged.
 */

// ── Sizes (RegionalWeatherMap.kt:661-698) ─────────────────────────────────────

export const DOT_RADIUS = 5.5;
export const DOT_STROKE = 1.5;
export const FOCUS_RING_RADIUS = 9.5;
export const FOCUS_RING_STROKE = 2;
export const COAST_STROKE = 1;

export const LABEL_OFFSET_X = 8;
export const LABEL_FONT_SIZE = 17;
export const MARKER_ICON_SIZE = 18;
export const LABEL_WIDTH = 52;
export const LABEL_HEIGHT = 22;
export const LABEL_GAP = 3;

export const MAP_PAD_START = 8;
export const MAP_PAD_END = 62;
export const MAP_PAD_TOP = 12;
export const MAP_PAD_BOTTOM = 14;

/** 6x is about one fjord; past that the outline and the points carry no more detail. */
export const MAX_SCALE = 6;
/** One press of +/-. 1.8 is roughly three presses to the limit. */
export const ZOOM_STEP = 1.8;

/** The top-right control cluster; no temperature label may be placed under it. */
export const CONTROLS_WIDTH = 96;
export const CONTROLS_HEIGHT = 112;

/** A 5.5px dot is unhittable on a touch screen, so taps are matched within 24px. */
export const TAP_TOLERANCE = 24;

// ── Colours (Theme.kt darkColorScheme, RegionalWeatherMap.kt:145-149) ─────────

/** Deliberately outside the four obstruction colours so it reads on any of them. */
export const FOCUS_RING_COLOR = "#FF3B30";
/** colorScheme.surface — also the "sea" the island floats on. */
export const MAP_SURFACE = "#141B2D";
/** surfaceVariant #1E2740 at alpha 0.45. */
export const MAP_LAND = "rgba(30, 39, 64, 0.45)";
/** colorScheme.outline. */
export const MAP_COAST = "#3A465F";
/** colorScheme.onSurface. */
export const MAP_LABEL_COLOR = "#E8EDF7";
/** colorScheme.onSurfaceVariant. */
export const MAP_MUTED_COLOR = "#AEB9D0";
/** surfaceVariant at alpha 0.6, the focused-site card background. */
export const FOCUS_CARD_BACKGROUND = "rgba(30, 39, 64, 0.6)";

// ── Effective obstruction (SiteWeather.kt:58-69) ──────────────────────────────

export interface CloudLayers {
  cloudLowPercent?: number;
  cloudMediumPercent?: number;
  cloudHighPercent?: number;
  cloudTotalPercent?: number;
}

/**
 * The single number the whole map is coloured by: how much of the sky is actually blocked,
 * weighting low cloud 1.00, mid 0.70 and high 0.35.
 *
 * Multiplied as transmission rather than summed, so three layers can never exceed 100.
 */
export function effectiveObstruction(layers: CloudLayers): number {
  const low = layers.cloudLowPercent ?? layers.cloudTotalPercent;
  if (low === undefined) return 100;
  const mid = layers.cloudMediumPercent ?? 0;
  const high = layers.cloudHighPercent ?? 0;
  const transmission = (1 - (low / 100) * 1.0) * (1 - (mid / 100) * 0.7) * (1 - (high / 100) * 0.35);
  return Math.min(100, Math.max(0, (1 - transmission) * 100));
}

/** ObstructionZones (WeatherDetailScreen.kt:1094-1102), matched by `colorFor`: first zone >= value. */
export const OBSTRUCTION_ZONES: { upTo: number; color: string }[] = [
  { upTo: 20, color: "#1D6DFF" },
  { upTo: 45, color: "#5EE74B" },
  { upTo: 70, color: "#C6C6C6" },
  { upTo: 100, color: "#636363" },
];

export function obstructionColorFor(obstruction: number): string {
  for (const zone of OBSTRUCTION_ZONES) {
    if (obstruction <= zone.upTo) return zone.color;
  }
  return OBSTRUCTION_ZONES[OBSTRUCTION_ZONES.length - 1].color;
}

// ── Weather symbols (WeatherSymbols.kt) ───────────────────────────────────────

export type WeatherSymbolKey =
  | "thunder"
  | "snow"
  | "rain"
  | "fog"
  | "partlycloudy"
  | "cloudy"
  | "clearsky_day"
  | "clearsky_night"
  | "unknown";

/** Material Icons (filled) path data, 24x24 — the same artwork the app's Icons.Filled.* render. */
const ICON_PATHS: Record<string, string[]> = {
  bolt: ["M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"],
  acUnit: ["M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L17.83 13H22z"],
  waterDrop: ["M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zM7.83 14c.37 0 .67.26.74.62.41 2.22 2.28 2.98 3.64 2.87.43-.02.79.32.79.75 0 .4-.32.73-.72.75-2.13.13-4.62-1.09-5.19-4.12a.75.75 0 0 1 .74-.87z"],
  cloud: ["M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"],
  filterDrama: ["M19.35 10.04A7.49 7.49 0 0 0 12 4a7.48 7.48 0 0 0-6.64 4.04A5.996 5.996 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4h2c0-2.76-1.86-5.08-4.4-5.78C8.61 6.88 10.2 6 12 6c3.03 0 5.5 2.47 5.5 5.5v.5H19c1.65 0 3 1.35 3 3s-1.35 3-3 3z"],
  wbCloudy: ["M19.36 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.64-4.96z"],
  wbSunny: ["m6.76 4.84-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7 1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91 1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"],
  nightsStay: [
    "M11.1 12.08c-2.33-4.51-.5-8.48.53-10.07C6.27 2.2 1.98 6.59 1.98 12c0 .14.02.28.02.42.62-.27 1.29-.42 2-.42 1.66 0 3.18.83 4.1 2.15A4.01 4.01 0 0 1 11 18c0 1.52-.87 2.83-2.12 3.51.98.32 2.03.5 3.11.5 3.5 0 6.58-1.8 8.37-4.52-2.36.23-6.98-.97-9.26-5.41z",
    "M7 16h-.18C6.4 14.84 5.3 14 4 14c-1.66 0-3 1.34-3 3s1.34 3 3 3h3c1.1 0 2-.9 2-2s-.9-2-2-2z",
  ],
  arrowUpward: ["m4 12 1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"],
};

export const WIND_ARROW_PATHS = ICON_PATHS.arrowUpward;

interface SymbolStyle {
  key: WeatherSymbolKey;
  paths: string[];
  tint: string;
  label: string;
}

/** WeatherSymbols.kt tints, verbatim. */
const TINTS = {
  sun: "#FBBF24",
  clearNight: "#93C5FD",
  partlyCloudy: "#CBD5E1",
  overcast: "#94A3B8",
  rain: "#60A5FA",
  snow: "#BAE6FD",
  thunder: "#F59E0B",
};

const SYMBOLS: Record<WeatherSymbolKey, SymbolStyle> = {
  thunder: { key: "thunder", paths: ICON_PATHS.bolt, tint: TINTS.thunder, label: "雷雨" },
  snow: { key: "snow", paths: ICON_PATHS.acUnit, tint: TINTS.snow, label: "下雪或雨夾雪" },
  rain: { key: "rain", paths: ICON_PATHS.waterDrop, tint: TINTS.rain, label: "下雨或毛毛雨" },
  fog: { key: "fog", paths: ICON_PATHS.cloud, tint: TINTS.overcast, label: "陰天或起霧" },
  partlycloudy: { key: "partlycloudy", paths: ICON_PATHS.filterDrama, tint: TINTS.partlyCloudy, label: "局部多雲" },
  cloudy: { key: "cloudy", paths: ICON_PATHS.wbCloudy, tint: TINTS.overcast, label: "陰天或起霧" },
  clearsky_day: { key: "clearsky_day", paths: ICON_PATHS.wbSunny, tint: TINTS.sun, label: "晴天（白天）" },
  clearsky_night: { key: "clearsky_night", paths: ICON_PATHS.nightsStay, tint: TINTS.clearNight, label: "晴朗（夜間）" },
  unknown: { key: "unknown", paths: ICON_PATHS.cloud, tint: TINTS.overcast, label: "陰天或起霧" },
};

/**
 * Matched by keyword rather than by enumerating codes: MET Norway has close to a hundred
 * combinations and a missed one would silently become the default icon. The order matters —
 * `rainandthunder` contains both keywords, and thunder must win.
 */
export function weatherSymbolFor(symbolCode: string | undefined | null): SymbolStyle {
  if (!symbolCode) return SYMBOLS.unknown;
  const code = symbolCode.toLowerCase();
  const isNight = code.endsWith("_night");
  if (code.includes("thunder")) return SYMBOLS.thunder;
  if (code.includes("snow") || code.includes("sleet")) return SYMBOLS.snow;
  if (code.includes("rain") || code.includes("drizzle")) return SYMBOLS.rain;
  if (code.includes("fog")) return SYMBOLS.fog;
  if (code.includes("partlycloudy") || code.includes("fair")) return SYMBOLS.partlycloudy;
  if (code.includes("cloudy")) return SYMBOLS.cloudy;
  if (code.includes("clearsky")) return isNight ? SYMBOLS.clearsky_night : SYMBOLS.clearsky_day;
  return SYMBOLS.unknown;
}

// ── Outline and projection (IcelandOutline.kt, RegionalWeatherMap.kt:163-267) ──

export type Ring = [number, number][];

export interface OutlineBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface OutlineShape {
  rings: Ring[];
  bounds: OutlineBounds;
}

/** Reads the same asset the app reads: Polygon or MultiPolygon rings of [lon, lat]. */
export function parseOutline(geojson: unknown): OutlineShape | null {
  type Geometry = { type?: string; coordinates?: unknown };
  const root = geojson as { type?: string; features?: unknown[]; geometry?: unknown };
  const candidates: unknown[] =
    root?.type === "FeatureCollection"
      ? (root.features ?? []).map((feature) => (feature as { geometry?: unknown }).geometry)
      : root?.type === "Feature"
        ? [root.geometry]
        : [root];
  const geometries = candidates.filter(
    (geometry): geometry is Geometry => typeof geometry === "object" && geometry !== null,
  );

  const rings: Ring[] = [];
  for (const geometry of geometries) {
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates)) continue;
    if (geometry.type === "Polygon") {
      for (const ring of coordinates) if (Array.isArray(ring)) rings.push(ring as Ring);
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of coordinates) {
        if (!Array.isArray(polygon)) continue;
        for (const ring of polygon) if (Array.isArray(ring)) rings.push(ring as Ring);
      }
    }
  }

  const usable = rings.filter((ring) => ring.length >= 3);
  if (usable.length === 0) return null;

  const points = usable.flat();
  return {
    rings: usable,
    bounds: {
      minLat: Math.min(...points.map((point) => point[1])),
      maxLat: Math.max(...points.map((point) => point[1])),
      minLon: Math.min(...points.map((point) => point[0])),
      maxLon: Math.max(...points.map((point) => point[0])),
    },
  };
}

export interface Projection {
  bounds: OutlineBounds;
  lonScale: number;
  spanLat: number;
  spanLon: number;
  aspect: number;
  innerWidth: number;
  innerHeight: number;
  centreShiftX: number;
  centreShiftY: number;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * The card layout: height follows the island's aspect ratio, so the frame hugs the island and
 * Iceland is never stretched. This is the `hasBoundedHeight == false` branch in the app.
 */
export function createProjection(bounds: OutlineBounds, viewportWidth: number): Projection {
  // A degree of longitude is only cos(latitude) as wide as a degree of latitude. Iceland sits at
  // 65°N where that is about 0.42 — without the correction the island comes out twice too wide.
  const lonScale = Math.cos(((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180));
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 1e-6);
  const spanLon = Math.max(bounds.maxLon - bounds.minLon, 1e-6) * lonScale;
  const aspect = spanLon / spanLat;

  const innerWidth = Math.max(viewportWidth - MAP_PAD_START - MAP_PAD_END, 1);
  const innerHeight = innerWidth / aspect;
  const viewportHeight = innerHeight + MAP_PAD_TOP + MAP_PAD_BOTTOM;

  return {
    bounds,
    lonScale,
    spanLat,
    spanLon,
    aspect,
    innerWidth,
    innerHeight,
    centreShiftX: (viewportWidth - MAP_PAD_START - MAP_PAD_END - innerWidth) / 2,
    centreShiftY: (viewportHeight - MAP_PAD_TOP - MAP_PAD_BOTTOM - innerHeight) / 2,
    viewportWidth,
    viewportHeight,
  };
}

export interface Point {
  x: number;
  y: number;
}

/** Unscaled, unpanned position. Zoom anchoring must use this, never a transformed coordinate. */
export function projectBase(projection: Projection, lon: number, lat: number): Point {
  return {
    x:
      MAP_PAD_START +
      projection.centreShiftX +
      (((lon - projection.bounds.minLon) * projection.lonScale) / projection.spanLon) * projection.innerWidth,
    // Latitude grows north, screen y grows down, so this axis is flipped.
    y:
      MAP_PAD_TOP +
      projection.centreShiftY +
      (1 - (lat - projection.bounds.minLat) / projection.spanLat) * projection.innerHeight,
  };
}

export function project(projection: Projection, lon: number, lat: number, scale: number, pan: Point): Point {
  const base = projectBase(projection, lon, lat);
  return { x: base.x * scale + pan.x, y: base.y * scale + pan.y };
}

/**
 * Keeps the pan within reach, bounded so that any position can be dragged to the centre of the
 * viewport — not so that content edges stop at screen edges, which made the outermost sites
 * impossible to inspect. At scale 1 the whole island already fits, so panning is disabled.
 */
export function clampPan(candidate: Point, atScale: number, viewportWidth: number, viewportHeight: number): Point {
  if (atScale <= 1) return { x: 0, y: 0 };
  const centreX = viewportWidth / 2;
  const centreY = viewportHeight / 2;
  return {
    x: Math.min(centreX, Math.max(centreX - viewportWidth * atScale, candidate.x)),
    y: Math.min(centreY, Math.max(centreY - viewportHeight * atScale, candidate.y)),
  };
}

/**
 * Zooms with the focused site as the anchor.
 *
 * The geometric centre of Iceland is uninhabited highland ice; anchoring there meant two presses
 * of + left a blank white field. Anchoring on the selection zooms into what is being looked at.
 */
export function zoomTo(
  target: number,
  projection: Projection,
  anchorLonLat: { lon: number; lat: number } | undefined,
): { scale: number; pan: Point } {
  const scale = Math.min(MAX_SCALE, Math.max(1, target));
  const centre = { x: projection.viewportWidth / 2, y: projection.viewportHeight / 2 };
  const anchor = anchorLonLat ? projectBase(projection, anchorLonLat.lon, anchorLonLat.lat) : centre;
  const pan = clampPan(
    { x: centre.x - anchor.x * scale, y: centre.y - anchor.y * scale },
    scale,
    projection.viewportWidth,
    projection.viewportHeight,
  );
  return { scale, pan };
}

// ── Label placement (RegionalWeatherMap.kt:601-658) ───────────────────────────

export type LabelSide = "RIGHT" | "LEFT";

export interface MarkerInput {
  id: string;
  lon: number;
  lat: number;
}

export interface PlacedMarker<T extends MarkerInput> {
  point: T;
  position: Point;
  labelSide: LabelSide | null;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const inflate = (rect: Rect, by: number): Rect => ({
  left: rect.left - by,
  top: rect.top - by,
  right: rect.right + by,
  bottom: rect.bottom + by,
});

const contains = (rect: Rect, point: Point) =>
  point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Which sites get a label, and on which side.
 *
 * Over half the 32 sites crowd into the south-west corner, so labelling all of them would produce
 * one unreadable clump. Dots are always drawn — position is itself information. Labels are placed
 * greedily: focused site first so its label is guaranteed, then right side, then left, skipping any
 * that would fall off-screen, cover another site's dot, or collide with a label already placed.
 *
 * Zooming re-runs this, which is the real benefit of zoom: not bigger, but *more* labels.
 */
export function layoutMarkers<T extends MarkerInput>(options: {
  points: T[];
  focusedId: string;
  viewportWidth: number;
  viewportHeight: number;
  project: (lon: number, lat: number) => Point;
}): PlacedMarker<T>[] {
  const { points, focusedId, viewportWidth, viewportHeight, project: projectPoint } = options;

  const ordered = [...points].sort(
    (a, b) => Number(b.id === focusedId) - Number(a.id === focusedId),
  );
  const positions = ordered.map((point) => projectPoint(point.lon, point.lat));
  const taken: Rect[] = [];

  return ordered.map((point, index) => {
    const position = positions[index];
    const onScreen =
      position.x >= 0 && position.x <= viewportWidth && position.y >= 0 && position.y <= viewportHeight;
    const underControls = position.x > viewportWidth - CONTROLS_WIDTH && position.y < CONTROLS_HEIGHT;

    let chosen: LabelSide | null = null;
    if (onScreen && !underControls) {
      for (const side of ["RIGHT", "LEFT"] as const) {
        const left = side === "RIGHT" ? position.x + LABEL_OFFSET_X : position.x - LABEL_OFFSET_X - LABEL_WIDTH;
        const rect: Rect = {
          left,
          top: position.y - LABEL_HEIGHT / 2,
          right: left + LABEL_WIDTH,
          bottom: position.y + LABEL_HEIGHT / 2,
        };
        if (rect.left < 0 || rect.right > viewportWidth) continue;
        // A label must not cover somebody else's dot; checking label-to-label alone is not enough.
        const coversAnotherDot = positions.some(
          (other, otherIndex) => otherIndex !== index && contains(inflate(rect, DOT_RADIUS), other),
        );
        if (coversAnotherDot) continue;
        if (taken.some((placed) => overlaps(placed, inflate(rect, LABEL_GAP)))) continue;
        taken.push(rect);
        chosen = side;
        break;
      }
    }

    return { point, position, labelSide: chosen };
  });
}

// ── Legend (WeatherLegendDialog.kt) ───────────────────────────────────────────

/** The legend's symbol rows, in the app's order, keyed by the sample code the app passes. */
export const LEGEND_SYMBOL_CODES = [
  "clearsky_day",
  "clearsky_night",
  "partlycloudy_day",
  "cloudy",
  "lightrain",
  "snow",
  "rainandthunder",
] as const;

/** The legend's dot rows: sample obstruction values and what they mean. */
export const LEGEND_DOTS: { obstruction: number; label: string }[] = [
  { obstruction: 10, label: "幾乎沒有遮擋" },
  { obstruction: 35, label: "有一些雲，還可以" },
  { obstruction: 60, label: "雲很多" },
  { obstruction: 90, label: "滿天雲 — 沒機會" },
];
