import { decodeSiteForecast } from "@/lib/forecastCodec";
import {
  auroraForecastSites,
  type AuroraForecastDisplaySite,
  type AuroraRegion,
} from "@/lib/auroraForecastPresentation";
import {
  assessAuroraVisibility,
  kpAt,
  levelOf,
  type AuroraAssessment,
} from "@/lib/auroraVisibility";
import { effectiveObstruction, hourAt, type WeatherHour } from "@/lib/weatherMap";
import {
  isNoaaKpForecastData,
  type DashboardSnapshot,
  type KpForecastPoint,
} from "@/snapshot/types";

export const ICELAND_TIME_ZONE = "Atlantic/Reykjavik";
const HOUR_MS = 3_600_000;

export interface IcelandTonightWindow {
  start: Date;
  hours: Date[];
}

export interface BriefingHour {
  time: string;
  hour: string;
  kp: number;
  best: AuroraAssessment & { site: AuroraForecastDisplaySite };
}

/** Cloud-matrix rows follow the travel-map circuit, with the capital kept first. */
export const BRIEFING_CLOUD_REGIONS = [
  "CAPITAL",
  "SOUTHWEST",
  "SOUTHEAST",
  "EASTFJORDS",
  "NORTHEAST",
  "NORTHWEST",
  "WESTFJORDS",
  "SNAEFELLSNES",
] as const;
export type BriefingCloudRegion = (typeof BRIEFING_CLOUD_REGIONS)[number];
export const BRIEFING_CLOUD_REGION_LABEL: Record<BriefingCloudRegion, string> = {
  CAPITAL: "首都圈",
  SOUTHWEST: "西南部",
  SOUTHEAST: "東南部",
  EASTFJORDS: "東峽灣",
  NORTHEAST: "東北部",
  NORTHWEST: "西北部",
  WESTFJORDS: "西峽灣",
  SNAEFELLSNES: "斯奈山半島",
};

const BRIEFING_CLOUD_REGION_BY_SITE: Record<string, BriefingCloudRegion> = {
  grotta: "CAPITAL",
  reykjavik: "CAPITAL",
  keflavik: "CAPITAL",
  blue_lagoon: "CAPITAL",
  thingvellir: "SOUTHWEST",
  geysir: "SOUTHWEST",
  gullfoss: "SOUTHWEST",
  kerid: "SOUTHWEST",
  selfoss: "SOUTHWEST",
  seljalandsfoss: "SOUTHWEST",
  skogafoss: "SOUTHWEST",
  vik: "SOUTHWEST",
  reynisfjara: "SOUTHWEST",
  landmannalaugar: "SOUTHWEST",
  jokulsarlon: "SOUTHEAST",
  diamond_beach: "SOUTHEAST",
  hofn: "SOUTHEAST",
  stokksnes: "SOUTHEAST",
  egilsstadir: "EASTFJORDS",
  akureyri: "NORTHEAST",
  godafoss: "NORTHEAST",
  myvatn: "NORTHEAST",
  husavik: "NORTHEAST",
  dettifoss: "NORTHEAST",
  asbyrgi: "NORTHEAST",
  borgarnes: "NORTHWEST",
  hvitserkur: "NORTHWEST",
  isafjordur: "WESTFJORDS",
  kirkjufell: "SNAEFELLSNES",
  budir: "SNAEFELLSNES",
  snaefellsjokull: "SNAEFELLSNES",
  hellissandur: "SNAEFELLSNES",
};

const BRIEFING_CLOUD_REGION_FALLBACK: Record<AuroraRegion, BriefingCloudRegion> = {
  CAPITAL: "CAPITAL",
  SOUTH: "SOUTHWEST",
  WEST: "SNAEFELLSNES",
  WESTFJORDS: "WESTFJORDS",
  NORTH: "NORTHEAST",
  EAST: "EASTFJORDS",
  HIGHLANDS: "SOUTHWEST",
};

export function briefingCloudRegion(
  site: Pick<AuroraForecastDisplaySite, "id" | "region">,
): BriefingCloudRegion {
  return BRIEFING_CLOUD_REGION_BY_SITE[site.id] ?? BRIEFING_CLOUD_REGION_FALLBACK[site.region];
}

