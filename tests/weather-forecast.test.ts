import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import {
  DIALOG_HOURS_SHOWN,
  FORECAST_TIME_ZONE,
  forecastBaseTime,
  formatForecastDayHour,
  formatForecastHour,
  hourAt,
  MAX_OFFSET_HOURS,
  nextHours,
  type WeatherHour,
} from "../src/lib/weatherMap";
import { checkMetno } from "../src/monitors/metno/monitor";
import { mergeSource } from "../src/snapshot/mergeSnapshot";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const NOW = new Date("2026-09-04T09:00:00Z");
const RECENT = "2026-09-04T08:55:00Z";

/** Sixty hourly entries, the shape `/complete` actually returns. */
const hourlyForecast = () => ({
  properties: {
    meta: { updated_at: RECENT },
    timeseries: Array.from({ length: 60 }, (_, index) => ({
      // Real timestamps from the response, never the array index.
      time: new Date(Date.parse(RECENT) + index * 3_600_000).toISOString(),
      data: {
        instant: {
          details: {
            air_temperature: 8.4 - index * 0.1,
            wind_speed: 6.4,
            wind_from_direction: 210,
            cloud_area_fraction: 42,
            cloud_area_fraction_low: 12,
            cloud_area_fraction_medium: 21,
            cloud_area_fraction_high: 9,
          },
        },
        next_1_hours: { summary: { symbol_code: index % 2 === 0 ? "partlycloudy_night" : "lightrain" } },
      },
    })),
  },
});

