import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ringsFromWarning, resolveImoWarningDialog } from "../src/lib/imoWarningMap";
import { formatIcelandStamp, presentImoWarnings } from "../src/lib/imoWarningPresentation";
import {
  translateImoDescription,
  translateImoEvent,
  translateImoHeadline,
} from "../src/lib/imoWarningZhTw";
import type { NormalizedImoWarning } from "../src/monitors/imo/normalize";
import type { SnapshotSource } from "../src/snapshot/types";

const NOW = new Date("2026-09-24T16:00:00Z");
const SOUTH = "64.00,-20.00 64.20,-19.00 63.80,-19.00 64.00,-20.00";
const HIGHLANDS = "65.00,-18.50 65.20,-17.50 64.80,-17.50 65.00,-18.50";
const EAST = "65.20,-14.50 65.40,-13.80 64.90,-13.80 65.20,-14.50";
const WEST = "66.00,-23.50 66.20,-22.50 65.70,-22.50 66.00,-23.50";
const WIND_ONLY = "63.50,-21.00 63.70,-20.00 63.30,-20.00 63.50,-21.00";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function warning(over: Partial<NormalizedImoWarning> & Pick<NormalizedImoWarning, "identifier">): NormalizedImoWarning {
  return {
    warningColor: "Yellow",
    eventEn: "Weather Warning: Wind",
    areaNameEn: "South Iceland",
    sent: "2026-09-23T06:41:00Z",
    onset: "2026-09-24T07:00:00Z",
    expires: "2026-09-24T21:00:00Z",
    headlineEn: "Strong wind",
    descriptionEn: "Strong wind is expected.",
    instructionEn: "Secure loose objects.",
    eventIs: "Veðurviðvörun: Vindur",
    headlineIs: "Hvassviðri",
    descriptionIs: "Gert er ráð fyrir hvassviðri.",
    instructionIs: "Tryggið lausamuni.",
    polygon: [SOUTH],
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

function feedOf(warnings: NormalizedImoWarning[], status: SnapshotSource["status"] = "ok") {
  return presentImoWarnings(source(status, warnings), NOW);
}

const six = [
  warning({
    identifier: "se-rain",
    areaId: 8,
    areaNameEn: "Southeast Iceland",
    eventEn: "Weather Warning: Precipitation",
    eventIs: "Veðurviðvörun: Úrkoma",
    headlineEn: "Heavy rain",
    descriptionEn: "Heavy rain is expected.",
  }),
  warning({
    identifier: "se-wind",
    areaId: 8,
    areaNameEn: "Southeast Iceland",
    eventEn: "Weather Warning: Wind",
    polygon: [WIND_ONLY],
  }),
  warning({ identifier: "south", areaId: 2, areaNameEn: "South Iceland" }),
  warning({
    identifier: "highlands",
    areaId: 10,
    areaNameEn: "Central Highlands - uninhabited part of Iceland",
    polygon: [HIGHLANDS],
  }),
  warning({ identifier: "east", areaId: 9, areaNameEn: "Eastfjords", polygon: [EAST] }),
  warning({ identifier: "west", areaId: 5, areaNameEn: "Westfjords", polygon: [WEST] }),
];

test("opening from a region selects that region and the first warning tab", () => {
  const feed = feedOf(six);
  const opened = resolveImoWarningDialog(feed, { regionId: "id:8" });
  assert.equal(opened?.region.name, "Southeast Iceland");
  assert.equal(opened?.tabs.length, 2);
  assert.equal(opened?.active.warning.identifier, opened?.tabs[0].warning.identifier);
});

test("opening from a compact card selects that warning tab in its region", () => {
  const feed = feedOf(six);
  const rain = resolveImoWarningDialog(feed, { warningId: "se-rain" });
  const wind = resolveImoWarningDialog(feed, { warningId: "se-wind" });
  assert.equal(rain?.region.name, "Southeast Iceland");
  assert.equal(rain?.active.warning.identifier, "se-rain");
  assert.equal(translateImoEvent(rain?.active.warning.eventEn).text, "降雨警報");
  assert.equal(wind?.active.warning.identifier, "se-wind");
  assert.equal(translateImoEvent(wind?.active.warning.eventEn).text, "強風警報");
  assert.equal(rain?.tabs.length, 2);
  assert.equal(wind?.tabs.length, 2);
});

test("Southeast has rainfall and wind tabs; other current regions have one tab", () => {
  const feed = feedOf(six);
  assert.equal(feed.cards.length, 6);
  assert.equal(resolveImoWarningDialog(feed, { regionId: "id:8" })?.tabs.length, 2);
  assert.equal(resolveImoWarningDialog(feed, { regionId: "id:2" })?.tabs.length, 1);
  assert.equal(resolveImoWarningDialog(feed, { regionId: "id:10" })?.tabs.length, 1);
  assert.equal(resolveImoWarningDialog(feed, { regionId: "id:9" })?.tabs.length, 1);
  assert.equal(resolveImoWarningDialog(feed, { regionId: "id:5" })?.tabs.length, 1);
});

test("the active tab uses that warning polygon, and switching tabs updates it", () => {
  const feed = feedOf(six);
  const rain = resolveImoWarningDialog(feed, { warningId: "se-rain" });
  const wind = resolveImoWarningDialog(feed, { warningId: "se-wind" });
  const rainRings = ringsFromWarning(rain!.active.warning);
  const windRings = ringsFromWarning(wind!.active.warning);
  assert.equal(rainRings.length, 1);
  assert.equal(windRings.length, 1);
  assert.notDeepEqual(rainRings, windRings);
  assert.deepEqual(rainRings[0][0], [-20, 64]);
  assert.deepEqual(windRings[0][0], [-21, 63.5]);
});

test("dialog copy shows Chinese, English, Icelandic, and Iceland times", () => {
  const feed = feedOf(six);
  const opened = resolveImoWarningDialog(feed, { warningId: "se-rain" });
  const warning = opened!.active.warning;
  assert.equal(translateImoHeadline(warning.headlineEn).text, "強降雨");
  const description = translateImoDescription(warning.descriptionEn);
  assert.equal(description.text.includes("Heavy rain") || description.text.includes("強降雨"), true);
  assert.equal(warning.eventEn, "Weather Warning: Precipitation");
  assert.equal(warning.headlineEn, "Heavy rain");
  assert.equal(warning.descriptionEn, "Heavy rain is expected.");
  assert.equal(warning.eventIs, "Veðurviðvörun: Úrkoma");
  assert.equal(warning.headlineIs, "Hvassviðri");
  assert.equal(formatIcelandStamp(warning.sent), "09/23 06:41");
  assert.equal(formatIcelandStamp(warning.onset), "09/24 07:00");
  assert.equal(formatIcelandStamp(warning.expires), "09/24 21:00");
});

test("unknown Chinese translation falls back to English", () => {
  const feed = feedOf([
    warning({ identifier: "odd", eventEn: "Weather Warning: Volcanic ash", headlineEn: "Ashfall tonight" }),
  ]);
  const opened = resolveImoWarningDialog(feed, { warningId: "odd" });
  const event = translateImoEvent(opened?.active.warning.eventEn);
  const headline = translateImoHeadline(opened?.active.warning.headlineEn);
  assert.equal(event.translated, false);
  assert.equal(event.text, "Weather Warning: Volcanic ash");
  assert.equal(headline.translated, false);
  assert.equal(headline.text, "Ashfall tonight");
});

test("a warning without a polygon still resolves a dialog payload", () => {
  const feed = feedOf([warning({ identifier: "text", polygon: undefined })]);
  const opened = resolveImoWarningDialog(feed, { warningId: "text" });
  assert.equal(opened?.active.warning.identifier, "text");
  assert.deepEqual(ringsFromWarning(opened!.active.warning), []);
});

test("many tabs keep every warning in the same region", () => {
  const events = ["Wind", "Precipitation", "Snow", "Icing", "Flood", "Thunder", "Blizzard", "Ice"];
  const feed = feedOf(
    events.map((event, index) =>
      warning({
        identifier: `many-${index}`,
        eventEn: `Weather Warning: ${event}`,
        onset: `2026-09-24T0${index}:00:00Z`,
      }),
    ),
  );
  const opened = resolveImoWarningDialog(feed, { regionId: "name:South Iceland" });
  assert.equal(opened?.tabs.length, 8);
  assert.deepEqual(
    opened?.tabs.map((card) => card.warning.identifier).sort(),
    events.map((_, index) => `many-${index}`).sort(),
  );
});

test("a stale unexpired warning can still open; expired-only failure cannot", () => {
  const stale = resolveImoWarningDialog(feedOf([warning({ identifier: "kept" })], "error"), { warningId: "kept" });
  const expired = resolveImoWarningDialog(
    feedOf([warning({ identifier: "gone", onset: "2026-09-24T08:00:00Z", expires: "2026-09-24T10:00:00Z" })], "error"),
    { warningId: "gone" },
  );
  assert.equal(stale?.active.warning.identifier, "kept");
  assert.equal(expired, undefined);
});

test("the dialog UI follows the native dialog pattern and compact cards", () => {
  const dialog = read("src/components/ImoWarningDetailDialog.tsx");
  const panel = read("src/components/ImoWarningsPanel.tsx");
  const map = read("src/components/ImoWarningMap.tsx");
  const css = read("src/app/globals.css");
  const files = dialog + panel + map;
  assert.match(dialog, /showModal/);
  assert.match(dialog, /onCancel/);
  assert.match(dialog, /event\.target === event\.currentTarget/);
  assert.match(dialog, /aria-label="關閉"/);
  assert.match(dialog, /restoreRef\.current\?\.focus/);
  assert.match(dialog, /role="tablist"/);
  assert.match(dialog, /role="tab"/);
  assert.match(dialog, /aria-selected/);
  assert.match(dialog, /aria-controls/);
  assert.match(dialog, /role="tabpanel"/);
  assert.match(dialog, /ArrowLeft/);
  assert.match(dialog, /ArrowRight/);
  assert.match(dialog, /發布時間/);
  assert.match(dialog, /開始生效/);
  assert.match(dialog, /警報結束/);
  assert.match(dialog, /Atlantic\/Reykjavik/);
  assert.match(dialog, /English \/ IMO/);
  assert.match(dialog, /Íslenska \/ IMO/);
  assert.match(dialog, /translateImoHeadline/);
  assert.match(dialog, /此警報沒有可用的區域圖形資料/);
  assert.match(dialog, /mode="detail"/);
  assert.match(dialog, /activeWarningId/);
  assert.match(dialog, /查看詳情/);
  assert.equal(dialog.includes("查看完整警報內容"), false);
  assert.equal(panel.includes("查看完整警報內容"), false);
  assert.equal(panel.includes("imo-warning-selection"), false);
  assert.equal(panel.includes("scrollIntoView"), false);
  assert.match(panel, /setOpen\(\{ regionId: id \}\)/);
  assert.match(panel, /setOpen\(\{ warningId: card.warning.identifier \}\)/);
  assert.match(panel, /TechnicalDetails/);
  assert.match(panel, /feed.cards.map/);
  assert.match(map, /is-active-warning/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /imo-warning-dialog-pane/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.equal(/vedur\.is|fetch\s*\(/.test(files), false);
});