export interface BriefingRegion {
  region: BriefingCloudRegion;
  label: string;
  obstructions: (number | undefined)[];
  average?: number;
}

export interface AuroraBriefing {
  window: IcelandTonightWindow;
  hours: BriefingHour[];
  best: BriefingHour["best"];
  highestKp: number;
  lowestKp: number;
  regions: BriefingRegion[];
  bestCloudRegions: BriefingRegion[];
  judgement: string;
  current: {
    kp?: number;
    bt?: number;
    bz?: number;
    speed?: number;
    ovation?: number;
  };
}

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function icelandParts(time: Date) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: ICELAND_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(time);
  const part = (type: "year" | "month" | "day") =>
    values.find((value) => value.type === type)?.value;
  return { year: part("year")!, month: part("month")!, day: part("day")! };
}

/** This report window is always keyed from the Icelandic date, never the browser''s local date. */
export function getIcelandTonightWindow(now = new Date()): IcelandTonightWindow {
  const { year, month, day } = icelandParts(now);
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 18));
  return {
    start,
    hours: Array.from(
      { length: 9 },
      (_, index) => new Date(start.getTime() + index * HOUR_MS),
    ),
  };
}

export function formatBriefingDate(time: Date, includeYear = false) {
  const { year, month, day } = icelandParts(time);
  return `${includeYear ? `${year}/` : ""}${month}/${day}`;
}

export function formatBriefingHour(time: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ICELAND_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(time);
}

export function formatBriefingHourLabel(hour: string) {
  return hour === "—" ? hour : `${hour}:00`;
}

export function formatBriefingKp(lowest: number, highest: number) {
  const low = lowest.toFixed(0);
  const high = highest.toFixed(0);
  return low === high ? `Kp 約 ${low}` : `Kp 約 ${low}～${high}`;
}

function weatherBySite(snapshot: DashboardSnapshot) {
  const metno = snapshot.sources.metno?.data;
  const stored = Array.isArray(metno?.sites) ? metno.sites : [];
  return new Map(
    stored.flatMap((site) => {
      if (
        !site ||
        typeof site !== "object" ||
        typeof (site as { id?: unknown }).id !== "string"
      ) {
        return [];
      }
      const value = site as { id: string; forecast?: unknown };
      return [[value.id, decodeSiteForecast(metno?.forecastTimes, value.forecast)] as const];
    }),
  );
}

function kpPoints(snapshot: DashboardSnapshot): KpForecastPoint[] {
  const data = snapshot.sources.noaaKpForecast?.data;
  return isNoaaKpForecastData(data) ? data.points : [];
}

function regionRows(
  sites: AuroraForecastDisplaySite[],
  weather: Map<string, WeatherHour[]>,
  hours: Date[],
): BriefingRegion[] {
  return BRIEFING_CLOUD_REGIONS.map((region) => {
    const regionSites = sites.filter((site) => briefingCloudRegion(site) === region);
    const obstructions = hours.map((time) => {
      const values = regionSites.flatMap((site) => {
        const reading = hourAt(weather.get(site.id), time, 0);
        return reading ? [effectiveObstruction(reading)] : [];
      });
      return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : undefined;
    });
    const present = obstructions.filter((value): value is number => value !== undefined);
    return {
      region,
      label: BRIEFING_CLOUD_REGION_LABEL[region],
      obstructions,
      average: present.length
        ? present.reduce((sum, value) => sum + value, 0) / present.length
        : undefined,
    };
  });
}

function overallCloudLabel(regions: BriefingRegion[]) {
  const averages = regions
    .map((region) => region.average)
    .filter((value): value is number => value !== undefined);
  if (!averages.length) return "資料不足";
  const average = averages.reduce((sum, value) => sum + value, 0) / averages.length;
  if (average < 35) return "偏低";
  if (average < 65) return "中等";
  return "偏高";
}

function conditionLabel(score: number) {
  if (score < 20) return "偏弱";
  if (score < 40) return "普通";
  return "偏佳";
}

function judgementText(
  best: BriefingHour["best"],
  bestHour: string,
  lowestKp: number,
  highestKp: number,
  regions: BriefingRegion[],
) {
  return `預測顯示今晚整體條件${conditionLabel(best.score)}，${formatBriefingKp(lowestKp, highestKp)}；${formatBriefingHourLabel(bestHour)} 前後相對較佳。全島多數區域雲層遮蔽${overallCloudLabel(regions)}。`;
}

