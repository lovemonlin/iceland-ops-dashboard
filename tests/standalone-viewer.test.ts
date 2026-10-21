import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StandaloneOpenButton } from "../src/components/StandaloneOpenButton";
import { WeatherMap } from "../src/components/WeatherMap";
import { getPublicPagePath } from "../src/lib/publicPath";
import { parseCloudFrameQuery, parseRoadModeQuery, parseWeatherQuery } from "../src/lib/standaloneQuery";
import { createProjection } from "../src/lib/weatherMap";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("three standalone routes statically export and share the existing viewer", () => {
  const viewer = read("src/components/StandaloneViewer.tsx");
  for (const kind of ["weather", "cloud", "roads"] as const) {
    assert.match(read(`src/app/${kind}/page.tsx`), new RegExp(`StandaloneViewerPage kind="${kind}"`));
    if (existsSync(resolve(process.cwd(), "out/index.html"))) {
      assert.equal(existsSync(resolve(process.cwd(), `out/${kind}/index.html`)), true);
    }
  }
  assert.match(viewer, /<WeatherMap[\s\S]*?standalone/);
  assert.match(viewer, /<CloudForecastMap[\s\S]*?standalone/);
  assert.match(viewer, /<RoadMap onBundle=\{onRoadBundle\} initialMode=\{parseRoadModeQuery\(query\)\} standalone/);
  assert.doesNotMatch(viewer, /<StandaloneOpenButton/);
});

