import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  extractImoWindConditions,
  getImoWindImpactLevel,
  IMO_WIND_IMPACT_IMAGE,
  IMO_WIND_IMPACT_IMAGES_READY,
  IMO_WIND_IMPACT_LEVELS,
  presentImoWindImpact,
  resolveImoWindImpactRange,
} from "../src/lib/imoWindImpact";
import { isWindRelatedImoWarning } from "../src/lib/imoWindSpeed";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function ids(min: number, max: number) {
  return resolveImoWindImpactRange(min, max).map((level) => level.id);
}

test("wind impact bands are exclusive at the upper bound except the last", () => {
  const cases: [number, string][] = [
    [0, "calm"],
    [4.9, "calm"],
    [5, "windy"],
    [9.9, "windy"],
    [10, "strong"],
    [12.9, "strong"],
    [13, "strong_gale"],
    [14.9, "strong_gale"],
    [15, "gale"],
    [17.9, "gale"],
    [18, "severe_gale"],
    [19.9, "severe_gale"],
    [20, "very_strong"],
    [22.9, "very_strong"],
    [23, "storm_like"],
    [25, "storm_like"],
    [28, "storm_like"],
  ];
  for (const [speed, id] of cases) {
    assert.equal(getImoWindImpactLevel(speed).id, id, String(speed));
  }
});

test("sustained ranges light every overlapping travel band without inventing extra cells", () => {
  assert.deepEqual(ids(18, 25), ["severe_gale", "very_strong", "storm_like"]);
  assert.deepEqual(ids(20, 28), ["very_strong", "storm_like"]);
  assert.deepEqual(ids(15, 23), ["gale", "severe_gale", "very_strong"]);
  assert.deepEqual(ids(18, 18), ["severe_gale"]);
});

test("production English sentences keep mean wind separate from numeric gusts", () => {
  const south = extractImoWindConditions("Southeast 18-25 m/s with windgusts locally over 35 m/s");
  assert.deepEqual(south.sustained, { min: 18, max: 25, raw: "18-25 m/s" });
  assert.deepEqual(south.gust, { min: 35, operator: "over", raw: "35 m/s" });

  const west = extractImoWindConditions("Westfjords 15-23 m/s with windgusts locally over 30 m/s");
  assert.equal(west.sustained?.min, 15);
  assert.equal(west.sustained?.max, 23);
  assert.equal(west.gust?.min, 30);
  assert.equal(west.gust?.operator, "over");

  const highlands = extractImoWindConditions("Central highlands 20-28 m/s with very strong windgusts");
  assert.deepEqual(highlands.sustained, { min: 20, max: 28, raw: "20-28 m/s" });
  assert.equal(highlands.gust, undefined);
});

test("wind impact is presentation-only and never rewrites official warning fields", () => {
  const warning = {
    warningColor: "Yellow" as const,
    severity: "Moderate",
    phase: "active",
    eventEn: "Weather Warning: Wind",
    headlineEn: "Strong wind",
    descriptionEn: "East 25 m/s.",
  };
  const view = presentImoWindImpact(warning);
  assert.equal(view?.to.id, "storm_like");
  assert.equal(warning.warningColor, "Yellow");
  assert.equal(warning.severity, "Moderate");
  assert.equal(warning.phase, "active");

  const orange = {
    warningColor: "Orange" as const,
    eventEn: "Weather Warning: Wind",
    headlineEn: "Gale",
    descriptionEn: "15 m/s.",
  };
  const orangeView = presentImoWindImpact(orange);
  assert.equal(orangeView?.from.id, "gale");
  assert.equal(orange.warningColor, "Orange");
});

