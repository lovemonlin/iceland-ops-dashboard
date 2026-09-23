import type { NormalizedImoWarning } from "@/monitors/imo/normalize";
import type { SnapshotSource } from "@/snapshot/types";

/** Official IMO colour only. Severity is never mapped onto yellow / orange / red. */
export type ImoWarningRank = "red" | "orange" | "yellow" | "unknown";
export type ImoWarningPhase = "active" | "upcoming" | "expired" | "unknown";

export interface ImoEventChip {
  icon: string;
  label: string;
  count: number;
}

export interface PresentedImoWarning {
  warning: NormalizedImoWarning;
  rank: ImoWarningRank;
  phase: ImoWarningPhase;
  icon: string;
  areaLabel: string;
  windowLabel: string;
}

export interface ImoWarningSummary {
  listed: number;
  effectiveCount: number;
  highest: ImoWarningRank | "none";
  yellow: number;
  orange: number;
  red: number;
  unknown: number;
  events: ImoEventChip[];
  areas: string[];
  earliestOnset?: string;
  latestExpires?: string;
}

export type ImoWarningFeed =
  | { state: "clear"; summary: ImoWarningSummary; cards: PresentedImoWarning[] }
  | { state: "current"; summary: ImoWarningSummary; cards: PresentedImoWarning[] }
  | { state: "stale-current"; summary: ImoWarningSummary; cards: PresentedImoWarning[] }
  | { state: "stale-expired"; summary: ImoWarningSummary; cards: PresentedImoWarning[] }
  | { state: "unavailable"; summary: ImoWarningSummary; cards: PresentedImoWarning[] }
  | { state: "undetailed"; summary: ImoWarningSummary; cards: PresentedImoWarning[]; recordedCount: number };

const RANK_ORDER: Record<ImoWarningRank, number> = { red: 0, orange: 1, yellow: 2, unknown: 3 };
const PHASE_ORDER: Record<ImoWarningPhase, number> = { active: 0, upcoming: 1, expired: 2, unknown: 3 };

const LEVEL_LABEL: Record<ImoWarningRank, string> = {
  red: "紅色警報",
  orange: "橙色警報",
  yellow: "黃色警報",
  unknown: "警報等級未知",
};

const LEVEL_MARK: Record<ImoWarningRank, string> = {
  red: "🔴",
  orange: "🟠",
  yellow: "🟡",
  unknown: "⚠️",
};

export function imoWarningRank(color: string | undefined): ImoWarningRank {
  const key = color?.trim().toLowerCase();
  if (key === "red" || key === "orange" || key === "yellow") return key;
  return "unknown";
}

export function imoLevelLabel(rank: ImoWarningRank): string {
  return `${LEVEL_MARK[rank]} ${LEVEL_LABEL[rank]}`;
}

export function imoEventIcon(eventEn: string | undefined, eventIs?: string): { icon: string; chip: string } {
  const text = `${eventEn ?? ""} ${eventIs ?? ""}`;
  if (/snow|blizzard/i.test(text)) return { icon: "❄️", chip: "降雪" };
  if (/thunder/i.test(text)) return { icon: "⛈️", chip: "雷雨" };
  if (/ice|icing|freezing/i.test(text)) return { icon: "🧊", chip: "結冰" };
  if (/flood/i.test(text)) return { icon: "🌊", chip: "洪水" };
  if (/precip|rain/i.test(text)) return { icon: "🌧️", chip: "降雨" };
  if (/wind|gale|storm/i.test(text)) return { icon: "💨", chip: "強風" };
  return { icon: "⚠️", chip: eventEn?.trim() || eventIs?.trim() || "其他" };
}

export function imoWarningPhase(warning: Pick<NormalizedImoWarning, "onset" | "expires">, now: Date): ImoWarningPhase {
  const onset = warning.onset ? Date.parse(warning.onset) : Number.NaN;
  const expires = warning.expires ? Date.parse(warning.expires) : Number.NaN;
  if (Number.isNaN(onset) || Number.isNaN(expires)) return "unknown";
  const time = now.getTime();
  if (time < onset) return "upcoming";
  if (time < expires) return "active";
  return "expired";
}

function icelandParts(iso: string) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return undefined;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Atlantic/Reykjavik",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(parsed));
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!bag.month || !bag.day || !bag.hour || !bag.minute) return undefined;
  return { stamp: `${bag.month}/${bag.day} ${bag.hour}:${bag.minute}`, day: `${bag.month}/${bag.day}`, clock: `${bag.hour}:${bag.minute}` };
}

/** Iceland clock only. Same local day drops the end date; a midnight crossing keeps both dates. */
export function formatIcelandWarningWindow(onset?: string, expires?: string): string {
  const start = onset ? icelandParts(onset) : undefined;
  const end = expires ? icelandParts(expires) : undefined;
  if (!start && !end) return "—";
  if (start && end) return `${start.stamp} → ${start.day === end.day ? end.clock : end.stamp}`;
  return start?.stamp ?? end?.stamp ?? "—";
}

function isWarning(value: unknown): value is NormalizedImoWarning {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { identifier?: unknown }).identifier === "string";
}

