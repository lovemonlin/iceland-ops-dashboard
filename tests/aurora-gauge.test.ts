import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { androidPath, hasAndroidFile } from "./androidRepo";
import {
  bzStatus,
  btStatus,
  formatBt,
  formatBz,
  formatKp,
  formatPower,
  formatSpeed,
  gaugeAngle,
  GAUGE_SPECS,
  GAUGE_START_ANGLE,
  GAUGE_STYLE,
  GAUGE_SWEEP_ANGLE,
  readGauges,
  speedStatus,
  zoneColorFor,
} from "../src/lib/auroraGauge";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ANDROID_SPECS = androidPath(
  "app/src/main/java/com/iceland/aurora/ui/home/AuroraGaugeSpecs.kt",
);
const hasAndroid = hasAndroidFile("app/src/main/java/com/iceland/aurora/ui/home/AuroraGaugeSpecs.kt");

test("the dial geometry is the app's 270° arc, open at the bottom", () => {
  assert.equal(GAUGE_START_ANGLE, 135);
  assert.equal(GAUGE_SWEEP_ANGLE, 270);
  assert.equal(GAUGE_STYLE.segmentCount, 24);
  assert.equal(GAUGE_STYLE.ringWidth, 0.105);

  // Minimum at the lower left, midpoint straight up, maximum at the lower right.
  const range = { start: 0, end: 10 };
  assert.equal(gaugeAngle(0, range), 135);
  assert.equal(gaugeAngle(5, range), 270);
  assert.equal(gaugeAngle(10, range), 405);
  // Out-of-range readings park at the ends rather than sweeping off the dial.
  assert.equal(gaugeAngle(-99, range), 135);
  assert.equal(gaugeAngle(99, range), 405);
});

test("each dial carries the app's range and zone thresholds", () => {
  const spec = (key: string) => GAUGE_SPECS.find((candidate) => candidate.key === key)!;

  assert.deepEqual(GAUGE_SPECS.map((entry) => entry.key), ["kp", "bz", "bt", "speed", "power"]);

  assert.deepEqual(spec("kp").range, { start: 0, end: 9 });
  assert.deepEqual(spec("kp").zones, [
    { upTo: 4, color: "#4ADE80" },
    { upTo: 5, color: "#FDE047" },
    { upTo: 9, color: "#FB923C" },
  ]);

  // Bz runs negative to positive and the warm end is the favourable one — the reverse of the rest.
  assert.deepEqual(spec("bz").range, { start: -20, end: 20 });
  assert.deepEqual(spec("bz").zones, [
    { upTo: -10, color: "#F97316" },
    { upTo: -5, color: "#FB923C" },
    { upTo: 0, color: "#FDE047" },
    { upTo: 5, color: "#4ADE80" },
    { upTo: 20, color: "#2DD4BF" },
  ]);
  assert.equal(spec("bz").emphasizedBoundary, 0, "only Bz marks its zero crossing");
  assert.equal(spec("kp").emphasizedBoundary, undefined);

  assert.deepEqual(spec("bt").range, { start: 0, end: 20 });
  assert.deepEqual(spec("speed").range, { start: 250, end: 800 });
  assert.deepEqual(spec("power").range, { start: 0, end: 200 });
  assert.deepEqual(spec("power").zones, [
    { upTo: 20, color: "#4ADE80" },
    { upTo: 50, color: "#FDE047" },
    { upTo: 200, color: "#FB923C" },
  ]);
});

test("zone colours are picked by the app's own rule", () => {
  const kp = GAUGE_SPECS[0].zones;
  assert.equal(zoneColorFor(kp, 0), "#4ADE80");
  assert.equal(zoneColorFor(kp, 4), "#4ADE80");
  assert.equal(zoneColorFor(kp, 4.1), "#FDE047");
  assert.equal(zoneColorFor(kp, 5), "#FDE047");
  assert.equal(zoneColorFor(kp, 5.1), "#FB923C");
  assert.equal(zoneColorFor(kp, 9), "#FB923C");
  // Past the last bound it stays on the last colour rather than falling back to grey.
  assert.equal(zoneColorFor(kp, 99), "#FB923C");

  const power = GAUGE_SPECS.find((spec) => spec.key === "power")!.zones;
  assert.equal(zoneColorFor(power, 0), "#4ADE80");
  assert.equal(zoneColorFor(power, 20), "#4ADE80");
  assert.equal(zoneColorFor(power, 20.1), "#FDE047");
  assert.equal(zoneColorFor(power, 50), "#FDE047");
  assert.equal(zoneColorFor(power, 50.1), "#FB923C");
});