test("page URLs use the existing base path for local and Pages builds", () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    assert.deepEqual(["weather", "cloud", "roads"].map((kind) => getPublicPagePath(`/${kind}/`)),
      ["/weather/", "/cloud/", "/roads/"]);
    process.env.NEXT_PUBLIC_BASE_PATH = "/iceland-ops-dashboard";
    assert.deepEqual(["weather", "cloud", "roads"].map((kind) => getPublicPagePath(`/${kind}/`)),
      ["/iceland-ops-dashboard/weather/", "/iceland-ops-dashboard/cloud/", "/iceland-ops-dashboard/roads/"]);
    const markup = renderToStaticMarkup(createElement(StandaloneOpenButton, {
      kind: "weather", query: new URLSearchParams({ mode: "map", hour: "18", site: "reykjavik" }),
    }));
    assert.match(markup, /⛶ 獨立檢視/);
    assert.match(markup, /iceland-ops-dashboard\/weather\/\?mode=map&amp;hour=18&amp;site=reykjavik/);
    assert.match(read("src/components/StandaloneOpenButton.tsx"), /window\.open\(href, name/);
    assert.match(read("src/components/StandaloneOpenButton.tsx"), /target="_blank"/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});

test("weather query validates mode, clamps hours, and accepts only published sites", () => {
  const ids = ["akureyri", "reykjavik"];
  assert.deepEqual(parseWeatherQuery(new URLSearchParams("mode=map&hour=18&site=reykjavik"), ids),
    { mode: "MAP", hour: 18, site: "reykjavik" });
  assert.deepEqual(parseWeatherQuery(new URLSearchParams("mode=list&hour=999&site=unknown"), ids),
    { mode: "LIST", hour: 48, site: "reykjavik" });
  assert.deepEqual(parseWeatherQuery(new URLSearchParams("mode=bad&hour=1.5"), ids),
    { mode: "LIST", hour: 0, site: "reykjavik" });
});

test("cloud frame and RoadInfoMode queries reject invalid values", () => {
  assert.equal(parseCloudFrameQuery(new URLSearchParams("frame=7"), 17), 7);
  assert.equal(parseCloudFrameQuery(new URLSearchParams("frame=999"), 17), 16);
  assert.equal(parseCloudFrameQuery(new URLSearchParams("frame=NaN"), 17), 0);
  assert.equal(parseCloudFrameQuery(new URLSearchParams("frame=-1"), 17), 0);
  assert.equal(parseRoadModeQuery(new URLSearchParams("mode=STATIONS")), "STATIONS");
  assert.equal(parseRoadModeQuery(new URLSearchParams("mode=invalid")), "EVENTS");
});

test("Dashboard and all three viewers share the snapshot reload and site decoding paths", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const viewer = read("src/components/StandaloneViewer.tsx");
  const sections = read("src/components/SourceSections.tsx");
  const hook = read("src/lib/usePublishedSnapshot.ts");
  assert.match(dashboard, /usePublishedSnapshot\(initialSnapshot, onSnapshotChange\)/);
  assert.match(viewer, /usePublishedSnapshot\(initialSnapshot\)/);
  assert.match(hook, /fetch\(getSnapshotUrl\(\{ cacheBust: true \}\), \{ cache: "no-store" \}\)/);
  assert.match(hook, /SNAPSHOT_RELOAD_MS/);
  assert.equal((sections.match(/buildWeatherViewerSites\(/g) ?? []).length, 2);
  assert.match(viewer, /buildWeatherViewerSites\(weatherSource\)/);
  for (const source of [viewer, sections, hook]) {
    assert.doesNotMatch(source, /met\.no|noaa\.gov|api\.github\.com|lovemonlin\.github\.io/);
  }
});

test("standalone controls are next to existing modes and hidden inside viewers", () => {
  for (const [path, kind] of [
    ["src/components/WeatherMap.tsx", "weather"],
    ["src/components/CloudForecastMap.tsx", "cloud"],
    ["src/components/RoadMap.tsx", "roads"],
  ]) {
    const source = read(path);
    assert.match(source, new RegExp(`!standalone && <StandaloneOpenButton kind="${kind}"`));
    assert.match(source, /viewer-control-row/);
  }
  const css = read("src/app/globals.css");
  assert.match(css, /main\.standalone-viewer[\s\S]*?max-width: none/);
  assert.match(css, /\.standalone-cloud \.cloud-forecast-canvas[\s\S]*?100dvh/);
  assert.match(css, /\.standalone-roads \.road-map-canvas[\s\S]*?100dvh/);
  assert.match(read("src/components/WeatherMap.tsx"), /ResizeObserver/);
  assert.match(read("src/components/CloudForecastMap.tsx"), /map\.resize\(\)/);
  assert.match(read("src/components/RoadMap.tsx"), /map\.resize\(\)/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(WeatherMap, { sites: [], standalone: true })), /獨立檢視/);
  assert.match(renderToStaticMarkup(createElement(WeatherMap, { sites: [] })), /獨立檢視/);
});

test("weather projection and MapLibre container rules cover mobile and four desktop window sizes", () => {
  const bounds = { minLon: -24.55, maxLon: -13.25, minLat: 63.28, maxLat: 66.58 };
  const viewports = [[360, 740], [1120, 720], [1280, 720], [1440, 900], [1920, 1080]];
  const heights = viewports.map(([width]) => {
    const projection = createProjection(bounds, width);
    assert.equal(projection.viewportWidth, width);
    assert.equal(Number.isFinite(projection.viewportHeight), true);
    assert.equal(projection.viewportHeight > 0, true);
    return projection.viewportHeight;
  });
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b));
  for (const [, viewportHeight] of viewports.slice(1)) {
    assert.equal(Math.max(360, viewportHeight - 320) > 340, true, "desktop cloud canvas grows beyond its card height");
    assert.equal(Math.max(420, viewportHeight - 230) > 460, true, "desktop road canvas grows beyond its card height");
  }
  const css = read("src/app/globals.css");
  assert.match(css, /\.standalone-cloud \.cloud-forecast-canvas \{\s*height: clamp\(360px, calc\(100dvh - 320px\), 1100px\)/);
  assert.match(css, /\.standalone-roads \.road-map-canvas \{\s*height: clamp\(420px, calc\(100dvh - 230px\), 1200px\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.standalone-roads \.road-map-canvas \{ height: clamp\(300px, 52dvh, 500px\)/);
});