export function buildAuroraBriefing(
  snapshot: DashboardSnapshot,
  now = new Date(),
): AuroraBriefing | undefined {
  const sites = auroraForecastSites(snapshot);
  if (!sites.length) return undefined;

  const window = getIcelandTonightWindow(now);
  const weather = weatherBySite(snapshot);
  const points = kpPoints(snapshot);
  const fallbackKp = finite(snapshot.sources.noaaKp?.data?.kp) ?? 0;
  const hours = window.hours.map((time) => {
    const kp = kpAt(points, time, fallbackKp);
    const candidates = sites.map((site) => ({
      ...assessAuroraVisibility({
        time,
        site,
        weather: hourAt(weather.get(site.id), time, 0),
        kp,
      }),
      site,
    }));
    const best = candidates.reduce((winner, candidate) =>
      candidate.score > winner.score ? candidate : winner,
    );
    return { time: time.toISOString(), hour: formatBriefingHour(time), kp, best };
  });
  const best = hours.reduce((winner, point) =>
    point.best.score > winner.best.score ? point : winner,
  ).best;
  const regions = regionRows(sites, weather, window.hours);
  const bestCloudRegions = regions
    .filter((region) => region.average !== undefined)
    .sort((a, b) => a.average! - b.average!)
    .slice(0, 2);
  const bestHour = hours.find((hour) => hour.best === best)?.hour ?? "—";
  const lowestKp = Math.min(...hours.map((hour) => hour.kp));
  const highestKp = Math.max(...hours.map((hour) => hour.kp));

  return {
    window,
    hours,
    best,
    highestKp: Math.max(...hours.map((hour) => hour.kp)),
    lowestKp: Math.min(...hours.map((hour) => hour.kp)),
    regions,
    bestCloudRegions,
    judgement: judgementText(best, bestHour, lowestKp, highestKp, regions),
    current: {
      kp: finite(snapshot.sources.noaaKp?.data?.kp),
      bt: finite(snapshot.sources.solarWind?.data?.btNt),
      bz: finite(snapshot.sources.solarWind?.data?.bzNt),
      speed: finite(snapshot.sources.solarWind?.data?.speedKms),
      ovation: finite(snapshot.sources.ovation?.data?.icelandPeakProbabilityPercent),
    },
  };
}

export function briefingSummary(briefing: AuroraBriefing) {
  const start = formatBriefingDate(briefing.window.hours[0]);
  const end = formatBriefingDate(briefing.window.hours[8]);
  const clouds =
    briefing.bestCloudRegions
      .map((region) => `${region.label} ${Math.round(region.average!)}%`)
      .join("、") || "資料不足";
  const current = briefing.current;
  const space =
    [
      current.bt === undefined ? undefined : `Bt ${current.bt.toFixed(1)} nT`,
      current.bz === undefined ? undefined : `Bz ${current.bz.toFixed(1)} nT`,
      current.speed === undefined
        ? undefined
        : `太陽風 ${Math.trunc(current.speed)} km/s`,
    ]
      .filter((value): value is string => value !== undefined)
      .join("｜") || "資料不足";
  const bestHour =
    briefing.hours.find((hour) => hour.best === briefing.best)?.hour ?? "—";

  return [
    `冰島極光快報｜${start} ${briefing.hours[0].hour}:00–${end} ${briefing.hours[8].hour}:00`,
    `今晚判讀摘要：${briefing.judgement}`,
    `今晚最佳可觀測條件：${levelOf(briefing.best.score).levelLabel}`,
    `最佳時間：${formatBriefingHourLabel(bestHour)}`,
    `最佳地點：${briefing.best.site.nameZh}`,
    `最高預測分數：${briefing.best.score}`,
    `預測 ${formatBriefingKp(briefing.lowestKp, briefing.highestKp)}`,
    `雲況相對較佳區域：${clouds}`,
    `目前太空天氣：${space}`,
    "※ Bt / Bz / 太陽風為目前即時值；今晚資料為預測。",
  ].join("\n");
}