test("values are formatted exactly as the app prints them", () => {
  assert.equal(formatKp(0.33), "0.33");
  assert.equal(formatKp(undefined), "—");
  // "%+.1f": the sign is always shown, including on zero.
  assert.equal(formatBz(2), "+2.0");
  assert.equal(formatBz(-4.25), "-4.3");
  assert.equal(formatBz(0), "+0.0");
  assert.equal(formatBt(6), "6.0");
  assert.equal(formatSpeed(385.7), "385");
  assert.equal(formatSpeed(undefined), "—");
  assert.equal(formatPower(13.9), "13");
  assert.equal(formatPower(undefined), "—");
});

test("status wording follows the app's thresholds", () => {
  assert.equal(bzStatus(-12), "很有利");
  assert.equal(bzStatus(-10), "很有利");
  assert.equal(bzStatus(-6), "有利");
  assert.equal(bzStatus(-1), "稍有利");
  assert.equal(bzStatus(0), "不利");
  assert.equal(bzStatus(4.9), "不利");
  assert.equal(bzStatus(5), "不利");

  assert.equal(btStatus(4.9), "偏弱");
  assert.equal(btStatus(5), "普通");
  assert.equal(btStatus(10), "偏強");
  assert.equal(btStatus(15), "強");

  assert.equal(speedStatus(399), "偏低");
  assert.equal(speedStatus(400), "中等");
  assert.equal(speedStatus(500), "偏高");
  assert.equal(speedStatus(650), "高");

  // Kp and power carry no status pill in the app, so neither do they here.
  assert.equal(GAUGE_SPECS.find((spec) => spec.key === "kp")!.status, undefined);
  assert.equal(GAUGE_SPECS.find((spec) => spec.key === "power")!.status, undefined);
  for (const value of [undefined]) {
    assert.equal(bzStatus(value), undefined);
    assert.equal(btStatus(value), undefined);
    assert.equal(speedStatus(value), undefined);
  }
});

test("the dials read the snapshot the dashboard already publishes", () => {
  const readings = readGauges(
    { kp: 0.33, kpLabel: "0P" },
    { speedKms: 385, btNt: 6, bzNt: 2, observedAt: "2026-09-04 14:00 UTC" },
    { northGw: 13.9, southGw: 12 },
  );
  assert.deepEqual(
    readings.map((entry) => [entry.spec.key, entry.value]),
    [
      ["kp", 0.33],
      ["bz", 2],
      ["bt", 6],
      ["speed", 385],
      ["power", 13.9],
    ],
  );
  assert.equal(readings[4].spec.format(readings[4].value), "13");

  // A missing or non-numeric reading becomes "no value" rather than zero, so a dead feed never
  // parks the needle at a number that looks like data.
  const empty = readGauges({}, { speedKms: "n/a" });
  assert.deepEqual(empty.map((entry) => entry.value), [undefined, undefined, undefined, undefined, undefined]);
  assert.equal(empty[0].spec.format(empty[0].value), "—");
  assert.equal(empty[4].spec.format(empty[4].value), "—");
});

