import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  classifyImoWarningFamily,
  filterImoWarningFeedByFamily,
  imoWarningFamilyTabs,
} from "../src/lib/imoWarningFamily";
import { buildImoWarningMap, resolveImoWarningDialog } from "../src/lib/imoWarningMap";
import { presentImoWarnings } from "../src/lib/imoWarningPresentation";
import type { NormalizedImoWarning } from "../src/monitors/imo/normalize";
import type { SnapshotSource } from "../src/snapshot/types";

const NOW = new Date("2026-09-24T16:00:00Z");
const SOUTH = "64.00,-20.00 64.20,-19.00 63.80,-19.00 64.00,-20.00";
const HIGHLANDS = "65.00,-18.50 65.20,-17.50 64.80,-17.50 65.00,-18.50";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function warning(over: Partial<NormalizedImoWarning> & Pick<NormalizedImoWarning, "identifier">): NormalizedImoWarning {
  return {
    warningColor: "Yellow",
    eventEn: "Weather Warning: Wind",
    areaNameEn: "South Iceland",
    sent: "2026-09-23T06:41:00Z",
    onset: "2026-09-24T07:00:00Z",
    expires: "2026-09-24T21:00:00Z",
    polygon: [SOUTH],
    ...over,
  };
}

function source(warnings: NormalizedImoWarning[]): SnapshotSource {
  return {
    id: "imo",
    name: "IMO Warnings",
    status: "ok",
    lastAttemptAt: "2026-09-24T16:00:00Z",
    data: { activeWarnings: warnings.length, warnings },
  };
}

const weather = [
  warning({ identifier: "w1", areaId: 2, eventEn: "Weather Warning: Wind" }),
  warning({ identifier: "w2", areaId: 8, eventEn: "Weather Warning: Precipitation" }),
  warning({ identifier: "w3", areaId: 8, eventEn: "Weather Warning: Wind" }),
  warning({ identifier: "w4", areaId: 9, eventEn: "Weather Warning: Precipitation" }),
  warning({ identifier: "w5", areaId: 10, eventEn: "Weather Warning: Wind", polygon: [HIGHLANDS] }),
  warning({ identifier: "w6", areaId: 5, eventEn: "Weather Warning: Wind" }),
];

const landslide = [
  warning({ identifier: "l1", areaId: 27, eventEn: "Landslide", areaNameEn: "Landslides: Central highlands", polygon: [HIGHLANDS] }),
  warning({ identifier: "l2", areaId: 25, eventEn: "Landslide", areaNameEn: "Landslides: South Iceland" }),
  warning({ identifier: "l3", areaId: 24, eventEn: "Landslide", areaNameEn: "Landslides: Southeast Iceland" }),
  warning({ identifier: "l4", areaId: 23, eventEn: "Landslide", areaNameEn: "Landslides: Southward Eastfjords" }),
];

test("event text classifies weather, landslide, and unknown families", () => {
  assert.equal(classifyImoWarningFamily({ eventEn: "Weather Warning: Wind" }), "weather");
  assert.equal(classifyImoWarningFamily({ eventEn: "Weather Warning: Precipitation" }), "weather");
  assert.equal(classifyImoWarningFamily({ eventEn: "Weather Warning: Blizzard" }), "weather");
  assert.equal(classifyImoWarningFamily({ eventEn: "Weather Warning: Rapid thaw" }), "weather");
  assert.equal(classifyImoWarningFamily({ eventEn: "Landslide" }), "landslide");
  assert.equal(classifyImoWarningFamily({ eventEn: "Viðvörun: Landslide" }), "landslide");
  assert.equal(classifyImoWarningFamily({ eventEn: "Volcanic Ash" }), "other");
  assert.equal(classifyImoWarningFamily({ eventEn: "Weather Warning: Something New" }), "other");
  assert.equal(classifyImoWarningFamily({ eventEn: undefined, areaNameEn: "Landslides: South Iceland" }), "landslide");
});

test("current production-shaped set is six weather and four landslide warnings", () => {
  const feed = presentImoWarnings(source([...weather, ...landslide]), NOW);
  const tabs = imoWarningFamilyTabs(feed.cards);
  assert.equal(feed.summary.effectiveCount, 10);
  assert.deepEqual(
    tabs.map((tab) => `${tab.family}:${tab.count}`),
    ["weather:6", "landslide:4"],
  );
  assert.equal(tabs.some((tab) => tab.family === "other"), false);
});

