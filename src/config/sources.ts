/**
 * Canonical production data sources.
 *
 * Every endpoint, coordinate and field name here was read out of the Android app
 * (`C:\dev\iceland-aurora`, read-only) so the dashboard checks exactly what the app uses. It is
 * never a convenient substitute chosen for the dashboard: a monitor watching a different endpoint
 * would tell the maintainer nothing about the app.
 */

// ── MET Norway ────────────────────────────────────────────────────────────────
export const METNO_FORECAST_URL = "https://api.met.no/weatherapi/locationforecast/2.0/complete";

/**
 * MET Norway's terms require a User-Agent that identifies the caller and offers a way to reach
 * them. The default points at this project's public repository; set `METNO_USER_AGENT` to supply a
 * contact address instead. No private email is hardcoded here — this repository is public.
 */
export const METNO_USER_AGENT =
  process.env.METNO_USER_AGENT ??
  "IcelandOpsDashboard/1.0 (+https://github.com/lovemonlin/iceland-ops-dashboard)";

/** MET Norway treats differing decimal places as different queries and asks for at most four. */
export const METNO_COORDINATE_DECIMALS = 4;

/** Requests run a few at a time: the app polls these same points, but politely. */
export const METNO_CONCURRENCY = 6;

export interface WeatherSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region: string;
}

/**
 * The app's curated site list, verbatim. MET Norway forbids bulk point-fetching to build grids;
 * a fixed curated list is explicitly what the app was designed around, so this stays in step with it.
 */
export const WEATHER_SITES: WeatherSite[] = [
  { id: "grotta", name: "Grótta Lighthouse", lat: 64.1656, lon: -22.0186, region: "CAPITAL" },
  { id: "reykjavik", name: "Reykjavík", lat: 64.1466, lon: -21.9426, region: "CAPITAL" },
  { id: "keflavik", name: "Keflavík Airport", lat: 63.9850, lon: -22.6056, region: "CAPITAL" },
  { id: "blue_lagoon", name: "Blue Lagoon", lat: 63.8804, lon: -22.4495, region: "CAPITAL" },
  { id: "thingvellir", name: "Þingvellir National Park", lat: 64.2559, lon: -21.1300, region: "SOUTH" },
  { id: "geysir", name: "Geysir Geothermal Area", lat: 64.3104, lon: -20.3024, region: "SOUTH" },
  { id: "gullfoss", name: "Gullfoss Waterfall", lat: 64.3271, lon: -20.1199, region: "SOUTH" },
  { id: "kerid", name: "Kerið Crater", lat: 64.0411, lon: -20.8850, region: "SOUTH" },
  { id: "selfoss", name: "Selfoss", lat: 63.9330, lon: -21.0000, region: "SOUTH" },
  { id: "seljalandsfoss", name: "Seljalandsfoss Waterfall", lat: 63.6156, lon: -19.9885, region: "SOUTH" },
  { id: "skogafoss", name: "Skógafoss Waterfall", lat: 63.5321, lon: -19.5114, region: "SOUTH" },
  { id: "vik", name: "Vík", lat: 63.4187, lon: -19.0060, region: "SOUTH" },
  { id: "reynisfjara", name: "Reynisfjara Black Sand Beach", lat: 63.4054, lon: -19.0447, region: "SOUTH" },
  { id: "jokulsarlon", name: "Jökulsárlón Glacier Lagoon", lat: 64.0784, lon: -16.2306, region: "SOUTH" },
  { id: "diamond_beach", name: "Diamond Beach", lat: 64.0430, lon: -16.1790, region: "SOUTH" },
  { id: "hofn", name: "Höfn", lat: 64.2539, lon: -15.2082, region: "SOUTH" },
  { id: "stokksnes", name: "Stokksnes (Vestrahorn)", lat: 64.2470, lon: -14.9930, region: "SOUTH" },
  { id: "borgarnes", name: "Borgarnes", lat: 64.5386, lon: -21.9220, region: "WEST" },
  { id: "kirkjufell", name: "Kirkjufell Mountain", lat: 64.9270, lon: -23.3070, region: "WEST" },
  { id: "budir", name: "Búðir Black Church", lat: 64.8215, lon: -23.3843, region: "WEST" },
  { id: "snaefellsjokull", name: "Snæfellsjökull National Park", lat: 64.8080, lon: -23.7770, region: "WEST" },
  { id: "hellissandur", name: "Hellissandur", lat: 64.9160, lon: -23.9060, region: "WEST" },
  { id: "hvitserkur", name: "Hvítserkur Sea Stack", lat: 65.6060, lon: -20.6390, region: "WEST" },
  { id: "isafjordur", name: "Ísafjörður", lat: 66.0749, lon: -23.1355, region: "WESTFJORDS" },
  { id: "akureyri", name: "Akureyri", lat: 65.6835, lon: -18.0878, region: "NORTH" },
  { id: "godafoss", name: "Goðafoss Waterfall", lat: 65.6828, lon: -17.5500, region: "NORTH" },
  { id: "myvatn", name: "Lake Mývatn", lat: 65.6039, lon: -16.9964, region: "NORTH" },
  { id: "husavik", name: "Húsavík", lat: 66.0449, lon: -17.3389, region: "NORTH" },
  { id: "dettifoss", name: "Dettifoss Waterfall", lat: 65.8145, lon: -16.3849, region: "NORTH" },
  { id: "asbyrgi", name: "Ásbyrgi Canyon", lat: 66.0200, lon: -16.5100, region: "NORTH" },
  { id: "egilsstadir", name: "Egilsstaðir", lat: 65.2669, lon: -14.3948, region: "EAST" },
  { id: "landmannalaugar", name: "Landmannalaugar", lat: 63.9900, lon: -19.0600, region: "HIGHLANDS" },
];

