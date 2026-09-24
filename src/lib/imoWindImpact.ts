import { isWindRelatedImoWarning } from "./imoWindSpeed";

export type ImoWindImpactLevelId =
  | "calm"
  | "windy"
  | "strong"
  | "strong_gale"
  | "gale"
  | "severe_gale"
  | "very_strong"
  | "storm_like";

export interface ImoWindImpactLevel {
  id: ImoWindImpactLevelId;
  minMps: number;
  maxMps: number | undefined;
  bandLabel: string;
  labelZh: string;
  labelEn: string;
  shortDescriptionZh: string;
  personImpactZh: string[];
  environmentImpactZh: string[];
  drivingImpactZh: string[];
  photoAdviceZh: string[];
  activityAdviceZh: string[];
  illustrationKey: string;
  altZh: string;
}

export interface ImoWindSpeedSpan {
  min: number;
  max: number;
  raw: string;
}

export interface ImoWindGust {
  min: number;
  operator: "over" | "at";
  raw: string;
}

export interface ImoWindConditions {
  sustained?: ImoWindSpeedSpan;
  gust?: ImoWindGust;
}

export const IMO_WIND_IMPACT_IMAGE: Record<ImoWindImpactLevelId, string> = {
  calm: "/images/wind-impact/wind-00-calm.webp",
  windy: "/images/wind-impact/wind-01-windy.webp",
  strong: "/images/wind-impact/wind-02-strong.webp",
  strong_gale: "/images/wind-impact/wind-03-strong-gale.webp",
  gale: "/images/wind-impact/wind-04-gale.webp",
  severe_gale: "/images/wind-impact/wind-05-severe-gale.webp",
  very_strong: "/images/wind-impact/wind-06-very-strong.webp",
  storm_like: "/images/wind-impact/wind-07-storm.webp",
};

/** Local webp illustrations in public/images/wind-impact/. */
export const IMO_WIND_IMPACT_IMAGES_READY = true;

