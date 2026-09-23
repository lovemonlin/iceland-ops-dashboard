import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildImoWarningMap,
  parseImoPolygon,
  ringsFromWarning,
  summarizeWarningRegion,
} from "../src/lib/imoWarningMap";
import { presentImoWarnings } from "../src/lib/imoWarningPresentation";
import type { NormalizedImoWarning } from "../src/monitors/imo/normalize";
import type { SnapshotSource } from "../src/snapshot/types";

const NOW = new Date("2026-09-24T16:00:00Z");
const POLY = "64.00,-20.00 64.20,-19.00 63.80,-19.00 64.00,-20.00";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function warning(over: Partial<NormalizedImoWarning> & Pick<NormalizedImoWarning, "identifier">): NormalizedImoWarning {
  return {
    warningColor: "Yellow",
    eventEn: "Weather Warning: Wind",
    areaId: 2,
    areaNameEn: "South Iceland",
    onset: "2026-09-24T15:00:00Z",
    expires: "2026-09-24T21:00:00Z",
    polygon: [POLY],
    ...over,
  };
}

function source(status: SnapshotSource["status"], warnings: NormalizedImoWarning[]): SnapshotSource {
  return {
    id: "imo",
    name: "IMO Warnings",
    status,
    lastAttemptAt: "2026-09-24T16:00:00Z",
    data: { activeWarnings: warnings.length, warnings },
  };
}

function mapOf(status: SnapshotSource["status"], warnings: NormalizedImoWarning[]) {
  return buildImoWarningMap(presentImoWarnings(source(status, warnings), NOW));
}

test("parse a normal IMO polygon from lat,lon into lon,lat", () => {
  const ring = parseImoPolygon("63.55,-19.43 63.88,-19.56 64,-19.74 63.55,-19.43");
  assert.deepEqual(ring[0], [-19.43, 63.55]);
  assert.deepEqual(ring[1], [-19.56, 63.88]);
  assert.equal(ring.length >= 4, true);
});

test("extra whitespace does not change valid points", () => {
  const ring = parseImoPolygon("  63.55,-19.43   63.88,-19.56\n64,-19.74  63.55,-19.43 ");
  assert.deepEqual(ring[0], [-19.43, 63.55]);
  assert.equal(ring.length, 4);
});

test("malformed coordinates are skipped without throwing", () => {
  const ring = parseImoPolygon("63.55,-19.43 oops 63.88,-19.56 64,-19.74 63.55,-19.43");
  assert.deepEqual(ring[0], [-19.43, 63.55]);
  assert.equal(ring.some((point) => Number.isNaN(point[0])), false);
});

test("fewer than three valid points are not drawn", () => {
  assert.deepEqual(parseImoPolygon("63.55,-19.43 63.88,-19.56"), []);
  assert.deepEqual(parseImoPolygon(""), []);
});

test("a missing polygon yields no rings", () => {
  assert.deepEqual(ringsFromWarning({}), []);
});

test("one yellow region is ready and yellow", () => {
  const map = mapOf("ok", [warning({ identifier: "y" })]);
  assert.equal(map.status, "ready");
  assert.equal(map.regions[0].rank, "yellow");
  assert.equal(map.regions[0].rings.length, 1);
});

test("orange and red regions keep official colours", () => {
  const orange = mapOf("ok", [warning({ identifier: "o", warningColor: "Orange", areaId: 3 })]);
  const red = mapOf("ok", [warning({ identifier: "r", warningColor: "Red", areaId: 4 })]);
  assert.equal(orange.regions[0].rank, "orange");
  assert.equal(red.regions[0].rank, "red");
});

test("unknown colour paints as unknown, not yellow", () => {
  const map = mapOf("ok", [warning({ identifier: "u", warningColor: undefined })]);
  assert.equal(map.regions[0].rank, "unknown");
});

test("two yellow warnings in the same area keep one region polygon", () => {
  const map = mapOf("ok", [
    warning({ identifier: "w1", eventEn: "Weather Warning: Wind" }),
    warning({ identifier: "w2", eventEn: "Weather Warning: Precipitation" }),
  ]);
  assert.equal(map.regions.length, 1);
  assert.equal(map.regions[0].rings.length, 1);
  assert.equal(map.regions[0].cards.length, 2);
});

test("yellow plus orange in the same area colours the map orange and keeps both warnings", () => {
  const map = mapOf("ok", [
    warning({ identifier: "y", warningColor: "Yellow" }),
    warning({ identifier: "o", warningColor: "Orange" }),
  ]);
  assert.equal(map.regions[0].rank, "orange");
  assert.deepEqual(
    map.regions[0].cards.map((card) => card.warning.identifier).sort(),
    ["o", "y"],
  );
});

test("orange plus red in the same area colours the map red", () => {
  const map = mapOf("ok", [
    warning({ identifier: "o", warningColor: "Orange" }),
    warning({ identifier: "r", warningColor: "Red" }),
  ]);
  assert.equal(map.regions[0].rank, "red");
  assert.equal(map.regions[0].cards.length, 2);
});

test("expired warnings do not colour the default map", () => {
  const map = mapOf("ok", [
    warning({ identifier: "old", onset: "2026-09-24T08:00:00Z", expires: "2026-09-24T10:00:00Z" }),
    warning({ identifier: "now" }),
  ]);
  assert.equal(map.regions.every((region) => region.cards.every((card) => card.phase !== "expired")), true);
  assert.equal(map.regions.some((region) => region.cards.some((card) => card.warning.identifier === "now")), true);
});

