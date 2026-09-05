import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { WEATHER_SITES } from "../src/config/sources";
import {
  buildCloudForecastStyle,
  CLOUD_ATTRIBUTION,
  CLOUD_FORECAST_MAX_HOURS,
  CLOUD_FRAME_STEP_HOURS,
  CLOUD_FRAME_TOLERANCE_SECONDS,
  CLOUD_IMAGE_COORDINATES,
  CLOUD_IMAGE_LAT_MAX,
  CLOUD_IMAGE_LAT_MIN,
  CLOUD_IMAGE_LON_MAX,
  CLOUD_IMAGE_LON_MIN,
  CLOUD_LEGEND,
  CLOUD_RASTER_OPACITY,
  cloudForecastColor,
  cloudForecastMarkersAt,
  FORECAST_COAST_COLOR,
  FORECAST_LAND_COLOR,
  FORECAST_OCEAN_COLOR,
  formatForecastOffset,
  formatIcelandDateTime,
  frameAt,
  type CloudFrame,
} from "../src/lib/cloudForecast";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import { effectiveObstruction, hourAt, type WeatherHour } from "../src/lib/weatherMap";
import { checkEcmwf } from "../src/monitors/ecmwf/monitor";
import { mergeSource } from "../src/snapshot/mergeSnapshot";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ANDROID = "../iceland-aurora/app/src/main/java/com/iceland/aurora";
const androidFile = (path: string) => resolve(process.cwd(), `${ANDROID}/${path}`);
const hasAndroid = existsSync(androidFile("ui/map/MapStyleFactory.kt"));
const readAndroid = (path: string) => readFileSync(androidFile(path), "utf8");

const RUN_AT = "2026-09-05T06:00:00Z";
const NOW = new Date("2026-09-05T13:00:00Z");
const BASE = "https://lovemonlin.github.io/iceland-aurora-cloud";

/** The manifest the publisher actually serves: 17 frames, three hours apart, out to +48 h. */
function manifest() {
  return {
    model: "ECMWF IFS Open Data (0.25 degree)",
    run_at: RUN_AT,
    generated_at: "2026-09-05T12:52:00Z",
    source_url: `${BASE}/`,
    attribution: "ECMWF, CC BY 4.0.",
    frames: Array.from({ length: 17 }, (_, index) => ({
      valid_at: new Date(Date.parse(RUN_AT) + index * 3 * 3_600_000).toISOString(),
      image_url: `${BASE}/tcc-${String(index * 3).padStart(2, "0")}h.png`,
    })),
  };
}

