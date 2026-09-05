/**
 * The Android road map, ported.
 *
 * Read out of the app (`C:\dev\iceland-aurora`, read-only) and reproduced verbatim:
 *
 *   ui/roadinfo/RoadInfoStyleFactory.kt    the MapLibre style, layer for layer
 *   ui/roadinfo/RoadMarkerIconFactory.kt   the incident marker artwork
 *   ui/roadinfo/RoadInfoScreen.kt          camera bounds, hit testing, legend, detail card
 *
 * The app draws this with MapLibre, so the port uses MapLibre GL JS with the same style object
 * rather than reimplementing it — the layer definitions below are the app's, unchanged.
 */

/** The production artifacts our own cloud publisher writes. The browser never touches IRCA. */
export const ROAD_DATA_BASE = "https://lovemonlin.github.io/iceland-aurora-cloud";
export const ROAD_SOURCE_URLS = {
  roads: `${ROAD_DATA_BASE}/road-conditions.geojson`,
  incidents: `${ROAD_DATA_BASE}/road-incidents.geojson`,
  stations: `${ROAD_DATA_BASE}/road-stations.geojson`,
};

/** RoadInfoScreen.kt:462 — the camera is fitted to these two corners, not to the data. */
export const ICELAND_CAMERA_BOUNDS: [[number, number], [number, number]] = [
  [-24.8, 63.2],
  [-13.2, 66.7],
];
/** RoadInfoScreen.kt:464 — used only if fitting the bounds fails. */
export const ICELAND_CAMERA_FALLBACK = { center: [-18.7, 64.95] as [number, number], zoom: 5 };

// ── Palette (RoadInfoStyleFactory.kt) ─────────────────────────────────────────

export const ROAD_OCEAN = "#0B3142";
export const ROAD_LAND = "#E7E4D3";
export const ROAD_COAST = "#A8B8B8";
export const ROAD_CASING = "#17352D";

/**
 * `roadLayer`'s `line-color` match, in the app's order. Not a simplification to red/amber/green:
 * every one of these states means something different to a driver.
 */
export const ROAD_STATUS_LINE_COLORS: [string, string][] = [
  ["closed", "#E53935"],
  ["mountain_vehicles", "#8E44AD"],
  ["extremely_slippery", "#1D4ED8"],
  ["slippery", "#3B82F6"],
  ["wet_snow", "#60A5FA"],
  ["snow", "#E5E7EB"],
  ["difficult", "#F97316"],
  ["spots_of_ice", "#FACC15"],
  ["loose_gravel", "#FB923C"],
  ["weight_restriction", "#F59E0B"],
  ["fog", "#94A3B8"],
  ["unknown", "#64748B"],
  ["restriction", "#F59E0B"],
];
export const ROAD_STATUS_DEFAULT_COLOR = "#16A34A";

export const STATION_TRAFFIC_COLOR = "#0EA5E9";
export const STATION_WEATHER_COLOR = "#64748B";

// ── Status text (RoadInfoScreen.kt:474-518) ───────────────────────────────────

/**
 * The detail card's status colour. Deliberately *not* the line-colour table above — the app keeps
 * two mappings, and an accident is red in the card while its road segment keeps its own condition.
 */
export function roadStatusColor(status: string): string {
  switch (status) {
    case "closed":
    case "closure":
    case "accident":
      return "#E53935";
    case "mountain_vehicles":
      return "#8E44AD";
    case "unknown":
      return "#64748B";
    case "no_reported_restriction":
    case "easily_passable":
      return "#16A34A";
    case "station":
      return "#0EA5E9";
    default:
      return "#F59E0B";
  }
}

