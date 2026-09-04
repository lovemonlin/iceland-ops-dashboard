import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { METNO_FORECAST_URL, WEATHER_SITES } from "../src/config/sources";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import {
  clampPan,
  createProjection,
  effectiveObstruction,
  layoutMarkers,
  LEGEND_DOTS,
  MAX_SCALE,
  obstructionColorFor,
  OBSTRUCTION_ZONES,
  parseOutline,
  projectBase,
  weatherSymbolFor,
  zoomTo,
  ZOOM_STEP,
} from "../src/lib/weatherMap";
import { checkMetno } from "../src/monitors/metno/monitor";
import { mergeSource } from "../src/snapshot/mergeSnapshot";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const NOW = new Date("2026-09-04T09:00:00Z");
const RECENT = "2026-09-04T08:55:00Z";

const forecast = () => ({
  properties: {
    meta: { updated_at: RECENT },
    timeseries: [
      {
        time: RECENT,
        data: {
          instant: {
            details: {
              air_temperature: 8.4,
              wind_speed: 6.4,
              wind_from_direction: 210,
              cloud_area_fraction: 42,
              cloud_area_fraction_low: 12,
              cloud_area_fraction_medium: 21,
              cloud_area_fraction_high: 9,
            },
          },
          next_1_hours: { summary: { symbol_code: "partlycloudy_night" } },
        },
      },
    ],
  },
});

/** Serves one canned MET response through the real diagnostics core. Nothing touches the network. */
const stub = (): DiagnosticFetcher => (url, options) =>
  fetchWithDiagnosticsCore(url, {
    ...options,
    fetch: async () =>
      new Response(JSON.stringify(forecast()), { status: 200, headers: { "content-type": "application/json" } }),
  });

// ── 1. The snapshot payload ───────────────────────────────────────────────────

test("the snapshot carries all 32 sites with everything the map needs to draw them", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const sites = health.data?.sites as Record<string, unknown>[];

  assert.equal(Array.isArray(sites), true);
  assert.equal(sites.length, 32);
  assert.equal(sites.length, WEATHER_SITES.length);
  assert.equal(new Set(sites.map((site) => site.id)).size, 32, "site ids must be unique");

  for (const site of sites) {
    assert.equal(Number.isFinite(site.lat), true, `${site.id} lat`);
    assert.equal(Number.isFinite(site.lon), true, `${site.id} lon`);
    // Everything the Android map renders per site.
    for (const field of ["id", "name", "nameIs", "nameZh", "region"]) {
      assert.equal(typeof site[field], "string", `${site.id} ${field}`);
      assert.notEqual(site[field], "", `${site.id} ${field} must not be empty`);
    }
    assert.equal(site.temperatureC, 8.4);
    assert.equal(site.windMps, 6.4);
    assert.equal(site.windFromDirection, 210);
    assert.equal(site.symbolCode, "partlycloudy_night");
    assert.equal(site.cloudLowPercent, 12);
    assert.equal(site.cloudMediumPercent, 21);
    assert.equal(site.cloudHighPercent, 9);
  }
});

/**
 * The app is the source of truth for this list, so when a checkout of it is beside this repository
 * the two are compared directly. CI has no such checkout, hence the guard rather than a copy of the
 * data that could silently drift.
 */
const ANDROID_SITES = "../iceland-aurora/app/src/main/java/com/iceland/aurora/data/sites/IcelandAuroraSites.kt";