test("green warnings are not counted as active hazards", () => {
  const feed = presentImoWarnings(
    source([warning({ identifier: "cancelled", warningColor: "Green", eventEn: "Weather Warning: Wind" })]),
    NOW,
  );
  assert.equal(feed.cards[0].warning.warningColor, "Green");
  assert.equal(feed.cards[0].rank, "green");
  assert.equal(feed.summary.effectiveCount, 0);
  assert.equal(imoWarningFamilyTabs(feed.cards).length, 0);
});

test("family filter keeps map polygons and cards on the same hazard set", () => {
  const feed = presentImoWarnings(source([...weather, ...landslide]), NOW);
  const weatherFeed = filterImoWarningFeedByFamily(feed, "weather");
  const slideFeed = filterImoWarningFeedByFamily(feed, "landslide");
  const weatherMap = buildImoWarningMap(weatherFeed);
  const slideMap = buildImoWarningMap(slideFeed);
  assert.equal(weatherFeed.cards.length, 6);
  assert.equal(slideFeed.cards.length, 4);
  assert.equal(weatherFeed.cards.every((card) => classifyImoWarningFamily(card.warning) === "weather"), true);
  assert.equal(slideFeed.cards.every((card) => classifyImoWarningFamily(card.warning) === "landslide"), true);
  assert.equal(
    weatherMap.regions.flatMap((region) => region.cards).every((card) => classifyImoWarningFamily(card.warning) === "weather"),
    true,
  );
  assert.equal(
    slideMap.regions.flatMap((region) => region.cards).every((card) => classifyImoWarningFamily(card.warning) === "landslide"),
    true,
  );
});

test("an unknown hazard family adds an Other tab only when present", () => {
  const withOther = presentImoWarnings(
    source([...weather, warning({ identifier: "ash", eventEn: "Volcanic Ash", areaId: 99, areaNameEn: "Reykjanes" })]),
    NOW,
  );
  const tabs = imoWarningFamilyTabs(withOther.cards);
  assert.deepEqual(
    tabs.map((tab) => tab.family),
    ["weather", "other"],
  );
  assert.equal(imoWarningFamilyTabs(presentImoWarnings(source(weather), NOW).cards).some((tab) => tab.family === "other"), false);
});

test("same-region yellow wind, orange snow, and red rain aggregate to red without rewriting colours", () => {
  const warnings = [
    warning({ identifier: "y-wind", eventEn: "Weather Warning: Wind", warningColor: "Yellow" }),
    warning({ identifier: "o-snow", eventEn: "Weather Warning: Snow", warningColor: "Orange" }),
    warning({ identifier: "r-rain", eventEn: "Weather Warning: Precipitation", warningColor: "Red" }),
  ];
  const feed = presentImoWarnings(source(warnings), NOW);
  const map = buildImoWarningMap(feed);
  const opened = resolveImoWarningDialog(feed, { regionId: map.regions[0]?.id });
  assert.equal(map.regions.length, 1);
  assert.equal(map.regions[0].rank, "red");
  assert.deepEqual(
    feed.cards.map((card) => `${card.warning.identifier}:${card.warning.warningColor}`).sort(),
    ["o-snow:Orange", "r-rain:Red", "y-wind:Yellow"],
  );
  assert.equal(opened?.tabs.length, 3);
  assert.deepEqual(
    opened?.tabs.map((card) => card.rank).sort(),
    ["orange", "red", "yellow"],
  );
});

test("the panel keeps family tabs separate from dialog warning tabs", () => {
  const panel = read("src/components/ImoWarningsPanel.tsx");
  const dialog = read("src/components/ImoWarningDetailDialog.tsx");
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /警報類型/);
  assert.match(panel, /imo-warning-family-tab/);
  assert.match(panel, /visible\.cards.map/);
  assert.match(panel, /filterImoWarningFeedByFamily/);
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /imo-warning-dialog-tabs/);
  assert.equal(panel.includes("warningColor") && /familyTabs[\s\S]*warningColor/.test(panel), false);
});
