import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("the forecast exposes an accessible briefing without replacing its 48-hour builder", () => {
  const forecast = read("src/components/AuroraForecast.tsx");
  assert.match(forecast, /🌌 極光快報/);
  assert.match(forecast, /aria-haspopup="dialog"/);
  assert.match(forecast, /<AuroraBriefingDialog/);
  assert.match(forecast, /snapshot=\{snapshot\}/);
  assert.match(forecast, /now=\{baseTime\}/);
  assert.match(forecast, /buildAuroraForecast48\(snapshot, site, baseTime\)/);
  assert.match(forecast, /<AuroraScoreExplanationDialog/);
});

test("the briefing uses a labelled native modal and safe clipboard feedback", () => {
  const dialog = read("src/components/AuroraBriefingDialog.tsx");
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /aria-labelledby="aurora-briefing-title"/);
  assert.match(dialog, /aria-describedby="aurora-briefing-description"/);
  assert.match(dialog, /onCancel=/);
  assert.match(dialog, /event\.target === event\.currentTarget/);
  assert.match(dialog, /navigator\.clipboard\.writeText/);
  assert.match(dialog, /catch \{/);
  assert.match(dialog, /aria-live="polite"/);
});

test("the fixed Iceland report, timeline, heatmap, and current-only warning are visible", () => {
  const dialog = read("src/components/AuroraBriefingDialog.tsx");
  for (const text of [
    "今晚觀測時段固定以冰島當地 18:00～隔日 02:00 計算。",
    "今晚最佳可觀測條件",
    "今晚判讀摘要",
    "最佳極光區域",
    "今晚 18～02 時間軸",
    "今晚雲層分布",
    "今晚平均",
    "天色",
    "雲況相對較佳區域",
    "目前太空天氣",
    "不代表今晚 18:00～02:00 的預測值",
    "複製文字摘要",
  ]) {
    assert.equal(dialog.includes(text), true, `${text} missing`);
  }
  assert.match(dialog, /className="aurora-briefing-head-actions"/);
  assert.doesNotMatch(dialog, /<footer className="aurora-briefing-actions">/);
  assert.match(dialog, /此時段沒有有效極光觀測地點/);
  assert.match(dialog, /briefingBestSiteLabel\(hour\.best\)/);
  assert.match(dialog, /skyLightLabel\(hour\.best\)/);
});

test("the briefing remains snapshot-only and never forwards current space weather into assessments", () => {
  const dialog = read("src/components/AuroraBriefingDialog.tsx");
  const domain = read("src/lib/auroraBriefing.ts");
  assert.match(domain, /kpAt\(points, time, fallbackKp\)/);
  assert.match(domain, /assessAuroraVisibility\(\{/);
  assert.match(domain, /weather: hourAt\(weather\.get\(site\.id\), time, 0\)/);
  assert.match(domain, /effectiveObstruction\(reading\)/);
  assert.equal(/ovationProbability|bzGsm/.test(domain), false);
  assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\//i.test(dialog), false);
  assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\//i.test(domain), false);
});

test("the briefing switches from nine-column tables to hour cards on small screens", () => {
  const dialog = read("src/components/AuroraBriefingDialog.tsx");
  assert.match(dialog, /className="aurora-briefing-wide"/);
  assert.match(dialog, /className="aurora-briefing-narrow aurora-briefing-hours"/);
  assert.match(dialog, /className="aurora-briefing-narrow aurora-briefing-regions"/);
  assert.match(dialog, /aurora-briefing-hour-card/);
  assert.match(dialog, /aurora-briefing-hour-card-top/);
  assert.equal((dialog.match(/briefing\.hours\.map/g) ?? []).length >= 2, true);
  assert.equal(/fetch\s*\(|noaa\.gov/i.test(dialog), false);

  const css = read("src/app/globals.css");
  assert.match(css, /\.aurora-briefing-dialog[\s\S]*1180px/);
  assert.match(css, /\.aurora-briefing-heatmap[\s\S]*repeat\(10/);
  assert.match(css, /\.aurora-briefing-heatmap \.aurora-briefing-row \{ grid-template-columns: 108px repeat\(10/);
  assert.match(css, /\.aurora-briefing-narrow \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\.aurora-briefing-wide \{ display: none; \}/);
  assert.match(css, /ol\.aurora-briefing-narrow,\s*ul\.aurora-briefing-narrow \{ display: grid; \}/);
  assert.match(css, /height: 100dvh/);
});

test("the briefing score map is schematic, slider-driven, and never loads a cloud overlay", () => {
  const dialog = read("src/components/AuroraBriefingDialog.tsx");
  const map = read("src/components/AuroraBriefingMap.tsx");
  const css = read("src/app/globals.css");
  assert.match(dialog, /今晚各區極光分數/);
  assert.match(dialog, /<AuroraBriefingMap/);
  assert.match(dialog, /type="range"/);
  assert.match(dialog, /is-hour-selected/);
  assert.match(dialog, /西南部含首都圈/);
  assert.match(map, /clipPath="url\(#aurora-briefing-land\)"/);
  assert.match(map, /levelOf\(score\)/);
  assert.equal(/ecmwf|cloud-forecast|fetch\s*\(/i.test(map), false);
  assert.equal(/ecmwf|cloud-forecast/i.test(dialog), false);
  assert.match(css, /\.aurora-briefing-slider input\[type="range"\]/);
});