export const IMO_WIND_IMPACT_LEVELS: ImoWindImpactLevel[] = [
  {
    id: "calm",
    minMps: 0,
    maxMps: 5,
    bandLabel: "0–5",
    labelZh: "幾乎無風～微風",
    labelEn: "Calm to light breeze",
    shortDescriptionZh: "戶外幾乎感覺不到明顯風阻，一般步行與停留通常不受影響。",
    personImpactZh: ["幾乎感覺不到明顯風阻", "正常步行與拍照通常不受影響"],
    environmentImpactZh: ["旗幟與樹葉頂多輕微擺動", "鬆動物件通常保持原位"],
    drivingImpactZh: ["幾乎無明顯側風影響", "開車門與車速控制通常如常"],
    photoAdviceZh: ["正常手持或腳架皆可"],
    activityAdviceZh: ["適合一般戶外活動"],
    illustrationKey: "wind-00-calm",
    altZh: "微風中輕鬆站立的人物示意圖",
  },
  {
    id: "windy",
    minMps: 5,
    maxMps: 10,
    bandLabel: "5–10",
    labelZh: "有風",
    labelEn: "Breezy",
    shortDescriptionZh: "已經可以明顯感受到風，頭髮與寬鬆衣物會被吹動。",
    personImpactZh: ["可以明顯感受到風", "頭髮與寬鬆衣物會被風吹動"],
    environmentImpactZh: ["樹葉與細枝會晃動", "輕飄物可能開始移動"],
    drivingImpactZh: ["開始感受側風", "高車身車輛可稍加留意"],
    photoAdviceZh: ["手持通常仍可，輕型腳架建議踩穩"],
    activityAdviceZh: ["注意帽子與鬆動物件"],
    illustrationKey: "wind-01-windy",
    altZh: "有風時頭髮與衣物被吹動的人物示意圖",
  },
  {
    id: "strong",
    minMps: 10,
    maxMps: 13,
    bandLabel: "10–13",
    labelZh: "強風",
    labelEn: "Strong wind",
    shortDescriptionZh: "迎風行走開始有阻力，空曠處站姿需要更穩定。",
    personImpactZh: ["迎風行走開始有阻力", "拍照時需要更穩定站姿", "帽子與鬆散物品要注意"],
    environmentImpactZh: ["較小樹枝會明顯晃動", "小型鬆動物可能被吹動"],
    drivingImpactZh: ["需要更穩定控制方向", "開開關車門時留意被風帶動"],
    photoAdviceZh: ["腳架需要壓低、穩固"],
    activityAdviceZh: ["拍攝時注意器材與腳架"],
    illustrationKey: "wind-02-strong",
    altZh: "迎風行走開始感到阻力的人物示意圖",
  },
  {
    id: "strong_gale",
    minMps: 13,
    maxMps: 15,
    bandLabel: "13–15",
    labelZh: "強風～烈風",
    labelEn: "Strong to near gale",
    shortDescriptionZh: "走路明顯受到側風影響，空曠處需要注意平衡。",
    personImpactZh: ["走路明顯受到側風影響", "空曠處需要注意平衡", "操作相機與手機開始不方便"],
    environmentImpactZh: ["樹枝晃動更明顯", "小型招牌或輕物較容易移動"],
    drivingImpactZh: ["側風對車身的推擠更明顯", "高車身車輛需特別注意"],
    photoAdviceZh: ["腳架與長焦需更穩固"],
    activityAdviceZh: ["減少在空曠迎風處久留"],
    illustrationKey: "wind-03-strong-gale",
    altZh: "側風中需要注意平衡的人物示意圖",
  },
  {
    id: "gale",
    minMps: 15,
    maxMps: 18,
    bandLabel: "15–18",
    labelZh: "烈風",
    labelEn: "Gale",
    shortDescriptionZh: "戶外步行開始費力，長時間停留空曠處會不舒適。",
    personImpactZh: ["戶外步行開始費力", "身體可能被強側風吹偏", "長時間停留空曠處不舒適"],
    environmentImpactZh: ["較大樹枝明顯搖晃", "垃圾桶、小招牌、輕物可能被風吹動"],
    drivingImpactZh: ["空曠道路與橋梁側風明顯", "車門開關需小心"],
    photoAdviceZh: ["腳架與長焦鏡頭需特別注意側風"],
    activityAdviceZh: ["重新評估暴露地形的健行或停留時間"],
    illustrationKey: "wind-04-gale",
    altZh: "烈風中步行開始費力的人物示意圖",
  },
  {
    id: "severe_gale",
    minMps: 18,
    maxMps: 20,
    bandLabel: "18–20",
    labelZh: "烈風～強烈風",
    labelEn: "Severe gale",
    shortDescriptionZh: "很難舒服地進行戶外活動，站立穩定性會受到影響。",
    personImpactZh: ["很難舒服地進行戶外活動", "強側風可能使身體明顯偏移", "拍照與站立穩定性受到影響"],
    environmentImpactZh: ["大型標牌與輕型結構風險增加", "鬆動物件更容易被吹離原地"],
    drivingImpactZh: ["高車身、露營車風險升高", "側風路段需要更保守車速"],
    photoAdviceZh: ["在暴露地形使用腳架及更換鏡頭變困難"],
    activityAdviceZh: ["減少暴露在高風空曠區"],
    illustrationKey: "wind-05-severe-gale",
    altZh: "強烈側風中身體明顯偏移的人物示意圖",
  },
  {
    id: "very_strong",
    minMps: 20,
    maxMps: 23,
    bandLabel: "20–23",
    labelZh: "強烈風",
    labelEn: "Very strong wind",
    shortDescriptionZh: "行走困難，很難維持穩定站姿，暴露地形活動風險明顯增加。",
    personImpactZh: ["行走困難", "很難維持穩定站姿", "暴露地形活動風險明顯增加"],
    environmentImpactZh: ["大型標牌、輕型結構與鬆動物風險增加", "空曠處飛沙或細物可能更明顯"],
    drivingImpactZh: ["空曠道路／橋梁側風明顯", "高車身車輛操控負擔明顯增加"],
    photoAdviceZh: ["暴露地形不適合細緻更換鏡頭"],
    activityAdviceZh: ["重新評估戶外拍攝／健行安排"],
    illustrationKey: "wind-06-very-strong",
    altZh: "強烈風中行走困難的人物示意圖",
  },
  {
    id: "storm_like",
    minMps: 23,
    maxMps: undefined,
    bandLabel: "23–25+",
    labelZh: "接近暴風",
    labelEn: "Storm-like",
    shortDescriptionZh: "強風環境可能使正常步行非常困難，不適合一般觀光型戶外活動。",
    personImpactZh: ["強風環境可能使正常步行非常困難", "空曠區域可能難以維持平衡", "不適合一般觀光型戶外活動"],
    environmentImpactZh: ["大型標牌與鬆動物風險明顯增加", "空曠暴露處環境干擾很強"],
    drivingImpactZh: ["高車身、露營車風險升高", "側風路段行車負擔很高"],
    photoAdviceZh: ["不建議為拍攝目的長時間停留在暴露區域"],
    activityAdviceZh: ["以室內或遮蔽處為主，戶外行程需重新評估"],
    illustrationKey: "wind-07-storm",
    altZh: "接近暴風的環境中難以維持平衡的人物示意圖",
  },
];

