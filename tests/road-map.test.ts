import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  ALL_MARKER_IDS,
  buildRoadStyle,
  ICELAND_CAMERA_BOUNDS,
  INCIDENT_KIND_ICONS,
  incidentIconId,
  MARKER_IDS,
  readFeature,
  ROAD_CASING,
  ROAD_COAST,
  ROAD_LAND,
  ROAD_OCEAN,
  ROAD_QUERY_ORDER,
  ROAD_SOURCE_URLS,
  ROAD_STATUS_DEFAULT_COLOR,
  ROAD_STATUS_LINE_COLORS,
  ROAD_TAP_TOLERANCE,
  roadDisplayTitle,
  roadStatusColor,
  roadStatusEnglish,
  roadStatusLabel,
  STATION_LABEL,
  STATION_TRAFFIC_COLOR,
  STATION_WEATHER_COLOR,
} from "../src/lib/roadMap";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ANDROID_STYLE = "../iceland-aurora/app/src/main/java/com/iceland/aurora/ui/roadinfo/RoadInfoStyleFactory.kt";
const hasAndroid = existsSync(resolve(process.cwd(), ANDROID_STYLE));

// ── 7. Road status colours ────────────────────────────────────────────────────

test("every road status the app colours is carried over, with the same fallback", () => {
  assert.deepEqual(ROAD_STATUS_LINE_COLORS, [
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
  ]);
  // Anything not listed is "no reported restriction", which is green — not an error colour.
  assert.equal(ROAD_STATUS_DEFAULT_COLOR, "#16A34A");
  // Thirteen distinct states, not a red/amber/green simplification.
  assert.equal(ROAD_STATUS_LINE_COLORS.length, 13);
});

test("the line colours are exactly the app's, read from its own style factory", { skip: !hasAndroid }, () => {
  const kotlin = read(ANDROID_STYLE);
  for (const [status, color] of ROAD_STATUS_LINE_COLORS) {
    const pattern = new RegExp(`add\\("${status}"\\); add\\("${color}"\\)`);
    assert.match(kotlin, pattern, `${status} -> ${color}`);
  }
  assert.match(kotlin, new RegExp(`add\\("${ROAD_STATUS_DEFAULT_COLOR}"\\)`));
  for (const [name, color] of [
    ["ocean", ROAD_OCEAN],
    ["land", ROAD_LAND],
    ["coast", ROAD_COAST],
    ["casing", ROAD_CASING],
    ["station traffic", STATION_TRAFFIC_COLOR],
    ["station weather", STATION_WEATHER_COLOR],
  ] as const) {
    assert.equal(kotlin.includes(color), true, `${name} colour ${color} is not in the app's style`);
  }
});

test("the detail card keeps its own status colours, which are not the line colours", () => {
  // The app deliberately maintains two mappings; an accident is red in the card.
  assert.equal(roadStatusColor("closed"), "#E53935");
  assert.equal(roadStatusColor("closure"), "#E53935");
  assert.equal(roadStatusColor("accident"), "#E53935");
  assert.equal(roadStatusColor("mountain_vehicles"), "#8E44AD");
  assert.equal(roadStatusColor("unknown"), "#64748B");
  assert.equal(roadStatusColor("no_reported_restriction"), "#16A34A");
  assert.equal(roadStatusColor("easily_passable"), "#16A34A");
  assert.equal(roadStatusColor("station"), "#0EA5E9");
  assert.equal(roadStatusColor("roadworks"), "#F59E0B", "anything else is amber");
  // A road with an accident is amber as a line but red in the card — both are the app's.
  assert.notEqual(roadStatusColor("accident"), ROAD_STATUS_DEFAULT_COLOR);
});