/** `localizedStatus()` with the app's zh-rTW strings. */
export function roadStatusLabel(status: string): string {
  switch (status) {
    case "closed":
    case "closure":
      return "封閉／無法通行";
    case "mountain_vehicles":
      return "僅限高性能越野車";
    case "extremely_slippery":
      return "極度濕滑";
    case "slippery":
      return "路面濕滑";
    case "wet_snow":
      return "濕雪";
    case "snow":
      return "積雪";
    case "difficult":
      return "行駛困難";
    case "spots_of_ice":
      return "局部結冰";
    case "loose_gravel":
    case "road_surface":
      return "碎石／路面狀況不佳";
    case "weight_restriction":
      return "重量限制";
    case "fog":
      return "濃霧";
    case "unknown":
      return "道路狀況未知";
    case "roadworks":
      return "道路施工";
    case "accident":
      return "交通事故";
    case "animals":
      return "道路有動物";
    case "warning":
      return "道路警示";
    case "station":
      return "車流與道路氣象測量站";
    case "easily_passable":
    case "no_reported_restriction":
      return "未回報通行限制";
    default:
      return "限制／注意通行";
  }
}

/** `englishStatus()`, including its fallback of un-snake-casing the raw value. */
export function roadStatusEnglish(status: string): string {
  switch (status) {
    case "closed":
    case "closure":
      return "Closed / impassable";
    case "mountain_vehicles":
      return "Mountain vehicles only";
    case "roadworks":
      return "Road works";
    case "accident":
      return "Traffic accident";
    case "animals":
      return "Animals on road";
    case "road_surface":
    case "loose_gravel":
      return "Road surface warning";
    case "unknown":
      return "Condition unknown";
    case "no_reported_restriction":
    case "easily_passable":
      return "No reported restriction";
    case "station":
      return "Road weather and traffic station";
    default: {
      const spaced = status.replace(/_/g, " ");
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }
  }
}

// ── Incident markers (RoadMarkerIconFactory.kt) ───────────────────────────────

export const MARKER_IDS = {
  ROADWORKS: "incident-roadworks",
  CLOSURE: "incident-closure",
  ACCIDENT: "incident-accident",
  ANIMALS: "incident-animals",
  ROAD_SURFACE: "incident-road-surface",
  WARNING: "incident-warning",
} as const;

export type MarkerId = (typeof MARKER_IDS)[keyof typeof MARKER_IDS];

export const ALL_MARKER_IDS: MarkerId[] = [
  MARKER_IDS.ROADWORKS,
  MARKER_IDS.CLOSURE,
  MARKER_IDS.ACCIDENT,
  MARKER_IDS.ANIMALS,
  MARKER_IDS.ROAD_SURFACE,
  MARKER_IDS.WARNING,
];

/** `incidentLayer`'s `icon-image` match on the feature's `kind`. */
export const INCIDENT_KIND_ICONS: [string, MarkerId][] = [
  ["closure", MARKER_IDS.CLOSURE],
  ["roadworks", MARKER_IDS.ROADWORKS],
  ["accident", MARKER_IDS.ACCIDENT],
  ["animals", MARKER_IDS.ANIMALS],
  ["road_surface", MARKER_IDS.ROAD_SURFACE],
];

export function incidentIconId(kind: string): MarkerId {
  return INCIDENT_KIND_ICONS.find(([key]) => key === kind)?.[1] ?? MARKER_IDS.WARNING;
}

const MARKER_SIZE = 56;
const DARK = "#111827"; // rgb(17, 24, 39)
const AMBER = "#FACC15"; // rgb(250, 204, 21)
const RED = "#DC2626"; // rgb(220, 38, 38)

function strokeStyle(context: CanvasRenderingContext2D, color: string, width: number) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
}

