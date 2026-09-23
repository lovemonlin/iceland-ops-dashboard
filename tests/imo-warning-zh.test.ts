import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  IMO_ZH_UNTRANSLATED,
  translateImoArea,
  translateImoDescription,
  translateImoEvent,
  translateImoHeadline,
  translateImoInstruction,
} from "../src/lib/imoWarningZhTw";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("South Iceland becomes 南部", () => {
  assert.equal(translateImoArea("South Iceland").text, "南部");
});

test("Southeast Iceland becomes 東南部", () => {
  assert.equal(translateImoArea("Southeast Iceland").text, "東南部");
});

test("Eastfjords becomes 東峽灣", () => {
  assert.equal(translateImoArea("Eastfjords").text, "東峽灣");
});

test("Westfjords becomes 西峽灣", () => {
  assert.equal(translateImoArea("Westfjords").text, "西峽灣");
});

test("Central highlands long name keeps the uninhabited qualifier", () => {
  assert.equal(
    translateImoArea("Central highlands - Uninhabited part of Iceland").text,
    "中央高地（無人居住區）",
  );
});

test("map short Central highlands drops the qualifier", () => {
  assert.equal(translateImoArea("Central highlands - Uninhabited part of Iceland", "short").text, "中央高地");
});

test("Wind and Precipitation events become Chinese warning names", () => {
  assert.equal(translateImoEvent("Weather Warning: Wind").text, "強風警報");
  assert.equal(translateImoEvent("Weather Warning: Precipitation").text, "降雨警報");
});

test("production headlines keep direction and intensity", () => {
  assert.equal(translateImoHeadline("Heavy rain").text, "強降雨");
  assert.equal(translateImoHeadline("East severe gale").text, "強勁東風");
  assert.equal(translateImoHeadline("Northeast strong gale").text, "強勁東北風");
  assert.equal(translateImoHeadline("East storm and heavy rain").text, "東風暴風與強降雨");
  assert.notEqual(translateImoHeadline("East gale").text, translateImoHeadline("East storm").text);
});

test("wind speeds stay numeric with m/s", () => {
  const zh = translateImoDescription(
    "East severe gale, 18-25 m/s with windgusts locally over 35 m/s, e.g. near Eyjafjallajökull and in Vestmannaeyjar. People are advised to secure loose objects. Hazardous traveling conditions.",
  );
  assert.equal(zh.translated, true);
  assert.match(zh.text, /18–25 m\/s/);
  assert.match(zh.text, /35 m\/s/);
  assert.match(zh.text, /Eyjafjallajökull/);
  assert.match(zh.text, /Vestmannaeyjar/);
  assert.match(zh.text, /請固定戶外或容易被風吹動的鬆散物品/);
  assert.match(zh.text, /交通與旅行條件具有危險性/);
});

test("heavy rain description covers runoff and landslides", () => {
  const zh = translateImoDescription(
    "Heavy rain expected with increased runoff, higher waterlevels and a risk of landslides that can cause travel disruption and damages. Higher strain anticipated on drainage systems. People are advised to show caution and clear grates to prevent flood damage.",
  );
  assert.equal(zh.translated, true);
  assert.match(zh.text, /強降雨/);
  assert.match(zh.text, /逕流/);
  assert.match(zh.text, /山崩/);
  assert.match(zh.text, /排水/);
});

test("gale description with snow on mountain roads keeps Friday and may-hazard", () => {
  const zh = translateImoDescription(
    "Northeast gale or strong gale, 15-23 m/s with windgusts locally over 30 m/s. Rain is also expected, which turns to snow on mountain roads on Friday. Traveling may become hazardous.",
  );
  assert.equal(zh.translated, true);
  assert.match(zh.text, /15–23 m\/s/);
  assert.match(zh.text, /30 m\/s/);
  assert.match(zh.text, /週五/);
  assert.match(zh.text, /降雪/);
  assert.match(zh.text, /旅行與交通條件可能變得危險/);
});

test("traveling is not advised keeps its strength", () => {
  const zh = translateImoDescription(
    "East severe gale or storm, 20-28 m/s with very strong windgusts. Considerable rain is also expected with increased runoff and elevated water levels. Traveling is not advised.",
  );
  assert.equal(zh.translated, true);
  assert.match(zh.text, /20–28 m\/s/);
  assert.match(zh.text, /不建議出行/);
  assert.equal(/可能不太方便/.test(zh.text), false);
});

