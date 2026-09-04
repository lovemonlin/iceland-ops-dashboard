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
  /** English name, as the app shows it in an English locale. */
  name: string;
  /** Icelandic name. Road signs and satnav only carry this one, so the app always shows it too. */
  nameIs: string;
  /** Chinese name, as the app shows it in a zh locale. */
  nameZh: string;
  lat: number;
  lon: number;
  region: string;
}

/**
 * The app's curated site list, verbatim. MET Norway forbids bulk point-fetching to build grids;
 * a fixed curated list is explicitly what the app was designed around, so this stays in step with it.
 */
export const WEATHER_SITES: WeatherSite[] = [
  { id: "grotta", name: "Grótta Lighthouse", nameIs: "Grótta viti", nameZh: "格羅塔燈塔", lat: 64.1656, lon: -22.0186, region: "CAPITAL" },
  { id: "reykjavik", name: "Reykjavík", nameIs: "Reykjavík", nameZh: "雷克雅未克", lat: 64.1466, lon: -21.9426, region: "CAPITAL" },
  { id: "keflavik", name: "Keflavík Airport", nameIs: "Keflavíkurflugvöllur", nameZh: "凱夫拉維克機場", lat: 63.9850, lon: -22.6056, region: "CAPITAL" },
  { id: "blue_lagoon", name: "Blue Lagoon", nameIs: "Bláa lónið", nameZh: "藍湖溫泉", lat: 63.8804, lon: -22.4495, region: "CAPITAL" },
  { id: "thingvellir", name: "Þingvellir National Park", nameIs: "Þingvellir", nameZh: "辛格韋德利國家公園", lat: 64.2559, lon: -21.1300, region: "SOUTH" },
  { id: "geysir", name: "Geysir Geothermal Area", nameIs: "Geysir", nameZh: "蓋錫爾間歇泉", lat: 64.3104, lon: -20.3024, region: "SOUTH" },
  { id: "gullfoss", name: "Gullfoss Waterfall", nameIs: "Gullfoss", nameZh: "黃金瀑布", lat: 64.3271, lon: -20.1199, region: "SOUTH" },
  { id: "kerid", name: "Kerið Crater", nameIs: "Kerið", nameZh: "凱瑞德火山口湖", lat: 64.0411, lon: -20.8850, region: "SOUTH" },
  { id: "selfoss", name: "Selfoss", nameIs: "Selfoss", nameZh: "塞爾福斯", lat: 63.9330, lon: -21.0000, region: "SOUTH" },
  { id: "seljalandsfoss", name: "Seljalandsfoss Waterfall", nameIs: "Seljalandsfoss", nameZh: "塞里雅蘭瀑布", lat: 63.6156, lon: -19.9885, region: "SOUTH" },
  { id: "skogafoss", name: "Skógafoss Waterfall", nameIs: "Skógafoss", nameZh: "斯科加瀑布", lat: 63.5321, lon: -19.5114, region: "SOUTH" },
  { id: "vik", name: "Vík", nameIs: "Vík í Mýrdal", nameZh: "維克鎮", lat: 63.4187, lon: -19.0060, region: "SOUTH" },
  { id: "reynisfjara", name: "Reynisfjara Black Sand Beach", nameIs: "Reynisfjara", nameZh: "黑沙灘", lat: 63.4054, lon: -19.0447, region: "SOUTH" },
  { id: "jokulsarlon", name: "Jökulsárlón Glacier Lagoon", nameIs: "Jökulsárlón", nameZh: "傑古沙龍冰河湖", lat: 64.0784, lon: -16.2306, region: "SOUTH" },
  { id: "diamond_beach", name: "Diamond Beach", nameIs: "Breiðamerkursandur", nameZh: "鑽石冰沙灘", lat: 64.0430, lon: -16.1790, region: "SOUTH" },
  { id: "hofn", name: "Höfn", nameIs: "Höfn í Hornafirði", nameZh: "赫本鎮", lat: 64.2539, lon: -15.2082, region: "SOUTH" },
  { id: "stokksnes", name: "Stokksnes (Vestrahorn)", nameIs: "Stokksnes / Vestrahorn", nameZh: "蝙蝠山", lat: 64.2470, lon: -14.9930, region: "SOUTH" },
  { id: "borgarnes", name: "Borgarnes", nameIs: "Borgarnes", nameZh: "博爾加內斯", lat: 64.5386, lon: -21.9220, region: "WEST" },
  { id: "kirkjufell", name: "Kirkjufell Mountain", nameIs: "Kirkjufell", nameZh: "教會山", lat: 64.9270, lon: -23.3070, region: "WEST" },
  { id: "budir", name: "Búðir Black Church", nameIs: "Búðakirkja", nameZh: "布迪爾黑教堂", lat: 64.8215, lon: -23.3843, region: "WEST" },
  { id: "snaefellsjokull", name: "Snæfellsjökull National Park", nameIs: "Snæfellsjökull", nameZh: "斯奈菲爾冰川國家公園", lat: 64.8080, lon: -23.7770, region: "WEST" },
  { id: "hellissandur", name: "Hellissandur", nameIs: "Hellissandur", nameZh: "赫利桑德", lat: 64.9160, lon: -23.9060, region: "WEST" },
  { id: "hvitserkur", name: "Hvítserkur Sea Stack", nameIs: "Hvítserkur", nameZh: "犀牛石", lat: 65.6060, lon: -20.6390, region: "WEST" },
  { id: "isafjordur", name: "Ísafjörður", nameIs: "Ísafjörður", nameZh: "伊薩菲厄澤", lat: 66.0749, lon: -23.1355, region: "WESTFJORDS" },
  { id: "akureyri", name: "Akureyri", nameIs: "Akureyri", nameZh: "阿克雷里", lat: 65.6835, lon: -18.0878, region: "NORTH" },
  { id: "godafoss", name: "Goðafoss Waterfall", nameIs: "Goðafoss", nameZh: "眾神瀑布", lat: 65.6828, lon: -17.5500, region: "NORTH" },
  { id: "myvatn", name: "Lake Mývatn", nameIs: "Mývatn", nameZh: "米湖", lat: 65.6039, lon: -16.9964, region: "NORTH" },
  { id: "husavik", name: "Húsavík", nameIs: "Húsavík", nameZh: "胡薩維克", lat: 66.0449, lon: -17.3389, region: "NORTH" },
  { id: "dettifoss", name: "Dettifoss Waterfall", nameIs: "Dettifoss", nameZh: "黛提瀑布", lat: 65.8145, lon: -16.3849, region: "NORTH" },
  { id: "asbyrgi", name: "Ásbyrgi Canyon", nameIs: "Ásbyrgi", nameZh: "阿斯匹爾吉峽谷", lat: 66.0200, lon: -16.5100, region: "NORTH" },
  { id: "egilsstadir", name: "Egilsstaðir", nameIs: "Egilsstaðir", nameZh: "埃伊爾斯塔濟", lat: 65.2669, lon: -14.3948, region: "EAST" },
  { id: "landmannalaugar", name: "Landmannalaugar", nameIs: "Landmannalaugar", nameZh: "蘭德曼納勞卡", lat: 63.9900, lon: -19.0600, region: "HIGHLANDS" },
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
  /**
   * `meta.updated_at` is the model *issue* time, not the moment the response was refreshed, so it
   * legitimately lags by hours. Measured 2026-09-04 04:30 UTC: 183-184 minutes, identical across
   * Reykjavik, Akureyri, Vik and Isafjordur, while `Last-Modified` was 15 minutes old and the first
   * timeseries entry was the current hour. An earlier 3-hour threshold therefore reported STALE on
   * perfectly current data.
   *
   * TODO: refine against a longer observation. The authoritative "ask again" signal is MET's
   * `Expires` header (~30 min), which the app uses for caching; adopting it here would be sharper
   * than ageing `updated_at`.
   */
  metno: 8 * 3600,
  /** planetary_k_index_1m updates every minute. */
  noaaKp: 3600,
  /** The summary products update about once a minute. */
  solarWind: 3600,
  /** ovation_aurora_latest is reissued every few minutes for a +30 min forecast. */
  ovation: 3 * 3600,
} as const;

export const SOURCE_TIMEOUT_MS = 15_000;