test("active and upcoming warnings are drawn", () => {
  const map = mapOf("ok", [
    warning({ identifier: "now" }),
    warning({ identifier: "later", areaId: 5, areaNameEn: "Westfjords", onset: "2026-09-24T18:00:00Z", expires: "2026-09-24T22:00:00Z" }),
  ]);
  assert.deepEqual(
    map.regions.flatMap((region) => region.cards.map((card) => card.phase)).sort(),
    ["active", "upcoming"],
  );
});

test("a failed collection still maps unexpired stored warnings", () => {
  const map = mapOf("error", [warning({ identifier: "kept" })]);
  assert.equal(map.status, "ready");
  assert.equal(map.stale, true);
});

test("a failed collection with only expired warnings does not colour the map", () => {
  const map = mapOf("error", [
    warning({ identifier: "gone", onset: "2026-09-24T08:00:00Z", expires: "2026-09-24T10:00:00Z" }),
  ]);
  assert.equal(map.status, "blocked");
  assert.equal(map.regions.length, 0);
});

test("no warnings hides the map", () => {
  assert.equal(mapOf("info", []).status, "hidden");
});

test("warnings without polygons are not an empty broken map", () => {
  const map = mapOf("ok", [warning({ identifier: "text", polygon: undefined })]);
  assert.equal(map.status, "no-geometry");
  assert.equal(map.regions.length, 0);
});

test("selected region summary keeps official events and count", () => {
  const map = mapOf("ok", [
    warning({ identifier: "w1", eventEn: "Weather Warning: Wind" }),
    warning({ identifier: "w2", eventEn: "Weather Warning: Precipitation" }),
  ]);
  const summary = summarizeWarningRegion(map.regions[0]);
  assert.equal(summary.name, "South Iceland");
  assert.match(summary.countLine, /2 則/);
  assert.deepEqual(
    summary.events.map((event) => event.eventEn).sort(),
    ["Weather Warning: Precipitation", "Weather Warning: Wind"],
  );
  assert.match(summary.ariaLabel, /South Iceland/);
});

test("region ordering is deterministic", () => {
  const map = mapOf("ok", [
    warning({ identifier: "south", areaId: 2, areaNameEn: "South Iceland" }),
    warning({ identifier: "east", areaId: 9, areaNameEn: "Eastfjords", warningColor: "Red" }),
    warning({ identifier: "west", areaId: 5, areaNameEn: "Westfjords", warningColor: "Orange" }),
  ]);
  assert.deepEqual(
    map.regions.map((region) => region.name),
    ["Eastfjords", "Westfjords", "South Iceland"],
  );
});

test("the warning map UI does not fetch IMO from the browser", () => {
  const mapFile = read("src/lib/imoWarningMap.ts");
  const component = read("src/components/ImoWarningMap.tsx");
  const panel = read("src/components/ImoWarningsPanel.tsx");
  const css = read("src/app/globals.css");
  assert.equal(/vedur\.is|fetch\s*\(/.test(mapFile + component + panel), false);
  assert.match(component, /role="group"/);
  assert.match(component, /tabIndex/);
  assert.match(component, /aria-label/);
  assert.match(panel, /ImoWarningMap/);
  assert.match(panel, /ImoWarningDetailDialog/);
  assert.match(component, /mode/);
  assert.match(component, /activeWarningId/);
  assert.match(component, /orderedImoMapRegions/);
  assert.match(component, /地圖顏色表示目前類型中該區域的最高官方警報等級/);
  assert.equal(/fill=\{FILL|rgba\(253/.test(component), false);
  assert.match(css, /--imo-warning-yellow/);
  assert.match(css, /--imo-warning-orange/);
  assert.match(css, /--imo-warning-red/);
  assert.match(css, /--imo-warning-green/);
  assert.match(css, /--imo-wind-speed-alert/);
  assert.match(css, /fill-opacity: 1/);
  assert.notEqual(css.indexOf("--imo-wind-speed-alert"), css.indexOf("--imo-warning-red"));
});

test("green cancelled warnings stay in the feed but are not painted as an active region", () => {
  const map = mapOf("ok", [
    warning({ identifier: "gone", warningColor: "Green" }),
    warning({ identifier: "now", warningColor: "Yellow" }),
  ]);
  assert.equal(map.regions.length, 1);
  assert.equal(map.regions[0].rank, "yellow");
  assert.equal(map.regions[0].cards.some((card) => card.warning.warningColor === "Green"), false);
});

test("two yellow polygons in one region keep one overview region and do not encode count in fill", () => {
  const map = mapOf("ok", [
    warning({ identifier: "w1", eventEn: "Weather Warning: Wind" }),
    warning({ identifier: "w2", eventEn: "Weather Warning: Precipitation" }),
  ]);
  assert.equal(map.regions.length, 1);
  assert.equal(map.regions[0].rank, "yellow");
  assert.equal(map.regions[0].cards.length, 2);
  assert.equal(map.regions[0].rings.length, 1);
  assert.match(read("src/components/ImoWarningMap.tsx"), /is-\$\{region\.rank\}/);
});
