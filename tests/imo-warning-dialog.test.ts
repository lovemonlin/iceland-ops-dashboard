import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ringsFromWarning, resolveImoWarningDialog } from "../src/lib/imoWarningMap";
import {
  clampImoDialogPlace,
  clampImoDialogSize,
  IMO_DIALOG_MIN_HEIGHT,
  IMO_DIALOG_MIN_WIDTH,
} from "../src/lib/imoWarningDialogLayout";
import { formatIcelandStamp, imoWarningLifecycleSteps, presentImoWarnings } from "../src/lib/imoWarningPresentation";
import { presentImoWarningTextReport } from "../src/lib/imoWarningTextReport";
import {
  translateImoDescription,
  translateImoEvent,
  translateImoHeadline,
  translateImoInstruction,
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

test("lifecycle steps follow the existing warning phase", () => {
  assert.deepEqual(imoWarningLifecycleSteps("upcoming"), ["published", "now", "start", "end"]);
  assert.deepEqual(imoWarningLifecycleSteps("active"), ["published", "start", "now", "end"]);
  assert.deepEqual(imoWarningLifecycleSteps("expired"), ["published", "start", "end"]);
  assert.equal(imoWarningLifecycleSteps("unknown"), undefined);
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
  assert.match(dialog, /code="SEVERITY"/);
  assert.match(dialog, /code="STATUS"/);
  assert.match(dialog, /code="REGION"/);
  assert.match(dialog, /imo-warning-dialog-time-line/);
  assert.match(dialog, /formatIcelandDayClock/);
  assert.match(dialog, /Atlantic\/Reykjavik/);
  assert.match(css, /\.imo-warning-dialog-telemetry \{[\s\S]*gap: 8px;/);
  assert.match(css, /\.imo-warning-dialog-telemetry \.imo-warning-dialog-tile \{[\s\S]*padding: 8px 10px;/);
  assert.match(css, /@media \(max-width: 419px\)[\s\S]*\.imo-warning-dialog-telemetry \{ grid-template-columns: 1fr; \}/);
  assert.match(dialog, /IMO ENGLISH ORIGINAL/);
  assert.match(dialog, /IMO ÍSLENSKA ORIGINAL/);
  assert.match(dialog, /translateImoHeadline/);
  assert.match(dialog, /此警報沒有可用的區域圖形資料/);
  assert.match(dialog, /mode="detail"/);
  assert.match(dialog, /activeWarningId/);
  assert.match(dialog, /查看詳情/);
  assert.match(dialog, /事件摘要/);
  assert.match(dialog, /is-severity/);
  assert.match(dialog, /is-phase/);
  assert.match(dialog, /zh="開始生效"/);
  assert.match(dialog, /zh="警報結束"/);
  assert.equal(dialog.includes("imo-warning-dialog-iceland"), false);
  assert.equal(dialog.includes("imo-warning-dialog-utc"), false);
  assert.equal(dialog.includes(">Iceland<"), false);
  assert.match(dialog, /文字報告/);
  assert.match(dialog, /警報時序/);
  assert.match(dialog, /presentImoWarningTextReport/);
  assert.match(dialog, /imo-warning-dialog-zh/);
  assert.match(dialog, /imo-warning-dialog-side/);
  assert.match(dialog, /imo-warning-dialog-languages/);
  assert.equal(dialog.split('className="imo-warning-dialog-zh"').length - 1, 1);
  const languagesAt = dialog.indexOf('className="imo-warning-dialog-languages"');
  const detailAt = dialog.indexOf('className="imo-warning-dialog-detail"');
  const zhAt = dialog.indexOf('className="imo-warning-dialog-zh"');
  const right = dialog.slice(detailAt);
  assert.ok(languagesAt > 0 && languagesAt < detailAt);
  assert.ok(zhAt > languagesAt && zhAt < detailAt);
  assert.equal(right.includes("imo-warning-dialog-zh"), false);
  assert.equal(right.includes("IMO ENGLISH ORIGINAL"), false);
  assert.equal(right.includes("IMO ÍSLENSKA ORIGINAL"), false);
  assert.match(right, /文字報告/);
  assert.match(right, /ImoWindImpactPanel/);
  assert.match(right, /role="tablist"/);
  assert.match(css, /\.imo-warning-dialog-languages \{[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /@media \(max-width: 719px\)[\s\S]*\.imo-warning-dialog-side \{ display: contents; \}/);
  assert.match(css, /@media \(max-width: 719px\)[\s\S]*\.imo-warning-dialog-languages \{[\s\S]*order: 3;/);
  assert.match(dialog, /<details className="imo-warning-dialog-original">/);
  assert.equal(dialog.includes("<details open"), false);
  assert.match(dialog, /instruction\.text &&/);
  assert.match(dialog, /imo-warning-dialog-safety/);
  assert.equal(dialog.includes("查看完整警報內容"), false);
  assert.equal(panel.includes("查看完整警報內容"), false);
  assert.equal(panel.includes("imo-warning-selection"), false);
  assert.equal(panel.includes("scrollIntoView"), false);
  assert.match(panel, /setOpen\(\{ regionId: id \}\)/);
  assert.match(panel, /setOpen\(\{ warningId: card.warning.identifier \}\)/);
  assert.match(panel, /TechnicalDetails/);
  assert.match(panel, /visible\.cards.map/);
  assert.match(map, /is-active-warning/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /imo-warning-dialog-pane/);
  assert.match(dialog, /onPointerDown=\{beginMove\}/);
  assert.match(dialog, /onPointerDown=\{beginResize\}/);
  assert.match(dialog, /className="imo-warning-dialog-resize"/);
  assert.match(dialog, /skipBackdropClose/);
  assert.match(dialog, /setPointerCapture/);
  assert.match(dialog, /restoreRef\.current\?\.focus/);
  assert.match(dialog, /onCancel=\{/);
  assert.match(css, /\.imo-warning-dialog-resize \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 719px\)[\s\S]*\.imo-warning-dialog-header \{\s*cursor: default;/);
  const moveFn = dialog.slice(dialog.indexOf("const beginMove"), dialog.indexOf("const beginResize"));
  assert.equal(moveFn.includes("setWarningId"), false);
  assert.equal(dialog.slice(dialog.indexOf("const beginResize"), dialog.indexOf("const moveTab")).includes("setWarningId"), false);
  const moveTab = dialog.slice(dialog.indexOf("const moveTab"), dialog.indexOf("return (", dialog.indexOf("const moveTab")));
  assert.equal(moveTab.includes("setDialogPlace"), false);
  assert.equal(moveTab.includes("setDialogSize"), false);
  assert.match(dialog, /clampImoDialogSize/);
  assert.match(dialog, /className="imo-wind-speed"/);
  assert.match(dialog, /isWindRelatedImoWarning/);
  assert.match(css, /--imo-wind-speed-alert/);
  assert.equal(/vedur\.is|fetch\s*\(/.test(files), false);
});

test("desktop dialog size stays inside the viewport and keeps a usable header", () => {
  assert.equal(IMO_DIALOG_MIN_WIDTH, 760);
  assert.equal(IMO_DIALOG_MIN_HEIGHT, 520);
  assert.deepEqual(clampImoDialogSize(400, 200, { width: 1400, height: 900 }), { width: 760, height: 520 });
  assert.deepEqual(clampImoDialogSize(2000, 2000, { width: 1000, height: 800 }), { width: 960, height: 752 });
  assert.deepEqual(clampImoDialogPlace(-400, -20, 800, { width: 1200, height: 800 }), { left: -400, top: 0 });
  assert.deepEqual(clampImoDialogPlace(2000, 2000, 800, { width: 1200, height: 800 }), { left: 1120, top: 752 });
});

test("the text report stays under 300 characters and uses only existing warning facts", () => {
  const rain = warning({ identifier: "se-rain", eventEn: "Weather Warning: Precipitation", headlineEn: "Heavy rain", descriptionEn: "Heavy rain is expected." });
  const wind = warning({
    identifier: "se-wind",
    eventEn: "Weather Warning: Wind",
    headlineEn: "East severe gale",
    descriptionEn: "East severe gale, 18-25 m/s with windgusts locally over 35 m/s.",
    instructionEn: "Secure loose objects.",
  });
  const rainCard = feedOf([rain]).cards[0];
  const windCard = feedOf([wind]).cards[0];
  const rainReport = presentImoWarningTextReport({
    rank: rainCard.rank,
    phase: rainCard.phase,
    areaZh: "東南部",
    eventZh: translateImoEvent(rain.eventEn).text,
    windowLabel: rainCard.windowLabel,
    headlineZh: translateImoHeadline(rain.headlineEn).text,
    instructionZh: translateImoInstruction(rain.instructionEn).text,
    eventEn: rain.eventEn,
    headlineEn: rain.headlineEn,
    descriptionEn: rain.descriptionEn,
  });
  const windReport = presentImoWarningTextReport({
    rank: windCard.rank,
    phase: windCard.phase,
    areaZh: "東南部",
    eventZh: translateImoEvent(wind.eventEn).text,
    windowLabel: windCard.windowLabel,
    headlineZh: translateImoHeadline(wind.headlineEn).text,
    instructionZh: translateImoInstruction(wind.instructionEn).text,
    eventEn: wind.eventEn,
    headlineEn: wind.headlineEn,
    descriptionEn: wind.descriptionEn,
  });
  assert.ok([...rainReport].length <= 300);
  assert.ok([...rainReport].length >= 40);
  assert.match(rainReport, /黃色警報/);
  assert.match(rainReport, /降雨警報/);
  assert.match(rainReport, /目前生效/);
  assert.equal(/m\/s/.test(rainReport), false);
  assert.ok([...windReport].length <= 300);
  assert.match(windReport, /18–25 m\/s/);
  assert.match(windReport, /35 m\/s 以上/);
  assert.equal(wind.warningColor, "Yellow");
  const css = read("src/app/globals.css");
  assert.match(css, /\.imo-warning-dialog-lifecycle-mark \{[\s\S]*width: 14px;/);
  assert.match(css, /\.imo-warning-dialog-lifecycle-node::after \{[\s\S]*height: 3px;/);
});
