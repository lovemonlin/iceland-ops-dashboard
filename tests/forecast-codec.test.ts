import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import {
  buildForecastTimes,
  decodeForecastHour,
  decodeSiteForecast,
  encodeForecastHour,
  encodeSiteForecast,
  FORECAST_FIELDS,
  type ForecastTuple,
} from "../src/lib/forecastCodec";
import { hourAt, nextHours, type WeatherHour } from "../src/lib/weatherMap";
import { checkMetno } from "../src/monitors/metno/monitor";
import { serializeSnapshot } from "../src/snapshot/serializeSnapshot";

/**
 * The compact forecast storage format.
 *
 * The snapshot is committed hourly, so the size of the forecast is a recurring cost. These tests
 * hold the storage format to the one promise that matters: it is a re-encoding and nothing else.
 * Same hours, same values, same 0..48 h reach, nothing interpolated, and no extra MET request.
 */

const NOW = new Date("2026-09-04T09:00:00Z");
const RECENT = "2026-09-04T08:55:00Z";
const hourAtOffset = (index: number) => new Date(Date.parse(RECENT) + index * 3_600_000).toISOString();

const hourlyForecast = () => ({
  properties: {
    meta: { updated_at: RECENT },
    timeseries: Array.from({ length: 60 }, (_, index) => ({
      time: hourAtOffset(index),
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

// ── The tuple contract ────────────────────────────────────────────────────────

test("the tuple's field order is declared, not assumed", () => {
  // Anything reading a stored snapshot depends on this order. Changing it rewrites the meaning of
  // every tuple already committed, so it is pinned here rather than left to the encoder.
  assert.deepEqual([...FORECAST_FIELDS], [
    "temperatureC",
    "windMps",
    "windFromDirection",
    "cloudLowPercent",
    "cloudMediumPercent",
    "cloudHighPercent",
    "cloudTotalPercent",
    "symbolCode",
  ]);
  assert.equal(FORECAST_FIELDS.length, 8);
});

test("the decoder maps every slot to the field the contract names", () => {
  // Distinct values, so a transposed pair cannot pass unnoticed.
  const tuple: ForecastTuple = [1, 2, 3, 4, 5, 6, 7, "cloudy"];
  const hour = decodeForecastHour(RECENT, tuple);

  assert.deepEqual(hour, {
    time: RECENT,
    temperatureC: 1,
    windMps: 2,
    windFromDirection: 3,
    cloudLowPercent: 4,
    cloudMediumPercent: 5,
    cloudHighPercent: 6,
    cloudTotalPercent: 7,
    symbolCode: "cloudy",
  });

  // And the mapping is the field list's, position by position.
  FORECAST_FIELDS.forEach((field, index) => {
    assert.equal((hour as Record<string, unknown>)[field], tuple[index], `slot ${index} is not ${field}`);
  });
});

test("a reading MET did not publish stays missing, and never becomes zero", () => {
  const sparse: WeatherHour = { time: RECENT, temperatureC: 0, symbolCode: "fair_day" };
  const tuple = encodeForecastHour(sparse);

  // A real zero survives as a zero; everything absent is an explicit null in storage.
  assert.deepEqual(tuple, [0, null, null, null, null, null, null, "fair_day"]);

  const decoded = decodeForecastHour(RECENT, tuple);
  assert.equal(decoded.temperatureC, 0, "a published zero must not be mistaken for a gap");
  assert.equal("windMps" in decoded, false, "an absent reading must stay absent, not become null or 0");
  assert.equal(decoded.windMps, undefined);
  assert.equal(decoded.cloudTotalPercent, undefined);

  // Non-finite values cannot reach storage as numbers.
  assert.deepEqual(encodeForecastHour({ time: RECENT, temperatureC: Number.NaN }), [
    null, null, null, null, null, null, null, null,
  ]);

  // A malformed row is skipped rather than throwing or yielding a half-built hour.
  assert.deepEqual(decodeSiteForecast(undefined, undefined), []);
  assert.deepEqual(decodeSiteForecast([RECENT], "nonsense"), []);
  assert.deepEqual(decodeSiteForecast([RECENT], [null]), []);
});

test("the condition code survives the round trip untouched", () => {
  for (const code of ["partlycloudy_night", "lightrainshowers_day", "clearsky_polartwilight"]) {
    const hour: WeatherHour = { time: RECENT, temperatureC: 3, symbolCode: code };
    assert.equal(decodeForecastHour(RECENT, encodeForecastHour(hour)).symbolCode, code);
  }
  // An hour with no code — MET's six-hourly tail — decodes without one, not with an empty string.
  const bare = decodeForecastHour(RECENT, encodeForecastHour({ time: RECENT, temperatureC: 3 }));
  assert.equal("symbolCode" in bare, false);
});

// ── The shared time axis ──────────────────────────────────────────────────────

test("forecastTimes is sorted, deduplicated, and covers every site's hours", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const times = health.data?.forecastTimes as string[];

  assert.equal(Array.isArray(times), true);
  assert.equal(times.length, 49, "0..48 h inclusive");
  assert.equal(new Set(times).size, times.length, "no timestamp is stored twice");

  for (let index = 1; index < times.length; index += 1) {
    assert.equal(Date.parse(times[index]) > Date.parse(times[index - 1]), true, "times must ascend");
    assert.equal(Date.parse(times[index]) - Date.parse(times[index - 1]), 3_600_000);
  }
  assert.equal((Date.parse(times[48]) - Date.parse(times[0])) / 3_600_000, 48, "the axis must reach +48h");
});

test("every site's forecast is aligned one-for-one with forecastTimes", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const times = health.data?.forecastTimes as string[];
  const sites = health.data?.sites as Record<string, unknown>[];

  assert.equal(sites.length, 32);
  for (const site of sites) {
    const row = site.forecast as (ForecastTuple | null)[];
    assert.equal(Array.isArray(row), true, `${site.id} has no forecast row`);
    assert.equal(row.length, times.length, `${site.id} is not aligned with the shared axis`);
    for (const tuple of row) {
      assert.equal(Array.isArray(tuple), true, `${site.id} has an empty slot`);
      assert.equal(tuple!.length, FORECAST_FIELDS.length);
    }
    // Decoding restores exactly one hour per axis entry, with the axis's own timestamps.
    const hours = decodeSiteForecast(times, row);
    assert.equal(hours.length, 49);
    assert.deepEqual(hours.map((hour) => hour.time), times);
  }
});

test("a site an hour out of step keeps all its own hours", () => {
  // MET issues each point separately, so one site can start an hour before its neighbours. The
  // axis is the union, and neither site loses an hour to the other's schedule.
  const early: WeatherHour[] = [0, 1, 2].map((index) => ({ time: hourAtOffset(index), temperatureC: index }));
  const late: WeatherHour[] = [1, 2, 3].map((index) => ({ time: hourAtOffset(index), temperatureC: index * 10 }));

  const times = buildForecastTimes([early, late]);
  assert.deepEqual(times, [0, 1, 2, 3].map(hourAtOffset), "the axis is the union, sorted");

  const earlyRow = encodeSiteForecast(early, times);
  const lateRow = encodeSiteForecast(late, times);
  assert.equal(earlyRow.length, 4);
  assert.equal(earlyRow[3], null, "a site has no tuple at an hour it never published");
  assert.equal(lateRow[0], null);

  // Each site decodes back to precisely the hours it published — no hole, and nothing invented.
  assert.deepEqual(decodeSiteForecast(times, earlyRow), early);
  assert.deepEqual(decodeSiteForecast(times, lateRow), late);
});

// ── The values the UI resolves ────────────────────────────────────────────────

test("+0, +12 and +48 resolve to the source's own values after decoding", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const times = health.data?.forecastTimes as string[];
  const site = (health.data?.sites as Record<string, unknown>[])[0];
  const hours = decodeSiteForecast(times, site.forecast);

  const base = new Date(hours[0].time);
  const at = (offset: number) => hourAt(hours, new Date(base.getTime() + offset * 3_600_000));

  // The stub's temperature is 8.4 - 0.1 * index, so each offset has a value only it can have.
  assert.equal(at(0)?.temperatureC, 8.4);
  assert.equal(Math.abs((at(12)?.temperatureC ?? 0) - 7.2) < 1e-9, true);
  assert.equal(Math.abs((at(48)?.temperatureC ?? 0) - 3.6) < 1e-9, true);
  assert.equal(at(0)?.time, times[0]);
  assert.equal(at(12)?.time, times[12]);
  assert.equal(at(48)?.time, times[48]);

  // The alternating condition code still alternates, so nothing was shifted by a slot.
  assert.equal(at(0)?.symbolCode, "partlycloudy_night");
  assert.equal(at(1)?.symbolCode, "lightrain");
  assert.equal(at(48)?.symbolCode, "partlycloudy_night");

  // And the dialog reads 24 consecutive stored hours from the selected one.
  const rows = nextHours(hours, new Date(base.getTime() + 12 * 3_600_000), 24);
  assert.equal(rows.length, 24);
  assert.equal(rows[0].time, times[12]);
  assert.equal(rows[23].time, times[35]);
});

test("re-encoding the series changes its size and nothing else", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const times = health.data?.forecastTimes as string[];
  const sites = health.data?.sites as Record<string, unknown>[];

  // What the response actually carried, rebuilt independently of the monitor.
  const expected = hourlyForecast().properties.timeseries.slice(0, 49).map((entry) => ({
    time: entry.time,
    temperatureC: entry.data.instant.details.air_temperature,
    windMps: entry.data.instant.details.wind_speed,
    windFromDirection: entry.data.instant.details.wind_from_direction,
    cloudLowPercent: entry.data.instant.details.cloud_area_fraction_low,
    cloudMediumPercent: entry.data.instant.details.cloud_area_fraction_medium,
    cloudHighPercent: entry.data.instant.details.cloud_area_fraction_high,
    cloudTotalPercent: entry.data.instant.details.cloud_area_fraction,
    symbolCode: entry.data.next_1_hours.summary.symbol_code,
  }));

  // Field for field, hour for hour, for a whole site.
  assert.deepEqual(decodeSiteForecast(times, sites[0].forecast), expected);
});

test("storing the forecast compactly still costs no extra MET request", async () => {
  const calls: string[] = [];
  await checkMetno({ now: NOW, request: stub(calls) });
  assert.equal(calls.length, 32, "one request per site, unchanged by the storage format");
  assert.equal(new Set(calls).size, 32, "no site is fetched twice");
});

test("the headline fields are untouched by the storage change", async () => {
  const health = await checkMetno({ now: NOW, request: stub() });
  const data = health.data!;
  assert.equal(data.primarySite, "Reykjavík");
  assert.equal(data.temperatureC, 8.4);
  assert.equal(data.windMps, 6.4);
  assert.equal(data.cloudLowPercent, 12);
  assert.equal(data.cloudMediumPercent, 21);
  assert.equal(data.cloudHighPercent, 9);
  assert.equal(health.status, "ok");
  assert.equal(health.dataTime, new Date(RECENT).toISOString());
  assert.equal(health.provenance?.mode, "production");

  // The per-site current reading is still a named field, not something to be decoded.
  const site = (health.data?.sites as Record<string, unknown>[])[0];
  assert.equal(site.temperatureC, 8.4);
  assert.equal(site.symbolCode, "partlycloudy_night");
  assert.equal("hours" in site, false, "the old per-hour objects are gone");
});

// ── The file the scheduler commits ────────────────────────────────────────────

test("the snapshot writer emits JSON, with rows of numbers on one line", () => {
  const snapshot = {
    generatedAt: "2026-09-04T09:00:00Z",
    sources: {
      metno: {
        data: {
          forecastTimes: [hourAtOffset(0), hourAtOffset(1)],
          sites: [{ id: "reykjavik", forecast: [[8.4, 6.1, 253.6, 100, 11.7, 0, 100, "cloudy"], null] }],
        },
      },
    },
  };

  const text = serializeSnapshot(snapshot);

  // Still JSON, and still exactly the same data.
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(snapshot)));
  assert.equal(text.endsWith("\n"), true);

  // A forecast hour is one readable row, not eight lines of one number each.
  assert.match(text, /\[8\.4, ?6\.1, ?253\.6, ?100, ?11\.7, ?0, ?100, ?"cloudy"\]/);
  // Objects keep their indentation, so the rest of the snapshot still diffs line by line.
  assert.match(text, /\n {2}"sources": \{\n {4}"metno": \{/);
  assert.equal(text.split("\n").length > 5, true, "the file must stay readable, not become one line");

  // And it is smaller than the pretty-printed form it replaces.
  assert.equal(text.length < JSON.stringify(snapshot, null, 2).length, true);
});

test("the serializer agrees with JSON.stringify on everything but whitespace", () => {
  const awkward = {
    empty: {},
    emptyList: [] as unknown[],
    nested: [[1, 2], [3, 4]],
    mixed: [1, { a: 2 }],
    nulls: [null, 1, null],
    text: 'quotes " and \\ backslashes and é',
    dropped: undefined,
    deep: { a: { b: { c: [1.5, -0.25, 1e-7] } } },
  };
  assert.deepEqual(JSON.parse(serializeSnapshot(awkward)), JSON.parse(JSON.stringify(awkward)));
  assert.equal("dropped" in JSON.parse(serializeSnapshot(awkward)), false);
});