const stub = (calls: string[]): DiagnosticFetcher => (url, options) =>
  fetchWithDiagnosticsCore(url, {
    ...options,
    fetch: async (target) => {
      calls.push(target);
      if (target.endsWith(".png")) return new Response(null, { status: 200, headers: { "content-type": "image/png" } });
      return new Response(JSON.stringify(manifest()), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

const frames = (): CloudFrame[] =>
  manifest().frames.map((frame, index) => ({
    leadHours: index * 3,
    validAt: frame.valid_at,
    imageUrl: frame.image_url,
  }));

// ── 1, 2, 3, 4: the payload ──────────────────────────────────────────────────

test("the frame list costs no extra manifest request", async () => {
  const calls: string[] = [];
  await checkEcmwf({ now: NOW, request: stub(calls) });

  const manifests = calls.filter((url) => url.endsWith("manifest.json"));
  assert.equal(manifests.length, 1, "the manifest is still fetched exactly once");
  // The first and last frame are probed to prove the publish is not broken -- unchanged behaviour.
  const images = calls.filter((url) => url.endsWith(".png"));
  assert.equal(images.length, 2, "still only two images are sampled, not all 17");
  assert.equal(calls.length, 3);
});

test("the existing summary fields are untouched", async () => {
  const health = await checkEcmwf({ now: NOW, request: stub([]) });
  const data = health.data!;
  assert.equal(data.modelRun, "2026-09-05 06Z");
  assert.equal(data.frames, "17 / 17");
  assert.equal(data.coverage, "run → +48h");
  assert.equal(data.latestValid, "2026-09-07 06:00 UTC");
  assert.equal(data.images, "2 / 2 sampled OK");
  assert.equal(data.model, "ECMWF IFS Open Data (0.25 degree)");
  assert.equal(data.generatedAt, "2026-09-05 12:52 UTC");
  assert.equal(typeof data.expectedRun, "string");
  assert.equal(health.status, "ok");
  assert.equal(health.provenance?.mode, "production");
});

test("forecastFrames carries every validated frame, mapped from the manifest", async () => {
  const health = await checkEcmwf({ now: NOW, request: stub([]) });
  const stored = health.data?.forecastFrames as CloudFrame[];
  const source = manifest().frames;

  assert.equal(stored.length, 17, "all 17 published frames are kept");
  assert.equal(stored.length, source.length);

  stored.forEach((frame, index) => {
    assert.equal(frame.validAt, source[index].valid_at, `frame ${index} validAt`);
    assert.equal(frame.imageUrl, source[index].image_url, `frame ${index} imageUrl`);
    // leadHours is measured from the run, not parsed out of the file name.
    assert.equal(frame.leadHours, index * CLOUD_FRAME_STEP_HOURS, `frame ${index} leadHours`);
    assert.equal(
      Date.parse(frame.validAt) - Date.parse(RUN_AT),
      frame.leadHours * 3_600_000,
      `frame ${index} leadHours must agree with validAt`,
    );
  });

  assert.equal(stored[0].leadHours, 0);
  assert.equal(stored[16].leadHours, 48);
  // Stored as a normalised ISO instant, which is the same moment the manifest named.
  assert.equal(health.data?.forecastRunAt, new Date(RUN_AT).toISOString());
  assert.equal(health.data?.forecastGeneratedAt, "2026-09-05T12:52:00.000Z");
});

// ── 5: the merge contract ────────────────────────────────────────────────────

test("a failed collection keeps the frames the last good one stored", () => {
  const good = {
    id: "ecmwf",
    name: "ECMWF Cloud Forecast",
    status: "ok" as const,
    checkedAt: "2026-09-05T13:00:00Z",
    networkOk: true,
    parseOk: true,
    data: { modelRun: "2026-09-05 06Z", forecastFrames: frames(), forecastRunAt: RUN_AT },
    provenance: { mode: "production" as const },
  };
  const failed = { ...good, checkedAt: "2026-09-05T14:00:00Z", status: "error" as const, networkOk: false, data: undefined };

  const after = mergeSource(mergeSource(undefined, good), failed);
  assert.equal(after.status, "error");
  const kept = (after.data as Record<string, unknown>).forecastFrames as CloudFrame[];
  assert.equal(kept.length, 17, "the stored frames must survive a failed collection");
  assert.equal(kept[0].imageUrl, `${BASE}/tcc-00h.png`);
  assert.equal((after.data as Record<string, unknown>).forecastRunAt, RUN_AT);
  assert.equal((after.data as Record<string, unknown>).modelRun, "2026-09-05 06Z");
});

// ── 9: frameAt parity ────────────────────────────────────────────────────────

test("frame selection matches the app's frameAt, including between frames", () => {
  const list = frames();
  const base = new Date(RUN_AT);
  const at = (offsetHours: number) => frameAt(list, new Date(base.getTime() + offsetHours * 3_600_000));

  // Exactly on a frame.
  assert.equal(at(0)?.leadHours, 0);
  assert.equal(at(3)?.leadHours, 3);
  assert.equal(at(12)?.leadHours, 12);
  assert.equal(at(24)?.leadHours, 24);
  // Between frames: the nearest one, not the next one forward.
  assert.equal(at(1)?.leadHours, 0);
  assert.equal(at(2)?.leadHours, 3);
  assert.equal(at(7)?.leadHours, 6);
  assert.equal(at(23)?.leadHours, 24);
  // An exact midpoint is 90 minutes from both; the app's minByOrNull keeps the earlier one.
  assert.equal(at(1.5)?.leadHours, 0);
  assert.equal(CLOUD_FRAME_TOLERANCE_SECONDS, 5400);

  // Past the published range there is no frame rather than a stale one.
  assert.equal(at(48)?.leadHours, 48);
  assert.equal(at(49.4)?.leadHours, 48);
  assert.equal(at(50), undefined, "beyond 90 minutes past the last frame, nothing is shown");
  assert.equal(frameAt([], base), undefined);
  assert.equal(frameAt(undefined, base), undefined);
});

test("the viewer stops at 24 hours even though the publisher keeps 48", () => {
  assert.equal(CLOUD_FORECAST_MAX_HOURS, 24);
  assert.equal(CLOUD_FRAME_STEP_HOURS, 3);
  assert.equal(frames().length, 17, "the payload still carries the publisher's full run");

  const component = read("src/components/CloudForecastMap.tsx");
  assert.match(component, /max=\{CLOUD_FORECAST_MAX_HOURS\}/);
  assert.match(component, /min=\{0\}/);
  assert.match(component, /useState\(0\)/);
});

test("the app's own limit and tolerance are what these numbers came from", { skip: !hasAndroid }, () => {
  const viewModel = readAndroid("ui/map/MapViewModel.kt");
  assert.match(viewModel, /const val MAX_FORECAST_HOURS = 24/);

  const remote = readAndroid("data/remote/EcmwfCloudForecast.kt");
  assert.match(remote, /minByOrNull/);
  assert.match(remote, /<= 90\.minutes/);

  const screen = readAndroid("ui/map/MapScreen.kt");
  assert.match(screen, /valueRange = 0f\.\.24f/);
});

// ── 10, 11: the map style ────────────────────────────────────────────────────

test("the forecast palette is the app's, colour for colour", () => {
  assert.equal(FORECAST_OCEAN_COLOR, "#294D61");
  assert.equal(FORECAST_LAND_COLOR, "#4D625E");
  assert.equal(FORECAST_COAST_COLOR, "#B8CDD2");

  const style = buildCloudForecastStyle("/iceland.geojson", `${BASE}/tcc-00h.png`, []);
  const paint = (id: string) => style.layers.find((layer) => layer.id === id)!.paint as Record<string, unknown>;
  assert.equal(paint("background")["background-color"], "#294D61");
  assert.equal(paint("land-fill")["fill-color"], "#4D625E");
  assert.equal(paint("coastline")["line-color"], "#B8CDD2");
  assert.equal(paint("coastline")["line-width"], 1.4);

  // The coastline is drawn over the cloud image, as the app draws it.
  const order = style.layers.map((layer) => layer.id);
  assert.equal(order.indexOf("ecmwf-cloud-forecast") < order.indexOf("coastline"), true);
  assert.equal(order.indexOf("coastline") < order.indexOf("site-circles"), true);

  assert.equal(paint("ecmwf-cloud-forecast")["raster-opacity"], CLOUD_RASTER_OPACITY);
  assert.equal(CLOUD_RASTER_OPACITY, 0.62);
  assert.equal(paint("ecmwf-cloud-forecast")["raster-fade-duration"], 250);
});

test("the cloud image covers exactly the app's box, corners in the app's order", () => {
  assert.equal(CLOUD_IMAGE_LAT_MIN, 63.4);
  assert.equal(CLOUD_IMAGE_LAT_MAX, 66.54);
  assert.equal(CLOUD_IMAGE_LON_MIN, -24.54);
  assert.equal(CLOUD_IMAGE_LON_MAX, -13.5);

  // top-left, top-right, bottom-right, bottom-left
  assert.deepEqual(CLOUD_IMAGE_COORDINATES, [
    [-24.54, 66.54],
    [-13.5, 66.54],
    [-13.5, 63.4],
    [-24.54, 63.4],
  ]);

  const style = buildCloudForecastStyle("/iceland.geojson", `${BASE}/tcc-00h.png`, []);
  const source = style.sources["ecmwf-cloud-forecast"] as Record<string, unknown>;
  assert.equal(source.type, "image");
  assert.equal(source.url, `${BASE}/tcc-00h.png`);
  assert.deepEqual(source.coordinates, CLOUD_IMAGE_COORDINATES);
  assert.equal(source.attribution, CLOUD_ATTRIBUTION);
  assert.equal(CLOUD_ATTRIBUTION, "ECMWF © CC BY 4.0");

  // With no frame there is simply no image source, rather than a broken one.
  const bare = buildCloudForecastStyle("/iceland.geojson", undefined, []);
  assert.equal("ecmwf-cloud-forecast" in bare.sources, false);
  assert.equal(bare.layers.some((layer) => layer.id === "ecmwf-cloud-forecast"), false);
});

test("the palette and bounds are the app's own values", { skip: !hasAndroid }, () => {
  const kotlin = readAndroid("ui/map/MapStyleFactory.kt");
  assert.match(kotlin, /COLOR_FORECAST_OCEAN = "#294D61"/);
  assert.match(kotlin, /COLOR_FORECAST_LAND = "#4D625E"/);
  assert.match(kotlin, /COLOR_FORECAST_COAST = "#B8CDD2"/);
  assert.match(kotlin, /LAT_MIN = 63\.40/);
  assert.match(kotlin, /LAT_MAX = 66\.54/);
  assert.match(kotlin, /LON_MIN = -24\.54/);
  assert.match(kotlin, /LON_MAX = -13\.50/);
  assert.match(kotlin, /put\("raster-opacity", 0\.62\)/);
  assert.match(kotlin, /put\("attribution", "ECMWF © CC BY 4\.0"\)/);
});

// ── 12: the legend and the marker colours ────────────────────────────────────

test("the legend is the app's four bands, with its own labels", () => {
  assert.deepEqual(CLOUD_LEGEND.map((entry) => entry.color), ["#4ADE80", "#FDE047", "#FB923C", "#F87171"]);
  assert.deepEqual(CLOUD_LEGEND.map((entry) => entry.label), [
    "少雲 0–20%",
    "20–50%",
    "50–75%",
    "75–100%",
  ]);
});

test("marker colours follow cloudForecastColor's thresholds exactly", () => {
  assert.equal(cloudForecastColor(undefined), "#64748B");
  assert.equal(cloudForecastColor(0), "#4ADE80");
  assert.equal(cloudForecastColor(20), "#4ADE80");
  assert.equal(cloudForecastColor(20.1), "#FDE047");
  assert.equal(cloudForecastColor(50), "#FDE047");
  assert.equal(cloudForecastColor(50.1), "#FB923C");
  assert.equal(cloudForecastColor(75), "#FB923C");
  assert.equal(cloudForecastColor(75.1), "#F87171");
  assert.equal(cloudForecastColor(100), "#F87171");
});

test("the thresholds are the app's own", { skip: !hasAndroid }, () => {
  const viewModel = readAndroid("ui/map/MapViewModel.kt");
  assert.match(viewModel, /obstruction <= 20\.0 -> "#4ADE80"/);
  assert.match(viewModel, /obstruction <= 50\.0 -> "#FDE047"/);
  assert.match(viewModel, /obstruction <= 75\.0 -> "#FB923C"/);
  assert.match(viewModel, /else -> "#F87171"/);
});

// ── 15: the sites ────────────────────────────────────────────────────────────

test("site markers are recoloured from the stored hourly weather at the selected hour", () => {
  const start = Date.parse("2026-09-05T06:00:00Z");
  const hours = (values: number[]): WeatherHour[] =>
    values.map((low, index) => ({
      time: new Date(start + index * 3_600_000).toISOString(),
      cloudLowPercent: low,
      cloudMediumPercent: 0,
      cloudHighPercent: 0,
    }));

  const sites = [
    // Clear now, overcast in six hours.
    { id: "a", name: "A", nameZh: "甲", lat: 64, lon: -20, hours: hours([0, 0, 0, 0, 0, 0, 100]) },
    // No series at all: the app's neutral colour, never "clear".
    { id: "b", name: "B", nameZh: "乙", lat: 65, lon: -18 },
  ];

  const at = (offset: number) =>
    cloudForecastMarkersAt(
      sites,
      new Date(start + offset * 3_600_000),
      (hour) => (hour ? effectiveObstruction(hour) : undefined),
      hourAt,
    );

  const now = at(0);
  assert.equal(now.length, 2);
  assert.equal(now[0].color, "#4ADE80");
  assert.equal(now[0].score, 100, "score is 100 - obstruction, as the app computes it");
  assert.equal(now[1].color, "#64748B");
  assert.equal(now[1].score, 0);

  const later = at(6);
  assert.equal(later[0].color, "#F87171", "the same site must change with the selected hour");
  assert.equal(later[0].score, 0);
  // Positions never move.
  assert.deepEqual(later.map((marker) => [marker.lat, marker.lon]), [[64, -20], [65, -18]]);
});

test("the viewer's sites are the app's 32, with the app's circle paint", { skip: !hasAndroid }, () => {
  const kotlin = readAndroid("data/sites/IcelandAuroraSites.kt");
  assert.equal(WEATHER_SITES.length, 32);
  for (const site of WEATHER_SITES) {
    assert.equal(kotlin.includes(`id = "${site.id}"`), true, `${site.id} is not in IcelandAuroraSites.all`);
    assert.equal(
      kotlin.includes(`lat = ${site.lat}, lon = ${site.lon}`) ||
        new RegExp(`lat = ${site.lat.toFixed(4)}, lon = ${site.lon.toFixed(4)}`).test(kotlin),
      true,
      `${site.id} coordinates do not match the app`,
    );
  }

  const style = buildCloudForecastStyle("/iceland.geojson", undefined, []);
  const paint = style.layers.find((layer) => layer.id === "site-circles")!.paint as Record<string, unknown>;
  assert.equal(paint["circle-radius"], 7);
  assert.equal(paint["circle-stroke-width"], 2);
  assert.equal(paint["circle-stroke-color"], "#F8FAFC");
  assert.equal(paint["circle-opacity"], 0.95);
  assert.deepEqual(paint["circle-color"], ["to-color", ["get", "color"]]);
});

// ── 6, 7, 13, 14, 16: the viewer's behaviour ─────────────────────────────────

test("the viewer is collapsed by default and loads nothing until opened", () => {
  const sections = read("src/components/SourceSections.tsx");
  // A disclosure, exactly like the weather and road maps -- closed until clicked.
  assert.match(sections, /<MapDisclosure label="展開雲層預報">/);
  assert.match(sections, /<CloudForecastMap/);
  // The component is a separate chunk that is not even imported until the card renders it.
  assert.match(sections, /dynamic\(\s*\(\) => import\("@\/components\/CloudForecastMap"\)/);
  assert.match(sections, /ssr: false/);

  const disclosure = read("src/components/MapDisclosure.tsx");
  // Children are mounted only once opened, so no frame can be requested while collapsed.
  assert.equal(/useState\((false|)\)/.test(disclosure), true);
});

test("only the selected frame is ever requested", () => {
  const component = read("src/components/CloudForecastMap.tsx");
  // One frame goes into the style, and the slider swaps that one image.
  assert.match(component, /frame\?\.imageUrl/);
  assert.match(component, /source\.updateImage\(\{ url: frame\.imageUrl/);
  // Nothing preloads the run: no loop over the frame list building images.
  assert.equal(/frames\.map\([^)]*Image\(|new Image\(|preload/.test(component), false);
});

test("the slider updates the sources instead of rebuilding the map", () => {
  const component = read("src/components/CloudForecastMap.tsx");
  // The map is constructed once, in an effect with no dependencies.
  assert.equal((component.match(/new maplibre\.Map\(/g) ?? []).length, 1);
  // The image and the markers are updated in place.
  assert.match(component, /map\.getSource\("ecmwf-cloud-forecast"\)/);
  assert.match(component, /map\.getSource\("sites"\)/);
  assert.match(component, /source\?\.setData\?\.\(siteFeatureCollection\(markers\)\)/);
  // No setStyle call: rebuilding would re-fetch the outline and lose the reader's pan and zoom.
  assert.equal(/\.setStyle\(/.test(component), false);
});

test("the map cannot be rotated or tilted", () => {
  const component = read("src/components/CloudForecastMap.tsx");
  assert.match(component, /dragRotate: false/);
  assert.match(component, /pitchWithRotate: false/);
  assert.match(component, /touchZoomRotate: true/);
});

test("the browser reaches ECMWF only through our own published images", () => {
  for (const file of ["src/components/CloudForecastMap.tsx", "src/lib/cloudForecast.ts"]) {
    const source = read(file);
    // No upstream ECMWF, no GRIB service, no GitHub API.
    assert.equal(/ecmwf\.int|open-data\.ecmwf|grib|api\.github\.com/i.test(source), false, `${file} reaches upstream`);
    assert.equal(/ECMWF_MANIFEST_URL|checkEcmwf/.test(source), false, `${file} must not reach the monitor`);
  }
  const component = read("src/components/CloudForecastMap.tsx");
  // The image URLs come from the snapshot, never built in the browser.
  assert.equal(/iceland-aurora-cloud/.test(component), false, "frame URLs must come from the payload");
  assert.equal(/[^.\w]fetch\(/.test(component), false, "the viewer must not fetch anything itself");
});

// ── The control panel ────────────────────────────────────────────────────────

test("the three timestamps are distinct and Iceland local", () => {
  // Generated, run and valid are three different instants and must never be collapsed into one.
  assert.equal(formatIcelandDateTime("2026-09-05T12:52:00Z"), "09/05 12:52");
  assert.equal(formatIcelandDateTime("2026-09-05T06:00:00Z"), "09/05 06:00");
  assert.equal(formatIcelandDateTime("2026-09-05T18:00:00Z"), "09/05 18:00");
  assert.equal(formatIcelandDateTime(undefined), undefined);
  assert.equal(formatIcelandDateTime("nonsense"), undefined);

  // Iceland keeps UTC all year, so a UTC instant reads as the same clock time there -- and
  // deliberately not as the reader's own, which is the one label that would mislead.
  assert.equal(formatForecastOffset("9/5 18:00", 12), "預測 9/5 18:00 · 12 小時後");

  const component = read("src/components/CloudForecastMap.tsx");
  assert.match(component, /formatGeneratedAt\(generated\)/);
  assert.match(component, /formatRunAt\(run\)/);
  assert.match(component, /formatValidAt\(valid\)/);
  // The Kp line the app prints is left out rather than invented, and says so.
  assert.match(component, /未收集 NOAA 三日 Kp 預報序列/);
});

test("the panel carries the app's wording, in the app's order", () => {
  const source = read("src/components/CloudForecastMap.tsx");
  // Only the rendered panel, so the import list at the top cannot satisfy the ordering.
  const component = source.slice(source.indexOf("<div className=\"cloud-forecast\">"));
  const order = [
    "CLOUD_FORECAST_TITLE",
    "CLOUD_FORECAST_NOW",
    'type="range"',
    "cloud-forecast-timing",
    "cloud-forecast-legend",
    "CLOUD_FRAME_AVAILABLE",
    "CLOUD_FORECAST_NOTE",
    "CLOUD_ATTRIBUTION",
  ];
  let previous = -1;
  for (const token of order) {
    const index = component.indexOf(token);
    assert.equal(index > previous, true, `${token} is out of the app's order`);
    previous = index;
  }
});

test("the card keeps its monitoring stats and stops describing 48 hours to the reader", () => {
  const sections = read("src/components/SourceSections.tsx");
  // The publisher's coverage stays visible as an operator stat.
  assert.match(sections, /label="模式時次"/);
  assert.match(sections, /label="預報涵蓋"/);
  assert.match(sections, /label="預報時段"/);
  // The headline no longer promises two days, because the viewer shows one.
  assert.match(sections, /ECMWF 雲層預報資料正常更新。/);
  assert.equal(sections.includes("未來兩天的雲層預報已備妥。"), false);
});