const SPEED_TOKEN = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*m\/s/gi;

export function getImoWindImpactLevel(speedMps: number): ImoWindImpactLevel {
  if (speedMps < 5) return IMO_WIND_IMPACT_LEVELS[0];
  if (speedMps < 10) return IMO_WIND_IMPACT_LEVELS[1];
  if (speedMps < 13) return IMO_WIND_IMPACT_LEVELS[2];
  if (speedMps < 15) return IMO_WIND_IMPACT_LEVELS[3];
  if (speedMps < 18) return IMO_WIND_IMPACT_LEVELS[4];
  if (speedMps < 20) return IMO_WIND_IMPACT_LEVELS[5];
  if (speedMps < 23) return IMO_WIND_IMPACT_LEVELS[6];
  return IMO_WIND_IMPACT_LEVELS[7];
}

function bandHi(level: ImoWindImpactLevel) {
  return level.maxMps ?? Number.POSITIVE_INFINITY;
}

/** Inclusive single speeds; exclusive-looking overlap so 15–23 does not light 23–25+. */
export function resolveImoWindImpactRange(minMps: number, maxMps: number): ImoWindImpactLevel[] {
  if (minMps === maxMps) return [getImoWindImpactLevel(minMps)];
  const lo = Math.min(minMps, maxMps);
  const hi = Math.max(minMps, maxMps);
  return IMO_WIND_IMPACT_LEVELS.filter((level) => lo < bandHi(level) && hi > level.minMps);
}

function parseSpan(match: RegExpMatchArray): ImoWindSpeedSpan {
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  return { min, max, raw: match[0] };
}

function gustContext(source: string, index: number) {
  const before = source.slice(Math.max(0, index - 90), index);
  return /gust|windgust|陣風|vindhvi/i.test(before);
}

function overContext(source: string, index: number) {
  const before = source.slice(Math.max(0, index - 40), index);
  return /\bover\b|超過|yfir/i.test(before);
}

export function extractImoWindConditions(...sources: (string | undefined)[]): ImoWindConditions {
  for (const source of sources) {
    const text = source?.trim();
    if (!text) continue;
    const found: { span: ImoWindSpeedSpan; index: number; gust: boolean; over: boolean }[] = [];
    for (const match of text.matchAll(SPEED_TOKEN)) {
      const index = match.index ?? 0;
      found.push({
        span: parseSpan(match),
        index,
        gust: gustContext(text, index),
        over: overContext(text, index),
      });
    }
    if (found.length === 0) continue;
    const sustainedHit = found.find((item) => !item.gust);
    const gustHit = found.find((item) => item.gust);
    const conditions: ImoWindConditions = {};
    if (sustainedHit) conditions.sustained = sustainedHit.span;
    if (gustHit) {
      conditions.gust = {
        min: gustHit.span.min,
        operator: gustHit.over ? "over" : "at",
        raw: gustHit.span.raw,
      };
    }
    if (conditions.sustained || conditions.gust) return conditions;
  }
  return {};
}

export interface ImoWindImpactView {
  sustained: ImoWindSpeedSpan;
  gust?: ImoWindGust;
  active: ImoWindImpactLevel[];
  from: ImoWindImpactLevel;
  to: ImoWindImpactLevel;
  feelLabelZh: string;
}

export function presentImoWindImpact(warning: {
  eventEn?: string;
  headlineEn?: string;
  descriptionEn?: string;
  descriptionIs?: string;
  descriptionZh?: string;
}): ImoWindImpactView | undefined {
  if (!isWindRelatedImoWarning(warning.eventEn, warning.headlineEn)) return undefined;
  const conditions = extractImoWindConditions(warning.descriptionEn, warning.descriptionIs, warning.descriptionZh);
  const sustained = conditions.sustained;
  if (!sustained) return undefined;
  const active = resolveImoWindImpactRange(sustained.min, sustained.max);
  if (active.length === 0) return undefined;
  const from = active[0];
  const to = active[active.length - 1];
  return {
    sustained,
    gust: conditions.gust,
    active,
    from,
    to,
    feelLabelZh: from.id === to.id ? from.labelZh : `${from.labelZh} → ${to.labelZh}`,
  };
}

export function formatImoWindSpan(span: ImoWindSpeedSpan): string {
  if (span.min === span.max) return `${formatMps(span.min)} m/s`;
  return `${formatMps(span.min)}–${formatMps(span.max)} m/s`;
}

export function formatImoWindGust(gust: ImoWindGust): string {
  return gust.operator === "over" ? `${formatMps(gust.min)} m/s 以上` : `${formatMps(gust.min)} m/s`;
}

function formatMps(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}