test("unknown event, headline, and description fall back to English", () => {
  assert.equal(translateImoEvent("Weather Warning: Something New").translated, false);
  assert.equal(translateImoEvent("Weather Warning: Something New").text, "Weather Warning: Something New");
  assert.equal(translateImoHeadline("Unprecedented solar hail").translated, false);
  assert.equal(translateImoHeadline("Unprecedented solar hail").text, "Unprecedented solar hail");
  const description = translateImoDescription("A brand new meteorological phenomenon is occurring over Atlantis.");
  assert.equal(description.translated, false);
  assert.match(description.text, /Atlantis/);
});

test("instructions reuse the same safety phrases", () => {
  const zh = translateImoInstruction("People are advised to secure loose objects. Traveling is not advised.");
  assert.equal(zh.translated, true);
  assert.match(zh.text, /請固定戶外或容易被風吹動的鬆散物品/);
  assert.match(zh.text, /不建議出行/);
});

test("landslide events, areas, headlines, and descriptions have Traditional Chinese presentation", () => {
  assert.equal(translateImoEvent("Landslide").text, "山崩／土石流警報");
  assert.equal(translateImoArea("Landslides: Central highlands").text, "中央高地");
  assert.equal(translateImoArea("Landslides: South Iceland").text, "南部");
  assert.equal(translateImoArea("Landslides: Southeast Iceland").text, "東南部");
  assert.equal(translateImoArea("Landslides: Southward Eastfjords").text, "東峽灣南部");
  assert.equal(translateImoArea("Landslides: Central highlands", "short").text, "中央高地");
  assert.equal(translateImoHeadline("Possibility of landslides due to significant rainfall").text, "因顯著降雨可能發生山崩或土石流");
  assert.equal(translateImoHeadline("Possibility of landslides due to very heavy rainfall").text, "因強烈降雨可能發生山崩或土石流");
  assert.equal(/一定/.test(translateImoHeadline("Possibility of landslides due to significant rainfall").text), false);
  const glacier = translateImoDescription(
    "Significant rainfall is expected from the early hours of Thursday 24 September into Friday 25 September. The heaviest rainfall is expected near glaciers, including Eyjafjallajökull and Mýrdalsjökull. Rising water levels may occur in rivers and streams, and slope movements such as rockfalls, channelized debris flows and shallow landslides may occur with little warning. Avoid steep slopes and exercise caution while travelling.",
  );
  assert.equal(glacier.translated, true);
  assert.match(glacier.text, /顯著降雨/);
  assert.match(glacier.text, /落石/);
  assert.match(glacier.text, /土石流/);
  assert.match(glacier.text, /山崩/);
  assert.match(glacier.text, /陡坡/);
  assert.match(glacier.text, /提高警覺/);
  assert.match(glacier.text, /Eyjafjallajökull/);
  const southeast = translateImoDescription(
    "Significant rainfall is expected from Thursday 24 September into Friday 25 September. The highest rainfall accumulations are expected in this area, especially in Öræfi and near Vatnajökull. Rising water levels may occur in rivers and streams, and slope movements such as rockfalls, channelized debris flows and shallow landslides may occur suddenly and without warning. Avoid stopping below steep slopes and exercise caution on roads.",
  );
  assert.equal(southeast.translated, true);
  assert.match(southeast.text, /Vatnajökull/);
  assert.match(southeast.text, /幾乎無預警/);
  assert.match(southeast.text, /陡坡下方/);
});

test("summary, map, dialog, and cards use Chinese without dropping English originals", () => {
  const panel = read("src/components/ImoWarningsPanel.tsx");
  const dialog = read("src/components/ImoWarningDetailDialog.tsx");
  const map = read("src/components/ImoWarningMap.tsx");
  const presentation = read("src/lib/imoWarningPresentation.ts");
  const normalize = read("src/monitors/imo/normalize.ts");
  assert.match(panel, /translateImoArea\(area, "short"\)/);
  assert.match(dialog, /translateImoEvent/);
  assert.match(dialog, /IMO ENGLISH ORIGINAL/);
  assert.match(dialog, /IMO ÍSLENSKA ORIGINAL/);
  assert.match(dialog, /查看詳情/);
  assert.match(map, /translateImoArea\(region\.name, "short"\)/);
  assert.equal(/vedur\.is|translate\.googleapis|openai|fetch\s*\(/.test(read("src/lib/imoWarningZhTw.ts") + panel + dialog + map), false);
  assert.equal(/Translator/.test(read("src/lib/imoWarningZhTw.ts")), false);
  assert.match(presentation, /areaNameEn \?\? warning.areaNameIs/);
  assert.match(normalize, /warning.areaNameEn = areaNameEn/);
  assert.equal(IMO_ZH_UNTRANSLATED.includes("繁體中文"), true);
});
