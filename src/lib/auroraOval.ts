/**
 * The app's aurora position map, ported.
 *
 * Read out of `C:\dev\iceland-aurora` (read-only) and reproduced rather than re-designed:
 *
 *   ui/auroraoval/AuroraOvalStyleFactory.kt      base style, graticule, Iceland marker
 *   ui/auroraoval/AuroraProbabilityContours.kt   the contour algorithm below, line for line
 *   ui/auroraoval/AuroraOvalScreen.kt            camera bounds, layer order, info card
 *   ui/map/MapStyleFactory.kt                    siteCircleLayer(), for the 32 site markers
 *   data/sites/IcelandAuroraSites.kt             those sites
 *
 * The contours are vector bands, not a heatmap: the app moved away from `heatmap-density` because
 * it normalises neighbouring low-probability cells into colours that read as high probability.
 * Nothing here interpolates the published data into new information — the subdivision is a
 * clipping step against a threshold, which is what the app does.
 */

import type { OvationGrid } from "@/lib/ovationGrid";

// ── Contour bands (AuroraProbabilityContours.kt:38-43) ────────────────────────

export const CONTOUR_LAT_FROM = 45;
export const CONTOUR_LAT_TO = 85;
/** Boundary cells are cut into 4×4 before clipping. */
export const CONTOUR_SUBDIVISIONS = 4;

export interface ContourBandSpec {
  id: string;
  threshold: number;
  color: string;
  opacity: number;
}

/** The app's four bands, in the app's order — later bands draw over earlier ones. */
export const CONTOUR_BANDS: ContourBandSpec[] = [
  { id: "very-low", threshold: 1, color: "#3D5B78", opacity: 0.4 },
  { id: "low", threshold: 10, color: "#4ADE80", opacity: 0.8 },
  { id: "moderate", threshold: 30, color: "#FB923C", opacity: 0.82 },
  { id: "high", threshold: 50, color: "#F87171", opacity: 0.9 },
];

type Ring = [number, number][];

interface Vertex {
  longitude: number;
  latitude: number;
  probability: number;
}

export interface ContourBand extends ContourBandSpec {
  geoJson: {
    type: "FeatureCollection";
    features: {
      type: "Feature";
      properties: { band: string; threshold: number };
      geometry: { type: "MultiPolygon"; coordinates: Ring[][] };
    }[];
  };
}

const gridValue = (grid: OvationGrid, latitude: number, longitude: number) =>
  grid.probabilityAt(latitude, longitude);

/** The four corners of one 1°×1° cell, `AuroraProbabilityContours.cellCorners`. */
function cellCorners(grid: OvationGrid, latitude: number, longitude: number): Vertex[] {
  return [
    { longitude, latitude, probability: gridValue(grid, latitude, longitude) },
    { longitude: longitude + 1, latitude, probability: gridValue(grid, latitude, longitude + 1) },
    { longitude: longitude + 1, latitude: latitude + 1, probability: gridValue(grid, latitude + 1, longitude + 1) },
    { longitude, latitude: latitude + 1, probability: gridValue(grid, latitude + 1, longitude) },
  ];
}

/** Bilinear sample inside a cell, `AuroraProbabilityContours.sampledVertex`. */
function sampledVertex(grid: OvationGrid, latitude: number, longitude: number): Vertex {
  const south = Math.min(89, Math.max(-90, Math.floor(latitude)));
  const westFloor = Math.floor(longitude);
  const west = westFloor;
  const fx = longitude - westFloor;
  const fy = latitude - south;
  const southWest = gridValue(grid, south, west);
  const southEast = gridValue(grid, south, west + 1);
  const northWest = gridValue(grid, south + 1, west);
  const northEast = gridValue(grid, south + 1, west + 1);
  const southValue = southWest + (southEast - southWest) * fx;
  const northValue = northWest + (northEast - northWest) * fx;
  return { longitude, latitude, probability: southValue + (northValue - southValue) * fy };
}

function vertexRing(vertices: Vertex[]): Ring {
  const ring: Ring = vertices.map((vertex) => [vertex.longitude, vertex.latitude]);
  ring.push([vertices[0].longitude, vertices[0].latitude]);
  return ring;
}

function rectangleRing(west: number, south: number, east: number, north: number): Ring {
  return vertexRing([
    { longitude: west, latitude: south, probability: 0 },
    { longitude: east, latitude: south, probability: 0 },
    { longitude: east, latitude: north, probability: 0 },
    { longitude: west, latitude: north, probability: 0 },
  ]);
}