test("status labels cover every case the app names, in both languages", () => {
  assert.equal(roadStatusLabel("closed"), "封閉／無法通行");
  assert.equal(roadStatusLabel("closure"), "封閉／無法通行");
  assert.equal(roadStatusLabel("mountain_vehicles"), "僅限高性能越野車");
  assert.equal(roadStatusLabel("extremely_slippery"), "極度濕滑");
  assert.equal(roadStatusLabel("loose_gravel"), "碎石／路面狀況不佳");
  assert.equal(roadStatusLabel("road_surface"), "碎石／路面狀況不佳");
  assert.equal(roadStatusLabel("easily_passable"), "未回報通行限制");
  assert.equal(roadStatusLabel("no_reported_restriction"), "未回報通行限制");
  assert.equal(roadStatusLabel("station"), "車流與道路氣象測量站");
  assert.equal(roadStatusLabel("something_new"), "限制／注意通行", "unknown states fall back, never crash");

  assert.equal(roadStatusEnglish("closed"), "Closed / impassable");
  assert.equal(roadStatusEnglish("animals"), "Animals on road");
  assert.equal(roadStatusEnglish("no_reported_restriction"), "No reported restriction");
  // The app un-snake-cases anything it does not know rather than dropping it.
  assert.equal(roadStatusEnglish("some_new_state"), "Some new state");
});

// ── 8. Incident markers ───────────────────────────────────────────────────────

test("incident kinds map to the app's marker artwork, with warning as the fallback", () => {
  assert.deepEqual(INCIDENT_KIND_ICONS, [
    ["closure", MARKER_IDS.CLOSURE],
    ["roadworks", MARKER_IDS.ROADWORKS],
    ["accident", MARKER_IDS.ACCIDENT],
    ["animals", MARKER_IDS.ANIMALS],
    ["road_surface", MARKER_IDS.ROAD_SURFACE],
  ]);
  assert.equal(incidentIconId("closure"), "incident-closure");
  assert.equal(incidentIconId("roadworks"), "incident-roadworks");
  assert.equal(incidentIconId("accident"), "incident-accident");
  assert.equal(incidentIconId("animals"), "incident-animals");
  assert.equal(incidentIconId("road_surface"), "incident-road-surface");
  assert.equal(incidentIconId("anything-else"), "incident-warning");
  assert.equal(ALL_MARKER_IDS.length, 6);
});

test("the marker ids are the app's own constants", { skip: !hasAndroid }, () => {
  const kotlin = read("../iceland-aurora/app/src/main/java/com/iceland/aurora/ui/roadinfo/RoadMarkerIconFactory.kt");
  for (const id of ALL_MARKER_IDS) {
    assert.equal(kotlin.includes(`"${id}"`), true, `${id} is not an app marker id`);
  }
});

// ── The style ─────────────────────────────────────────────────────────────────

test("the style is the app's, layer for layer and value for value", () => {
  const style = buildRoadStyle("/data/iceland.geojson");

  assert.equal(style.version, 8);
  assert.deepEqual(
    style.layers.map((layer) => layer.id),
    ["ocean", "land", "coast", "road-casing", "road-lines", "incident-markers", "station-markers"],
  );

  const layer = (id: string) => style.layers.find((candidate) => candidate.id === id) as never as Record<string, never>;
  assert.equal((layer("ocean").paint as Record<string, string>)["background-color"], ROAD_OCEAN);
  assert.equal((layer("land").paint as Record<string, string>)["fill-color"], ROAD_LAND);
  assert.equal((layer("coast").paint as Record<string, string>)["line-color"], ROAD_COAST);

  const casing = layer("road-casing").paint as unknown as Record<string, unknown>;
  assert.equal(casing["line-color"], ROAD_CASING);
  assert.equal(casing["line-opacity"], 0.82);
  assert.deepEqual(casing["line-width"], ["interpolate", ["linear"], ["zoom"], 4, 2.8, 9, 7.0]);

  const lines = layer("road-lines").paint as unknown as Record<string, unknown>;
  assert.deepEqual(lines["line-width"], ["interpolate", ["linear"], ["zoom"], 4, 1.7, 9, 5.2]);
  const match = lines["line-color"] as unknown[];
  assert.equal(match[0], "match");
  assert.deepEqual(match[1], ["get", "status"]);
  assert.equal(match[match.length - 1], ROAD_STATUS_DEFAULT_COLOR);

  const stations = layer("station-markers").paint as unknown as Record<string, unknown>;
  assert.deepEqual(stations["circle-color"], ["case", ["get", "has_traffic"], STATION_TRAFFIC_COLOR, STATION_WEATHER_COLOR]);
  assert.deepEqual(stations["circle-radius"], ["interpolate", ["linear"], ["zoom"], 4, 4, 9, 7]);
  assert.equal(stations["circle-stroke-color"], "#FFFFFF");
  assert.equal(stations["circle-stroke-width"], 1.5);

  const incidents = layer("incident-markers").layout as unknown as Record<string, unknown>;
  assert.deepEqual(incidents["icon-size"], ["interpolate", ["linear"], ["zoom"], 4, 1.0, 9, 1.5]);
  assert.equal(incidents["icon-allow-overlap"], true);
  assert.equal(incidents["icon-ignore-placement"], true);
});

