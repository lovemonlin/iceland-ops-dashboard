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
  EVENT_LEGEND,
  ROAD_CASING,
  ROAD_COAST,
  ROAD_LAND,
  ROAD_LEGEND,
  ROAD_MODES,
  ROAD_OCEAN,
  ROAD_QUERY_ORDER,
  ROAD_SOURCE_URLS,
  ROAD_STATUS_DEFAULT_COLOR,
  ROAD_STATUS_LINE_COLORS,
  ROAD_TAP_TOLERANCE,
  roadDisplayTitle,
  roadLayerVisibility,
  roadStatusColor,
  roadStatusEnglish,
  roadStatusLabel,
  STATION_LABEL,
  STATION_LEGEND,
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

// ── The app's two road display modes ──────────────────────────────────────────

test("both of the app's road screens exist, under the app's own names", () => {
  assert.deepEqual(ROAD_MODES, [
    { mode: "EVENTS", label: "道路狀況＋封路與施工" },
    { mode: "STATIONS", label: "道路狀況＋車流與氣象" },
  ]);
});

test("the mode names are the app's strings, not a paraphrase", { skip: !hasAndroid }, () => {
  const strings = read("../iceland-aurora/app/src/main/res/values-zh-rTW/strings.xml");
  for (const entry of ROAD_MODES) {
    assert.equal(strings.includes(`>${entry.label}<`), true, `${entry.label} is not an app string`);
  }
  // And the app really does define exactly these two.
  const screen = read("../iceland-aurora/app/src/main/java/com/iceland/aurora/ui/roadinfo/RoadInfoScreen.kt");
  assert.match(screen, /enum class RoadInfoMode \{ EVENTS, STATIONS \}/);
});

test("both modes always draw the roads; only the overlay changes", () => {
  // RoadInfoScreen.kt:120-124 — showRoads is unconditional in the app too.
  assert.deepEqual(roadLayerVisibility("EVENTS"), {
    showRoads: true,
    showIncidents: true,
    showStations: false,
  });
  assert.deepEqual(roadLayerVisibility("STATIONS"), {
    showRoads: true,
    showIncidents: false,
    showStations: true,
  });
});

test("the legend changes with the mode, as the app's does", () => {
  // The three road colours are shown in both modes...
  assert.equal(ROAD_LEGEND.length, 3);
  assert.deepEqual(ROAD_LEGEND.map((entry) => entry.color), ["#16A34A", "#E53935", "#8E44AD"]);
  // ...then events adds restriction/unknown plus a marker sample, and stations adds its two dots.
  assert.deepEqual(EVENT_LEGEND.map((entry) => entry.color), ["#F59E0B", "#64748B"]);
  assert.deepEqual(STATION_LEGEND.map((entry) => entry.color), [STATION_TRAFFIC_COLOR, STATION_WEATHER_COLOR]);
});

