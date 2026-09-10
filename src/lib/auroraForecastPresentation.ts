import type {
  AuroraAssessment,
  AuroraForecastSite,
  AuroraLimitingFactor,
  LightPollution,
} from "@/lib/auroraVisibility";
import type { DashboardSnapshot } from "@/snapshot/types";

export interface AuroraForecastDisplaySite extends AuroraForecastSite {
  name: string;
  nameIs: string;
  nameZh: string;
  region: AuroraRegion;
}

const BRIEFING_SITE_LABELS: Record<string, string> = {
  geysir: "蓋錫爾",
  thingvellir: "辛格韋德利",
  jokulsarlon: "冰河湖",
};

/** Short labels for the briefing timeline; formal site names stay unchanged. */
export function briefingSiteLabel(site: Pick<AuroraForecastDisplaySite, "id" | "nameZh">) {
  return BRIEFING_SITE_LABELS[site.id] ?? site.nameZh;
}

export const AURORA_REGIONS = ["CAPITAL", "SOUTH", "WEST", "WESTFJORDS", "NORTH", "EAST", "HIGHLANDS"] as const;
export type AuroraRegion = (typeof AURORA_REGIONS)[number];
export const AURORA_REGION_LABEL: Record<AuroraRegion, string> = {
  CAPITAL: "首都圈",
  SOUTH: "南部",
  WEST: "西部",
  WESTFJORDS: "西峽灣",
  NORTH: "北部",
  EAST: "東部",
  HIGHLANDS: "高地",
};

const LIGHT_POLLUTION = new Set<LightPollution>(["DARK", "MODERATE", "BRIGHT"]);

/** Reads the MET sites already stored in the snapshot; this is deliberately not a second site list. */
export function auroraForecastSites(snapshot: DashboardSnapshot): AuroraForecastDisplaySite[] {
  const sites = snapshot.sources.metno?.data?.sites;
  if (!Array.isArray(sites)) return [];

  return sites.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const site = value as Record<string, unknown>;
    if (
      typeof site.id !== "string" ||
      typeof site.name !== "string" ||
      typeof site.nameIs !== "string" ||
      typeof site.nameZh !== "string" ||
      typeof site.lat !== "number" ||
      !Number.isFinite(site.lat) ||
      typeof site.lon !== "number" ||
      !Number.isFinite(site.lon) ||
      !LIGHT_POLLUTION.has(site.lightPollution as LightPollution) ||
      !AURORA_REGIONS.includes(site.region as AuroraRegion)
    ) {
      return [];
    }

    return [{
      id: site.id,
      name: site.name,
      nameIs: site.nameIs,
      nameZh: site.nameZh,
      lat: site.lat,
      lon: site.lon,
      lightPollution: site.lightPollution as LightPollution,
      region: site.region as AuroraRegion,
    }];
  });
}

export function defaultAuroraForecastSite(sites: AuroraForecastDisplaySite[]) {
  return sites.find((site) => site.id === "reykjavik") ?? sites[0];
}

export const LIMITING_FACTOR_LABEL: Record<AuroraLimitingFactor, string> = {
  NOT_DARK_ENOUGH: "天空不夠暗",
  CLOUD: "雲層遮蔽",
  MOON: "月光干擾",
  SOLAR_ACTIVITY: "太陽活動不足",
  LOCATION: "地點條件",
  NONE: "無明顯限制",
};

export const LIGHT_POLLUTION_LABEL: Record<LightPollution, string> = {
  DARK: "低光害",
  MODERATE: "中等光害",
  BRIGHT: "高光害",
};

export function skyLightLabel(assessment: Pick<AuroraAssessment, "darknessFactor" | "sunElevation">) {
  if (assessment.darknessFactor === 0) return "白晝";
  if (assessment.darknessFactor < 1) return "不夠暗";
  return "黑夜";
}

export function briefingBestSiteLabel(
  assessment: Pick<AuroraAssessment, "score" | "darknessFactor" | "sunElevation"> & {
    site: Pick<AuroraForecastDisplaySite, "id" | "nameZh">;
  },
) {
  return assessment.score < 5 || skyLightLabel(assessment) === "白晝"
    ? undefined
    : briefingSiteLabel(assessment.site);
}
