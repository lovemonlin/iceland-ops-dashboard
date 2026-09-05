import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { WEATHER_SITES } from "../src/config/sources";
import {
  AURORA_LAYER_ANCHOR,
  buildAuroraOvalStyle,
  buildContourBands,
  CONTOUR_BANDS,
  CONTOUR_LAT_FROM,
  CONTOUR_LAT_TO,
  CONTOUR_SUBDIVISIONS,
  formatIcelandProbability,
  formatOvalTimes,
  GRATICULE_LATITUDES,
  GRATICULE_LONGITUDES,
  OVAL_CAMERA_BOUNDS,
  OVAL_CAMERA_FALLBACK,
  ovalCameraPadding,
  SITE_TAP_TOLERANCE,
} from "../src/lib/auroraOval";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import {
  decodeOvationGrid,
  encodeOvationGrid,
  ICELAND_LAT,
  ICELAND_LON,
  icelandProbability,
  OVATION_GRID_LAT_FROM,
  OVATION_GRID_LAT_TO,
  OVATION_GRID_LON_FROM,
  OVATION_GRID_LON_TO,
  type OvationGrid,
} from "../src/lib/ovationGrid";
import { checkOvation } from "../src/monitors/noaa/monitor";
import { mergeSource } from "../src/snapshot/mergeSnapshot";
import { serializeSnapshot } from "../src/snapshot/serializeSnapshot";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ANDROID = "../iceland-aurora/app/src/main/java/com/iceland/aurora";
const androidFile = (path: string) => resolve(process.cwd(), `${ANDROID}/${path}`);
const hasAndroid = existsSync(androidFile("ui/auroraoval/AuroraProbabilityContours.kt"));
const readAndroid = (path: string) => readFileSync(androidFile(path), "utf8");

const NOW = new Date("2026-09-04T09:00:00Z");

/** NOAA publishes `[longitude 0..359, latitude -90..90, probability]`. */
function ovationResponse(cells: [number, number, number][] = [[341, 65, 42]]) {
  return {
    "Observation Time": "2026-09-04T08:55:00Z",
    "Forecast Time": "2026-09-04T09:25:00Z",
    coordinates: cells,
  };
}