test("the site list still matches the app, one for one", { skip: !existsSync(resolve(process.cwd(), ANDROID_SITES)) }, () => {
  const kotlin = read(ANDROID_SITES);
  const ids = [...kotlin.matchAll(/id = "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 32);
  assert.deepEqual(WEATHER_SITES.map((site) => site.id), ids);

  for (const site of WEATHER_SITES) {
    const block = new RegExp(`id = "${site.id}",[\\s\\S]{0,320}?lat = ([-\\d.]+), lon = ([-\\d.]+)`);
    const match = kotlin.match(block);
    assert.notEqual(match, null, `${site.id} not found in the app`);
    assert.equal(Number(match![1]), site.lat, `${site.id} lat`);
    assert.equal(Number(match![2]), site.lon, `${site.id} lon`);
  }
});

// ── 2. Backward compatibility ─────────────────────────────────────────────────

test("the headline Reykjavík summary the existing card reads is unchanged", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const data = health.data!;
  assert.equal(data.primarySite, "Reykjavík");
  assert.equal(data.temperatureC, 8.4);
  assert.equal(data.windMps, 6.4);
  assert.equal(data.cloudLowPercent, 12);
  assert.equal(data.cloudMediumPercent, 21);
  assert.equal(data.cloudHighPercent, 9);
  assert.equal(data.locationsChecked, 32);
  assert.equal(data.locationsSuccessful, 32);
  assert.equal(health.status, "ok");
  assert.equal(health.provenance?.mode, "production");
});

// ── 3. The merge contract ─────────────────────────────────────────────────────

test("a failed collection keeps the sites the last good one stored", () => {
  const good = {
    id: "metno",
    name: "MET Norway Weather",
    status: "ok" as const,
    checkedAt: "2026-09-04T09:00:00Z",
    networkOk: true,
    parseOk: true,
    data: { primarySite: "Reykjavík", sites: [{ id: "reykjavik", temperatureC: 8.4 }] },
    provenance: { mode: "production" as const },
  };
  const failed = {
    ...good,
    checkedAt: "2026-09-04T10:00:00Z",
    status: "error" as const,
    networkOk: false,
    errorType: "NETWORK_ERROR" as const,
    data: undefined,
  };

  const first = mergeSource(undefined, good);
  const after = mergeSource(first, failed);

  assert.equal(after.status, "error");
  assert.deepEqual(after.data, good.data, "a failed attempt must never erase the stored sites");
  assert.equal((after.data?.sites as unknown[]).length, 1);
});

// ── 4. Projection ─────────────────────────────────────────────────────────────

const outline = parseOutline(JSON.parse(read("public/data/iceland.geojson")))!;

test("the outline parses and keeps the app's bounds", () => {
  assert.notEqual(outline, null);
  assert.equal(outline.rings.length >= 1, true);
  // The asset itself, unmodified: the same file the app loads from its APK.
  assert.equal(Math.abs(outline.bounds.minLon - -24.5399) < 1e-6, true);
  assert.equal(Math.abs(outline.bounds.maxLon - -13.5029) < 1e-6, true);
  assert.equal(Math.abs(outline.bounds.minLat - 63.3967) < 1e-6, true);
  assert.equal(Math.abs(outline.bounds.maxLat - 66.5366) < 1e-6, true);
});

test("longitude is compressed by cos(latitude), so Iceland is never stretched", () => {
  const projection = createProjection(outline.bounds, 600);
  // At 65°N a degree of longitude is about 0.42 of a degree of latitude.
  assert.equal(Math.abs(projection.lonScale - Math.cos((64.96665 * Math.PI) / 180)) < 1e-9, true);
  assert.equal(projection.aspect > 1.4 && projection.aspect < 1.6, true, `aspect was ${projection.aspect}`);
  // Height follows the aspect ratio, which is what keeps the shape honest at any width.
  const wider = createProjection(outline.bounds, 900);
  assert.equal(Math.abs(wider.aspect - projection.aspect) < 1e-12, true);
});

test("known sites land where they belong on the drawn island", () => {
  const projection = createProjection(outline.bounds, 600);
  const at = (id: string) => {
    const site = WEATHER_SITES.find((candidate) => candidate.id === id)!;
    const point = projectBase(projection, site.lon, site.lat);
    return {
      x: (point.x - 8 - projection.centreShiftX) / projection.innerWidth,
      y: (point.y - 12 - projection.centreShiftY) / projection.innerHeight,
    };
  };

  const reykjavik = at("reykjavik");
  const egilsstadir = at("egilsstadir");
  const isafjordur = at("isafjordur");
  const vik = at("vik");

  // Reykjavík is south-west: left half, lower half.
  assert.equal(reykjavik.x < 0.35 && reykjavik.y > 0.5, true, JSON.stringify(reykjavik));
  // Egilsstaðir is east of Reykjavík; Ísafjörður is north of it.
  assert.equal(egilsstadir.x > reykjavik.x, true);
  assert.equal(isafjordur.y < reykjavik.y, true);
  // Vík is the southern coast: near the bottom.
  assert.equal(vik.y > 0.8, true, JSON.stringify(vik));
  // Everything stays inside the drawn area.
  for (const site of WEATHER_SITES) {
    const point = at(site.id);
    assert.equal(point.x >= -0.01 && point.x <= 1.01, true, `${site.id} x ${point.x}`);
    assert.equal(point.y >= -0.01 && point.y <= 1.01, true, `${site.id} y ${point.y}`);
  }
});

// ── 5. Cloud colour ───────────────────────────────────────────────────────────

test("effective obstruction weights the three cloud layers the way the app does", () => {
  // Low 1.00, mid 0.70, high 0.35, combined as transmission rather than summed.
  const clear = effectiveObstruction({ cloudLowPercent: 0, cloudMediumPercent: 0, cloudHighPercent: 0 });
  assert.equal(clear, 0);

  const overcastLow = effectiveObstruction({ cloudLowPercent: 100, cloudMediumPercent: 0, cloudHighPercent: 0 });
  assert.equal(overcastLow, 100);

  // High cloud alone barely counts, which is the whole point of the weighting.
  const highOnly = effectiveObstruction({ cloudLowPercent: 0, cloudMediumPercent: 0, cloudHighPercent: 100 });
  assert.equal(Math.round(highOnly), 35);

  const mixed = effectiveObstruction({ cloudLowPercent: 12, cloudMediumPercent: 21, cloudHighPercent: 9 });
  const expected = (1 - (1 - 0.12) * (1 - 0.21 * 0.7) * (1 - 0.09 * 0.35)) * 100;
  assert.equal(Math.abs(mixed - expected) < 1e-9, true);

  // No cloud data at all is treated as fully blocked, never as clear.
  assert.equal(effectiveObstruction({}), 100);
  // cloudTotal stands in for a missing low layer.
  assert.equal(effectiveObstruction({ cloudTotalPercent: 50 }), 50);
});

test("dot colours match the app's ObstructionZones thresholds exactly", () => {
  assert.deepEqual(OBSTRUCTION_ZONES, [
    { upTo: 20, color: "#1D6DFF" },
    { upTo: 45, color: "#5EE74B" },
    { upTo: 70, color: "#C6C6C6" },
    { upTo: 100, color: "#636363" },
  ]);

  // `colorFor` returns the first zone whose upper bound the value does not exceed.
  assert.equal(obstructionColorFor(0), "#1D6DFF");
  assert.equal(obstructionColorFor(20), "#1D6DFF");
  assert.equal(obstructionColorFor(20.1), "#5EE74B");
  assert.equal(obstructionColorFor(45), "#5EE74B");
  assert.equal(obstructionColorFor(45.1), "#C6C6C6");
  assert.equal(obstructionColorFor(70), "#C6C6C6");
  assert.equal(obstructionColorFor(70.1), "#636363");
  assert.equal(obstructionColorFor(100), "#636363");

  // The legend samples the same function, so it can never drift from the map.
  assert.deepEqual(LEGEND_DOTS.map((dot) => obstructionColorFor(dot.obstruction)), [
    "#1D6DFF",
    "#5EE74B",
    "#C6C6C6",
    "#636363",
  ]);
});

test("symbol codes resolve to the app's icons and tints, in the app's order", () => {
  // Thunder must beat rain: "rainandthunder" contains both keywords.
  assert.equal(weatherSymbolFor("rainandthunder").key, "thunder");
  assert.equal(weatherSymbolFor("lightsleetshowers_day").key, "snow");
  assert.equal(weatherSymbolFor("lightrainshowers_night").key, "rain");
  assert.equal(weatherSymbolFor("drizzle").key, "rain");
  assert.equal(weatherSymbolFor("fog").key, "fog");
  assert.equal(weatherSymbolFor("fair_day").key, "partlycloudy");
  assert.equal(weatherSymbolFor("partlycloudy_night").key, "partlycloudy");
  assert.equal(weatherSymbolFor("cloudy").key, "cloudy");
  assert.equal(weatherSymbolFor("clearsky_day").key, "clearsky_day");
  assert.equal(weatherSymbolFor("clearsky_night").key, "clearsky_night");
  assert.equal(weatherSymbolFor(undefined).key, "unknown");

  assert.equal(weatherSymbolFor("clearsky_day").tint, "#FBBF24");
  assert.equal(weatherSymbolFor("clearsky_night").tint, "#93C5FD");
  assert.equal(weatherSymbolFor("partlycloudy_day").tint, "#CBD5E1");
  assert.equal(weatherSymbolFor("cloudy").tint, "#94A3B8");
  assert.equal(weatherSymbolFor("lightrain").tint, "#60A5FA");
  assert.equal(weatherSymbolFor("snow").tint, "#BAE6FD");
  assert.equal(weatherSymbolFor("thunder").tint, "#F59E0B");
});

// ── 6. Selection, zoom and reset ──────────────────────────────────────────────

test("zoom is bounded, stepped and anchored on the selected site", () => {
  const projection = createProjection(outline.bounds, 600);
  const reykjavik = WEATHER_SITES.find((site) => site.id === "reykjavik")!;

  assert.equal(zoomTo(0.2, projection, reykjavik).scale, 1);
  assert.equal(zoomTo(99, projection, reykjavik).scale, MAX_SCALE);
  assert.equal(Math.abs(zoomTo(1 * ZOOM_STEP, projection, reykjavik).scale - 1.8) < 1e-9, true);

  // The anchored site ends up at the centre of the viewport, not the island's empty middle.
  const zoomed = zoomTo(3, projection, reykjavik);
  const base = projectBase(projection, reykjavik.lon, reykjavik.lat);
  const onScreen = { x: base.x * zoomed.scale + zoomed.pan.x, y: base.y * zoomed.scale + zoomed.pan.y };
  assert.equal(Math.abs(onScreen.x - projection.viewportWidth / 2) < 1, true);
  assert.equal(Math.abs(onScreen.y - projection.viewportHeight / 2) < 1, true);
});

test("reset returns to the whole island, and panning is disabled there", () => {
  // At scale 1 the pan is forced back to zero, which is how the reset lands exactly home.
  assert.deepEqual(clampPan({ x: 120, y: -40 }, 1, 600, 400), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: 120, y: -40 }, 0.5, 600, 400), { x: 0, y: 0 });

  // Zoomed in, any point can still be dragged as far as the centre, but no further.
  const clamped = clampPan({ x: 9999, y: 9999 }, 3, 600, 400);
  assert.deepEqual(clamped, { x: 300, y: 200 });
  const other = clampPan({ x: -99999, y: -99999 }, 3, 600, 400);
  assert.deepEqual(other, { x: 300 - 600 * 3, y: 200 - 400 * 3 });
});

