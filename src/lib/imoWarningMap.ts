import icelandCoastRing from "./icelandCoastRing.json";
import {
  higherImoRank,
  imoEventIcon,
  imoLevelLabel,
  sortImoWarnings,
  type ImoWarningFeed,
  type ImoWarningRank,
  type PresentedImoWarning,
} from "./imoWarningPresentation";
import type { NormalizedImoWarning } from "@/monitors/imo/normalize";

/** GeoJSON order: [longitude, latitude]. */
export type LonLat = [number, number];

export interface ImoWarningMapEvent {
  icon: string;
  chip: string;
  eventEn: string;
}

export interface ImoWarningMapRegion {
  id: string;
  name: string;
  rank: ImoWarningRank;
  paint: "official" | "unknown-time";
  cards: PresentedImoWarning[];
  events: ImoWarningMapEvent[];
  rings: LonLat[][];
}

export interface ImoWarningMapModel {
  status: "hidden" | "blocked" | "no-geometry" | "ready";
  stale: boolean;
  regions: ImoWarningMapRegion[];
  coast: LonLat[];
}

export interface ImoWarningMapProjection {
  width: number;
  height: number;
  project(lon: number, lat: number): { x: number; y: number };
}

export interface ImoWarningRegionSummary {
  id: string;
  name: string;
  rank: ImoWarningRank;
  countLine: string;
  events: ImoWarningMapEvent[];
  identifiers: string[];
  ariaLabel: string;
}

const MAP_WIDTH = 900;
const PAD = 0.06;
const RANK_SORT: Record<ImoWarningRank, number> = { red: 0, orange: 1, yellow: 2, unknown: 3 };

const coastRing: LonLat[] = (icelandCoastRing as number[][]).flatMap((point) =>
  point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [[point[0], point[1]] as LonLat] : [],
);

function closeRing(points: LonLat[]): LonLat[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, [first[0], first[1]]];
}

/** IMO strings are `lat,lon` pairs. GeoJSON and this map use `[lon, lat]`. */
export function parseImoPolygon(source: string): LonLat[] {
  const points: LonLat[] = [];
  for (const token of source.trim().split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(",");
    if (parts.length !== 2) continue;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    points.push([lon, lat]);
  }
  return points.length >= 3 ? closeRing(points) : [];
}

export function ringsFromWarning(warning: Pick<NormalizedImoWarning, "polygon">): LonLat[][] {
  const rings: LonLat[][] = [];
  const seen = new Set<string>();
  for (const raw of warning.polygon ?? []) {
    const ring = parseImoPolygon(raw);
    if (ring.length < 4) continue;
    const key = ring.map((point) => point.join(",")).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    rings.push(ring);
  }
  return rings;
}

function areaKey(card: PresentedImoWarning): string {
  const id = card.warning.areaId;
  if (id !== undefined && id !== "") return `id:${id}`;
  return `name:${card.areaLabel}`;
}

function mapEligible(card: PresentedImoWarning): boolean {
  return card.phase !== "expired";
}

function colorsFromOfficial(card: PresentedImoWarning): boolean {
  return card.phase === "active" || card.phase === "upcoming";
}

function uniqueRings(cards: PresentedImoWarning[]): LonLat[][] {
  const rings: LonLat[][] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    for (const ring of ringsFromWarning(card.warning)) {
      const key = ring.map((point) => point.join(",")).join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      rings.push(ring);
    }
  }
  return rings;
}

function uniqueEvents(cards: PresentedImoWarning[]): ImoWarningMapEvent[] {
  const events: ImoWarningMapEvent[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const official = card.warning.eventEn ?? card.warning.eventIs ?? "事件未提供";
    if (seen.has(official)) continue;
    seen.add(official);
    const mapped = imoEventIcon(card.warning.eventEn, card.warning.eventIs);
    events.push({ icon: mapped.icon, chip: mapped.chip, eventEn: official });
  }
  return events;
}

export function groupImoWarningRegions(feed: ImoWarningFeed): ImoWarningMapRegion[] {
  const groups = new Map<string, PresentedImoWarning[]>();
  for (const card of feed.cards.filter(mapEligible)) {
    const key = areaKey(card);
    const list = groups.get(key);
    if (list) list.push(card);
    else groups.set(key, [card]);
  }

  return [...groups.entries()]
    .map(([id, cards]) => {
      const official = cards.filter(colorsFromOfficial);
      const paint: "official" | "unknown-time" = official.length > 0 ? "official" : "unknown-time";
      const ranked = paint === "official" ? official : cards;
      const rank = ranked.reduce((best, card) => higherImoRank(best, card.rank), ranked[0]?.rank ?? "unknown");
      return {
        id,
        name: cards[0]?.areaLabel ?? "區域未提供",
        rank,
        paint,
        cards: sortImoWarnings(cards),
        events: uniqueEvents(cards),
        rings: uniqueRings(cards),
      };
    })
    .sort((left, right) => {
      const rank = RANK_SORT[left.rank] - RANK_SORT[right.rank];
      if (rank !== 0) return rank;
      const name = left.name.localeCompare(right.name);
      if (name !== 0) return name;
      return left.id.localeCompare(right.id);
    });
}