const stub = (calls: string[], body: unknown = ovationResponse()): DiagnosticFetcher => (url, options) =>
  fetchWithDiagnosticsCore(url, {
    ...options,
    fetch: async (target) => {
      calls.push(target);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

/** A grid built directly from cell values, for the contour tests. */
function gridOf(cells: [number, number, number][]): OvationGrid {
  return decodeOvationGrid(encodeOvationGrid(cells))!;
}

/** Every coordinate in a band, flattened. */
function coordinatesOf(band: { geoJson: { features: { geometry: { coordinates: [number, number][][][] } }[] } }) {
  return band.geoJson.features.flatMap((feature) => feature.geometry.coordinates.flat(2));
}

// ── 1, 2: the OVATION collection is unchanged ─────────────────────────────────

test("the aurora grid costs no extra NOAA request", async () => {
  const calls: string[] = [];
  await checkOvation({ now: NOW, request: stub(calls) });
  assert.equal(calls.length, 1, "OVATION is still one request");
  assert.equal(new Set(calls).size, 1);
  assert.match(calls[0], /ovation_aurora_latest\.json$/);
});

test("the existing OVATION summary fields are untouched", async () => {
  const cells: [number, number, number][] = [
    [341, 65, 42],
    [341, 63, 7],
    [10, 30, 90],
  ];
  const health = await checkOvation({ now: NOW, request: stub([], ovationResponse(cells)) });
  const data = health.data!;

  assert.equal(data.gridCells, 3);
  assert.equal(data.observationTime, "2026-09-04 08:55 UTC");
  assert.equal(data.forecastTime, "2026-09-04 09:25 UTC");
  // 63 and 65 are Iceland latitudes; 30 is not.
  assert.equal(data.icelandLatitudeCells, 2);
  assert.equal(data.icelandPeakProbabilityPercent, 42);
  assert.equal(health.status, "ok");
  assert.equal(health.dataTime, "2026-09-04T08:55:00.000Z");
  assert.equal(health.provenance?.mode, "production");
  assert.equal(health.recordCount, 3);
});

// ── 3, 4, 5: the compact grid ────────────────────────────────────────────────

test("the grid encodes row-major and decodes back to the same cells", () => {
  const cells: [number, number, number][] = [
    [0, 45, 11], // first row, longitude 0
    [341, 65, 42], // Iceland's column, -19
    [180, 85, 3], // the -180 column, last row
    [359, 45, 7], // -1
  ];
  const payload = encodeOvationGrid(cells);

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.latFrom, OVATION_GRID_LAT_FROM);
  assert.equal(payload.latTo, OVATION_GRID_LAT_TO);
  assert.equal(payload.lonFrom, OVATION_GRID_LON_FROM);
  assert.equal(payload.lonTo, OVATION_GRID_LON_TO);
  assert.equal(payload.latStep, 1);
  assert.equal(payload.lonStep, 1);

  const rows = OVATION_GRID_LAT_TO - OVATION_GRID_LAT_FROM + 1;
  const columns = OVATION_GRID_LON_TO - OVATION_GRID_LON_FROM + 1;
  assert.equal(rows, 41);
  assert.equal(columns, 360);
  assert.equal(payload.values.length, rows * columns);
  assert.equal(payload.values.every((value) => typeof value === "number"), true, "values stay primitive");

  // Row-major: latitude outer, longitude inner.
  const at = (lat: number, lon: number) => payload.values[(lat - payload.latFrom) * columns + (lon - payload.lonFrom)];
  assert.equal(at(45, 0), 11);
  assert.equal(at(65, -19), 42);
  assert.equal(at(85, -180), 3);
  assert.equal(at(45, -1), 7);

  // And the decoder answers the same, addressed either way round the globe.
  const grid = decodeOvationGrid(payload)!;
  assert.equal(grid.probabilityAt(45, 0), 11);
  assert.equal(grid.probabilityAt(65, -19), 42);
  assert.equal(grid.probabilityAt(65, 341), 42, "NOAA's own 0..359 longitude addresses the same cell");
  assert.equal(grid.probabilityAt(85, -180), 3);
  assert.equal(grid.probabilityAt(85, 180), 3, "180 and -180 are one cell");
  assert.equal(grid.probabilityAt(45, 359), 7);

  // A cell that was never published reads as zero, exactly as the app's map lookup does.
  assert.equal(grid.probabilityAt(50, 100), 0);
  // Outside the stored band, and outside the world, also zero rather than throwing.
  assert.equal(grid.probabilityAt(10, 0), 0);
  assert.equal(grid.probabilityAt(95, 0), 0);
  assert.equal(decodeOvationGrid(undefined), undefined);
  assert.equal(decodeOvationGrid({ latFrom: 45, latTo: 85, lonFrom: -180, lonTo: 179, values: [1] }), undefined);
});

test("probabilityAt rounds and normalises exactly as OvationGrid does", () => {
  const grid = gridOf([
    [341, 65, 42],
    [0, 64, 8],
  ]);

  // Math.round on the latitude: 64.96 is row 65, and both languages round half towards +∞.
  assert.equal(grid.probabilityAt(64.96, -18.97), 42);
  assert.equal(grid.probabilityAt(65.4, -19.4), 42);
  // Half rounds up in both languages: 63.5 lands on row 64, and 64.5 lands on row 65 -- which
  // holds nothing at longitude 0, so rounding the other way would wrongly report 8 here.
  assert.equal(grid.probabilityAt(63.5, 0), 8, "63.5 rounds up to row 64");
  assert.equal(grid.probabilityAt(63.49, 0), 0);
  assert.equal(grid.probabilityAt(64.49, 0), 8);
  assert.equal(grid.probabilityAt(64.5, 0), 0, "64.5 rounds up to row 65, which is empty here");
  // Longitude wraps rather than clamping.
  assert.equal(grid.probabilityAt(65, -18.97 - 360), 42);
  assert.equal(grid.probabilityAt(65, -18.97 + 360), 42);
});

// ── 6: Iceland ───────────────────────────────────────────────────────────────

test("the Iceland probability is read at the app's own coordinate", () => {
  assert.equal(ICELAND_LAT, 64.96);
  assert.equal(ICELAND_LON, -18.97);
  // -18.97 rounds to -19, which is NOAA's longitude 341; 64.96 rounds to 65.
  const grid = gridOf([[341, 65, 37]]);
  assert.equal(icelandProbability(grid), 37);
  assert.equal(icelandProbability(undefined), undefined);
  assert.equal(formatIcelandProbability(37), "冰島模型機率：37%");
  assert.equal(formatOvalTimes("09/04 08:55", "09/04 09:25"), "觀測 09/04 08:55 · 預測 09/04 09:25");
});

test(
  "the app reads Iceland at the same coordinate and the same thresholds",
  { skip: !hasAndroid },
  () => {
    const viewModel = readAndroid("ui/auroraoval/AuroraOvalViewModel.kt");
    assert.match(viewModel, /probabilityAt\(64\.96, -18\.97\)/);

    const contours = readAndroid("ui/auroraoval/AuroraProbabilityContours.kt");
    assert.match(contours, /const val LAT_FROM = 45\.0/);
    assert.match(contours, /const val LAT_TO = 85\.0/);
    assert.match(contours, /SUBDIVISIONS = 4/);
    // Every band this port claims, exactly as the app declares it.
    assert.match(contours, /band\(grid, "very-low", 1\.0, "#3D5B78", 0\.40f\)/);
    assert.match(contours, /band\(grid, "low", 10\.0, "#4ADE80", 0\.80f\)/);
    assert.match(contours, /band\(grid, "moderate", 30\.0, "#FB923C", 0\.82f\)/);
    assert.match(contours, /band\(grid, "high", 50\.0, "#F87171", 0\.90f\)/);

    // The lookup this port reproduces.
    const model = readAndroid("data/model/SpaceWeather.kt");
    assert.match(model, /val roundedLat = Math\.round\(lat\)\.toInt\(\)\.coerceIn\(-90, 90\)/);
    assert.match(model, /val normalisedLon = \(\(Math\.round\(lon\)\.toInt\(\) % 360\) \+ 360\) % 360/);
  },
);

// ── 7, 8, 9, 10: the contours ────────────────────────────────────────────────

test("the four bands carry the app's thresholds, colours and opacities", () => {
  assert.deepEqual(CONTOUR_BANDS.map((band) => band.threshold), [1, 10, 30, 50]);
  assert.deepEqual(CONTOUR_BANDS.map((band) => band.color), ["#3D5B78", "#4ADE80", "#FB923C", "#F87171"]);
  assert.deepEqual(CONTOUR_BANDS.map((band) => band.opacity), [0.4, 0.8, 0.82, 0.9]);
  assert.deepEqual(CONTOUR_BANDS.map((band) => band.id), ["very-low", "low", "moderate", "high"]);
  assert.equal(CONTOUR_LAT_FROM, 45);
  assert.equal(CONTOUR_LAT_TO, 85);
  assert.equal(CONTOUR_SUBDIVISIONS, 4);

  // The built bands carry them through unchanged.
  const bands = buildContourBands(gridOf([[341, 65, 60]]));
  assert.equal(bands.length, 4);
  for (const [index, band] of bands.entries()) {
    assert.equal(band.threshold, CONTOUR_BANDS[index].threshold);
    assert.equal(band.color, CONTOUR_BANDS[index].color);
    assert.equal(band.opacity, CONTOUR_BANDS[index].opacity);
  }
});

test("a cell wholly above the threshold becomes one rectangle", () => {
  // Four adjacent grid points at 100 make the single cell they corner fully inside.
  const grid = gridOf([
    [10, 60, 100],
    [11, 60, 100],
    [10, 61, 100],
    [11, 61, 100],
  ]);
  const high = buildContourBands(grid).find((band) => band.id === "high")!;
  const polygons = high.geoJson.features[0].geometry.coordinates;

  const rings = polygons.map((polygon) => polygon[0]);
  const whole = rings.filter(
    (ring) => JSON.stringify(ring) === JSON.stringify([[10, 60], [11, 60], [11, 61], [10, 61], [10, 60]]),
  );
  assert.equal(whole.length, 1, "the cell inside the threshold is emitted once, as one rectangle");

  // Its eight neighbours are crossed by the contour, so they are subdivided and clipped instead.
  // Between a corner at 100 and one at 0 the 50% crossing is the midpoint, which is what bounds
  // the whole shape at half a degree beyond the full cell.
  const coordinates = rings.flat();
  assert.equal(Math.min(...coordinates.map(([longitude]) => longitude)), 9.5);
  assert.equal(Math.max(...coordinates.map(([longitude]) => longitude)), 11.5);
  assert.equal(Math.min(...coordinates.map(([, latitude]) => latitude)), 59.5);
  assert.equal(Math.max(...coordinates.map(([, latitude]) => latitude)), 61.5);
});

test("adjacent full cells merge along a row instead of becoming separate faces", () => {
  const cells: [number, number, number][] = [];
  for (let lon = 10; lon <= 14; lon += 1) {
    cells.push([lon, 60, 100], [lon, 61, 100]);
  }
  const high = buildContourBands(gridOf(cells)).find((band) => band.id === "high")!;
  const polygons = high.geoJson.features[0].geometry.coordinates;

  const rings = polygons.map((polygon) => polygon[0]);
  // The four full cells collapse into one rectangle spanning 10..14, rather than four of them.
  const merged = rings.filter(
    (ring) => JSON.stringify(ring) === JSON.stringify([[10, 60], [14, 60], [14, 61], [10, 61], [10, 60]]),
  );
  assert.equal(merged.length, 1, "adjacent full cells must merge into a single face");
  const singleCells = rings.filter(
    (ring) => ring.length === 5 && ring[0][1] === 60 && ring[2][1] === 61 && ring[1][0] - ring[0][0] === 1,
  );
  assert.equal(singleCells.length, 0, "no full cell may be emitted on its own once merged");
});

test("two separate runs stay separate, with no polygon bridging the gap", () => {
  const cells: [number, number, number][] = [];
  for (const lon of [10, 11, 40, 41]) cells.push([lon, 60, 100], [lon, 61, 100]);
  const high = buildContourBands(gridOf(cells)).find((band) => band.id === "high")!;
  const rings = high.geoJson.features[0].geometry.coordinates.map((polygon) => polygon[0]);

  // Branches and holes survive: nothing here assumes one run per latitude row.
  const fullCells = rings.filter((ring) => ring.length === 5 && ring[0][1] === 60 && ring[2][1] === 61);
  const spans = fullCells.map((ring) => [ring[0][0], ring[1][0]]);
  assert.equal(spans.some(([west, east]) => west === 10 && east === 11), true);
  assert.equal(spans.some(([west, east]) => west === 40 && east === 41), true);
  // No face spans the empty longitudes between them — that would be a fabricated seam.
  assert.equal(
    spans.some(([west, east]) => west <= 11 && east >= 40),
    false,
    "a polygon must not bridge two separate runs",
  );
});

test("a boundary cell is subdivided and clipped, and stays inside its own cell", () => {
  // A single high corner: the contour crosses this cell, so it is cut into 4x4 and clipped.
  const grid = gridOf([[10, 60, 100]]);
  const high = buildContourBands(grid).find((band) => band.id === "high")!;
  const coordinates = coordinatesOf(high);

  assert.equal(coordinates.length > 0, true, "a crossed cell must still produce a face");
  // Clipping keeps everything inside the four cells that corner on the high point, and the 50%
  // crossing between 100 and 0 is the midpoint -- so the face is exactly half a degree across.
  for (const [longitude, latitude] of coordinates) {
    assert.equal(longitude >= 9 && longitude <= 11, true, `longitude ${longitude} escaped the neighbourhood`);
    assert.equal(latitude >= 59 && latitude <= 61, true, `latitude ${latitude} escaped the neighbourhood`);
  }
  assert.equal(Math.min(...coordinates.map(([longitude]) => longitude)), 9.5);
  assert.equal(Math.max(...coordinates.map(([longitude]) => longitude)), 10.5);
  assert.equal(Math.min(...coordinates.map(([, latitude]) => latitude)), 59.5);
  assert.equal(Math.max(...coordinates.map(([, latitude]) => latitude)), 60.5);
  // The subdivision is 1/4 of a degree, so no vertex sits on a coarser lattice than that.
  const step = 1 / CONTOUR_SUBDIVISIONS;
  assert.equal(
    coordinates.some(([longitude]) => Math.abs(longitude / step - Math.round(longitude / step)) > 1e-9),
    true,
    "clipping must produce vertices off the subdivision lattice, not just whole sub-squares",
  );
});

test("every contour coordinate stays inside the processed range", () => {
  // A band that runs right to the edges of the processed window and across the date line.
  const cells: [number, number, number][] = [];
  for (let lat = 45; lat <= 85; lat += 1) {
    for (const lon of [0, 1, 179, 180, 181, 359]) cells.push([lon, lat, 80]);
  }
  const bands = buildContourBands(gridOf(cells));

  for (const band of bands) {
    const coordinates = coordinatesOf(band);
    assert.equal(coordinates.length > 0, true, `${band.id} produced nothing`);
    for (const [longitude, latitude] of coordinates) {
      assert.equal(latitude >= 45 && latitude <= 85, true, `${band.id} latitude ${latitude} out of range`);
      assert.equal(longitude >= -180 && longitude <= 180, true, `${band.id} longitude ${longitude} out of range`);
    }
  }
});

test("an empty grid produces four bands with no features rather than a fake one", () => {
  const bands = buildContourBands(gridOf([]));
  assert.equal(bands.length, 4);
  for (const band of bands) assert.deepEqual(band.geoJson.features, []);
});

// ── 11: the 32 site markers ──────────────────────────────────────────────────

test("the 32 site markers are the app's own sites, with its own circle paint", { skip: !hasAndroid }, () => {
  const kotlin = readAndroid("data/sites/IcelandAuroraSites.kt");

  assert.equal(WEATHER_SITES.length, 32);
  assert.equal((kotlin.match(/AuroraSite\(/g) ?? []).length, 32, "the app still has 32 sites");

  for (const site of WEATHER_SITES) {
    assert.equal(kotlin.includes(`id = "${site.id}"`), true, `${site.id} is not in IcelandAuroraSites.all`);
    // Coordinates as the app writes them: lat = 64.1656, lon = -22.0186
    const lat = site.lat.toFixed(4);
    const lon = site.lon.toFixed(4);
    const pattern = new RegExp(`lat = ${lat.replace(/0+$/, "")}[0-9]*, lon = ${lon.replace(/0+$/, "")}[0-9]*`);
    assert.equal(
      pattern.test(kotlin) || kotlin.includes(`lat = ${site.lat}, lon = ${site.lon}`),
      true,
      `${site.id} coordinates do not match the app`,
    );
  }
});

test("the marker circles are MapStyleFactory.siteCircleLayer, unchanged", () => {
  const style = buildAuroraOvalStyle("/world.geojson", "/iceland.geojson", { type: "FeatureCollection", features: [] });
  const layer = style.layers.find((entry) => entry.id === "site-circles")!;
  assert.equal(layer.type, "circle");
  const paint = layer.paint as Record<string, unknown>;
  assert.equal(paint["circle-radius"], 7);
  assert.equal(paint["circle-stroke-width"], 2);
  assert.equal(paint["circle-stroke-color"], "#F8FAFC");
  assert.equal(paint["circle-opacity"], 0.95);
  assert.deepEqual(paint["circle-color"], ["to-color", ["get", "color"]]);

  // The app's tap tolerance, so a 7 px dot does not need pixel-perfect clicking.
  assert.equal(SITE_TAP_TOLERANCE, 24);

  const component = read("src/components/AuroraOvalMap.tsx");
  assert.match(component, /queryRenderedFeatures\(box, \{ layers: \["site-circles"\] \}\)/);
  assert.match(component, /event\.point\.x - SITE_TAP_TOLERANCE/);
  // No score is invented: the app's own neutral fallback colour is used instead.
  assert.match(component, /NEUTRAL_MARKER_COLOR = "#64748B"/);
  assert.match(component, /color: NEUTRAL_MARKER_COLOR/);
  assert.match(component, /score: 0/);
  // No stand-in for the app's composite score is computed here, only named in the comment that
  // explains why it is absent.
  assert.equal(/sunElevation\(|moonInterference\(|latitudeAdvantage\(/.test(component), false);
});

test("the app's neutral fallback is the colour used, not one made up here", { skip: !hasAndroid }, () => {
  const viewModel = readAndroid("ui/map/MapViewModel.kt");
  assert.match(viewModel, /neutralMarkers\(\)[\s\S]{0,220}"#64748B"/);
  const style = readAndroid("ui/map/MapStyleFactory.kt");
  assert.match(style, /put\("circle-radius", 7\.0\)/);
  assert.match(style, /put\("circle-stroke-width", 2\.0\)/);
  assert.match(style, /put\("circle-stroke-color", "#F8FAFC"\)/);
  assert.match(style, /put\("circle-opacity", 0\.95\)/);
});

// ── The base style ───────────────────────────────────────────────────────────

test("the base style is AuroraOvalStyleFactory, colour for colour", () => {
  const style = buildAuroraOvalStyle("/world.geojson", "/iceland.geojson", { type: "FeatureCollection", features: [] });
  const layer = (id: string) => style.layers.find((entry) => entry.id === id)!;
  const paint = (id: string) => layer(id).paint as Record<string, unknown>;

  assert.equal(style.version, 8);
  assert.equal(paint("ocean")["background-color"], "#07162B");
  assert.equal(paint("land")["fill-color"], "#243B4D");
  assert.equal(paint("coastline")["line-color"], "#7890A1");
  assert.equal(paint("coastline")["line-width"], 0.8);
  assert.equal(paint("coastline")["line-opacity"], 0.72);
  assert.equal(paint("graticule")["line-color"], "#6B819C");
  assert.equal(paint("graticule")["line-width"], 0.7);
  assert.equal(paint("graticule")["line-opacity"], 0.22);

  assert.equal(paint("iceland-land-detail")["fill-color"], "#243B4D");
  assert.equal(paint("iceland-coastline-mask")["line-width"], 2.6);
  assert.equal(paint("iceland-coastline-mask")["line-color"], "#243B4D");
  assert.equal(paint("iceland-coastline-detail")["line-color"], "#8BA3B4");
  assert.equal(paint("iceland-coastline-detail")["line-width"], 1);
  assert.equal(paint("iceland-coastline-detail")["line-opacity"], 0.9);

  assert.equal(paint("iceland-halo")["circle-radius"], 9);
  assert.equal(paint("iceland-halo")["circle-color"], "#E2E8F0");
  assert.equal(paint("iceland-halo")["circle-opacity"], 0.92);
  assert.equal(paint("iceland-marker")["circle-radius"], 5.5);
  assert.equal(paint("iceland-marker")["circle-color"], "#38BDF8");
  assert.equal(paint("iceland-marker")["circle-stroke-width"], 1.2);
  assert.equal(paint("iceland-marker")["circle-stroke-color"], "#082F49");

  // The contour bands are anchored above the detailed Iceland fill, as the app anchors them.
  assert.equal(AURORA_LAYER_ANCHOR, "iceland-land-detail");
  assert.equal(style.layers.some((entry) => entry.id === AURORA_LAYER_ANCHOR), true);
});

test("the graticule is the app's, and still has no 0° meridian", () => {
  assert.deepEqual(GRATICULE_LATITUDES, [50, 60, 70, 80]);
  assert.deepEqual(GRATICULE_LONGITUDES, [-120, -60, 60, 120, 180]);
  // The app removed it deliberately: it lands mid-view and reads as a texture seam.
  assert.equal(GRATICULE_LONGITUDES.includes(0), false);
});

// ── 12, 13, 14, 15: the card's two modes ─────────────────────────────────────

test("the aurora card defaults to the gauges", () => {
  const modes = read("src/components/AuroraModes.tsx");
  assert.match(modes, /useState<AuroraMode>\("GAUGES"\)/);
  assert.match(modes, /儀表板/);
  assert.match(modes, /極光機率位置圖/);
  // The same switch markup the weather and road sections use.
  assert.match(modes, /className="road-modes aurora-view-modes"/);

  const sections = read("src/components/SourceSections.tsx");
  assert.match(sections, /<AuroraModes ovationData=\{ovationData\}>/);
  // The gauges and their stats stay exactly where they were, inside the default mode.
  assert.match(sections, /<AuroraGauges kpData=\{kpData\} windData=\{windData\} \/>/);
});

test("MapLibre and the world outline wait until the map mode is chosen", () => {
  const modes = read("src/components/AuroraModes.tsx");
  // The map component is a separate chunk, and it is not even mounted until asked for.
  assert.match(modes, /dynamic\(\s*\(\) => import\("@\/components\/AuroraOvalMap"\)/);
  assert.match(modes, /ssr: false/);
  assert.match(modes, /\{mapRequested && \(/);
  assert.match(modes, /setMapRequested\(true\)/);
  // Once mounted it stays mounted, so switching back is instant and nothing reloads.
  assert.match(modes, /hidden=\{mode !== "MAP"\}/);
  assert.match(modes, /hidden=\{mode !== "GAUGES"\}/);

  const map = read("src/components/AuroraOvalMap.tsx");
  // maplibre itself is imported inside the effect, not at module scope.
  assert.match(map, /const maplibre = await import\("maplibre-gl"\)/);
  // The outline is a URL handed to the style, so it is fetched by the map and not before.
  assert.match(map, /getPublicAssetPath\("\/data\/world_land\.geojson"\)/);
});

test("nothing in the aurora map reaches NOAA, on any interaction", () => {
  for (const file of ["src/components/AuroraOvalMap.tsx", "src/components/AuroraModes.tsx", "src/lib/auroraOval.ts", "src/lib/ovationGrid.ts"]) {
    const source = read(file);
    assert.equal(/services\.swpc\.noaa\.gov|swpc\.noaa|checkOvation/.test(source), false, `${file} must not reach NOAA`);
  }
  const map = read("src/components/AuroraOvalMap.tsx");
  // The only fetches are the map's own local style assets, issued by MapLibre itself.
  assert.equal(/[^.\w]fetch\(/.test(map), false, "the aurora map must not fetch anything itself");
  assert.match(map, /decodeOvationGrid\(ovation\.grid\)/);
});

test("the contour layers are added after the map exists, not before", () => {
  const map = read("src/components/AuroraOvalMap.tsx");
  // The map is created inside an async effect, so an effect keyed only on the bands would run
  // once at mount -- with no map yet -- and never again, leaving the aurora undrawn.
  assert.match(map, /const \[ready, setReady\] = useState\(false\)/);
  assert.match(map, /setReady\(true\)/);
  assert.match(map, /if \(!map \|\| !ready \|\| bands\.length === 0\) return;/);
  assert.match(map, /\}, \[bands, ready\]\);/);
  // The bands are anchored above the detailed Iceland fill, and the markers stay on top.
  assert.match(map, /map\.getLayer\(anchor\) \? anchor : undefined/);
  assert.match(map, /map\.moveLayer\("site-circles"\)/);
  assert.match(map, /"fill-antialias": false/);
});

test("the map cannot be rotated or tilted", () => {
  const map = read("src/components/AuroraOvalMap.tsx");
  assert.match(map, /dragRotate: false/);
  assert.match(map, /pitchWithRotate: false/);
  // Pinch zoom stays on; it is rotation that is disabled.
  assert.match(map, /touchZoomRotate: true/);
});

test("the camera keeps the app's geographic framing", () => {
  assert.deepEqual(OVAL_CAMERA_BOUNDS, [
    [-85, 48],
    [50, 83.5],
  ]);
  assert.deepEqual(OVAL_CAMERA_FALLBACK, { center: [-20, 68], zoom: 2.1 });

  // Pixel padding adapts to a short container; the corners it frames do not.
  const wide = ovalCameraPadding(900, 380);
  assert.equal(wide.top <= 52 && wide.top > 0, true);
  assert.equal(wide.left <= 34 && wide.left > 0, true);
  assert.equal(wide.bottom > 0 && wide.bottom < 380, true, "the bottom must leave the map visible");
  const tiny = ovalCameraPadding(120, 90);
  assert.equal(tiny.top + tiny.bottom < 90, true, "padding must never exceed the container");
});

test("the gauges are untouched by this change", () => {
  const gauges = read("src/components/AuroraGauges.tsx");
  assert.match(gauges, /GAUGE_STYLE\.segmentCount/);
  assert.match(gauges, /gaugeAngle\(/);
  assert.match(gauges, /prefers-reduced-motion: reduce/);
  // The panel knows nothing about the map.
  assert.equal(/AuroraOvalMap|contour|maplibre/i.test(gauges), false);
});

// ── 17: the snapshot ─────────────────────────────────────────────────────────

test("a failed collection keeps the grid the last good one stored", () => {
  const good = {
    id: "ovation",
    name: "NOAA OVATION",
    status: "ok" as const,
    checkedAt: "2026-09-04T09:00:00Z",
    networkOk: true,
    parseOk: true,
    data: {
      gridCells: 3,
      icelandPeakProbabilityPercent: 42,
      grid: encodeOvationGrid([[341, 65, 42]]),
    },
    provenance: { mode: "production" as const },
  };
  const failed = { ...good, checkedAt: "2026-09-04T10:00:00Z", status: "error" as const, networkOk: false, data: undefined };

  const after = mergeSource(mergeSource(undefined, good), failed);
  assert.equal(after.status, "error");
  const grid = decodeOvationGrid((after.data as Record<string, unknown> | undefined)?.grid);
  assert.equal(grid !== undefined, true, "the stored grid must survive a failed collection");
  assert.equal(grid!.probabilityAt(64.96, -18.97), 42);
  // And the summary the card reads survives with it.
  assert.equal((after.data as Record<string, number>).icelandPeakProbabilityPercent, 42);
});

test("the grid serializes as one compact row of numbers", () => {
  const payload = encodeOvationGrid([[341, 65, 42]]);
  const text = serializeSnapshot({ grid: payload });

  assert.deepEqual(JSON.parse(text).grid.values, payload.values);
  // The serializer keeps primitive-only arrays on one line, so 14,760 numbers cost one line.
  const valuesLine = text.split("\n").find((line) => line.includes('"values"'))!;
  assert.equal(valuesLine.includes("42"), true);
  assert.equal(text.split("\n").length < 20, true, "the grid must not expand to one line per cell");
});
