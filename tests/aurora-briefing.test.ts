import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { encodeSiteForecast } from "../src/lib/forecastCodec";
import {
  briefingSummary,
  buildAuroraBriefing,
  formatBriefingDate,
  formatBriefingHourLabel,
  formatBriefingKp,
  getIcelandTonightWindow,
} from "../src/lib/auroraBriefing";
import {
  AURORA_REGIONS,
  auroraForecastSites,
  briefingBestSiteLabel,
} from "../src/lib/auroraForecastPresentation";
import type { WeatherHour } from "../src/lib/weatherMap";
import type {
  DashboardSnapshot,
  SnapshotSource,
} from "../src/snapshot/types";

function source(id: string, data: Record<string, unknown>): SnapshotSource {
  return {
    id,
    name: id,
    status: "ok",
    lastAttemptAt: "2026-09-10T01:00:00Z",
    lastSuccessAt: "2026-09-10T01:00:00Z",
    data,
  };
}

function fixture(): DashboardSnapshot {
  const times = Array.from(
    { length: 9 },
    (_, offset) => new Date(Date.UTC(2026, 8, 10, 18 + offset)).toISOString(),
  );
  const clear: WeatherHour[] = times.map((time) => ({
    time,
    cloudLowPercent: 0,
    cloudMediumPercent: 0,
    cloudHighPercent: 0,
  }));
  const sites = [
    {
      id: "reykjavik",
      name: "Reykjavík",
      nameIs: "Reykjavík",
      nameZh: "雷克雅未克",
      lat: 64.1466,
      lon: -21.9426,
      region: "CAPITAL",
      lightPollution: "BRIGHT",
      forecast: encodeSiteForecast(clear, times),
    },
    {
      id: "myvatn",
      name: "Lake Mývatn",
      nameIs: "Mývatn",
      nameZh: "米湖",
      lat: 65.6039,
      lon: -16.9964,
      region: "NORTH",
      lightPollution: "DARK",
      forecast: new Array(times.length).fill(null),
    },
  ];

  return {
    schemaVersion: 2,
    generatedAt: "2026-09-10T01:00:00Z",
    overallStatus: "ok",
    summary: { ok: 5, info: 0, stale: 0, degraded: 0, error: 0 },
    sources: {
      noaaKp: source("noaaKp", { kp: 1.33 }),
      noaaKpForecast: source("noaaKpForecast", {
        points: [
          { time: times[0], kp: 2, status: "predicted", noaaScale: null },
          { time: times[3], kp: 3, status: "predicted", noaaScale: null },
          { time: times[6], kp: 4, status: "predicted", noaaScale: null },
        ],
      }),
      solarWind: source("solarWind", { btNt: 6, bzNt: -15, speedKms: 450 }),
      ovation: source("ovation", { icelandPeakProbabilityPercent: 88 }),
      metno: source("metno", { forecastTimes: times, sites }),
    },
  };
}

test("Iceland''s date alone defines all nine 18:00–02:00 report instants", () => {
  for (const now of [
    new Date("2026-09-10T01:00:00Z"),
    new Date("2026-09-10T22:00:00Z"),
  ]) {
    const window = getIcelandTonightWindow(now);
    assert.equal(window.hours.length, 9);
    assert.equal(window.hours[0].toISOString(), "2026-09-10T18:00:00.000Z");
    assert.equal(window.hours[8].toISOString(), "2026-09-11T02:00:00.000Z");
  }
});

test("the fixed Iceland window crosses month and year boundaries", () => {
  const month = getIcelandTonightWindow(new Date("2026-09-30T23:00:00Z"));
  assert.equal(formatBriefingDate(month.hours[0], true), "2026/09/30");
  assert.equal(formatBriefingDate(month.hours[8], true), "2026/10/01");

  const year = getIcelandTonightWindow(new Date("2026-12-31T23:00:00Z"));
  assert.equal(formatBriefingDate(year.hours[0], true), "2026/12/31");
  assert.equal(formatBriefingDate(year.hours[8], true), "2027/01/01");
});