function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function disc(context: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

type Symbol = (context: CanvasRenderingContext2D, color: string) => void;

function warningSign(context: CanvasRenderingContext2D, symbol: Symbol) {
  context.beginPath();
  context.moveTo(28, 3);
  context.lineTo(54, 52);
  context.lineTo(2, 52);
  context.closePath();
  context.fillStyle = AMBER;
  context.fill();
  strokeStyle(context, DARK, 4);
  context.stroke();
  strokeStyle(context, DARK, 4);
  symbol(context, DARK);
}

function closureSign(context: CanvasRenderingContext2D) {
  disc(context, 28, 28, 24, "#FFFFFF");
  disc(context, 28, 28, 22, RED);
  context.fillStyle = "#FFFFFF";
  context.beginPath();
  // RectF(11, 23, 45, 33) with 4px corners.
  context.roundRect(11, 23, 34, 10, 4);
  context.fill();
  strokeStyle(context, DARK, 3);
  context.beginPath();
  context.arc(28, 28, 24, 0, Math.PI * 2);
  context.stroke();
}

function diamondSign(context: CanvasRenderingContext2D, color: string, symbol: Symbol) {
  context.beginPath();
  context.moveTo(28, 2);
  context.lineTo(54, 28);
  context.lineTo(28, 54);
  context.lineTo(2, 28);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  strokeStyle(context, DARK, 4);
  context.stroke();
  const symbolColor = color === RED ? "#FFFFFF" : DARK;
  strokeStyle(context, symbolColor, 4);
  symbol(context, symbolColor);
}

const drawRoadworks: Symbol = (context, color) => {
  disc(context, 27, 20, 4, color);
  line(context, 27, 24, 22, 36);
  line(context, 25, 27, 37, 31);
  line(context, 22, 36, 16, 43);
  line(context, 22, 36, 31, 43);
  strokeStyle(context, color, 3);
  line(context, 37, 27, 37, 43);
};

const drawCross: Symbol = (context) => {
  line(context, 17, 17, 39, 39);
  line(context, 39, 17, 17, 39);
};

const drawAnimal: Symbol = (context, color) => {
  context.fillStyle = color;
  context.beginPath();
  // RectF(15, 21, 38, 35) as an oval.
  context.ellipse(26.5, 28, 11.5, 7, 0, 0, Math.PI * 2);
  context.fill();
  disc(context, 41, 23, 5, color);
  line(context, 19, 33, 17, 43);
  line(context, 34, 33, 37, 43);
  strokeStyle(context, color, 2.5);
  line(context, 43, 19, 47, 15);
};

const drawUnevenRoad: Symbol = (context) => {
  context.beginPath();
  context.moveTo(12, 39);
  context.bezierCurveTo(18, 39, 18, 28, 24, 28);
  context.bezierCurveTo(31, 28, 31, 39, 44, 39);
  context.stroke();
};

const drawExclamation: Symbol = (context, color) => {
  strokeStyle(context, color, 6);
  line(context, 28, 17, 28, 34);
  disc(context, 28, 42, 3, color);
};

/** Renders one marker at the app's 56x56, optionally at a device-pixel multiple. */
export function drawMarker(id: MarkerId, pixelRatio = 1): ImageData | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = MARKER_SIZE * pixelRatio;
  canvas.height = MARKER_SIZE * pixelRatio;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(pixelRatio, pixelRatio);

  switch (id) {
    case MARKER_IDS.ROADWORKS:
      warningSign(context, drawRoadworks);
      break;
    case MARKER_IDS.CLOSURE:
      closureSign(context);
      break;
    case MARKER_IDS.ACCIDENT:
      diamondSign(context, RED, drawCross);
      break;
    case MARKER_IDS.ANIMALS:
      diamondSign(context, AMBER, drawAnimal);
      break;
    case MARKER_IDS.ROAD_SURFACE:
      warningSign(context, drawUnevenRoad);
      break;
    default:
      warningSign(context, drawExclamation);
      break;
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// ── Style (RoadInfoStyleFactory.kt:14-175) ────────────────────────────────────

const zoomInterpolate = (fromZoom: number, from: number, toZoom: number, to: number) => [
  "interpolate",
  ["linear"],
  ["zoom"],
  fromZoom,
  from,
  toZoom,
  to,
];

/**
 * The app's style object, layer for layer and value for value.
 *
 * One deliberate omission: the app's `station-labels` symbol layer is not here. MapLibre GL JS
 * renders symbol text from a glyphs endpoint, which would be an external font dependency the app
 * does not have (it ships fonts in the APK). The labels are drawn as DOM overlays instead, with
 * the same content, size, colour, halo, offset and minzoom — see RoadMap.tsx.
 */
export function buildRoadStyle(outlineUrl: string) {
  return {
    version: 8 as const,
    name: "IRCA road information",
    sources: {
      iceland: { type: "geojson" as const, data: outlineUrl },
      roads: { type: "geojson" as const, data: ROAD_SOURCE_URLS.roads },
      incidents: { type: "geojson" as const, data: ROAD_SOURCE_URLS.incidents },
      stations: { type: "geojson" as const, data: ROAD_SOURCE_URLS.stations },
    },
    layers: [
      { id: "ocean", type: "background" as const, paint: { "background-color": ROAD_OCEAN } },
      { id: "land", type: "fill" as const, source: "iceland", paint: { "fill-color": ROAD_LAND } },
      {
        id: "coast",
        type: "line" as const,
        source: "iceland",
        paint: { "line-color": ROAD_COAST, "line-width": 1 },
      },
      {
        id: "road-casing",
        type: "line" as const,
        source: "roads",
        layout: { "line-cap": "round" as const, "line-join": "round" as const, visibility: "visible" as const },
        paint: {
          "line-color": ROAD_CASING,
          "line-width": zoomInterpolate(4, 2.8, 9, 7.0),
          "line-opacity": 0.82,
        },
      },
      {
        id: "road-lines",
        type: "line" as const,
        source: "roads",
        layout: { "line-cap": "round" as const, "line-join": "round" as const, visibility: "visible" as const },
        paint: {
          "line-color": [
            "match",
            ["get", "status"],
            ...ROAD_STATUS_LINE_COLORS.flat(),
            ROAD_STATUS_DEFAULT_COLOR,
          ],
          "line-width": zoomInterpolate(4, 1.7, 9, 5.2),
        },
      },
      {
        id: "incident-markers",
        type: "symbol" as const,
        source: "incidents",
        layout: {
          visibility: "visible" as const,
          "icon-image": [
            "match",
            ["get", "kind"],
            ...INCIDENT_KIND_ICONS.flat(),
            MARKER_IDS.WARNING,
          ],
          "icon-size": zoomInterpolate(4, 1.0, 9, 1.5),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
      {
        id: "station-markers",
        type: "circle" as const,
        source: "stations",
        layout: { visibility: "visible" as const },
        paint: {
          "circle-color": ["case", ["get", "has_traffic"], STATION_TRAFFIC_COLOR, STATION_WEATHER_COLOR],
          "circle-radius": zoomInterpolate(4, 4, 9, 7),
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 1.5,
        },
      },
    ],
  };
}

/** `station-labels` in the app: minzoom 7, 11px, top-left anchored, offset [0.65, 0.15] em. */
export const STATION_LABEL = {
  minZoom: 7,
  fontSize: 11,
  color: "#0F172A",
  haloColor: "#FFFFFF",
  haloWidth: 1.4,
  offsetEm: { x: 0.65, y: 0.15 },
};

/** RoadInfoScreen.kt:423 — a 16px box around the tap, queried incident → station → road. */
export const ROAD_TAP_TOLERANCE = 16;
export const ROAD_QUERY_ORDER = ["incident-markers", "station-markers", "road-lines"] as const;

/** The properties the app reads off a clicked feature, in RoadInfoItem order. */
export interface RoadFeatureItem {
  id: string;
  type: "ROAD" | "INCIDENT" | "STATION";
  status: string;
  name: string;
  roadNumber: string;
  titleEnglish: string;
  descriptionEnglish: string;
  descriptionIcelandic: string;
  updatedAt: string;
  startsAt: string;
  endsAt: string;
  temperature: string;
  roadTemperature: string;
  windSpeed: string;
  windGust: string;
  windDirection: string;
  humidity: string;
  trafficRecent: string;
  trafficToday: string;
}

export function readFeature(
  properties: Record<string, unknown>,
  type: RoadFeatureItem["type"],
): RoadFeatureItem {
  const text = (key: string) => {
    const value = properties[key];
    return value === undefined || value === null ? "" : String(value);
  };
  return {
    id: text("id"),
    type,
    status: type === "INCIDENT" ? text("kind") : type === "STATION" ? "station" : text("status"),
    name: text("name"),
    roadNumber: text("road_number"),
    titleEnglish: text("title_en"),
    descriptionEnglish: text("description_en"),
    descriptionIcelandic: text("description_is"),
    updatedAt: text("updated_at"),
    startsAt: text("started_at"),
    endsAt: text("ends_at"),
    temperature: text("temperature"),
    roadTemperature: text("road_temperature"),
    windSpeed: text("wind_speed"),
    windGust: text("wind_gust"),
    windDirection: text("wind_direction"),
    humidity: text("humidity"),
    trafficRecent: text("traffic_recent"),
    trafficToday: text("traffic_today"),
  };
}

/** `RoadInfoItem.displayTitle()`. */
export function roadDisplayTitle(item: RoadFeatureItem): string {
  if (item.type === "STATION") return item.name || "車流與道路氣象測量站";
  if (item.type === "INCIDENT") return roadStatusLabel(item.status);
  if (item.name && item.roadNumber) return `${item.name} · ${item.roadNumber} 號道路`;
  if (item.name) return item.name;
  if (item.roadNumber) return `${item.roadNumber} 號道路`;
  return "道路區段";
}

/**
 * The app's two road screens (RoadInfoScreen.kt:146, MainActivity.kt:367-380).
 *
 * Both always draw the road conditions; they differ in what is laid over them. The app reaches
 * them as two separate destinations from its menu, and the dashboard offers the same choice as a
 * toggle inside the one expanded map.
 */
export type RoadInfoMode = "EVENTS" | "STATIONS";

export const ROAD_MODES: { mode: RoadInfoMode; label: string }[] = [
  { mode: "EVENTS", label: "道路狀況＋封路與施工" },
  { mode: "STATIONS", label: "道路狀況＋車流與氣象" },
];

/** RoadInfoScreen.kt:120-124 — roads are always on; the overlay is what the mode selects. */
export function roadLayerVisibility(mode: RoadInfoMode) {
  return {
    showRoads: true,
    showIncidents: mode === "EVENTS",
    showStations: mode === "STATIONS",
  };
}

/** RoadInfoScreen.kt:207-216 — the legend rows, in the app's order. */
export const ROAD_LEGEND: { color: string; label: string }[] = [
  { color: "#16A34A", label: "未回報通行限制" },
  { color: "#E53935", label: "封閉／無法通行" },
  { color: "#8E44AD", label: "僅限高性能越野車" },
];

/** The app adds these two rows, plus a marker sample, only on the events screen. */
export const EVENT_LEGEND: { color: string; label: string }[] = [
  { color: "#F59E0B", label: "限制／注意通行" },
  { color: "#64748B", label: "道路狀況未知" },
];

export const STATION_LEGEND: { color: string; label: string }[] = [
  { color: STATION_TRAFFIC_COLOR, label: "藍色站點：氣象資料與車流計數器" },
  { color: STATION_WEATHER_COLOR, label: "灰色站點：僅有氣象資料" },
];

export const ROAD_ATTRIBUTION =
  "資料來源：冰島道路暨海岸管理局（IRCA）。實際通行仍應遵循現場標誌及官方封路指示。";