test("the map reads only our own published artifacts, never IRCA", () => {
  const style = buildRoadStyle("/data/iceland.geojson");
  const sources = style.sources as Record<string, { data: string }>;

  assert.equal(sources.roads.data, ROAD_SOURCE_URLS.roads);
  assert.equal(sources.incidents.data, ROAD_SOURCE_URLS.incidents);
  assert.equal(sources.stations.data, ROAD_SOURCE_URLS.stations);
  assert.equal(sources.iceland.data, "/data/iceland.geojson", "the outline is this site's own asset");

  for (const url of Object.values(ROAD_SOURCE_URLS)) {
    assert.match(url, /^https:\/\/lovemonlin\.github\.io\/iceland-aurora-cloud\//);
  }
  // Nothing in the road layer may point at an upstream provider.
  const serialised = JSON.stringify(style);
  for (const forbidden of ["umferdin.is", "api.met.no", "api.github.com", "services.swpc.noaa.gov", "vedur.is", "ecmwf.int"]) {
    assert.equal(serialised.includes(forbidden), false, `the style must not reference ${forbidden}`);
  }
});

test("the camera frames Iceland the way the app frames it", () => {
  assert.deepEqual(ICELAND_CAMERA_BOUNDS, [
    [-24.8, 63.2],
    [-13.2, 66.7],
  ]);
  assert.equal(ROAD_TAP_TOLERANCE, 16);
  // Queried marker-first, so a marker always wins over the road under it.
  assert.deepEqual(ROAD_QUERY_ORDER, ["incident-markers", "station-markers", "road-lines"]);
  assert.equal(STATION_LABEL.minZoom, 7);
  assert.equal(STATION_LABEL.fontSize, 11);
  assert.equal(STATION_LABEL.color, "#0F172A");
});

// ── Feature reading and titles ────────────────────────────────────────────────

test("a clicked feature is read into the app's fields", () => {
  const station = readFeature(
    { id: "s1", name: "Hellisheiði", temperature: "-2", wind_speed: "12", traffic_today: "410", map_label: "x" },
    "STATION",
  );
  assert.equal(station.status, "station", "a station's status is fixed, not read from the feature");
  assert.equal(station.temperature, "-2");
  assert.equal(station.trafficToday, "410");
  assert.equal(station.roadNumber, "", "missing properties become empty strings, never undefined");

  const incident = readFeature({ kind: "roadworks", status: "closed" }, "INCIDENT");
  assert.equal(incident.status, "roadworks", "an incident's status comes from `kind`");

  const road = readFeature({ status: "slippery", name: "Suðurlandsvegur", road_number: "1" }, "ROAD");
  assert.equal(road.status, "slippery");
});

test("titles follow the app's rules for each item type", () => {
  const base = readFeature({}, "ROAD");
  assert.equal(roadDisplayTitle({ ...base, name: "Suðurlandsvegur", roadNumber: "1" }), "Suðurlandsvegur · 1 號道路");
  assert.equal(roadDisplayTitle({ ...base, name: "Suðurlandsvegur" }), "Suðurlandsvegur");
  assert.equal(roadDisplayTitle({ ...base, roadNumber: "35" }), "35 號道路");
  assert.equal(roadDisplayTitle(base), "道路區段");
  assert.equal(roadDisplayTitle({ ...base, type: "INCIDENT", status: "accident" }), "交通事故");
  assert.equal(roadDisplayTitle({ ...base, type: "STATION" }), "車流與道路氣象測量站");
  assert.equal(roadDisplayTitle({ ...base, type: "STATION", name: "Hellisheiði" }), "Hellisheiði");
});

// ── 9-11. Collapsed by default, and nothing loads until it is opened ──────────

test("both maps start collapsed and are not mounted until asked for", () => {
  const disclosure = read("src/components/MapDisclosure.tsx");
  // Closed on first render...
  assert.match(disclosure, /useState\(false\)/);
  assert.match(disclosure, /aria-expanded=\{open\}/);
  assert.match(disclosure, /aria-controls=\{panelId\}/);
  // ...and the children do not exist at all until the button has been pressed once.
  assert.match(disclosure, /\{mounted \? children : null\}/);
  assert.match(disclosure, /hidden=\{!open\}/);

  const sections = read("src/components/SourceSections.tsx");
  assert.match(sections, /<MapDisclosure label="展開全島天氣">/);
  assert.match(sections, /<MapDisclosure label="展開全島道路">/);
});

test("no road GeoJSON is requested, and MapLibre is not loaded, before the road map expands", () => {
  const sections = read("src/components/SourceSections.tsx");
  const dashboard = read("src/components/Dashboard.tsx");
  const card = read("src/components/StatusCard.tsx");

  // The three production URLs appear only in the road map's own module.
  for (const source of [sections, dashboard, card]) {
    for (const url of Object.values(ROAD_SOURCE_URLS)) {
      assert.equal(source.includes(url), false, "a road GeoJSON URL leaked into an always-rendered component");
    }
  }

  const roadMap = read("src/components/RoadMap.tsx");
  // The library is imported dynamically, inside the effect, so it is not in the first-load bundle.
  assert.match(roadMap, /await import\("maplibre-gl"\)/);
  assert.equal(/^import \* as maplibre|^import maplibre from/m.test(roadMap), false);
  // The only static import from the library is its types and stylesheet.
  assert.match(roadMap, /import type \{ Map as MapLibreMap/);
  // Once created the map is kept, so collapsing does not throw the downloaded data away.
  assert.match(roadMap, /if \(!container \|\| mapRef\.current\) return;/);
  // And it resizes when the container becomes visible. Resizing alone is not enough: a map built
  // at zero size has already fitted Iceland into nothing, so the bounds are fitted again too.
  assert.match(roadMap, /new ResizeObserver/);
  assert.match(roadMap, /map\.resize\(\)/);
  assert.match(roadMap, /if \(width === 0 \|\| height === 0\) return;/);
  assert.match(roadMap, /if \(!hadSize\) \{/);
  assert.match(roadMap, /function frameIceland/);
});

test("the browser still reaches no upstream provider from anywhere in the UI", () => {
  for (const file of [
    "src/components/Dashboard.tsx",
    "src/components/SourceSections.tsx",
    "src/components/StatusCard.tsx",
    "src/components/WeatherMap.tsx",
    "src/components/RoadMap.tsx",
    "src/components/MapDisclosure.tsx",
    "src/lib/weatherMap.ts",
    "src/lib/roadMap.ts",
  ]) {
    const source = read(file);
    for (const forbidden of [
      "api.met.no",
      "umferdin.is",
      "api.github.com",
      "services.swpc.noaa.gov",
      "vedur.is",
      "ecmwf.int",
      "runAllMonitors",
      "fetchWithDiagnostics",
    ]) {
      assert.equal(source.includes(forbidden), false, `${file} must not reference ${forbidden}`);
    }
  }
});
