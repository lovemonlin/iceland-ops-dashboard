import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  IMO_ACTIVE_WARNINGS_URL,
  METNO_FORECAST_URL,
  SWPC_KP_URL,
  SWPC_OVATION_URL,
  SWPC_SOLAR_WIND_MAG_URL,
  SWPC_SOLAR_WIND_SPEED_URL,
  WEATHER_SITES,
} from "../src/config/sources";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import { checkImo } from "../src/monitors/imo/monitor";
import { checkMetno } from "../src/monitors/metno/monitor";
import { checkNoaaKp, checkOvation, checkSolarWind } from "../src/monitors/noaa/monitor";
import { mergeSource } from "../src/snapshot/mergeSnapshot";

const NOW = new Date("2026-09-04T09:00:00Z");
const RECENT = "2026-09-04T08:55:00Z";

interface Route {
  status?: number;
  body?: unknown;
  raw?: string;
  contentType?: string;
  throws?: boolean;
}

/** Serves canned responses per URL through the real diagnostics core. Nothing touches the network. */
function stub(routes: Record<string, Route>, calls?: { url: string; method: string; headers: Record<string, string> }[]) {
  const request: DiagnosticFetcher = (url, options) =>
    fetchWithDiagnosticsCore(url, {
      ...options,
      fetch: async (target, init) => {
        calls?.push({
          url: target,
          method: init?.method ?? "GET",
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });
        const key = Object.keys(routes).find((candidate) => target.startsWith(candidate));
        const route = key ? routes[key] : undefined;
        if (!route) return new Response("not stubbed", { status: 404, headers: { "content-type": "text/plain" } });
        if (route.throws) throw new TypeError("offline");
        const status = route.status ?? 200;
        // 204 and friends must be constructed with a null body, as the real server sends.
        const body = status === 204 || status === 205 || status === 304 ? null : (route.raw ?? JSON.stringify(route.body));
        return new Response(body, {
          status,
          headers: { "content-type": route.contentType ?? "application/json" },
        });
      },
    });
  return request;
}

// ── MET Norway ────────────────────────────────────────────────────────────────

const forecast = (updatedAt = RECENT) => ({
  properties: {
    meta: { updated_at: updatedAt },
    timeseries: [
      {
        time: updatedAt,
        data: {
          instant: {
            details: {
              air_temperature: 8.4,
              wind_speed: 6.4,
              cloud_area_fraction: 42,
              cloud_area_fraction_low: 12,
              cloud_area_fraction_medium: 21,
              cloud_area_fraction_high: 9,
            },
          },
        },
      },
    ],
  },
});

const twoSites = WEATHER_SITES.filter((site) => site.id === "reykjavik" || site.id === "akureyri");

test("MET: a successful collection records values, provenance and location counts", async () => {
  const health = await checkMetno({ now: NOW, sites: twoSites, request: stub({ [METNO_FORECAST_URL]: { body: forecast() } }) });
  assert.equal(health.status, "ok");
  assert.equal(health.provenance?.mode, "production");
  assert.equal(health.data?.locationsChecked, 2);
  assert.equal(health.data?.locationsSuccessful, 2);
  assert.equal(health.data?.temperatureC, 8.4);
  assert.equal(health.data?.primarySite, "Reykjavík");
  assert.equal(health.dataTime, new Date(RECENT).toISOString());
});

test("MET: requests carry the compliant User-Agent and four-decimal coordinates", async () => {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  await checkMetno({ now: NOW, sites: twoSites, request: stub({ [METNO_FORECAST_URL]: { body: forecast() } }, calls) });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.url.startsWith(METNO_FORECAST_URL), true);
    assert.match(call.headers["user-agent"], /IcelandOpsDashboard/);
    // MET Norway asks for at most four decimals so its cache is not fragmented.
    const [, lat] = call.url.match(/lat=(-?\d+\.\d+)/) ?? [];
    assert.equal(lat.split(".")[1].length, 4);
  }
});