test("the map switches mode by opacity and keeps the loaded data", () => {
  const roadMap = read("src/components/RoadMap.tsx");

  // The app's own mechanism (RoadInfoScreen.kt:409-413): paint properties, not a style rebuild.
  assert.match(roadMap, /setPaintProperty\("road-casing", "line-opacity", showRoads \? 0\.82 : 0\)/);
  assert.match(roadMap, /setPaintProperty\("road-lines", "line-opacity", showRoads \? 1 : 0\)/);
  assert.match(roadMap, /setPaintProperty\("incident-markers", "icon-opacity", showIncidents \? 1 : 0\)/);
  assert.match(roadMap, /setPaintProperty\("station-markers", "circle-opacity", showStations \? 1 : 0\)/);
  // Nothing re-creates the map or its sources when the mode changes.
  assert.equal(/setStyle\(|new maplibre\.Map\(/.test(roadMap.split("useEffect(() => {\n    modeRef.current")[1] ?? ""), false);

  // A feature hidden by the current mode must not be selectable.
  assert.match(roadMap, /if \(layer === "incident-markers" && !visible\.showIncidents\) continue;/);
  assert.match(roadMap, /if \(layer === "station-markers" && !visible\.showStations\) continue;/);

  // The toggle is a real control, not a decorative div.
  assert.match(roadMap, /aria-pressed=\{entry\.mode === mode\}/);
  assert.match(roadMap, /role="group"/);
});

test("a clicked road, incident or station opens one modal dialog", () => {
  const roadMap = read("src/components/RoadMap.tsx");

  // All three feature kinds go through the same selection path, so one dialog serves them all.
  assert.match(roadMap, /const type = layer === "incident-markers" \? "INCIDENT" : layer === "station-markers" \? "STATION" : "ROAD";/);
  assert.match(roadMap, /onSelect\(readFeature\(hit\.properties \?\? \{\}, type\)\);/);
  assert.match(roadMap, /const onSelect = useCallback\(\(item: RoadFeatureItem\) => setSelected\(item\), \[\]\);/);

  // The detail is a dialog, not the inline panel that used to push the Dashboard down.
  assert.match(roadMap, /\{selected && <RoadDetailDialog item=\{selected\} onClose=\{\(\) => setSelected\(null\)\} \/>\}/);
  assert.equal(roadMap.includes("<RoadDetailCard"), false, "the inline detail card must be gone");
  assert.equal(roadMap.includes('className="road-detail"'), false, "the inline detail shell must be gone");
  assert.equal([...roadMap.matchAll(/<RoadDetailDialog/g)].length, 1, "exactly one dialog");
});

test("the road dialog behaves exactly like the weather one", () => {
  const roadMap = read("src/components/RoadMap.tsx");
  const dialog = roadMap.split("function RoadDetailDialog")[1]?.split("function RoadDetailBody")[0] ?? "";
  assert.notEqual(dialog, "", "RoadDetailDialog must exist");

  // Backdrop closes; the dialog itself does not, so a click on the content stays open.
  assert.match(dialog, /className="road-dialog-backdrop" role="presentation" onClick=\{onClose\}/);
  assert.match(dialog, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  // The accessibility contract the weather dialog already sets.
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-label=\{roadDisplayTitle\(item\)\}/);
  // Escape closes, and focus lands on the close control.
  assert.match(dialog, /if \(event\.key === "Escape"\) onClose\(\);/);
  assert.match(dialog, /window\.addEventListener\("keydown", onKey\)/);
  assert.match(dialog, /return \(\) => window\.removeEventListener\("keydown", onKey\)/);
  assert.match(dialog, /closeRef\.current\?\.focus\(\)/);
  assert.match(dialog, /<button ref=\{closeRef\} type="button" onClick=\{onClose\} aria-label="關閉">/);

  // Same interaction as SiteForecastDialog: the source of the pattern is left untouched.
  const weather = read("src/components/SiteForecastDialog.tsx");
  for (const contract of ['role="dialog"', 'aria-modal="true"', 'role="presentation" onClick={onClose}']) {
    assert.equal(weather.includes(contract), true, `the weather dialog lost ${contract}`);
  }
});

test("opening or closing the road dialog cannot rebuild the map", () => {
  const roadMap = read("src/components/RoadMap.tsx");

  // The map is built once, in an effect keyed only on the stable onSelect callback. `selected`
  // is not a dependency, so opening and closing the dialog never re-runs it — the camera, the
  // loaded GeoJSON and the current mode all survive.
  assert.match(roadMap, /\}, \[onSelect\]\);/);
  assert.equal(/\}, \[[^\]]*\bselected\b[^\]]*\]\);/.test(roadMap), false, "no effect may depend on `selected`");
  assert.match(roadMap, /if \(!container \|\| mapRef\.current\) return;/);

  // The dialog itself touches neither the map nor the network.
  const dialog = roadMap.split("function RoadDetailDialog")[1]?.split("function RoadDetailBody")[0] ?? "";
  assert.equal(/fetch\(|mapRef|flyTo|fitBounds|setPaintProperty|new maplibre/.test(dialog), false);
});

test("the road dialog still shows every field the inline card did", () => {
  const roadMap = read("src/components/RoadMap.tsx");
  const body = roadMap.split("function RoadDetailBody")[1] ?? "";

  // Station: the measurements, the caveat and the attribution.
  assert.match(body, /此筆資料更新於 <strong>\{item\.updatedAt\}<\/strong>/);
  assert.match(body, /roadStatusLabel\(item\.status\)/);
  assert.match(body, /<StationDetails item=\{item\} \/>/);
  assert.match(body, /測站數值由官方量測，僅供參考。/);
  // Road / incident: the English source text and both descriptions.
  assert.match(body, /英文原文/);
  assert.match(body, /\{item\.titleEnglish \|\| roadStatusEnglish\(item\.status\)\}/);
  assert.match(body, /\{item\.descriptionEnglish && <p className="road-note">\{item\.descriptionEnglish\}<\/p>\}/);
  assert.match(body, /\{item\.descriptionIcelandic && <p className="road-note">\{item\.descriptionIcelandic\}<\/p>\}/);
  assert.match(body, /\{ROAD_ATTRIBUTION\}/);

  // Every station measurement still has a row, now one label each rather than a run of prose.
  const values = roadMap.split("function StationDetails")[1] ?? "";
  for (const field of ["氣溫", "路面溫度", "風速", "風向", "陣風", "濕度", "車流", "最近", "今日"]) {
    assert.equal(values.includes(field), true, `StationDetails lost ${field}`);
  }
});

