import { decodeSiteForecast } from "@/lib/forecastCodec";
import type { WeatherMapSite } from "@/components/WeatherMap";
import type { SnapshotSource } from "@/snapshot/types";

/** Dashboard cards and standalone viewers decode the same stored MET series once per render. */
export function buildWeatherViewerSites(entry?: SnapshotSource): WeatherMapSite[] {
  const data = entry?.data;
  if (!data || !Array.isArray(data.sites)) return [];
  return data.sites.map((item) => {
    const site = item as WeatherMapSite & { forecast?: unknown };
    return { ...site, hours: decodeSiteForecast(data.forecastTimes, site.forecast) };
  });
}