test("the aurora card combines all five snapshot sources in order without fetching NOAA", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const sections = read("src/components/SourceSections.tsx");

  assert.match(
    dashboard,
    /kpForecast=\{snapshotEntry\(snapshot, "noaaKpForecast"\)\}/,
    "Dashboard must pass the stored Kp forecast into AuroraSection",
  );
  assert.match(
    dashboard,
    /hemiPower=\{snapshotEntry\(snapshot, "noaaHemiPower"\)\}/,
    "Dashboard must pass the stored hemispheric power into AuroraSection",
  );
  assert.match(sections, /kpForecast\?: SnapshotSource/);
  assert.match(sections, /hemiPower\?: SnapshotSource/);
  assert.match(sections, /const entries = \[kp, kpForecast, solarWind, ovation, hemiPower\]/);
  assert.match(sections, /Five feeds, one question/);
  assert.match(sections, /same five feeds/);

  // The card only combines entries already present in the snapshot.
  assert.equal(/fetch\s*\(|noaa\.gov|SWPC_/i.test(sections), false);
  assert.equal(/noaa\.gov|SWPC_/i.test(dashboard), false);
  assert.equal([...dashboard.matchAll(/fetch\s*\(/g)].length, 1, "only the existing snapshot reload may fetch");
  assert.match(dashboard, /fetch\(getSnapshotUrl\(\{ cacheBust: true \}\)/);
});

test("the ranges, zones and thresholds match the app's own file", { skip: !hasAndroid }, () => {
  const kotlin = read(ANDROID_SPECS);

  assert.match(kotlin, /val kpRange = 0f\.\.9f/);
  assert.match(kotlin, /val bzRange = -20f\.\.20f/);
  assert.match(kotlin, /val btRange = 0f\.\.20f/);
  assert.match(kotlin, /val speedRange = 250f\.\.800f/);
  assert.match(kotlin, /val hemisphericPowerRange = 0f\.\.200f/);

  // Every zone bound this port claims must appear in the app's own zone lists.
  for (const spec of GAUGE_SPECS) {
    for (const zone of spec.zones) {
      const bound = Number.isInteger(zone.upTo) ? `${zone.upTo}f` : `${zone.upTo}f`;
      assert.equal(
        kotlin.includes(`GaugeZone(${bound}`),
        true,
        `${spec.key} zone bound ${bound} is not in AuroraGaugeSpecs.kt`,
      );
    }
  }

  // The status thresholds, read straight out of the app's when-branches.
  assert.match(kotlin, /it <= -10 -> R\.string\.gauge_status_very_favorable/);
  assert.match(kotlin, /it < 5 -> R\.string\.gauge_status_weak/);
  assert.match(kotlin, /it < 400 -> R\.string\.gauge_status_low/);
});

test("hemispheric power uses the app's SWPC table and last-row parser", {
  skip: !hasAndroidFile("app/src/main/java/com/iceland/aurora/data/remote/SwpcApi.kt"),
}, () => {
  const kotlin = read(androidPath("app/src/main/java/com/iceland/aurora/data/remote/SwpcApi.kt"));
  assert.match(kotlin, /text\/aurora-nowcast-hemi-power\.txt/);
  assert.match(kotlin, /\.lastOrNull\(\)/);
  assert.match(kotlin, /northGw = parts\[2\]\.toDoubleOrNull\(\)/);
  const monitor = read("src/monitors/noaa/monitor.ts");
  assert.match(monitor, /SWPC_HEMI_POWER_URL/);
  assert.match(monitor, /rows\.at\(-1\)/);
  assert.match(monitor, /northGw/);
});

test("the panel is drawn with the app's fifth dial, from the snapshot only", () => {
  const component = read("src/components/AuroraGauges.tsx");
  assert.match(component, /GAUGE_STYLE\.segmentCount/);
  assert.match(component, /gaugeAngle\(/);
  assert.match(component, /hemiData/);
  assert.equal(/fetch\s*\(|noaa\.gov|SWPC_/i.test(component), false);

  // The app snaps instead of sweeping when animations are off; so does this, and a timer also
  // guarantees the true reading arrives if no animation frame is ever delivered.
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /setTimeout\(\(\) => setDisplayed\(target\), delayMs \+ duration \+ 80\)/);

  const lib = read("src/lib/auroraGauge.ts");
  assert.match(lib, /功率（GW）/);
  assert.match(lib, /noaaHemiPower/);
  assert.match(lib, /northGw/);
});
