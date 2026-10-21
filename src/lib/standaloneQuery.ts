import { ROAD_MODES, type RoadInfoMode } from "@/lib/roadMap";
import { MAX_OFFSET_HOURS } from "@/lib/weatherMap";

export type WeatherViewMode = "LIST" | "MAP";

function integerParam(params: URLSearchParams, key: string, maximum: number) {
  const raw = params.get(key);
  if (raw === null || !/^\d+$/.test(raw)) return 0;
  return Math.min(maximum, Number(raw));
}

export function parseWeatherQuery(params: URLSearchParams, siteIds: readonly string[]) {
  const rawMode = params.get("mode")?.toUpperCase();
  const mode: WeatherViewMode = rawMode === "MAP" ? "MAP" : "LIST";
  const requestedSite = params.get("site");
  return {
    mode,
    hour: integerParam(params, "hour", MAX_OFFSET_HOURS),
    site: requestedSite && siteIds.includes(requestedSite)
      ? requestedSite
      : siteIds.includes("reykjavik") ? "reykjavik" : siteIds[0],
  };
}

export function parseCloudFrameQuery(params: URLSearchParams, frameCount: number) {
  return integerParam(params, "frame", Math.max(0, frameCount - 1));
}

export function parseRoadModeQuery(params: URLSearchParams): RoadInfoMode {
  const mode = params.get("mode");
  return ROAD_MODES.find((entry) => entry.mode === mode)?.mode ?? "EVENTS";
}