export function resolveImoWarningDialog(
  feed: ImoWarningFeed,
  open: { regionId?: string; warningId?: string },
): { region: ImoWarningMapRegion; active: PresentedImoWarning; tabs: PresentedImoWarning[] } | undefined {
  const regions = groupImoWarningRegions(feed);
  const region = open.warningId
    ? regions.find((entry) => entry.cards.some((card) => card.warning.identifier === open.warningId))
    : regions.find((entry) => entry.id === open.regionId);
  if (!region || region.cards.length === 0) return undefined;
  const active = region.cards.find((card) => card.warning.identifier === open.warningId) ?? region.cards[0];
  return { region, active, tabs: region.cards };
}

export function buildImoWarningMap(feed: ImoWarningFeed): ImoWarningMapModel {
  const coast = coastRing;
  if (feed.state === "clear" || feed.state === "unavailable" || feed.state === "undetailed") {
    return { status: "hidden", stale: false, regions: [], coast };
  }
  if (feed.state === "stale-expired") {
    return { status: "blocked", stale: true, regions: [], coast };
  }

  const regions = groupImoWarningRegions(feed);
  const drawable = regions.filter((region) => region.rings.length > 0);
  if (drawable.length === 0) {
    return { status: feed.cards.some(mapEligible) ? "no-geometry" : "hidden", stale: feed.state === "stale-current", regions: [], coast };
  }
  return { status: "ready", stale: feed.state === "stale-current", regions: drawable, coast };
}

export function summarizeWarningRegion(region: ImoWarningMapRegion): ImoWarningRegionSummary {
  const count = region.cards.length;
  const countLine =
    region.paint === "unknown-time"
      ? `⚪ 時間狀態未知 · ${count} 則`
      : `${imoLevelLabel(region.rank)} · ${count} 則`;
  return {
    id: region.id,
    name: region.name,
    rank: region.rank,
    countLine,
    events: region.events,
    identifiers: region.cards.map((card) => card.warning.identifier),
    ariaLabel: `${region.name}，${region.paint === "unknown-time" ? "時間狀態未知" : imoLevelLabel(region.rank).replace(/^[^\s]+\s/, "")}，${count} 則`,
  };
}

function boundsOf(points: LonLat[]) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

export function createWarningMapProjection(model: ImoWarningMapModel): ImoWarningMapProjection {
  const points = [...model.coast, ...model.regions.flatMap((region) => region.rings.flat())];
  const raw = boundsOf(points.length > 0 ? points : [[-24.5, 63.3], [-13.5, 66.6]]);
  const padLon = (raw.maxLon - raw.minLon) * PAD || 0.4;
  const padLat = (raw.maxLat - raw.minLat) * PAD || 0.2;
  const minLon = raw.minLon - padLon;
  const maxLon = raw.maxLon + padLon;
  const minLat = raw.minLat - padLat;
  const maxLat = raw.maxLat + padLat;
  const lonScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanLon = Math.max((maxLon - minLon) * lonScale, 1e-6);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const height = MAP_WIDTH * (spanLat / spanLon);
  return {
    width: MAP_WIDTH,
    height,
    project(lon: number, lat: number) {
      return {
        x: ((lon - minLon) * lonScale) / spanLon * MAP_WIDTH,
        y: (1 - (lat - minLat) / spanLat) * height,
      };
    },
  };
}

export function ringToPath(ring: LonLat[], project: ImoWarningMapProjection["project"]): string {
  return `${ring.map((point, index) => {
    const { x, y } = project(point[0], point[1]);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ")} Z`;
}

export function regionLabelAt(ring: LonLat[], project: ImoWarningMapProjection["project"]) {
  const inner = ring.slice(0, -1);
  if (inner.length === 0) return undefined;
  const xs = inner.map((point) => project(point[0], point[1]));
  const x = xs.reduce((sum, point) => sum + point.x, 0) / xs.length;
  const y = xs.reduce((sum, point) => sum + point.y, 0) / xs.length;
  const minX = Math.min(...xs.map((point) => point.x));
  const maxX = Math.max(...xs.map((point) => point.x));
  const minY = Math.min(...xs.map((point) => point.y));
  const maxY = Math.max(...xs.map((point) => point.y));
  return { x, y, wide: maxX - minX > 70 && maxY - minY > 40 };
}
