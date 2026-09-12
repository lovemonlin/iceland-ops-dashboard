/**
 * Schematic travel-area shapes from the app's IcelandTravelRegionMap.
 * Editorial boxes clipped to a simplified Natural Earth coastline — not admin borders.
 */

export const BRIEFING_MAP_WIDTH = 1000;
export const BRIEFING_MAP_HEIGHT = 620;

const MIN_LON = -24.6;
const MAX_LON = -13.3;
const MIN_LAT = 63.3;
const MAX_LAT = 66.6;

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

/** Draw later regions on top where the editorial boxes overlap. */
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
    [-24.8, 64.85],
    [-21.65, 64.85],
    [-21.45, 66.65],
    [-24.8, 66.65],
  ],
  NORTHWEST: [
    [-21.65, 64.55],
    [-18.45, 64.7],
    [-18.45, 66.65],
    [-21.45, 66.65],
  ],
  NORTHEAST: [
    [-18.45, 65.05],
    [-14.7, 64.95],
    [-13.2, 66.65],
    [-18.45, 66.65],
  ],
  EASTFJORDS: [
    [-15.55, 64.25],
    [-13.2, 64.2],
    [-13.2, 65.75],
    [-14.7, 64.95],
  ],
  SOUTHEAST: [
    [-19.1, 63.2],
    [-13.2, 63.2],
    [-13.2, 64.35],
    [-15.55, 64.25],
    [-17.2, 64.65],
  ],
  SOUTHWEST: [
    [-23.1, 63.2],
    [-23.1, 64.7],
    [-21.45, 64.7],
    [-20.35, 64.35],
    [-18.6, 63.2],
  ],
  SNAEFELLSNES: [
    [-24.1, 64.55],
    [-21.45, 64.55],
    [-21.45, 65.2],
    [-24.1, 65.2],
  ],
};

const REGION_LABEL_AT: Record<BriefingMapRegionId, LonLat> = {
  SOUTHWEST: [-20.9, 64.12],
  SOUTHEAST: [-16.4, 64.12],
  EASTFJORDS: [-14.35, 64.95],
  NORTHEAST: [-16.7, 65.75],
  NORTHWEST: [-20.35, 65.55],
  WESTFJORDS: [-23.15, 65.85],
  SNAEFELLSNES: [-23.05, 64.88],
};

const ICELAND_MAIN_ISLAND: LonLat[] = [
  [-14.563629, 66.384508],
  [-14.898061, 66.03559],
  [-14.788197, 65.796047],
  [-14.506174, 65.538031],
  [-13.685292, 65.555162],
  [-13.855458, 65.30683],
  [-13.681549, 65.15176],
  [-13.589589, 65.042304],
  [-13.867909, 64.978217],
  [-14.01769, 64.764838],
  [-14.274322, 64.651435],
  [-14.511667, 64.453111],
  [-14.899485, 64.33393],
  [-15.17927, 64.287909],
  [-15.422109, 64.385199],
  [-15.733022, 64.179267],
  [-16.501332, 63.897366],
  [-16.901967, 63.801703],
  [-16.97704, 63.888821],
  [-17.59557, 63.759467],
  [-17.967356, 63.6765],
  [-18.228139, 63.493232],
  [-19.055653, 63.414374],
  [-20.068959, 63.552883],
  [-20.468658, 63.677151],
  [-20.562408, 63.756822],
  [-20.695139, 63.857978],
  [-21.222035, 63.898871],
  [-22.535878, 63.821194],
  [-22.716461, 64.032294],
  [-22.040679, 64.051093],
  [-21.852447, 64.147691],
  [-21.875111, 64.238105],
  [-21.448883, 64.395331],
  [-21.995717, 64.384996],
  [-21.60558, 64.589342],
  [-21.750478, 64.607733],
  [-22.214589, 64.484931],
  [-22.418324, 64.647895],
  [-22.332428, 64.744859],
  [-22.651235, 64.791571],
  [-23.67394, 64.741116],
  [-23.381093, 64.953111],
  [-23.139516, 64.971869],
  [-22.695872, 65.062323],
  [-22.120432, 65.041897],
  [-22.420725, 65.160224],
  [-21.990387, 65.393622],
  [-22.109039, 65.511623],
  [-22.276438, 65.530707],
  [-22.546539, 65.560736],
  [-22.785227, 65.508002],
  [-23.128651, 65.54975],
  [-23.66804, 65.456977],
  [-24.335032, 65.62637],
  [-23.881215, 65.648098],
  [-23.401438, 65.649482],
  [-23.319244, 65.757025],
  [-23.6551, 65.942572],
  [-23.48412, 66.12759],
  [-22.983754, 66.059516],
  [-22.848622, 65.986151],
  [-22.635162, 65.835273],
  [-22.392649, 65.948065],
  [-22.593414, 66.234198],
  [-22.682118, 66.323635],
  [-23.053049, 66.393541],
  [-22.613881, 66.46015],
  [-22.187123, 66.279486],
  [-21.749867, 66.185777],
  [-21.548818, 66.097642],
  [-21.28718, 65.915839],
  [-21.695302, 65.748236],
  [-21.375885, 65.462877],
  [-21.079986, 65.21015],
  [-20.983306, 65.521674],
  [-20.608957, 65.590969],
  [-20.465972, 65.583157],
  [-20.339101, 65.830146],
  [-20.054351, 66.089789],
  [-19.67276, 65.823228],
  [-19.510854, 65.96015],
  [-19.086252, 66.088284],
  [-18.629058, 66.138617],
  [-18.233998, 65.872219],
  [-18.097768, 65.782375],
  [-18.28954, 66.021918],
  [-17.672963, 66.007066],
  [-17.364654, 66.049262],
  [-16.910268, 66.112006],
  [-16.508168, 66.199449],
  [-16.480824, 66.350287],
  [-16.43102, 66.491604],
  [-16.0808, 66.525946],
  [-15.744862, 66.299547],
  [-15.340443, 66.182196],
  [-14.563629, 66.384508],
];

export function projectBriefingMap(lon: number, lat: number) {
  const x = (0.03 + ((lon - MIN_LON) / (MAX_LON - MIN_LON)) * 0.94) * BRIEFING_MAP_WIDTH;
  const y = (0.08 + ((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * 0.84) * BRIEFING_MAP_HEIGHT;
  return { x, y };
}

function svgPath(ring: LonLat[]) {
  return ring
    .map(([lon, lat], index) => {
      const { x, y } = projectBriefingMap(lon, lat);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ")
    .concat(" Z");
}

export const BRIEFING_MAP_LAND_PATH = svgPath(ICELAND_MAIN_ISLAND);

export const BRIEFING_MAP_SHAPES = REGION_DRAW_ORDER.map((region) => ({
  region,
  label: BRIEFING_MAP_REGION_LABEL[region],
  path: svgPath(REGION_RINGS[region]),
  labelAt: projectBriefingMap(...REGION_LABEL_AT[region]),
}));
