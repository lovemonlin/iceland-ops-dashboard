/**
 * Schematic travel-area shapes clipped to a rounded Natural Earth coastline.
 * Region edges are editorial, not admin borders.
 */

import icelandCoastRing from "./icelandCoastRing.json";

export const BRIEFING_MAP_WIDTH = 1000;
export const BRIEFING_MAP_HEIGHT = 700;

const MIN_LON = -24.55;
const MAX_LON = -13.25;
const MIN_LAT = 63.28;
const MAX_LAT = 66.58;
const MID_LAT = (MIN_LAT + MAX_LAT) / 2;
const LON_SCALE = Math.cos((MID_LAT * Math.PI) / 180);
const SPAN_LON = (MAX_LON - MIN_LON) * LON_SCALE;
const SPAN_LAT = MAX_LAT - MIN_LAT;
const PAD_X = 0.045;
const PAD_Y = 0.05;
const INNER_W = 1 - PAD_X * 2;
const INNER_H = INNER_W * (SPAN_LAT / SPAN_LON) * (BRIEFING_MAP_WIDTH / BRIEFING_MAP_HEIGHT);

type LonLat = readonly [number, number];

export const BRIEFING_MAP_REGIONS = [
  "SOUTHWEST",
  "SOUTHEAST",
  "EASTFJORDS",
  "NORTHEAST",
  "NORTHWEST",
  "WESTFJORDS",
  "SNAEFELLSNES",
] as const;
export type BriefingMapRegionId = (typeof BRIEFING_MAP_REGIONS)[number];

export const BRIEFING_MAP_REGION_LABEL: Record<BriefingMapRegionId, string> = {
  SOUTHWEST: "西南部",
  SOUTHEAST: "東南部",
  EASTFJORDS: "東峽灣",
  NORTHEAST: "東北部",
  NORTHWEST: "西北部",
  WESTFJORDS: "西峽灣",
  SNAEFELLSNES: "斯奈山半島",
};

/** Draw later regions on top where the editorial shapes overlap. */
const REGION_DRAW_ORDER: BriefingMapRegionId[] = [
  "SOUTHEAST",
  "SOUTHWEST",
  "EASTFJORDS",
  "NORTHEAST",
  "NORTHWEST",
  "WESTFJORDS",
  "SNAEFELLSNES",
];

const REGION_RINGS: Record<BriefingMapRegionId, LonLat[]> = {
  WESTFJORDS: [
    [-24.95, 66.58],
    [-23.85, 66.62],
    [-22.55, 66.52],
    [-21.55, 66.22],
    [-21.28, 65.72],
    [-21.48, 65.32],
    [-22.15, 65.18],
    [-23.35, 65.22],
    [-24.55, 65.38],
    [-24.95, 65.78],
  ],
  NORTHWEST: [
    [-21.48, 65.32],
    [-21.28, 65.72],
    [-21.55, 66.22],
    [-20.35, 66.38],
    [-19.05, 66.32],
    [-18.45, 65.85],
    [-18.35, 65.35],
    [-18.55, 64.85],
    [-19.55, 64.55],
    [-20.55, 64.48],
    [-21.45, 64.68],
  ],
  NORTHEAST: [
    [-19.05, 66.32],
    [-17.55, 66.55],
    [-15.85, 66.58],
    [-14.55, 66.42],
    [-14.25, 65.75],
    [-14.85, 65.35],
    [-15.85, 65.12],
    [-16.85, 64.98],
    [-17.85, 64.88],
    [-18.55, 64.85],
    [-18.35, 65.35],
    [-18.45, 65.85],
  ],
  EASTFJORDS: [
    [-16.85, 64.98],
    [-15.85, 65.12],
    [-14.85, 65.35],
    [-14.25, 65.75],
    [-13.35, 65.42],
    [-13.15, 64.72],
    [-13.35, 64.22],
    [-14.55, 64.02],
    [-15.45, 64.22],
    [-16.15, 64.52],
    [-16.65, 64.78],
  ],
  SOUTHEAST: [
    [-18.55, 64.85],
    [-17.85, 64.88],
    [-16.85, 64.98],
    [-16.65, 64.78],
    [-16.15, 64.52],
    [-15.45, 64.22],
    [-14.55, 64.02],
    [-15.35, 63.28],
    [-17.15, 63.28],
    [-18.55, 63.38],
    [-19.05, 64.12],
  ],
  SOUTHWEST: [
    [-21.45, 64.68],
    [-20.55, 64.48],
    [-19.55, 64.55],
    [-18.55, 64.85],
    [-19.05, 64.12],
    [-18.55, 63.38],
    [-20.25, 63.32],
    [-22.55, 63.72],
    [-23.05, 64.08],
    [-22.25, 64.48],
  ],
  SNAEFELLSNES: [
    [-24.35, 65.16],
    [-23.35, 65.22],
    [-22.15, 65.18],
    [-21.48, 65.32],
    [-21.42, 64.78],
    [-22.05, 64.48],
    [-23.45, 64.52],
    [-24.35, 64.78],
  ],
};

const REGION_LABEL_AT: Record<BriefingMapRegionId, LonLat> = {
  SOUTHWEST: [-20.85, 64.08],
  SOUTHEAST: [-16.55, 64.12],
  EASTFJORDS: [-14.42, 64.92],
  NORTHEAST: [-16.55, 65.82],
  NORTHWEST: [-20.15, 65.48],
  WESTFJORDS: [-23.05, 65.78],
  SNAEFELLSNES: [-23.15, 64.88],
};

export function projectBriefingMap(lon: number, lat: number) {
  const x = (PAD_X + ((lon - MIN_LON) * LON_SCALE) / SPAN_LON * INNER_W) * BRIEFING_MAP_WIDTH;
  const y = (PAD_Y + ((MAX_LAT - lat) / SPAN_LAT) * INNER_H) * BRIEFING_MAP_HEIGHT;
  return { x, y };
}

function catmullRomPath(ring: LonLat[]) {
  const pts = ring.map(([lon, lat]) => projectBriefingMap(lon, lat));
  const count = pts.length;
  if (count === 0) return "";
  const at = (index: number) => pts[(index + count) % count];
  const parts = [`M${at(0).x.toFixed(1)} ${at(0).y.toFixed(1)}`];
  for (let index = 0; index < count; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    parts.push(
      `C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    );
  }
  return `${parts.join(" ")} Z`;
}

const coast = icelandCoastRing as LonLat[];

export const BRIEFING_MAP_LAND_PATH = catmullRomPath(coast);

export const BRIEFING_MAP_SHAPES = REGION_DRAW_ORDER.map((region) => ({
  region,
  label: BRIEFING_MAP_REGION_LABEL[region],
  path: catmullRomPath(REGION_RINGS[region]),
  labelAt: projectBriefingMap(...REGION_LABEL_AT[region]),
}));