function intersection(from: Vertex, to: Vertex, threshold: number): Vertex {
  const delta = to.probability - from.probability;
  const fraction = delta === 0 ? 0.5 : Math.min(1, Math.max(0, (threshold - from.probability) / delta));
  return {
    longitude: from.longitude + (to.longitude - from.longitude) * fraction,
    latitude: from.latitude + (to.latitude - from.latitude) * fraction,
    probability: threshold,
  };
}

/** Sutherland–Hodgman against the `probability >= threshold` half-plane. */
function clipAtThreshold(vertices: Vertex[], threshold: number): Vertex[] {
  const result: Vertex[] = [];
  let previous = vertices[vertices.length - 1];
  let previousInside = previous.probability >= threshold;
  for (const current of vertices) {
    const currentInside = current.probability >= threshold;
    if (previousInside && currentInside) {
      result.push(current);
    } else if (previousInside && !currentInside) {
      result.push(intersection(previous, current, threshold));
    } else if (!previousInside && currentInside) {
      result.push(intersection(previous, current, threshold));
      result.push(current);
    }
    previous = current;
    previousInside = currentInside;
  }
  return result;
}

/** One cell the contour crosses, cut into 4×4 and clipped. */
function clippedBoundaryCell(grid: OvationGrid, latitude: number, longitude: number, threshold: number): Ring[] {
  const polygons: Ring[] = [];
  const step = 1 / CONTOUR_SUBDIVISIONS;
  for (let subY = 0; subY < CONTOUR_SUBDIVISIONS; subY += 1) {
    for (let subX = 0; subX < CONTOUR_SUBDIVISIONS; subX += 1) {
      const west = longitude + subX * step;
      const east = west + step;
      const south = latitude + subY * step;
      const north = south + step;
      const southWest = sampledVertex(grid, south, west);
      const southEast = sampledVertex(grid, south, east);
      const northEast = sampledVertex(grid, north, east);
      const northWest = sampledVertex(grid, north, west);
      const square = [southWest, southEast, northEast, northWest];
      if (square.every((vertex) => vertex.probability >= threshold)) {
        polygons.push(rectangleRing(west, south, east, north));
      } else if (square.some((vertex) => vertex.probability >= threshold)) {
        // The square is cut as two triangles, so a corner-only overlap still produces a face.
        for (const triangle of [
          [southWest, southEast, northEast],
          [southWest, northEast, northWest],
        ]) {
          const clipped = clipAtThreshold(triangle, threshold);
          if (clipped.length >= 3) polygons.push(vertexRing(clipped));
        }
      }
    }
  }
  return polygons;
}

/**
 * Every polygon at or above one threshold.
 *
 * Cells wholly inside the threshold are merged along a latitude row into one rectangle, and only
 * the cells the contour actually crosses are subdivided. Branches and holes survive because
 * nothing here assumes the band is a single run per longitude, and no polygon is closed across
 * the map — that is where a false vertical seam would come from.
 */
function contourPolygons(grid: OvationGrid, threshold: number): Ring[] {
  const polygons: Ring[] = [];
  for (let latitude = CONTOUR_LAT_FROM; latitude < CONTOUR_LAT_TO; latitude += 1) {
    let longitude = -180;
    while (longitude < 180) {
      const corners = cellCorners(grid, latitude, longitude);
      if (corners.every((vertex) => vertex.probability >= threshold)) {
        const runStart = longitude;
        longitude += 1;
        while (longitude < 180) {
          const next = cellCorners(grid, latitude, longitude);
          if (!next.every((vertex) => vertex.probability >= threshold)) break;
          longitude += 1;
        }
        polygons.push(rectangleRing(runStart, latitude, longitude, latitude + 1));
      } else {
        if (corners.some((vertex) => vertex.probability >= threshold)) {
          polygons.push(...clippedBoundaryCell(grid, latitude, longitude, threshold));
        }
        longitude += 1;
      }
    }
  }
  return polygons;
}

