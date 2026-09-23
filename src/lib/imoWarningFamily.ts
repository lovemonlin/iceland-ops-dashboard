import type { NormalizedImoWarning } from "@/monitors/imo/normalize";
import { isImoActiveHazardRank } from "./imoWarningLevel";
import type { ImoWarningFeed, PresentedImoWarning } from "./imoWarningPresentation";
import { summarizeImoWarnings } from "./imoWarningPresentation";

export type ImoWarningFamily = "weather" | "landslide" | "other";

export const IMO_FAMILY_LABEL: Record<ImoWarningFamily, string> = {
  weather: "氣象警報",
  landslide: "山崩／土石流",
  other: "其他警報",
};

const FAMILY_TAB_ORDER: ImoWarningFamily[] = ["weather", "landslide", "other"];

const WEATHER_EVENT =
  /(?:weather warning:\s*)?(?:winds?|gales?|blizzard|snowstorms?|rainfall|rains?|precipitation|snowfalls?|snow|rapid\s*thaws?|lightning|thunders(?:torm)?s?|icing|ice|floods?)\b/i;
const WEATHER_IS = /veðurviðvörun:\s*(?:vindur|rok|úrkoma|rigning|snjó|ofankoma|þruma|hret|ísing|klaki|flóð)/i;
const LANDSLIDE_EVENT = /\blandslides?\b|debris\s*flow|yfirborðshreyf|aurskrið|jarðvegsskrið|\bskrið(?:ur|um)?\b/i;
const LANDSLIDE_AREA = /^(?:landslides?|skriður)\s*:/i;

export function classifyImoWarningFamily(warning: Pick<NormalizedImoWarning, "eventEn" | "eventIs" | "areaNameEn" | "areaNameIs">): ImoWarningFamily {
  const event = `${warning.eventEn ?? ""} ${warning.eventIs ?? ""}`.trim();
  if (LANDSLIDE_EVENT.test(event) || LANDSLIDE_AREA.test(warning.areaNameEn ?? "") || LANDSLIDE_AREA.test(warning.areaNameIs ?? "")) {
    return "landslide";
  }
  if (WEATHER_EVENT.test(event) || WEATHER_IS.test(event)) return "weather";
  return "other";
}

function countable(card: PresentedImoWarning): boolean {
  return (card.phase === "active" || card.phase === "upcoming") && isImoActiveHazardRank(card.rank);
}

export function imoWarningFamilyTabs(cards: PresentedImoWarning[]): { family: ImoWarningFamily; label: string; count: number }[] {
  return FAMILY_TAB_ORDER.flatMap((family) => {
    const count = cards.filter((card) => classifyImoWarningFamily(card.warning) === family && countable(card)).length;
    if (count === 0) return [];
    return [{ family, label: IMO_FAMILY_LABEL[family], count }];
  });
}

export function filterImoWarningFeedByFamily(feed: ImoWarningFeed, family: ImoWarningFamily): ImoWarningFeed {
  const cards = feed.cards.filter((card) => classifyImoWarningFamily(card.warning) === family);
  const summary = summarizeImoWarnings(cards);
  if (feed.state === "undetailed") return { ...feed, cards, summary };
  return { ...feed, cards, summary };
}

export function imoFamilyRegionLine(family: ImoWarningFamily, count: number): string {
  if (family === "weather") return `${count} 個受影響氣象區域`;
  if (family === "landslide") return `${count} 個山崩／土石流警報區域`;
  return `${count} 個其他警報區域`;
}

export function imoFamilyKicker(family: ImoWarningFamily): string {
  if (family === "landslide") return "LANDSLIDE / IMO";
  if (family === "other") return "HAZARD / IMO";
  return "WEATHER ALERT / IMO";
}
