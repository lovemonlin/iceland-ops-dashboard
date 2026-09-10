import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  auroraForecastSites,
  defaultAuroraForecastSite,
  LIMITING_FACTOR_LABEL,
  skyLightLabel,
} from "../src/lib/auroraForecastPresentation";
import { buildAuroraForecast48, levelOf } from "../src/lib/auroraVisibility";
import type { DashboardSnapshot } from "../src/snapshot/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const snapshot = JSON.parse(read("public/data/latest-health.json")) as DashboardSnapshot;

test("AuroraModes has three modes and still defaults to the instrument dashboard", () => {
  const modes = read("src/components/AuroraModes.tsx");
  assert.match(modes, /type AuroraMode = "GAUGES" \| "MAP" \| "FORECAST"/);
  assert.match(modes, /useState<AuroraMode>\("GAUGES"\)/);
  assert.equal([...modes.matchAll(/aria-pressed=\{mode ===/g)].length, 3);

  const dashboardIndex = modes.indexOf("◉ 儀表板");
  const mapIndex = modes.indexOf("🗺 極光機率位置圖");
  const forecastIndex = modes.indexOf("極光預測", mapIndex + 1);
  assert.equal(dashboardIndex < mapIndex && mapIndex < forecastIndex, true);

  assert.match(modes, /hidden=\{mode !== "GAUGES"\}>\{children\}/);
  assert.match(modes, /<AuroraOvalMap ovation=\{ovationData\}/);
  assert.match(modes, /forecastRequested &&/);
  assert.match(modes, /hidden=\{mode !== "FORECAST"\}/);
});

test("the forecast reads all 32 stored MET sites and defaults to Reykjavík", () => {
  const sites = auroraForecastSites(snapshot);
  assert.equal(sites.length, 32);
  assert.equal(defaultAuroraForecastSite(sites)?.id, "reykjavik");
  assert.equal(defaultAuroraForecastSite(sites)?.nameZh, "雷克雅未克");

  const presentation = read("src/lib/auroraForecastPresentation.ts");
  assert.match(presentation, /snapshot\.sources\.metno\?\.data\?\.sites/);
  assert.equal(/WEATHER_SITES|IcelandAuroraSites/.test(presentation), false, "must not introduce another site list");
});

test("the UI builds and renders the existing 48-hour assessment series", () => {
  const site = defaultAuroraForecastSite(auroraForecastSites(snapshot))!;
  const forecast = buildAuroraForecast48(snapshot, site, snapshot.generatedAt);
  assert.equal(forecast.length, 48);
  assert.equal(Date.parse(forecast[47].time) - Date.parse(forecast[0].time), 47 * 3_600_000);

  const component = read("src/components/AuroraForecast.tsx");
  assert.match(component, /buildAuroraForecast48\(snapshot, site, baseTime\)/);
  assert.match(component, /forecast\.map\(\(assessment, index\)/);
  assert.match(component, /style=\{\{ height: `\$\{assessment\.score\}%`, backgroundColor: assessment\.color \}\}/);
  assert.equal(/assessAuroraVisibility|auroraStrength\(|darknessFactor\(/.test(component), false);
});

test("each hour exposes its own second-night darkness result instead of a 24-hour window", () => {
  const site = defaultAuroraForecastSite(auroraForecastSites(snapshot))!;
  const forecast = buildAuroraForecast48(snapshot, site, snapshot.generatedAt);
  for (const assessment of forecast.slice(24)) {
    assert.equal(Number.isFinite(assessment.sunElevation), true);
    assert.equal(assessment.darknessFactor >= 0 && assessment.darknessFactor <= 1, true);
    assert.equal(["白晝", "不夠暗", "黑夜"].includes(skyLightLabel(assessment)), true);
  }

  const component = read("src/components/AuroraForecast.tsx");
  assert.match(component, /assessment\.darknessFactor/);
  assert.match(component, /selected\.sunElevation/);
  assert.equal(/DarknessWindow|24\s*\*\s*HOUR/.test(component), false);
});

test("levels, colours and limiting-factor wording come from the 2B assessment contract", () => {
  assert.deepEqual(
    [0, 5, 20, 40, 65].map((score) => levelOf(score)),
    [
      { level: "NONE", levelLabel: "看不到", color: "#64748B" },
      { level: "POOR", levelLabel: "不佳", color: "#FB923C" },
      { level: "FAIR", levelLabel: "普通", color: "#FDE047" },
      { level: "GOOD", levelLabel: "良好", color: "#86EFAC" },
      { level: "EXCELLENT", levelLabel: "極佳", color: "#4ADE80" },
    ],
  );
  assert.deepEqual(Object.values(LIMITING_FACTOR_LABEL), [
    "天空不夠暗",
    "雲層遮蔽",
    "月光干擾",
    "太陽活動不足",
    "地點條件",
    "無明顯限制",
  ]);

  const component = read("src/components/AuroraForecast.tsx");
  for (const field of [
    "score",
    "levelLabel",
    "kp",
    "auroraStrength",
    "effectiveObstruction",
    "darknessFactor",
    "moonInterference",
    "siteFactor",
    "limitingFactor",
  ]) {
    assert.equal(component.includes(field), true, `${field} is missing from the selected-hour detail`);
  }
});

test("aurora forecast reuses the approved timezone client and makes no upstream request", () => {
  const component = read("src/components/AuroraForecast.tsx");
  const cloudTime = read("src/lib/cloudForecast.ts");
  assert.match(component, /deviceTimeZone, getIpTimeZone/);
  assert.match(component, /formatCloudForecastTimes\(selected\.time, localTimeZone\.timeZone\)/);
  assert.match(component, /localTimeZone\.source === "ip" \? "當地時間" : "裝置時間"/);
  assert.match(cloudTime, /CLOUD_TIME_ZONE = "Atlantic\/Reykjavik"/);
  assert.equal(/fetch\s*\(|sessionStorage|noaa\.gov|met\.no/i.test(component), false);

  const css = read("src/app/globals.css");
  assert.match(css, /\.aurora-forecast-time-local \{ color: #59A9FF; \}/);
  assert.match(css, /\.aurora-forecast-time-iceland \{ color: #FF9F43; \}/);
});

test("Dashboard passes the same snapshot through AuroraSection into forecast mode", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const sections = read("src/components/SourceSections.tsx");
  assert.match(dashboard, /<AuroraSection[\s\S]*snapshot=\{snapshot\}/);
  assert.match(sections, /snapshot: DashboardSnapshot/);
  assert.match(sections, /<AuroraModes ovationData=\{ovationData\} snapshot=\{snapshot\} now=\{now\}>/);
});