test("MET: a partial outage is DEGRADED and names the failed locations", async () => {
  let first = true;
  const request: DiagnosticFetcher = (url, options) =>
    fetchWithDiagnosticsCore(url, {
      ...options,
      fetch: async () => {
        const fail = first;
        first = false;
        return fail
          ? new Response("nope", { status: 500, headers: { "content-type": "text/plain" } })
          : new Response(JSON.stringify(forecast()), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

  const health = await checkMetno({ now: NOW, sites: twoSites, request });
  assert.equal(health.status, "degraded");
  assert.equal(health.data?.locationsSuccessful, 1);
  assert.equal(health.data?.locationsFailed, 1);
  assert.match(String(health.errorMessage), /1 of 2 MET Norway locations/);
});

test("MET: every location failing is ERROR with no data", async () => {
  const health = await checkMetno({ now: NOW, sites: twoSites, request: stub({ [METNO_FORECAST_URL]: { throws: true } }) });
  assert.equal(health.status, "error");
  assert.equal(health.data, undefined);
});

test("MET: HTTP 200 with a broken body is still a failure", async () => {
  const noSeries = { properties: { meta: { updated_at: RECENT }, timeseries: [] } };
  const all = await checkMetno({ now: NOW, sites: twoSites, request: stub({ [METNO_FORECAST_URL]: { body: noSeries } }) });
  assert.equal(all.status, "error");

  const badTime = { properties: { meta: { updated_at: "yesterday" }, timeseries: [{}] } };
  assert.equal((await checkMetno({ now: NOW, sites: twoSites, request: stub({ [METNO_FORECAST_URL]: { body: badTime } }) })).status, "error");

  const parseError = await checkMetno({ now: NOW, sites: twoSites, request: stub({ [METNO_FORECAST_URL]: { raw: "{ oops" } }) });
  assert.equal(parseError.status, "error");
});

test("MET: an old forecast issue time is STALE", async () => {
  const old = "2026-09-04T02:00:00Z";
  const health = await checkMetno({ now: NOW, sites: twoSites, request: stub({ [METNO_FORECAST_URL]: { body: forecast(old) } }) });
  assert.equal(health.status, "stale");
  assert.equal(health.errorType, "STALE_DATA");
});

// ── NOAA Kp ───────────────────────────────────────────────────────────────────

const kpSamples = [
  { time_tag: "2026-09-04T08:50:00", kp_index: 3, estimated_kp: 3.33, kp: "3M" },
  { time_tag: "2026-09-04T08:55:00", kp_index: 4, estimated_kp: 4.33, kp: "4M" },
];

test("NOAA Kp: the newest sample is read, with its own observation time", async () => {
  const health = await checkNoaaKp({ now: NOW, request: stub({ [SWPC_KP_URL]: { body: kpSamples } }) });
  assert.equal(health.status, "ok");
  assert.equal(health.data?.kp, 4.33);
  assert.equal(health.data?.kpIndex, 4);
  assert.equal(health.provenance?.provider, "NOAA SWPC");
  assert.equal(health.dataTime, "2026-09-04T08:55:00.000Z");
});

test("NOAA Kp: network, HTTP, parse, schema, empty and timestamp failures are distinguished", async () => {
  const cases: [Route, string][] = [
    [{ throws: true }, "NETWORK_ERROR"],
    [{ status: 503, raw: "down", contentType: "text/plain" }, "HTTP_ERROR"],
    [{ raw: "{ oops" }, "PARSE_ERROR"],
    [{ body: { nope: true } }, "SCHEMA_ERROR"],
    [{ body: [] }, "EMPTY_DATA"],
    [{ body: [{ time_tag: "not a time", estimated_kp: 4 }] }, "INVALID_TIMESTAMP"],
    [{ body: [{ time_tag: "2026-09-04T08:55:00" }] }, "SCHEMA_ERROR"],
  ];

  for (const [route, expected] of cases) {
    const health = await checkNoaaKp({ now: NOW, request: stub({ [SWPC_KP_URL]: route }) });
    assert.equal(health.status, "error", `${expected} should be an error`);
    assert.equal(health.errorType, expected);
    assert.equal(health.data, undefined, "a failed collection must not invent data");
  }
});

test("NOAA Kp: an old sample is STALE", async () => {
  const stale = [{ time_tag: "2026-09-04T05:00:00", estimated_kp: 2 }];
  const health = await checkNoaaKp({ now: NOW, request: stub({ [SWPC_KP_URL]: { body: stale } }) });
  assert.equal(health.status, "stale");
});

// ── Solar wind ────────────────────────────────────────────────────────────────

const magSamples = [{ time_tag: "2026-09-04T08:56:00", bt: 6.8, bz_gsm: -3.1 }];
const speedSamples = [{ time_tag: "2026-09-04T08:56:00", proton_speed: 514.2 }];

test("Solar wind: Bt, Bz and speed are collected from the summary products", async () => {
  const health = await checkSolarWind({
    now: NOW,
    request: stub({ [SWPC_SOLAR_WIND_MAG_URL]: { body: magSamples }, [SWPC_SOLAR_WIND_SPEED_URL]: { body: speedSamples } }),
  });
  assert.equal(health.status, "ok");
  assert.equal(health.data?.btNt, 6.8);
  assert.equal(health.data?.bzNt, -3.1);
  assert.equal(health.data?.speedKms, 514.2);
});

test("Solar wind: losing only the optional speed product is DEGRADED, keeping the field values", async () => {
  const health = await checkSolarWind({
    now: NOW,
    request: stub({ [SWPC_SOLAR_WIND_MAG_URL]: { body: magSamples }, [SWPC_SOLAR_WIND_SPEED_URL]: { status: 404, raw: "gone", contentType: "text/plain" } }),
  });
  assert.equal(health.status, "degraded");
  assert.equal(health.data?.btNt, 6.8);
  assert.equal(health.data?.speedKms, undefined);
  assert.match(String(health.errorMessage), /speed summary unavailable/);
});

test("Solar wind: a broken magnetic field product is an error with no data", async () => {
  for (const route of [{ throws: true }, { body: [] }, { body: [{ time_tag: "2026-09-04T08:56:00" }] }] as Route[]) {
    const health = await checkSolarWind({ now: NOW, request: stub({ [SWPC_SOLAR_WIND_MAG_URL]: route }) });
    assert.equal(health.status, "error");
    assert.equal(health.data, undefined);
  }
});

// ── OVATION ───────────────────────────────────────────────────────────────────

const ovation = {
  "Observation Time": "2026-09-04T08:50:00Z",
  "Forecast Time": "2026-09-04T09:20:00Z",
  coordinates: [
    [0, 60, 1],
    [0, 64, 37],
    [1, 65, 12],
    [2, 70, 88],
  ],
};

test("OVATION: the grid is summarised, including the Iceland peak probability", async () => {
  const health = await checkOvation({ now: NOW, request: stub({ [SWPC_OVATION_URL]: { body: ovation } }) });
  assert.equal(health.status, "ok");
  assert.equal(health.data?.gridCells, 4);
  assert.equal(health.data?.icelandLatitudeCells, 2);
  assert.equal(health.data?.icelandPeakProbabilityPercent, 37);
  assert.equal(health.dataTime, "2026-09-04T08:50:00.000Z");
});

test("OVATION: malformed, empty and untimed grids are errors with no data", async () => {
  const cases: [Route, string][] = [
    [{ body: { ...ovation, coordinates: [] } }, "EMPTY_DATA"],
    [{ body: { ...ovation, coordinates: [[0, 64]] } }, "SCHEMA_ERROR"],
    [{ body: { ...ovation, "Observation Time": "nope" } }, "INVALID_TIMESTAMP"],
    [{ body: [1, 2, 3] }, "SCHEMA_ERROR"],
    [{ throws: true }, "NETWORK_ERROR"],
  ];
  for (const [route, expected] of cases) {
    const health = await checkOvation({ now: NOW, request: stub({ [SWPC_OVATION_URL]: route }) });
    assert.equal(health.status, "error");
    assert.equal(health.errorType, expected);
    assert.equal(health.data, undefined);
  }
});

// ── IMO ───────────────────────────────────────────────────────────────────────

test("IMO: zero active warnings is INFO, never EMPTY_DATA", async () => {
  // Observed live: the broker answers 204 with an empty body when nothing is active. It has also
  // been seen returning the JSON string "" or an empty array.
  const routes: Route[] = [
    { status: 204, raw: "", contentType: "text/plain" },
    { raw: '""' },
    { body: [] },
  ];
  for (const route of routes) {
    const health = await checkImo({ now: NOW, request: stub({ [IMO_ACTIVE_WARNINGS_URL]: route }) });
    assert.equal(health.status, "info");
    assert.equal(health.errorType, undefined);
    assert.equal(health.data?.activeWarnings, 0);
    assert.match(String(health.note), /no active weather warnings/);
  }
});

test("IMO: active warnings are summarised with their newest sent time", async () => {
  const warnings = [
    { identifier: "a", area_en: "Faxafloi", event_en: "Wind", sent: "2026-09-04T07:00:00Z" },
    { identifier: "b", area_en: "Westfjords", event_en: "Snow", sent: "2026-09-04T08:30:00Z" },
  ];
  const health = await checkImo({ now: NOW, request: stub({ [IMO_ACTIVE_WARNINGS_URL]: { body: warnings } }) });

  assert.equal(health.status, "ok");
  assert.equal(health.data?.activeWarnings, 2);
  assert.equal(health.data?.events, "Wind, Snow");
  assert.equal(health.dataTime, "2026-09-04T08:30:00.000Z");
});

test("IMO: the required API version header is sent", async () => {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  await checkImo({ now: NOW, request: stub({ [IMO_ACTIVE_WARNINGS_URL]: { body: [] } }, calls) });
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers["x-vi-api-version"], "2026-04-14");
});

test("IMO: transport and schema failures are errors with no data", async () => {
  const cases: [Route, string][] = [
    [{ throws: true }, "NETWORK_ERROR"],
    [{ status: 500, raw: "boom", contentType: "text/plain" }, "HTTP_ERROR"],
    [{ raw: "{ oops" }, "PARSE_ERROR"],
    [{ body: [{ area_en: "no identifier" }] }, "SCHEMA_ERROR"],
  ];
  for (const [route, expected] of cases) {
    const health = await checkImo({ now: NOW, request: stub({ [IMO_ACTIVE_WARNINGS_URL]: route }) });
    assert.equal(health.status, "error");
    assert.equal(health.errorType, expected);
    assert.equal(health.data, undefined);
  }
});

// ── Cross-cutting guarantees ──────────────────────────────────────────────────

test("a failed collection preserves the last good data for every source", async () => {
  const good = await checkNoaaKp({ now: NOW, request: stub({ [SWPC_KP_URL]: { body: kpSamples } }) });
  const stored = mergeSource(undefined, good, "2026-09-04T10:00:00.000Z");

  const failed = await checkNoaaKp({ now: NOW, request: stub({ [SWPC_KP_URL]: { throws: true } }) });
  const after = mergeSource(stored, failed, "2026-09-04T11:00:00.000Z");

  assert.equal(after.status, "error");
  assert.equal(after.lastAttemptAt, "2026-09-04T11:00:00.000Z");
  assert.equal(after.lastSuccessAt, "2026-09-04T10:00:00.000Z");
  assert.deepEqual(after.data, good.data);
  assert.equal(after.provenance?.mode, "production");
});

test("the production snapshot contains no mock source", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  // There is no mock data path in the runtime at all.
  assert.throws(() => read("src/monitors/mockMonitors.ts"));
  for (const file of ["src/monitors/index.ts", "src/app/page.tsx", "src/components/Dashboard.tsx", "scripts/snapshot.ts"]) {
    assert.equal(/mockMonitors|getMockMonitors|from ["'][^"']*mock/i.test(read(file)), false, `${file} must not import mock data`);
  }

  // Every published entry declares production provenance.
  const snapshot = JSON.parse(read("public/data/latest-health.json")) as {
    sources: Record<string, { provenance?: { mode?: string } }>;
    pipelines?: Record<string, { provenance?: { mode?: string } }>;
  };
  const entries = [...Object.values(snapshot.sources), ...Object.values(snapshot.pipelines ?? {})];
  assert.equal(entries.length > 0, true);
  for (const entry of entries) {
    assert.equal(entry.provenance?.mode, "production");
  }
});

test("every monitored source points at the endpoint the Android app uses", () => {
  assert.equal(METNO_FORECAST_URL, "https://api.met.no/weatherapi/locationforecast/2.0/complete");
  assert.equal(SWPC_KP_URL, "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json");
  assert.equal(SWPC_SOLAR_WIND_MAG_URL, "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json");
  assert.equal(SWPC_OVATION_URL, "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json");
  assert.equal(IMO_ACTIVE_WARNINGS_URL, "https://api.vedur.is/cap/capbroker/active/detailed/all");
  // The app's curated list, verbatim.
  assert.equal(WEATHER_SITES.length, 32);
  assert.equal(WEATHER_SITES.some((site) => site.id === "reykjavik"), true);
  // Deprecated SWPC paths must never come back.
  assert.equal(SWPC_KP_URL.includes("/products/solar-wind/"), false);
});