const stub = (calls?: string[]): DiagnosticFetcher => (url, options) =>
  fetchWithDiagnosticsCore(url, {
    ...options,
    fetch: async (target) => {
      calls?.push(target);
      return new Response(JSON.stringify(hourlyForecast()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

// ── The stored series ─────────────────────────────────────────────────────────

test("the hourly series is stored without adding a single MET request", async () => {
  const calls: string[] = [];
  const health = await checkMetno({ now: NOW, request: stub(calls) });

  // One request per site, exactly as before the series was kept.
  assert.equal(calls.length, 32);
  assert.equal(new Set(calls).size, 32, "one request per site, none repeated");

  const sites = health.data?.sites as Record<string, unknown>[];
  assert.equal(sites.length, 32);
  for (const site of sites) {
    const hours = site.hours as Record<string, unknown>[];
    assert.equal(Array.isArray(hours), true, `${site.id} has no hourly series`);
    // 0..48 inclusive is 49 hourly entries; the rest of the response is dropped.
    assert.equal(hours.length, 49, `${site.id} stored ${hours.length} hours`);
  }
});

test("the stored hours reach +48h and carry the response's own timestamps", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const site = (health.data?.sites as Record<string, unknown>[])[0];
  const hours = site.hours as { time: string; symbolCode?: string; temperatureC?: number }[];

  const first = Date.parse(hours[0].time);
  const last = Date.parse(hours[hours.length - 1].time);
  assert.equal(Number.isNaN(first), false);
  assert.equal(Number.isNaN(last), false);
  assert.equal((last - first) / 3_600_000, 48, "the series must span the app's whole timeline");

  // Strictly one hour apart — the entries' own times, not their positions.
  for (let index = 1; index < hours.length; index += 1) {
    assert.equal(Date.parse(hours[index].time) - Date.parse(hours[index - 1].time), 3_600_000);
  }

  // Values are the source's, neither interpolated nor repeated.
  assert.equal(hours[0].temperatureC, 8.4);
  assert.equal(Math.abs((hours[10].temperatureC ?? 0) - 7.4) < 1e-9, true);
  // The condition code comes from next_1_hours, as the app reads it.
  assert.equal(hours[0].symbolCode, "partlycloudy_night");
  assert.equal(hours[1].symbolCode, "lightrain");
});

test("the headline reading is untouched by storing the series", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const data = health.data!;
  assert.equal(data.primarySite, "Reykjavík");
  assert.equal(data.temperatureC, 8.4);
  assert.equal(data.windMps, 6.4);
  assert.equal(data.cloudLowPercent, 12);
  assert.equal(data.cloudMediumPercent, 21);
  assert.equal(data.cloudHighPercent, 9);
  assert.equal(data.locationsChecked, 32);
  assert.equal(data.locationsSuccessful, 32);
  assert.equal(health.status, "ok");
  assert.equal(health.dataTime, new Date(RECENT).toISOString(), "dataTime semantics unchanged");
  assert.equal(health.provenance?.mode, "production");
});

test("a failed collection keeps the hourly series the last good one stored", () => {
  const good = {
    id: "metno",
    name: "MET Norway Weather",
    status: "ok" as const,
    checkedAt: "2026-09-04T09:00:00Z",
    networkOk: true,
    parseOk: true,
    data: {
      primarySite: "Reykjavík",
      sites: [{ id: "reykjavik", hours: [{ time: RECENT, temperatureC: 8.4 }] }],
    },
    provenance: { mode: "production" as const },
  };
  const failed = {
    ...good,
    checkedAt: "2026-09-04T10:00:00Z",
    status: "error" as const,
    networkOk: false,
    data: undefined,
  };

  const after = mergeSource(mergeSource(undefined, good), failed);
  assert.equal(after.status, "error");
  const sites = after.data?.sites as { hours: unknown[] }[];
  assert.equal(sites[0].hours.length, 1, "the stored forecast must survive a failed collection");
});

// ── The timeline ──────────────────────────────────────────────────────────────

const series = (): WeatherHour[] =>
  Array.from({ length: 49 }, (_, index) => ({
    time: new Date(Date.parse(RECENT) + index * 3_600_000).toISOString(),
    temperatureC: index,
  }));

test("the timeline runs 0..48 and only ever picks a stored hour", () => {
  assert.equal(MAX_OFFSET_HOURS, 48);
  // The dialog is a separate app behaviour and stays at 24.
  assert.equal(DIALOG_HOURS_SHOWN, 24);
  assert.notEqual(DIALOG_HOURS_SHOWN, MAX_OFFSET_HOURS);

  const hours = series();
  const base = forecastBaseTime([{ hours }])!;
  assert.equal(base.toISOString(), hours[0].time, "zero is the first hour the snapshot describes");

  const at = (offset: number) => hourAt(hours, new Date(base.getTime() + offset * 3_600_000));
  assert.equal(at(0)?.temperatureC, 0);
  assert.equal(at(12)?.temperatureC, 12);
  assert.equal(at(48)?.temperatureC, 48, "+48h must land on real stored data");
  // Past the end it holds the nearest entry rather than inventing one.
  assert.equal(at(99)?.temperatureC, 48);
  assert.equal(hourAt([], base), undefined);
  assert.equal(hourAt(undefined, base), undefined);
  assert.equal(forecastBaseTime([{}]), undefined);
});

test("the dialog lists 24 rows starting at the selected hour", () => {
  const hours = series();
  const base = forecastBaseTime([{ hours }])!;

  const fromNow = nextHours(hours, base, DIALOG_HOURS_SHOWN);
  assert.equal(fromNow.length, 24);
  assert.equal(fromNow[0].temperatureC, 0, "the first row is the hour being looked at");
  assert.equal(fromNow[23].temperatureC, 23);

  // Opened at +12h it starts there, so the dialog agrees with the timeline.
  const fromOffset = nextHours(hours, new Date(base.getTime() + 12 * 3_600_000), DIALOG_HOURS_SHOWN);
  assert.equal(fromOffset[0].temperatureC, 12);
  assert.equal(fromOffset.length, 24);

  // Near the end there is simply less to show; nothing is fabricated to fill the table.
  assert.equal(nextHours(hours, new Date(base.getTime() + 45 * 3_600_000), DIALOG_HOURS_SHOWN).length, 4);
  assert.equal(nextHours(undefined, base, DIALOG_HOURS_SHOWN).length, 0);
});

test("forecast clocks are Iceland's, and unambiguous across midnight", () => {
  assert.equal(FORECAST_TIME_ZONE, "Atlantic/Reykjavik");
  // 14:00 UTC is 14:00 in Iceland (no DST) and 22:00 in Taipei — the reader's own clock would
  // label Icelandic weather with a Taipei hour, which is the one reading that misleads.
  assert.equal(formatForecastHour("2026-09-05T14:00:00Z"), "14:00");
  // Midnight carries its date, exactly as SiteForecastDialog.formatHourLabel does.
  assert.equal(formatForecastHour("2026-09-06T00:00:00Z"), "9/6 00:00");
  // The timeline label always carries the date.
  assert.equal(formatForecastDayHour("2026-09-05T14:00:00Z"), "9/5 14:00");
  assert.equal(formatForecastDayHour("2026-09-06T00:00:00Z"), "9/6 00:00");
});

// ── The wiring ────────────────────────────────────────────────────────────────

test("list and map share one timeline and one selection", () => {
  const map = read("src/components/WeatherMap.tsx");

  // A single offset, above the mode switch, defaulting to now.
  assert.match(map, /const \[offsetHours, setOffsetHours\] = useState\(0\)/);
  assert.match(map, /max=\{MAX_OFFSET_HOURS\}/);
  assert.match(map, /min=\{0\}/);

  // Both modes render from the same hour-resolved list.
  assert.match(map, /const displaySites = useMemo\(/);
  assert.match(map, /points: displaySites/);
  assert.match(map, /<WeatherList sites=\{displaySites\}/);

  // Nothing resets the offset or the selection when the mode changes.
  assert.equal(/setMode\([^)]*\)[\s\S]{0,140}(setOffsetHours|setFocusedId)/.test(map), false);
});

test("a list row and a map point both open the same dialog", () => {
  const map = read("src/components/WeatherMap.tsx");

  // One handler does select-and-open, as the app's onSelectSite does.
  assert.match(map, /const openSite = useCallback\(\(id: string\) => \{/);
  assert.match(map, /setFocusedId\(id\);/);
  assert.match(map, /setDetailSiteId\(id\);/);

  // The list row uses it...
  assert.match(map, /<WeatherList sites=\{displaySites\} focusedId=\{focusedId\} onFocus=\{openSite\}/);
  // ...and so does a map tap.
  assert.match(map, /if \(nearest && nearest\.distance <= TAP_TOLERANCE\) openSite\(nearest\.marker\.point\.id\);/);

  // Exactly one dialog: two implementations would drift apart.
  assert.equal([...map.matchAll(/<SiteForecastDialog/g)].length, 1);
  assert.match(map, /from=\{selectedTime\}/);
});

test("the dialog is one component, fed only by stored data", () => {
  const dialog = read("src/components/SiteForecastDialog.tsx");
  assert.match(dialog, /nextHours\(site\.hours, from, DIALOG_HOURS_SHOWN\)/);
  assert.match(dialog, /未來 24 小時/);
  assert.match(dialog, /沒有這個地點的預報資料。/);
  for (const column of ["時間", "氣溫", "風速", "雲量"]) {
    assert.equal(dialog.includes(column), true, `the dialog is missing the ${column} column`);
  }
  assert.match(dialog, /obstructionColorFor/);
  assert.match(dialog, /weatherSymbolFor/);
  // The first row is emphasised, as the app emphasises it.
  assert.match(dialog, /isFirst \? " current" : ""/);
  // It never reaches the network.
  assert.equal(/fetch\(|XMLHttpRequest|api\.met\.no/.test(dialog), false);
});

test("the weather UI reaches MET Norway only through the snapshot", () => {
  for (const file of [
    "src/components/WeatherMap.tsx",
    "src/components/SiteForecastDialog.tsx",
    "src/lib/weatherMap.ts",
  ]) {
    const source = read(file);
    assert.equal(source.includes("api.met.no"), false, `${file} must not name the MET endpoint`);
    assert.equal(/METNO_FORECAST_URL|checkMetno/.test(source), false, `${file} must not reach the monitor`);
  }
  // The only fetch the weather UI makes is this site's own outline asset.
  const map = read("src/components/WeatherMap.tsx");
  const fetches = [...map.matchAll(/[^.\w]fetch\((.*)\)$/gm)].map((match) => match[1].trim());
  assert.deepEqual(fetches, ['getPublicAssetPath("/data/iceland.geojson")']);
  assert.equal([...map.matchAll(/[^.\w]fetch\(/g)].length, 1, "exactly one fetch in the weather UI");
});

test("the canvas architecture and the passive-listener fix both survive", () => {
  const map = read("src/components/WeatherMap.tsx");

  // Interaction still draws through one canvas held in refs, not React state per frame.
  assert.match(map, /const canvasRef = useRef<HTMLCanvasElement>/);
  assert.match(map, /viewRef = useRef<ViewState>/);
  assert.match(map, /requestAnimationFrame/);
  assert.match(map, /context\.lineTo/);
  assert.equal(/setScale\(/.test(map), false, "scale must not go back into React state");
  assert.equal(/setPan\(/.test(map), false, "pan must not go back into React state");

  // Wheel and pinch stay non-passive so preventDefault still holds.
  assert.match(map, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(map, /addEventListener\("touchmove", onTouchMove, \{ passive: false \}\)/);
  assert.equal(/onWheel=\{onWheel\}|onTouchMove=\{onTouchMove\}/.test(map), false);
});