// ── NOAA SWPC ─────────────────────────────────────────────────────────────────
export const SWPC_BASE = "https://services.swpc.noaa.gov";

/**
 * The app's own note: the widely-copied `/products/solar-wind/mag-1-day.json` style paths now 404.
 * Live solar wind moved to `/json/rtsw/`, and the light current values live under
 * `/products/summary/`. These are the paths the app actually calls.
 */
export const SWPC_KP_URL = `${SWPC_BASE}/json/planetary_k_index_1m.json`;
export const SWPC_SOLAR_WIND_MAG_URL = `${SWPC_BASE}/products/summary/solar-wind-mag-field.json`;
export const SWPC_SOLAR_WIND_SPEED_URL = `${SWPC_BASE}/products/summary/solar-wind-speed.json`;
export const SWPC_OVATION_URL = `${SWPC_BASE}/json/ovation_aurora_latest.json`;

// ── Icelandic Met Office (IMO) ────────────────────────────────────────────────
export const IMO_ACTIVE_WARNINGS_URL = "https://api.vedur.is/cap/capbroker/active/detailed/all";

/** The CAP broker requires an explicit API version header; this is the one the app sends. */
export const IMO_API_VERSION = "2026-04-14";

// ── Freshness policy ──────────────────────────────────────────────────────────
/**
 * How old a source's own data may get before the monitor reports STALE, in seconds.
 * Operational policy for this dashboard, not a guarantee from any provider.
 */
export const SOURCE_STALE_AFTER_SECONDS = {
  /** Locationforecast is reissued roughly hourly. */
  metno: 3 * 3600,
  /** planetary_k_index_1m updates every minute. */
  noaaKp: 3600,
  /** The summary products update about once a minute. */
  solarWind: 3600,
  /** ovation_aurora_latest is reissued every few minutes for a +30 min forecast. */
  ovation: 3 * 3600,
} as const;

export const SOURCE_TIMEOUT_MS = 15_000;