/** `AuroraProbabilityContours.build` — the four bands, each one MultiPolygon feature. */
export function buildContourBands(grid: OvationGrid): ContourBand[] {
  return CONTOUR_BANDS.map((spec) => {
    const polygons = contourPolygons(grid, spec.threshold);
    return {
      ...spec,
      geoJson: {
        type: "FeatureCollection" as const,
        features:
          polygons.length === 0
            ? []
            : [
                {
                  type: "Feature" as const,
                  properties: { band: spec.id, threshold: spec.threshold },
                  geometry: {
                    type: "MultiPolygon" as const,
                    coordinates: polygons.map((ring) => [ring]),
                  },
                },
              ],
      },
    };
  });
}

// ── Base style (AuroraOvalStyleFactory.kt) ────────────────────────────────────

export const OVAL_OCEAN_COLOR = "#07162B";
export const OVAL_LAND_COLOR = "#243B4D";
export const OVAL_COASTLINE_COLOR = "#7890A1";
export const OVAL_GRATICULE_COLOR = "#6B819C";
export const OVAL_ICELAND_DETAIL_COASTLINE = "#8BA3B4";
export const OVAL_ICELAND_HALO_COLOR = "#E2E8F0";
export const OVAL_ICELAND_MARKER_COLOR = "#38BDF8";
export const OVAL_ICELAND_MARKER_STROKE = "#082F49";

/** The contour layers are inserted above this one, keeping them under the Iceland marker. */
export const AURORA_LAYER_ANCHOR = "iceland-land-detail";

export const GRATICULE_LATITUDES = [50, 60, 70, 80];
/**
 * 0° is deliberately absent. It falls exactly down the middle of the default view, where a
 * semi-transparent aurora band crossing it reads as a texture seam — the app removed it for that
 * reason and this must not put it back.
 */
export const GRATICULE_LONGITUDES = [-120, -60, 60, 120, 180];

function lineFeature(coordinates: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates },
  };
}

export function graticuleFeatureCollection() {
  const features = [];
  for (const latitude of GRATICULE_LATITUDES) {
    const ring: [number, number][] = [];
    for (let longitude = -180; longitude <= 180; longitude += 5) ring.push([longitude, latitude]);
    features.push(lineFeature(ring));
  }
  for (const longitude of GRATICULE_LONGITUDES) {
    const line: [number, number][] = [];
    for (let latitude = 45; latitude <= 85; latitude += 2) line.push([longitude, latitude]);
    features.push(lineFeature(line));
  }
  return { type: "FeatureCollection" as const, features };
}

export function icelandFeature() {
  return {
    type: "Feature" as const,
    properties: { name: "Iceland" },
    geometry: { type: "Point" as const, coordinates: [-18.97, 64.96] },
  };
}

/**
 * The app's style, with the two `asset://` URLs pointed at this site's copies of the same files.
 *
 * `sites` is added here rather than in the app's own map style because the app reaches the site
 * markers through a different screen; the circle paint is `MapStyleFactory.siteCircleLayer()`
 * verbatim so the two look the same.
 */
export function buildAuroraOvalStyle(worldLandUrl: string, icelandUrl: string, sites: unknown) {
  return {
    version: 8,
    name: "Current aurora oval",
    sources: {
      "world-land": { type: "geojson", data: worldLandUrl, attribution: "Natural Earth · public domain" },
      "iceland-land-detail": { type: "geojson", data: icelandUrl },
      graticule: { type: "geojson", data: graticuleFeatureCollection() },
      iceland: { type: "geojson", data: icelandFeature() },
      sites: { type: "geojson", data: sites },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": OVAL_OCEAN_COLOR } },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: { "line-color": OVAL_GRATICULE_COLOR, "line-width": 0.7, "line-opacity": 0.22 },
      },
      { id: "land", type: "fill", source: "world-land", paint: { "fill-color": OVAL_LAND_COLOR, "fill-opacity": 1 } },
      {
        id: "coastline",
        type: "line",
        source: "world-land",
        paint: { "line-color": OVAL_COASTLINE_COLOR, "line-width": 0.8, "line-opacity": 0.72 },
      },
      {
        id: "iceland-land-detail",
        type: "fill",
        source: "iceland-land-detail",
        paint: { "fill-color": OVAL_LAND_COLOR, "fill-opacity": 1 },
      },
      // Masks the coarse Natural Earth outline of Iceland before the detailed one is drawn.
      {
        id: "iceland-coastline-mask",
        type: "line",
        source: "iceland-land-detail",
        paint: { "line-color": OVAL_LAND_COLOR, "line-width": 2.6, "line-opacity": 1 },
      },
      {
        id: "iceland-coastline-detail",
        type: "line",
        source: "iceland-land-detail",
        paint: { "line-color": OVAL_ICELAND_DETAIL_COASTLINE, "line-width": 1, "line-opacity": 0.9 },
      },
      {
        id: "iceland-halo",
        type: "circle",
        source: "iceland",
        paint: { "circle-radius": 9, "circle-color": OVAL_ICELAND_HALO_COLOR, "circle-opacity": 0.92 },
      },
      {
        id: "iceland-marker",
        type: "circle",
        source: "iceland",
        paint: {
          "circle-radius": 5.5,
          "circle-color": OVAL_ICELAND_MARKER_COLOR,
          "circle-stroke-width": 1.2,
          "circle-stroke-color": OVAL_ICELAND_MARKER_STROKE,
        },
      },
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
    ],
  };
}

