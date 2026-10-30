import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyAuroraContourLayers, buildAuroraOvalStyle, buildContourBands } from "../src/lib/auroraOval";
import { decodeOvationGrid, encodeOvationGrid } from "../src/lib/ovationGrid";
import { getPublicPagePath } from "../src/lib/publicPath";
import { StandaloneViewerShell } from "../src/components/StandaloneViewerShell";
import { StandaloneOpenButton } from "../src/components/StandaloneOpenButton";
import { AuroraDataStatus } from "../src/components/AuroraDataStatus";
import { AuroraForecast } from "../src/components/AuroraForecast";
import type { DashboardSnapshot } from "../src/snapshot/types";
import type { SnapshotSource } from "../src/snapshot/types";
import officialOvation from "./fixtures/noaa-ovation-20261030.json";
import { WEATHER_SITES } from "../src/config/sources";

const read = (path: string) => readFileSync(path, "utf8");

test("frozen NOAA same-time samples match four Iceland city lookups", () => {
  const grid = decodeOvationGrid(encodeOvationGrid(officialOvation.cells))!;
  for (const [id, probability] of [["reykjavik", 8], ["akureyri", 10], ["vik", 6], ["hofn", 7]] as const) {
    const site = WEATHER_SITES.find((site) => site.id === id)!;
    assert.equal(grid.probabilityAt(site.lat, site.lon), probability, id);
  }
  assert.equal(grid.probabilityAt(64.96, -18.97), 9, "centre is a separate single cell");
});

test("rendered contour order survives updates: land, low, high, coast, markers", () => {
  const layers = buildAuroraOvalStyle("world", "iceland", {}).layers.map((layer) => layer.id);
  const sources = new Set<string>();
  const map = {
    getLayer: (id: string) => layers.includes(id),
    removeLayer: (id: string) => { layers.splice(layers.indexOf(id), 1); },
    getSource: (id: string) => sources.has(id),
    removeSource: (id: string) => { sources.delete(id); },
    addSource: (id: string) => { sources.add(id); },
    addLayer: (layer: { id: string }, before?: string) => { layers.splice(before ? layers.indexOf(before) : layers.length, 0, layer.id); },
    moveLayer: (id: string) => { layers.splice(layers.indexOf(id), 1); layers.push(id); },
  };
  const grid = decodeOvationGrid(encodeOvationGrid([[341, 65, 65]]))!;
  const bands = buildContourBands(grid);
  const apply = () => applyAuroraContourLayers(map as never, bands);
  apply();
  const first = [...layers];
  apply();
  assert.deepEqual(layers, first, "new snapshots do not reverse or duplicate layers");
  const order = ["iceland-land-detail", "iceland-coastline-mask", "aurora-very-low-layer", "aurora-low-layer", "aurora-moderate-layer", "aurora-high-layer", "iceland-coastline-detail", "iceland-marker", "site-circles"].map((id) => layers.indexOf(id));
  assert.ok(order.every((index, i) => i === 0 || index > order[i - 1]));
  applyAuroraContourLayers(map as never, []);
  assert.equal(layers.some((id) => id.startsWith("aurora-")), false, "invalid/missing replacement grid clears old contour layers");
  assert.equal(sources.size, 0);
});

test("aurora route, popup and return navigation share base-path handling", () => {
  assert.match(read("src/app/aurora/page.tsx"), /StandaloneViewerPage kind="aurora"/);
  assert.match(read("src/components/StandaloneViewer.tsx"), /<AuroraViewer snapshot=\{snapshot\} now=\{now\}/);
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    process.env.NEXT_PUBLIC_BASE_PATH = "/iceland-ops-dashboard";
    assert.equal(getPublicPagePath("/aurora/"), "/iceland-ops-dashboard/aurora/");
    const popup = renderToStaticMarkup(createElement(StandaloneOpenButton, { kind: "aurora", query: new URLSearchParams() }));
    assert.match(popup, /href="\/iceland-ops-dashboard\/aurora\/\?"/);
    assert.match(popup, /極光預報/);
    const page = renderToStaticMarkup(createElement(StandaloneViewerShell, { kind: "aurora", generatedAt: "2026-10-30T00:00:00Z" }, null));
    assert.match(page, /<h1>極光預報<\/h1>/);
    assert.match(page, /href="\/iceland-ops-dashboard\/"/);
    assert.match(page, /冰島/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});

test("OVATION UI identifies all four UTC clocks and labels retained data as historical", () => {
  const source: SnapshotSource = {
    id: "ovation", name: "NOAA OVATION", status: "ok", lastAttemptAt: "2026-10-30T00:10:00Z",
    lastSuccessAt: "2026-10-30T00:10:00Z", dataTime: "2026-10-30T00:00:00Z",
    data: { observationTime: "2026-10-30T00:00:00Z", forecastTime: "2026-10-30T01:00:00Z", fetchedAt: "2026-10-30T00:10:02Z", grid: encodeOvationGrid([[341, 65, 11]]) },
  };
  const markup = renderToStaticMarkup(createElement(AuroraDataStatus, { source, now: new Date("2026-10-30T02:00:00Z"), generatedAt: "2026-10-30T00:10:00Z" }));
  for (const label of ["觀測時間", "預報有效時間", "資料取得時間", "最後檢查時間", "UTC", "過期", "歷史查詢", "00:10:02"]) assert.ok(markup.includes(label), label);
  assert.match(read("src/components/AuroraOvalMap.tsx"), /歷史資料/);
});

test("map queries and all viewers use snapshots without another NOAA fetch path", () => {
  for (const file of ["src/components/AuroraViewer.tsx", "src/components/AuroraOvalMap.tsx", "src/components/AuroraDataStatus.tsx"]) {
    assert.doesNotMatch(read(file), /\bfetch\(|checkOvation|services\.swpc/);
  }
  const map = read("src/components/AuroraOvalMap.tsx");
  for (const control of ["極光地圖區域", "極光機率查詢地點", "極光地圖放大", "極光地圖縮小", "冰島全境", "北半球"]) assert.ok(map.includes(control));
  assert.match(read("src/lib/usePublishedSnapshot.ts"), /setInterval\(\(\) => setNow\(new Date\(\)\), 60_000\)/);
});

test("failed Kp forecast is unavailable instead of a 48-hour series made from current Kp", () => {
  const snapshot = JSON.parse(read("public/data/latest-health.json")) as DashboardSnapshot;
  snapshot.sources.noaaKpForecast = { ...snapshot.sources.noaaKpForecast, status: "error", errorType: "STALE_DATA" };
  const markup = renderToStaticMarkup(createElement(AuroraForecast, { snapshot, baseTime: new Date(snapshot.generatedAt) }));
  assert.match(markup, /暫時無法提供 48 小時極光預測/);
  assert.doesNotMatch(markup, /aurora-forecast-timeline/);
});
