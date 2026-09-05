/**
 * The Android aurora gauges, ported.
 *
 * Read out of the app (`C:\dev\iceland-aurora`, read-only) and reproduced verbatim:
 *
 *   ui/home/AuroraGaugeSpecs.kt   ranges, zones, value formats, status thresholds
 *   ui/home/GaugeDial.kt          the 270° dial geometry, segments, ticks, needle, readout
 *   ui/theme/Theme.kt             AuroraColors and AuroraGaugeColors
 *   ui/home/HomeScreen.kt         which gauge reads which field, and in what order
 *
 * Thresholds are the app's judgement calls for travellers, not an independent forecast model,
 * and they are not re-derived here.
 */

export interface GaugeZone {
  upTo: number;
  color: string;
}

/** AuroraColors (Theme.kt:72-76). */
const EXCELLENT = "#4ADE80";
const FAIR = "#FDE047";
const POOR = "#FB923C";

/** GaugeDial.kt's private palette (lines 114-118). */
const DEEP_ORANGE = "#F97316";
const ORANGE = "#FB923C";
const YELLOW = "#FDE047";
const GREEN = "#4ADE80";
const COOL_GREEN = "#2DD4BF";

/** AuroraGaugeColors (Theme.kt:95-125) — the instrument chrome. */
export const GAUGE_COLORS = {
  needle: "#83B8FF",
  needleBase: "#B9D9EE",
  needleHighlight: "#EAF4FF",
  needleGlow: "rgba(118, 229, 255, 0.14)",
  needleMuted: "#4B5568",
  hubOuterMetal: "#26354B",
  hubInnerMetal: "#0A1220",
  hubSensor: "#72E7F2",
  outerMetalDark: "#111A29",
  outerMetalHighlight: "#40516A",
  innerMetalShadow: "#07101D",
  majorTick: "rgba(120, 150, 194, 0.8)",
  minorTick: "rgba(120, 150, 194, 0.24)",
  innerRing: "rgba(108, 141, 186, 0.30)",
  crosshair: "rgba(111, 146, 194, 0.32)",
  radarCenter: "#101C30",
  radarEdge: "#070D17",
  readoutValue: "#F4F8FF",
  readoutLabel: "#91A9CC",
  glassPanelTop: "#182940",
  glassPanelBottom: "#0A1424",
  glassPanelBorder: "#76DDEB",
  boundaryMarker: "rgba(253, 230, 138, 0.72)",
  statusBackground: "#08111F",
};

/** AuroraGaugeStyle (GaugeDial.kt:58-108), the values the dial's geometry is built from. */
export const GAUGE_STYLE = {
  ringWidth: 0.105,
  outerRingWidth: 1.92,
  metalRingWidth: 1.62,
  recessedRingWidth: 1.34,
  radarRecessWidth: 0.21,
  innerRingWidth: 0.09,
  segmentCount: 24,
  segmentGap: 2.4,
  segmentWidth: 0.68,
  segmentCoreWidth: 0.43,
  activeSegmentWidth: 0.52,
  boundaryMarkerWidth: 0.075,
  tickOuterOffset: 1.0,
  majorTickLength: 0.54,
  minorTickLength: 0.31,
  radarGridAlpha: 0.1,
  crosshairAlpha: 0.15,
};

/** GaugeDial.kt:789-790 — 270° open at the bottom, drawn clockwise from 135°. */
export const GAUGE_START_ANGLE = 135;
export const GAUGE_SWEEP_ANGLE = 270;

/** `List<GaugeZone>.colorFor` (GaugeDial.kt:117-122): the first zone the value does not exceed. */
export function zoneColorFor(zones: GaugeZone[], value: number): string {
  for (const zone of zones) {
    if (value <= zone.upTo) return zone.color;
  }
  return zones[zones.length - 1]?.color ?? "#808080";
}

/** GaugeDial.kt:793-796 — where a value sits on the arc. */
export function gaugeAngle(value: number, range: { start: number; end: number }): number {
  const span = range.end - range.start || 1;
  const normalized = Math.min(1, Math.max(0, (value - range.start) / span));
  return GAUGE_START_ANGLE + normalized * GAUGE_SWEEP_ANGLE;
}

export interface GaugeSpec {
  key: string;
  /** The snapshot field this dial reads. */
  label: string;
  range: { start: number; end: number };
  zones: GaugeZone[];
  format: (value: number | undefined) => string;
  status?: (value: number | undefined) => string | undefined;
  /** Bz alone marks its zero crossing (GaugeDial.kt:422-446). */
  emphasizedBoundary?: number;
}