export function readImoWarnings(data: Record<string, unknown> | undefined): NormalizedImoWarning[] {
  const raw = data?.warnings;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isWarning);
}

function present(warning: NormalizedImoWarning, now: Date): PresentedImoWarning {
  const event = imoEventIcon(warning.eventEn, warning.eventIs);
  return {
    warning,
    rank: imoWarningRank(warning.warningColor),
    phase: imoWarningPhase(warning, now),
    icon: event.icon,
    areaLabel: warning.areaNameEn ?? warning.areaNameIs ?? (warning.areaId !== undefined ? String(warning.areaId) : "區域未提供"),
    windowLabel: formatIcelandWarningWindow(warning.onset, warning.expires),
  };
}

export function sortImoWarnings(cards: PresentedImoWarning[]): PresentedImoWarning[] {
  return [...cards].sort((left, right) => {
    const rank = RANK_ORDER[left.rank] - RANK_ORDER[right.rank];
    if (rank !== 0) return rank;
    const phase = PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase];
    if (phase !== 0) return phase;
    const leftOnset = left.warning.onset ? Date.parse(left.warning.onset) : Number.POSITIVE_INFINITY;
    const rightOnset = right.warning.onset ? Date.parse(right.warning.onset) : Number.POSITIVE_INFINITY;
    if (leftOnset !== rightOnset) return leftOnset - rightOnset;
    return left.warning.identifier.localeCompare(right.warning.identifier);
  });
}

export function summarizeImoWarnings(cards: PresentedImoWarning[]): ImoWarningSummary {
  const effective = cards.filter((card) => card.phase === "active" || card.phase === "upcoming");
  const counted = effective.length > 0 ? effective : cards;
  const ranked = counted;
  const highest = ranked.length === 0 ? "none" : ranked.reduce((best, card) => (RANK_ORDER[card.rank] < RANK_ORDER[best] ? card.rank : best), "unknown" as ImoWarningRank);
  const chips = new Map<string, ImoEventChip>();
  for (const card of counted) {
    const event = imoEventIcon(card.warning.eventEn, card.warning.eventIs);
    const key = `${event.icon}|${event.chip}`;
    const existing = chips.get(key);
    if (existing) existing.count += 1;
    else chips.set(key, { icon: event.icon, label: event.chip, count: 1 });
  }
  const areas = [...new Set(counted.map((card) => card.areaLabel))];
  const onsets = cards.map((card) => card.warning.onset).filter((value): value is string => Boolean(value)).sort((left, right) => Date.parse(left) - Date.parse(right));
  const expires = cards.map((card) => card.warning.expires).filter((value): value is string => Boolean(value)).sort((left, right) => Date.parse(left) - Date.parse(right));
  return {
    listed: cards.length,
    effectiveCount: effective.length,
    highest: cards.length === 0 ? "none" : highest,
    yellow: counted.filter((card) => card.rank === "yellow").length,
    orange: counted.filter((card) => card.rank === "orange").length,
    red: counted.filter((card) => card.rank === "red").length,
    unknown: counted.filter((card) => card.rank === "unknown").length,
    events: [...chips.values()],
    areas,
    earliestOnset: onsets[0],
    latestExpires: expires.at(-1),
  };
}

function collectionFailed(entry: Pick<SnapshotSource, "status">): boolean {
  return entry.status !== "ok" && entry.status !== "info";
}

export function presentImoWarnings(entry: Pick<SnapshotSource, "status" | "data"> | undefined, now: Date): ImoWarningFeed {
  const cards = sortImoWarnings(readImoWarnings(entry?.data).map((warning) => present(warning, now)));
  const summary = summarizeImoWarnings(cards);
  const recorded = entry?.data?.activeWarnings;
  const recordedCount = typeof recorded === "number" && Number.isFinite(recorded) ? recorded : 0;
  if (entry && !collectionFailed(entry) && !Array.isArray(entry.data?.warnings) && recordedCount > 0) {
    return { state: "undetailed", summary, cards, recordedCount };
  }
  if (!entry || collectionFailed(entry)) {
    if (cards.length === 0) return { state: "unavailable", summary, cards };
    const stillRelevant = cards.some((card) => card.phase !== "expired");
    return stillRelevant ? { state: "stale-current", summary, cards } : { state: "stale-expired", summary, cards };
  }
  if (!cards.some((card) => card.phase !== "expired")) return { state: "clear", summary, cards };
  return { state: "current", summary, cards };
}

/** Yellow / orange / red that is active or upcoming belongs above weather, roads, and aurora. */
export function imoWarningsLead(entry: Pick<SnapshotSource, "status" | "data"> | undefined, now: Date): boolean {
  const feed = presentImoWarnings(entry, now);
  if (feed.state !== "current" && feed.state !== "stale-current") return false;
  return feed.cards.some(
    (card) =>
      (card.phase === "active" || card.phase === "upcoming") &&
      (card.rank === "yellow" || card.rank === "orange" || card.rank === "red"),
  );
}

export function imoSourceHealthLabel(entry: Pick<SnapshotSource, "status">): string {
  return entry.status === "ok" || entry.status === "info" ? "🟢 資料來源正常" : "資料來源目前無法更新";
}