// ── Camera (AuroraOvalScreen.kt:185-197) ──────────────────────────────────────

/** The app's own corners: Greenland, northern Canada, Scandinavia and Iceland in one view. */
export const OVAL_CAMERA_BOUNDS: [[number, number], [number, number]] = [
  [-85, 48],
  [50, 83.5],
];
/** What the app drops to when the fit throws. */
export const OVAL_CAMERA_FALLBACK = { center: [-20, 68] as [number, number], zoom: 2.1 };

/**
 * The app pads its fit for a full-height phone screen (34/52/34/330 px, the bottom being room for
 * the info card). A dashboard card is far shorter, so the same pixel numbers would leave nothing
 * to look at. The padding is scaled to the container instead, which preserves the framing rather
 * than the pixel counts.
 */
export function ovalCameraPadding(width: number, height: number) {
  const side = Math.min(34, Math.round(width * 0.06));
  const top = Math.min(52, Math.round(height * 0.07));
  // The app leaves 330 of ~700 px, about 47%, for the card it overlays at the bottom.
  const bottom = Math.min(Math.round(height * 0.47), Math.max(0, height - top - 40));
  return { top, bottom: Math.max(0, bottom), left: side, right: side };
}

/**
 * `MapScreen.SITE_TAP_TOLERANCE_DP`. A 7 px dot is hard to hit exactly, so the click is queried
 * through a box centred on it. dp and CSS px are both 1/160 inch at scale 1, so 24 carries across.
 */
export const SITE_TAP_TOLERANCE = 24;

// ── The info card (AuroraOvalScreen.kt:200-300, values-zh-rTW/strings.xml) ─────

export const OVAL_TITLE = "目前北半球極光帶";
export const OVAL_LOADING = "正在讀取最新極光位置…";
export const OVAL_LOAD_FAILED = "無法取得 NOAA 最新極光位置，請檢查網路後重試。";
export const OVAL_RESOLUTION_NOTE =
  "顏色直接對應 NOAA 機率 · 原始模型格點約 1° · 僅平滑顯示 · 每 10 分鐘更新";
export const OVAL_ATTRIBUTION = "極光：NOAA SWPC OVATION · 陸地：Natural Earth（公有領域）";

export const OVAL_LEGEND: { color: string; label: string }[] = [
  { color: "#3D5B78", label: "1–9% · 非常低（灰藍）" },
  { color: "#4ADE80", label: "10–29% · 綠色" },
  { color: "#FB923C", label: "30–49% · 橘色" },
  { color: "#F87171", label: "50%以上 · 紅色" },
];

/** `aurora_position_times`: 觀測 %1$s · 預測 %2$s */
export function formatOvalTimes(observation: string, forecast: string): string {
  return `觀測 ${observation} · 預測 ${forecast}`;
}

/** `aurora_position_iceland_probability`: 冰島模型機率：%1$d%% */
export function formatIcelandProbability(probability: number): string {
  return `冰島模型機率：${probability}%`;
}

/**
 * `Instant.formatOvalTime()` — "MM/dd HH:mm".
 *
 * The app formats in the device's zone, which on the trip is Iceland's; the same reasoning as the
 * weather forecast labels, so the same zone is used here rather than the reader's.
 */
export function formatOvalTime(value: string | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value.endsWith("UTC") ? value.replace(" UTC", "Z").replace(" ", "T") : value);
  if (Number.isNaN(parsed)) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Atlantic/Reykjavik",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(parsed));
  const value_ = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value_("month")}/${value_("day")} ${value_("hour")}:${value_("minute")}`;
}