test("future briefing points use NOAA forecast Kp without current Bz or OVATION", () => {
  const model = buildAuroraBriefing(fixture(), new Date("2026-09-10T01:00:00Z"))!;
  assert.deepEqual(model.hours.map((hour) => hour.kp), [2, 2, 2, 3, 3, 3, 4, 4, 4]);
  assert.equal(model.hours[0].best.auroraStrength, (2 / 9) * 100);
  assert.notEqual(model.hours[0].best.auroraStrength, 100);
  assert.deepEqual(model.current, {
    kp: 1.33,
    bt: 6,
    bz: -15,
    speed: 450,
    ovation: 88,
  });
});

test("region heatmap excludes missing site-hours instead of inventing cloud", () => {
  const model = buildAuroraBriefing(fixture(), new Date("2026-09-10T01:00:00Z"))!;
  const capital = model.regions.find((row) => row.region === "CAPITAL")!;
  const north = model.regions.find((row) => row.region === "NORTH")!;
  assert.deepEqual(capital.obstructions, new Array(9).fill(0));
  assert.deepEqual(north.obstructions, new Array(9).fill(undefined));
  assert.equal(north.average, undefined);
  assert.deepEqual(model.regions.map((region) => region.region), AURORA_REGIONS);
});

test("the published 32 sites remain the briefing''s sole site source", () => {
  const snapshot = JSON.parse(
    readFileSync(resolve(process.cwd(), "public/data/latest-health.json"), "utf8"),
  ) as DashboardSnapshot;
  assert.equal(auroraForecastSites(snapshot).length, 32);
  const domain = readFileSync(
    resolve(process.cwd(), "src/lib/auroraBriefing.ts"),
    "utf8",
  );
  assert.match(domain, /const sites = auroraForecastSites\(snapshot\)/);
  assert.equal(/id:\s*["''](?:reykjavik|myvatn)["'']|IcelandAuroraSites/i.test(domain), false);
});

test("the copy summary carries forecast, cloud and current-only context", () => {
  const model = buildAuroraBriefing(fixture(), new Date("2026-09-10T01:00:00Z"))!;
  const summary = briefingSummary(model);
  for (const text of [
    "冰島極光快報｜09/10 18:00–09/11 02:00",
    "今晚最佳可觀測條件：",
    "最佳時間：",
    "最佳地點：",
    "最高預測分數：",
    "預測 Kp 約 2～4",
    "今晚判讀摘要：預測顯示今晚",
    "全島多數區域雲層遮蔽偏低",
    "雲況相對較佳區域：首都圈 0%",
    "目前太空天氣：Bt 6.0 nT｜Bz -15.0 nT｜太陽風 450 km/s",
    "Bt / Bz / 太陽風為目前即時值；今晚資料為預測。",
  ]) {
    assert.equal(summary.includes(text), true, `${text} missing`);
  }
});

test("briefing labels keep full hours and collapse a flat Kp range", () => {
  assert.equal(formatBriefingKp(2, 2), "Kp 約 2");
  assert.equal(formatBriefingKp(2, 4), "Kp 約 2～4");
  assert.equal(formatBriefingKp(2.1, 2.4), "Kp 約 2");
  assert.equal(formatBriefingHourLabel("23"), "23:00");
  assert.equal(formatBriefingHourLabel("—"), "—");
});

test("briefing presentation suppresses a low-score or daylight best site", () => {
  const model = buildAuroraBriefing(fixture(), new Date("2026-09-10T01:00:00Z"))!;
  assert.equal(briefingBestSiteLabel(model.hours[0].best), undefined);
  assert.equal(
    briefingBestSiteLabel({ ...model.hours[0].best, score: 5, darknessFactor: 1 }),
    "雷克雅未克",
  );
});
