/**
 * Presentation-only Traditional Chinese for IMO warnings.
 * Deterministic phrase/token rules, same idea as the curated IRCA phrase map.
 * Offline only. No external translation service. Never mutates snapshot fields.
 */

export const IMO_ZH_UNTRANSLATED = "此項目暫無繁體中文翻譯";

export interface ImoZhText {
  text: string;
  translated: boolean;
}

const AREA_FULL: Record<string, string> = {
  "south iceland": "南部",
  "southeast iceland": "東南部",
  "southwest iceland": "西南部",
  "east iceland": "東部",
  "west iceland": "西部",
  "north iceland": "北部",
  "northeast iceland": "東北部",
  "northwest iceland": "西北部",
  eastfjords: "東峽灣",
  "east fjords": "東峽灣",
  westfjords: "西峽灣",
  "west fjords": "西峽灣",
  "north fjords": "北峽灣",
  "central highlands - uninhabited part of iceland": "中央高地（無人居住區）",
  "central highlands": "中央高地",
  "faxafloi - southwest iceland": "西南部（Faxaflói）",
  faxafloi: "Faxaflói",
  faxaflói: "Faxaflói",
};

const AREA_SHORT: Record<string, string> = {
  "central highlands - uninhabited part of iceland": "中央高地",
  "faxafloi - southwest iceland": "西南部",
};

const EVENT_ZH: [RegExp, string][] = [
  [/weather warning:\s*blizzard/i, "暴風雪警報"],
  [/weather warning:\s*thunderstorm/i, "雷暴警報"],
  [/weather warning:\s*thunder/i, "雷暴警報"],
  [/weather warning:\s*precipitation/i, "降雨警報"],
  [/weather warning:\s*snow/i, "降雪警報"],
  [/weather warning:\s*icing/i, "結冰警報"],
  [/weather warning:\s*ice/i, "結冰警報"],
  [/weather warning:\s*flood/i, "洪水警報"],
  [/weather warning:\s*wind/i, "強風警報"],
];

const DIRECTION_ZH: [RegExp, string][] = [
  [/northeast/gi, "東北"],
  [/northwest/gi, "西北"],
  [/southeast/gi, "東南"],
  [/southwest/gi, "西南"],
  [/\beast\b/gi, "東"],
  [/\bwest\b/gi, "西"],
  [/\bnorth\b/gi, "北"],
  [/\bsouth\b/gi, "南"],
];

const WEEKDAY_ZH: [RegExp, string][] = [
  [/\bMondays?\b/gi, "週一"],
  [/\bTuesdays?\b/gi, "週二"],
  [/\bWednesdays?\b/gi, "週三"],
  [/\bThursdays?\b/gi, "週四"],
  [/\bFridays?\b/gi, "週五"],
  [/\bSaturdays?\b/gi, "週六"],
  [/\bSundays?\b/gi, "週日"],
];

const PLACE_NAMES = [
  "Eyjafjallajökull",
  "Vestmannaeyjar",
  "Öræfajökull",
  "Oraefajokull",
  "Mýrdalur",
  "Myrdalur",
  "Reykjanes",
  "Reykjanesskaga",
];