test("labels are placed greedily, and the focused site always gets one", () => {
  const projection = createProjection(outline.bounds, 900);
  const points = WEATHER_SITES.map((site) => ({ id: site.id, lon: site.lon, lat: site.lat }));
  const placed = layoutMarkers({
    points,
    focusedId: "reykjavik",
    viewportWidth: projection.viewportWidth,
    viewportHeight: projection.viewportHeight,
    project: (lon, lat) => projectBase(projection, lon, lat),
  });

  assert.equal(placed.length, 32, "every site is drawn, whether or not it gets a label");
  assert.equal(placed[0].point.id, "reykjavik", "the focused site is laid out first");
  assert.equal(placed[0].labelSide !== null, true, "the focused site must always be labelled");

  // The south-west corner is crowded, so some labels are necessarily dropped.
  const labelled = placed.filter((marker) => marker.labelSide !== null);
  assert.equal(labelled.length < 32, true, "a crowded map cannot label everything");
  assert.equal(labelled.length > 8, true, `only ${labelled.length} labels placed`);

  // Zooming spreads the points out, so more labels fit. That is the point of zooming.
  const zoomed = layoutMarkers({
    points,
    focusedId: "reykjavik",
    viewportWidth: projection.viewportWidth,
    viewportHeight: projection.viewportHeight,
    project: (lon, lat) => {
      const { scale, pan } = zoomTo(3, projection, WEATHER_SITES[1]);
      const base = projectBase(projection, lon, lat);
      return { x: base.x * scale + pan.x, y: base.y * scale + pan.y };
    },
  });
  const onScreen = zoomed.filter(
    (marker) =>
      marker.position.x >= 0 &&
      marker.position.x <= projection.viewportWidth &&
      marker.position.y >= 0 &&
      marker.position.y <= projection.viewportHeight,
  );
  const zoomedLabelled = zoomed.filter((marker) => marker.labelSide !== null);
  assert.equal(zoomedLabelled.length <= onScreen.length, true, "off-screen points never get a label");
});