/** Kp 0–9, aligned to the NOAA G-scale (G1 storm = Kp 5). */
const kpRange = { start: 0, end: 9 };
const kpGaugeZones: GaugeZone[] = [
  { upTo: 4, color: EXCELLENT },
  { upTo: 5, color: FAIR },
  { upTo: 9, color: POOR },
];

/** Bz runs negative to positive; more negative is more favourable, so the warm end is the left. */
const bzRange = { start: -20, end: 20 };
const bzZones: GaugeZone[] = [
  { upTo: -10, color: DEEP_ORANGE },
  { upTo: -5, color: ORANGE },
  { upTo: 0, color: YELLOW },
  { upTo: 5, color: GREEN },
  { upTo: 20, color: COOL_GREEN },
];

const btRange = { start: 0, end: 20 };
const btZones: GaugeZone[] = [
  { upTo: 5, color: GREEN },
  { upTo: 10, color: YELLOW },
  { upTo: 15, color: ORANGE },
  { upTo: 20, color: DEEP_ORANGE },
];

const speedRange = { start: 250, end: 800 };
const speedZones: GaugeZone[] = [
  { upTo: 400, color: GREEN },
  { upTo: 500, color: YELLOW },
  { upTo: 650, color: ORANGE },
  { upTo: 800, color: DEEP_ORANGE },
];

const NO_VALUE = "—";
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** AuroraGaugeSpecs.kt:67-80 — the exact value formats the app prints. */
export const formatKp = (value?: number) => (value === undefined ? NO_VALUE : value.toFixed(2));
export const formatBz = (value?: number) =>
  value === undefined ? NO_VALUE : `${value > 0 ? "+" : value < 0 ? "-" : "+"}${Math.abs(value).toFixed(1)}`;
export const formatBt = (value?: number) => (value === undefined ? NO_VALUE : value.toFixed(1));
export const formatSpeed = (value?: number) => (value === undefined ? NO_VALUE : String(Math.trunc(value)));

/** AuroraGaugeSpecs.kt:82-111 with the app's zh-rTW strings. */
export const bzStatus = (value?: number) => {
  if (value === undefined) return undefined;
  if (value <= -10) return "很有利";
  if (value <= -5) return "有利";
  if (value < 0) return "稍有利";
  if (value < 5) return "偏不利";
  return "不利";
};

export const btStatus = (value?: number) => {
  if (value === undefined) return undefined;
  if (value < 5) return "偏弱";
  if (value < 10) return "普通";
  if (value < 15) return "偏強";
  return "強";
};

export const speedStatus = (value?: number) => {
  if (value === undefined) return undefined;
  if (value < 400) return "偏低";
  if (value < 500) return "中等";
  if (value < 650) return "偏高";
  return "高";
};

export const GAUGE_SPECS: GaugeSpec[] = [
  { key: "kp", label: "Kp（估算）", range: kpRange, zones: kpGaugeZones, format: formatKp },
  { key: "bz", label: "Bz（nT）", range: bzRange, zones: bzZones, format: formatBz, status: bzStatus, emphasizedBoundary: 0 },
  { key: "bt", label: "Bt（nT）", range: btRange, zones: btZones, format: formatBt, status: btStatus },
  { key: "speed", label: "風速（km/s）", range: speedRange, zones: speedZones, format: formatSpeed, status: speedStatus },
];

export interface GaugeReading {
  spec: GaugeSpec;
  value?: number;
}

/**
 * Pulls the four readings out of the snapshot the dashboard already publishes.
 *
 * The app has a fifth dial, 功率（GW）, fed by SWPC's `aurora-nowcast-hemi-power.txt`. This
 * dashboard does not monitor that endpoint, and adding it would change a production monitor's
 * output, so that dial is absent rather than filled with anything invented.
 */
export function readGauges(
  kpData: Record<string, unknown>,
  windData: Record<string, unknown>,
): GaugeReading[] {
  const values: Record<string, number | undefined> = {
    kp: number(kpData.kp),
    bz: number(windData.bzNt),
    bt: number(windData.btNt),
    speed: number(windData.speedKms),
  };
  return GAUGE_SPECS.map((spec) => ({ spec, value: values[spec.key] }));
}