test("the road dialog is presented by the same rules as the weather dialog", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

  // Shared by grouping the selectors, so the two can never drift into different presentations.
  assert.match(css, /\.forecast-dialog-backdrop,\s*\n\.road-dialog-backdrop \{/);
  assert.match(css, /\.forecast-dialog,\s*\n\.road-dialog \{/);
  assert.match(css, /\.forecast-dialog-head,\s*\n\.road-dialog-head \{/);
  // Centred over a full-screen backdrop, never full width, and capped so it always fits.
  const backdrop = css.match(/\.forecast-dialog-backdrop,\s*\n\.road-dialog-backdrop \{[^}]*\}/)?.[0] ?? "";
  assert.match(backdrop, /position: fixed/);
  assert.match(backdrop, /inset: 0/);
  assert.match(backdrop, /align-items: center/);
  assert.match(backdrop, /justify-content: center/);
  const shell = css.match(/\.forecast-dialog,\s*\n\.road-dialog \{[^}]*\}/)?.[0] ?? "";
  assert.match(shell, /width: min\(420px, 100%\)/);
  assert.match(shell, /max-height: min\(78vh, 620px\)/);
  // Long content scrolls inside the dialog rather than growing it.
  assert.match(css, /\.road-dialog-body \{[^}]*overflow-y: auto/);
  // The narrow-screen height applies to both.
  assert.match(css, /\.forecast-dialog,\s*\n  \.road-dialog \{ max-height: 86vh; \}/);
  // The inline card's own shell is gone with it.
  assert.equal(/^\.road-detail \{/m.test(css), false, "the inline .road-detail shell must be removed");
});

test("station measurements are label/value rows, not a run of prose", () => {
  const roadMap = read("src/components/RoadMap.tsx");
  const station = roadMap.split("function StationDetails")[1]?.split("function Measurement")[0] ?? "";

  // A definition list: each value is bound to its own label rather than sitting in a sentence.
  assert.match(station, /<dl className="road-values">/);
  assert.match(station, /<Measurement label="氣溫" value=\{`\$\{item\.temperature\}°C`\} \/>/);
  assert.match(station, /<Measurement label="路面溫度" value=\{`\$\{item\.roadTemperature\}°C`\} tone="surface" \/>/);
  assert.match(station, /<Measurement label="風速" value=\{`\$\{item\.windSpeed\} m\/s`\} tone="wind" \/>/);
  assert.match(station, /<Measurement label="風向" value=\{`\$\{item\.windDirection\}°`\} tone="wind" \/>/);
  assert.match(station, /<Measurement label="陣風" value=\{`\$\{item\.windGust\} m\/s`\} tone="wind" \/>/);
  assert.match(station, /<Measurement label="濕度" value=\{`\$\{item\.humidity\}%`\} tone="humidity" \/>/);
  // Traffic is its own section, behind a divider and a heading.
  assert.match(station, /<hr className="road-rule" \/>\s*<p className="road-subhead">車流<\/p>/);
  assert.match(station, /<Measurement label="最近" value=\{item\.trafficRecent \|\| "—"\} tone="recent" \/>/);
  assert.match(station, /<Measurement label="今日" value=\{item\.trafficToday \|\| "—"\} tone="today" \/>/);
  assert.match(station, /此站沒有車流計數器/);
  // The old prose rows are gone.
  assert.equal(/氣溫: \{item\.temperature\}|風（來向）/.test(station), false);

  // The label is always rendered as text, so a tint is never the only thing carrying meaning.
  const row = roadMap.split("function Measurement")[1] ?? "";
  assert.match(row, /<dt>\{label\}<\/dt>/);
  assert.match(row, /className=\{tone \? `road-value tone-\$\{tone\}` : "road-value"\}/);
});

test("the detail body steps down from title to attribution", () => {
  const roadMap = read("src/components/RoadMap.tsx");
  const body = roadMap.split("function RoadDetailBody")[1]?.split("function StationDetails")[0] ?? "";

  // The timestamp is the emphasised part of the banner, not the whole sentence.
  assert.match(body, /此筆資料更新於 <strong>\{item\.updatedAt\}<\/strong>/);
  // The status keeps the authoritative semantic colour.
  assert.match(body, /style=\{\{ color: roadStatusColor\(item\.status\) \}\}/);
  // A divider before the disclaimer, and before the attribution on the road/incident branch.
  assert.equal([...body.matchAll(/<hr className="road-rule" \/>/g)].length, 2);
  // Note and attribution are their own steps, no longer both `muted-line`.
  assert.match(body, /<p className="road-note">測站數值由官方量測，僅供參考。<\/p>/);
  assert.match(body, /<p className="road-primary">\{item\.titleEnglish \|\| roadStatusEnglish\(item\.status\)\}<\/p>/);
  assert.match(body, /<p className="road-attribution">\{ROAD_ATTRIBUTION\}<\/p>/);
  assert.equal(body.includes('className="muted-line"'), false, "the flat muted-line pass is gone");
});

test("the road detail palette is applied where it was specified", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  // Scanned rather than matched: these selectors carry dots and brackets, and escaping them for
  // a RegExp is more ways to be wrong than reading to the next closing brace.
  // The LAST declaration, not the first: several of these selectors also appear in the rule the
  // road dialog shares with the weather one, and at equal specificity the later one is what the
  // reader actually sees. Checking the first would pass while the page showed something else.
  const rule = (selector: string) => {
    const start = css.lastIndexOf(`\n${selector} {`);
    if (start < 0) return "";
    const end = css.indexOf("}", start);
    return end < 0 ? "" : css.slice(start + 1, end + 1);
  };

  assert.match(rule(".road-value-row dt"), /color: #94A3B8/);
  assert.match(rule(".road-value"), /color: #F8FAFC/);
  assert.match(rule(".road-subhead"), /color: #38BDF8/);
  assert.match(rule(".road-value.tone-surface"), /color: #FDBA74/);
  assert.match(rule(".road-value.tone-wind"), /color: #7DD3FC/);
  assert.match(rule(".road-value.tone-humidity"), /color: #5EEAD4/);
  assert.match(rule(".road-value.tone-recent"), /color: #4ADE80/);
  assert.match(rule(".road-value.tone-today"), /color: #FACC15/);
  assert.match(rule(".road-note"), /color: #94A3B8/);
  assert.match(rule(".road-attribution"), /color: #64748B/);
  // The station name stays the largest, whitest thing in the dialog — and the override must sit
  // after the rule it shares with the weather dialog, or the shared 15px would win instead.
  assert.match(rule(".road-dialog-head strong"), /color: #F8FAFC/);
  assert.match(rule(".road-dialog-head strong"), /font-size: 16px/);
  assert.equal(
    css.lastIndexOf("\n.road-dialog-head strong {") > css.indexOf("\n.road-dialog-head strong { font-size: 15px"),
    true,
    "the road title override must come after the shared dialog-head rule",
  );
  // The banner's sentence is normal weight; only the timestamp is bold.
  assert.match(rule(".road-detail-updated"), /font-weight: 400/);
  assert.match(rule(".road-detail-updated strong"), /font-weight: 700/);
  // Cards inside cards were not introduced: the rows carry no border or panel background,
  // and none of the road detail rules reaches for a gradient.
  assert.equal(/border|background/.test(rule(".road-value-row")), false);
  const roadRules = [...css.matchAll(/^\.road-[\w.-]*[^{]*\{[^}]*\}/gm)].map((match) => match[0]);
  assert.equal(roadRules.length > 8, true, "the road detail rules should have been found");
  assert.equal(roadRules.some((declaration) => declaration.includes("gradient")), false);
});

test("every road detail colour stays readable on the dialog background", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  const panel = css.match(/--panel: (#[0-9a-fA-F]{6});/)?.[1] ?? "";
  assert.equal(panel, "#121923");

  const channel = (hex: string, at: number) => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) =>
    0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // Values, labels and headings are body text, so they carry the 4.5:1 bar.
  for (const colour of ["#F8FAFC", "#94A3B8", "#38BDF8", "#FDBA74", "#7DD3FC", "#5EEAD4", "#4ADE80", "#FACC15"]) {
    const ratio = contrast(colour, panel);
    assert.equal(ratio >= 4.5, true, `${colour} is only ${ratio.toFixed(2)}:1 on ${panel}`);
  }
  // The attribution is deliberately the quietest line. It clears the 3:1 floor but not 4.5:1 --
  // recorded here so the trade-off is visible rather than discovered later.
  const attribution = contrast("#64748B", panel);
  assert.equal(attribution >= 3, true, `attribution is only ${attribution.toFixed(2)}:1`);
  assert.equal(attribution < 4.5, true, "attribution now clears 4.5:1 -- tighten this test");
});