function key(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function fromMap(value: string | undefined, table: Record<string, string>): string | undefined {
  if (!value?.trim()) return undefined;
  return table[key(value)];
}

export function translateImoArea(name: string | undefined, mode: "full" | "short" = "full"): ImoZhText {
  const source = name?.trim() ?? "";
  if (!source) return { text: "", translated: false };
  const short = mode === "short" ? fromMap(source, AREA_SHORT) : undefined;
  const mapped = short ?? fromMap(source, AREA_FULL);
  return mapped ? { text: mapped, translated: true } : { text: source, translated: false };
}

export function translateImoEvent(eventEn: string | undefined): ImoZhText {
  const source = eventEn?.trim() ?? "";
  if (!source) return { text: "", translated: false };
  for (const [pattern, zh] of EVENT_ZH) {
    if (pattern.test(source)) return { text: zh, translated: true };
  }
  return { text: source, translated: false };
}

function applyAll(source: string, rules: [RegExp, string][]) {
  let next = source;
  for (const [pattern, replacement] of rules) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function headlineWind(source: string): string | undefined {
  const match = source.match(
    /^(northeast|northwest|southeast|southwest|east|west|north|south)\s+(severe gale|strong gale|gales|gale|storm)(?:\s+and\s+(.+))?$/i,
  );
  if (!match) return undefined;
  const dir = applyAll(match[1], DIRECTION_ZH);
  const strength = match[2].toLowerCase();
  const extra = match[3] ? translateImoHeadline(match[3]).text : undefined;
  const wind =
    strength === "storm" ? `${dir}暴風` : strength === "gale" || strength === "gales" ? `${dir}大風` : `強勁${dir}風`;
  return extra ? `${wind}與${extra}` : wind;
}

export function translateImoHeadline(headlineEn: string | undefined): ImoZhText {
  const source = headlineEn?.replace(/\s+/g, " ").trim() ?? "";
  if (!source) return { text: "", translated: false };
  const exact: Record<string, string> = {
    "heavy rain": "強降雨",
    "east severe gale": "強勁東風",
    "northeast strong gale": "強勁東北風",
    "east storm and heavy rain": "東風暴風與強降雨",
    "southeast gales": "東南大風",
  };
  const mapped = exact[key(source)] ?? headlineWind(source);
  if (!mapped) return { text: source, translated: false };
  return leftoverEnglish(mapped) ? { text: source, translated: false } : { text: mapped, translated: true };
}

const DESCRIPTION_PHRASES: [RegExp, string][] = [
  [
    /People are advised to show caution and clear grates to prevent flood damage\.?/gi,
    "請提高警覺，並保持排水口暢通以降低淹水損害。",
  ],
  [/People are advised to secure loose objects\.?/gi, "請固定戶外或容易被風吹動的鬆散物品。"],
  [/Also, loos(?:e)? objects outside should be secured\.?/gi, "請固定戶外或容易被風吹動的鬆散物品。"],
  [/Hazardous traveling conditions\.?/gi, "交通與旅行條件具有危險性。"],
  [/Traveling is not advised\.?/gi, "不建議出行。"],
  [/Traveling may become hazardous\.?/gi, "旅行與交通條件可能變得危險。"],
  [/Hazardous for wind-sensitive vehicles\.?/gi, "對易受強風影響的車輛具有危險性。"],
  [
    /Heavy rain expected with increased runoff, higher water\s*levels and a risk of landslides that can cause travel disruption and damages\.?/gi,
    "預計有強降雨，地表逕流與河川水位可能上升，並增加山崩／土石滑動風險，可能造成交通中斷與損害。",
  ],
  [/Higher strain anticipated on drainage systems\.?/gi, "排水系統的負荷也會增加。"],
  [
    /Considerable rain is also expected with increased runoff and elevated water levels\.?/gi,
    "另預計有大量降雨，可能造成地表逕流增加及水位上升。",
  ],
  [
    /Rain is also expected, which turns to snow on mountain roads on (週[一二三四五六日])\.?/gi,
    "另有降雨，$1高山道路可能轉為降雪。",
  ],
  [/Rain is also expected\.?/gi, "另有降雨。"],
  [/, e\.g\. near ([^.]+?) and in ([^.]+?)\./gi, "，例如 $1 附近及 $2。"],
  [/, strongest wind west of ([^.]+?) and in ([^.]+?)\./gi, "，最強烈風力出現於 $1 以西及 $2。"],
  [/with very strong windgusts\.?/gi, "，並伴隨非常強烈的陣風。"],
  [/with windgusts locally over /gi, "，局部陣風超過 "],
  [/with wind gusts reaching /gi, "，陣風可達 "],
  [/near mountains in the south and on Reykjanes peninsula/gi, "，南部山區及 Reykjanes 半島附近"],
  [/near mountains in the east/gi, "，東部山區附近"],
  [/East severe gale or storm,/gi, "東風"],
  [/Northeast gale or strong gale,/gi, "東北風"],
  [/East severe gale,/gi, "東風"],
  [/Southeast /g, "東南風 "],
];

function leftoverEnglish(text: string): boolean {
  const stripped = text
    .replace(/\d+(?:[.–-]\d+)?\s*m\/s/gi, " ")
    .replace(/\b(?:週[一二三四五六日])\b/g, " ");
  let rest = stripped;
  for (const place of PLACE_NAMES) {
    rest = rest.split(place).join(" ");
  }
  return /\b(?:the|and|with|expected|people|advised|near|from|that|which|also|for|on|in|or|to)\b/i.test(rest);
}

function translateProse(source: string | undefined, extra: [RegExp, string][] = []): ImoZhText {
  const original = source?.trim() ?? "";
  if (!original) return { text: "", translated: false };
  let next = original.replace(/(\d+)\s*-\s*(\d+)/g, "$1–$2");
  next = applyAll(next, WEEKDAY_ZH);
  next = applyAll(next, extra);
  next = applyAll(next, DESCRIPTION_PHRASES);
  next = next.replace(/m\/s\./gi, "m/s。").replace(/m\/s,/gi, "m/s，");
  next = next.replace(/\s+,/g, "，").replace(/\s+\./g, "。").replace(/[ \t]+/g, " ").trim();
  next = next.replace(/。+/g, "。").replace(/，+/g, "，");
  if (leftoverEnglish(next)) return { text: original, translated: false };
  return { text: next, translated: next !== original };
}

export function translateImoDescription(descriptionEn: string | undefined): ImoZhText {
  return translateProse(descriptionEn);
}

export function translateImoInstruction(instructionEn: string | undefined): ImoZhText {
  return translateProse(instructionEn);
}

export function imoZhDisplay(result: ImoZhText): { text: string; untranslated: boolean } {
  if (!result.text) return { text: "", untranslated: false };
  return { text: result.text, untranslated: !result.translated };
}