test("the panel stays off unless the warning is wind-related and has a reliable mean speed", () => {
  assert.equal(
    presentImoWindImpact({
      eventEn: "Weather Warning: Precipitation",
      headlineEn: "Heavy rain",
      descriptionEn: "Rain and 18-25 m/s.",
    }),
    undefined,
  );
  assert.equal(
    presentImoWindImpact({
      eventEn: "Weather Warning: Landslide",
      headlineEn: "Landslide",
      descriptionEn: "Slope movement. 20 m/s.",
    }),
    undefined,
  );
  assert.equal(
    presentImoWindImpact({
      eventEn: "Weather Warning: Wind",
      headlineEn: "Strong wind",
      descriptionEn: "Strong wind is expected.",
    }),
    undefined,
  );
  assert.equal(isWindRelatedImoWarning("Weather Warning: Wind", "Strong wind"), true);
  assert.ok(presentImoWindImpact({
    eventEn: "Weather Warning: Wind",
    headlineEn: "Strong wind",
    descriptionEn: "18-25 m/s with windgusts locally over 35 m/s",
  }));
});

test("the dialog hosts wind impact after lifecycle and keeps chrome intact", () => {
  const dialog = read("src/components/ImoWarningDetailDialog.tsx");
  const panel = read("src/components/ImoWindImpactPanel.tsx");
  const css = read("src/app/globals.css");
  const lifecycle = dialog.indexOf("<LifecycleStrip");
  const impact = dialog.indexOf("<ImoWindImpactPanel");
  const zh = dialog.indexOf('className="imo-warning-dialog-zh"');
  const detail = dialog.indexOf('className="imo-warning-dialog-detail"');
  assert.ok(lifecycle > 0 && impact > lifecycle);
  assert.ok(zh > 0 && zh < detail && impact > detail);
  assert.match(dialog, /onPointerDown=\{beginMove\}/);
  assert.match(dialog, /onPointerDown=\{beginResize\}/);
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /imo-warning-dialog-pane/);
  assert.match(dialog, /event\.target === event\.currentTarget/);
  assert.match(dialog, /onCancel=\{/);
  assert.match(dialog, /restoreRef\.current\?\.focus/);
  assert.match(dialog, /IMO ENGLISH ORIGINAL/);
  assert.match(dialog, /IMO ÍSLENSKA ORIGINAL/);
  assert.match(panel, /TRAVEL REFERENCE/);
  assert.match(panel, /風速體感為旅遊與戶外活動的實務參考/);
  assert.match(panel, /不是 IMO/);
  assert.match(panel, /局部陣風/);
  assert.match(panel, /PHOTO \/ 拍攝/);
  assert.match(panel, /aria-current/);
  assert.equal(panel.includes("OFFICIAL WIND LEVEL"), false);
  assert.equal(panel.includes("RED WARNING"), false);
  assert.equal(/黃色警報|橙色警報可能性|典型黃色/.test(panel), false);
  assert.equal(IMO_WIND_IMPACT_IMAGES_READY, true);
  assert.match(panel, /<img src=\{src\} alt=\{alt\}/);
  assert.match(css, /--imo-wind-impact-accent/);
  const impactCss = css.slice(css.indexOf(".imo-wind-impact {"), css.indexOf(".imo-warning-dialog-resize"));
  assert.equal(/imo-warning-yellow|imo-warning-orange|imo-warning-red/.test(impactCss), false);
});

test("every wind-impact level has a local webp that matches the public asset contract", () => {
  const expected = {
    calm: "wind-00-calm.webp",
    windy: "wind-01-windy.webp",
    strong: "wind-02-strong.webp",
    strong_gale: "wind-03-strong-gale.webp",
    gale: "wind-04-gale.webp",
    severe_gale: "wind-05-severe-gale.webp",
    very_strong: "wind-06-very-strong.webp",
    storm_like: "wind-07-storm.webp",
  } as const;
  assert.equal(IMO_WIND_IMPACT_LEVELS.length, 8);
  for (const level of IMO_WIND_IMPACT_LEVELS) {
    const file = expected[level.id];
    assert.equal(IMO_WIND_IMPACT_IMAGE[level.id], `/images/wind-impact/${file}`);
    assert.equal(existsSync(resolve(process.cwd(), "public/images/wind-impact", file)), true, file);
  }
  assert.equal(existsSync(resolve(process.cwd(), "public/images/wind-impact/wind-07-storm-like.webp")), false);
});
