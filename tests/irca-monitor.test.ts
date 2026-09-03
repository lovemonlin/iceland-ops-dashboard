import assert from "node:assert/strict";
import test from "node:test";
import { IRCA_MANIFEST_URL, IRCA_PUBLIC_BASE_URL } from "../src/config/irca";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import { createIrcaContentCache } from "../src/monitors/irca/datasets";
import { checkIrca } from "../src/monitors/irca/monitor";

const MINUTE = 60_000;

/** Matches the shape observed in production on 2026-09-03. */
const PUBLISHED_AT = "2026-09-03T00:35:31.832760Z";
const NOW_FRESH = new Date(Date.parse(PUBLISHED_AT) + 10 * MINUTE);

const url = {
  roads: `${IRCA_PUBLIC_BASE_URL}/road-conditions.geojson`,
  incidents: `${IRCA_PUBLIC_BASE_URL}/road-incidents.geojson`,
  stations: `${IRCA_PUBLIC_BASE_URL}/road-stations.geojson`,
};

interface Counts {
  roads: number;
  incidents: number;
  stations: number;
  trafficStations: number;
}

const PRODUCTION_COUNTS: Counts = { roads: 701, incidents: 41, stations: 203, trafficStations: 107 };

function buildManifest(counts: Counts = PRODUCTION_COUNTS, generatedAt = PUBLISHED_AT) {
  return {
    schema_version: 2,
    generated_at: generatedAt,
    road_data_at: generatedAt,
    incident_data_at: generatedAt,
    measurement_data_at: generatedAt,
    road_count: counts.roads,
    incident_count: counts.incidents,
    station_count: counts.stations,
    traffic_station_count: counts.trafficStations,
    roads_url: url.roads,
    incidents_url: url.incidents,
    stations_url: url.stations,
    attribution: "Based on information provided by the Icelandic Road and Coastal Administration (IRCA).",
    source_url: "https://umferdin.is/en",
  };
}

function featureCollection(count: number, properties: (index: number) => Record<string, unknown> = () => ({})) {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_unused, index) => ({
      type: "Feature",
      properties: { id: `f${index}`, ...properties(index) },
      geometry: { type: "Point", coordinates: [0, 0] },
    })),
  };
}

function stationCollection(count: number, trafficCount: number) {
  return featureCollection(count, (index) => ({ has_traffic: index < trafficCount }));
}

interface StubOptions {
  manifest?: unknown;
  manifestBody?: string;
  manifestStatus?: number;
  manifestContentType?: string;
  manifestThrows?: boolean;
  /** Actual feature counts served by the GeoJSON files; defaults to the manifest counts. */
  actual?: Partial<Counts>;
  /** Replaces a dataset body wholesale, for malformed-GeoJSON cases. */
  bodies?: Partial<Record<"roads" | "incidents" | "stations", unknown>>;
  /** HTTP status per dataset URL; default 200. */
  datasetStatus?: (url: string) => number;
  calls?: { url: string; method: string }[];
}

/** Drives the real diagnostics core with a stub transport, so nothing touches the network. */
function stubRequest(options: StubOptions = {}): DiagnosticFetcher {
  const manifest = (options.manifest ?? buildManifest()) as ReturnType<typeof buildManifest>;
  const actual: Counts = {
    roads: options.actual?.roads ?? manifest.road_count,
    incidents: options.actual?.incidents ?? manifest.incident_count,
    stations: options.actual?.stations ?? manifest.station_count,
    trafficStations: options.actual?.trafficStations ?? manifest.traffic_station_count,
  };

  const json = (value: unknown, contentType = "application/geo+json") =>
    new Response(JSON.stringify(value), { status: 200, headers: { "content-type": contentType } });

  return (requestUrl, requestOptions) =>
    fetchWithDiagnosticsCore(requestUrl, {
      ...requestOptions,
      fetch: async (target, init) => {
        options.calls?.push({ url: target, method: init?.method ?? "GET" });

        if (target === IRCA_MANIFEST_URL) {
          if (options.manifestThrows) throw new TypeError("offline");
          return new Response(options.manifestBody ?? JSON.stringify(options.manifest ?? buildManifest()), {
            status: options.manifestStatus ?? 200,
            headers: { "content-type": options.manifestContentType ?? "application/json" },
          });
        }

        const status = options.datasetStatus?.(target) ?? 200;
        if (status !== 200) {
          return new Response("missing", { status, headers: { "content-type": "text/plain" } });
        }
        if (init?.method === "HEAD") return new Response("", { status: 200, headers: { "content-type": "application/geo+json" } });

        if (target === url.roads) return json(options.bodies?.roads ?? featureCollection(actual.roads));
        if (target === url.incidents) return json(options.bodies?.incidents ?? featureCollection(actual.incidents));
        return json(options.bodies?.stations ?? stationCollection(actual.stations, actual.trafficStations));
      },
    });
}

const check = (options: StubOptions & { now?: Date } = {}) =>
  checkIrca({
    now: options.now ?? NOW_FRESH,
    request: stubRequest(options),
    cache: createIrcaContentCache(),
  });

const agedNow = (minutesOld: number) => new Date(Date.parse(PUBLISHED_AT) + minutesOld * MINUTE);

test("1. current production-shaped data is OK", async () => {
  const health = await check();
  assert.equal(health.status, "ok");
  assert.equal(health.errorType, undefined);
  assert.equal(health.httpStatus, 200);
  assert.equal(health.details?.roads, 701);
  assert.equal(health.details?.incidents, 41);
  assert.equal(health.details?.stations, 203);
  assert.equal(health.details?.trafficStations, 107);
  assert.equal(health.details?.datasets, "3 / 3 available");
});

test("2. zero incidents is OK, not EMPTY_DATA", async () => {
  const health = await check({ manifest: buildManifest({ ...PRODUCTION_COUNTS, incidents: 0 }) });
  assert.equal(health.status, "ok");
  assert.equal(health.details?.incidents, 0);
});

test("3. zero roads is ERROR / EMPTY_DATA", async () => {
  const health = await check({ manifest: buildManifest({ ...PRODUCTION_COUNTS, roads: 0 }) });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "EMPTY_DATA");
  assert.match(String(health.errorMessage), /road dataset is empty/);
});

test("4. zero stations is ERROR and says what production normally carries", async () => {
  const health = await check({
    manifest: buildManifest({ ...PRODUCTION_COUNTS, stations: 0, trafficStations: 0 }),
  });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "EMPTY_DATA");
  assert.match(String(health.errorMessage), /station dataset is empty/);
  assert.match(String(health.errorMessage), /public files are reachable/);
  assert.doesNotMatch(String(health.errorMessage), /IRCA is down/);
});

test("5. zero traffic stations is ERROR", async () => {
  const health = await check({ manifest: buildManifest({ ...PRODUCTION_COUNTS, trafficStations: 0 }) });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "EMPTY_DATA");
  assert.match(String(health.errorMessage), /traffic station dataset is empty/);
});

test("6. roads below the sanity floor is ERROR and names both numbers", async () => {
  const health = await check({ manifest: buildManifest({ ...PRODUCTION_COUNTS, roads: 82 }) });
  assert.equal(health.status, "error");
  assert.match(String(health.errorMessage), /Expected at least 500 road features, received 82\./);
});

test("7. stations below the sanity floor is ERROR", async () => {
  const health = await check({ manifest: buildManifest({ ...PRODUCTION_COUNTS, stations: 60, trafficStations: 55 }) });
  assert.equal(health.status, "error");
  assert.match(String(health.errorMessage), /Expected at least 100 station features, received 60\./);
});

test("8. traffic stations below the sanity floor is ERROR", async () => {
  const health = await check({ manifest: buildManifest({ ...PRODUCTION_COUNTS, trafficStations: 12 }) });
  assert.equal(health.status, "error");
  assert.match(String(health.errorMessage), /Expected at least 50 traffic station features, received 12\./);
});

test("9. an age of 44:59 is OK", async () => {
  const health = await check({ now: new Date(Date.parse(PUBLISHED_AT) + 44 * MINUTE + 59_000) });
  assert.equal(health.status, "ok");
});

test("10. an age of 45:01 is STALE", async () => {
  const health = await check({ now: new Date(Date.parse(PUBLISHED_AT) + 45 * MINUTE + 1_000) });
  assert.equal(health.status, "stale");
  assert.equal(health.errorType, "STALE_DATA");
  assert.match(String(health.errorMessage), /republishes about every 30 min/);
  assert.equal(health.details?.expectedRefresh, "30 min");
});

test("11. an age of 119:59 is still STALE", async () => {
  const health = await check({ now: new Date(Date.parse(PUBLISHED_AT) + 119 * MINUTE + 59_000) });
  assert.equal(health.status, "stale");
  assert.equal(health.errorType, "STALE_DATA");
});

test("12. an age past 120 minutes is ERROR", async () => {
  const health = await check({ now: agedNow(121) });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "STALE_DATA");
  assert.match(String(health.errorMessage), /no longer be treated as a reliable picture/);
});

test("13. a malformed manifest is ERROR", async () => {
  assert.equal((await check({ manifest: [1, 2, 3] })).errorType, "SCHEMA_ERROR");

  const { road_count: _count, ...withoutCount } = buildManifest();
  assert.equal((await check({ manifest: withoutCount })).errorType, "SCHEMA_ERROR");

  const badTimestamp = await check({ manifest: { ...buildManifest(), generated_at: "yesterday" } });
  assert.equal(badTimestamp.errorType, "INVALID_TIMESTAMP");

  const future = await check({ manifest: buildManifest(PRODUCTION_COUNTS, "2026-09-04T00:00:00Z") });
  assert.equal(future.errorType, "INVALID_TIMESTAMP");

  // A dataset URL that points somewhere else must never become a request target.
  const foreign = await check({ manifest: { ...buildManifest(), stations_url: "https://example.test/stations.geojson" } });
  assert.equal(foreign.errorType, "SCHEMA_ERROR");
  assert.match(String(foreign.errorMessage), /does not point at the published output/);
});

test("14. malformed road GeoJSON is ERROR", async () => {
  const notACollection = await check({ bodies: { roads: { type: "Feature", features: [] } } });
  assert.equal(notACollection.status, "error");
  assert.equal(notACollection.errorType, "SCHEMA_ERROR");
  assert.match(String(notACollection.errorMessage), /not a FeatureCollection/);

  const noFeatures = await check({ bodies: { roads: { type: "FeatureCollection" } } });
  assert.equal(noFeatures.errorType, "SCHEMA_ERROR");
  assert.match(String(noFeatures.errorMessage), /no features array/);
});

test("15. a manifest count that disagrees with the GeoJSON is ERROR", async () => {
  const health = await check({ actual: { roads: 699 } });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "SCHEMA_ERROR");
  assert.match(
    String(health.errorMessage),
    /Manifest reports 701 roads features, but road-conditions\.geojson contains 699\./,
  );

  const traffic = await check({ actual: { trafficStations: 90 } });
  assert.equal(traffic.errorType, "SCHEMA_ERROR");
  assert.match(String(traffic.errorMessage), /107 traffic stations, but road-stations\.geojson contains 90/);
});

test("16. the core road dataset returning 404 is ERROR even on its own", async () => {
  const health = await check({ datasetStatus: (target) => (target === url.roads ? 404 : 200) });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "HTTP_ERROR");
  assert.match(String(health.errorMessage), /core road dataset is unavailable/);
  assert.equal(health.details?.datasets, "2 / 3 available");
});

test("17. the stations dataset returning 404 is DEGRADED", async () => {
  const health = await check({ datasetStatus: (target) => (target === url.stations ? 404 : 200) });
  assert.equal(health.status, "degraded");
  assert.equal(health.errorType, "HTTP_ERROR");
  assert.match(String(health.errorMessage), /road-stations\.geojson/);
  assert.equal(health.details?.datasets, "2 / 3 available");
});

test("18. the incidents dataset returning 404 is DEGRADED", async () => {
  const health = await check({ datasetStatus: (target) => (target === url.incidents ? 404 : 200) });
  assert.equal(health.status, "degraded");
  assert.match(String(health.errorMessage), /road-incidents\.geojson/);
});

test("19. two datasets unavailable is ERROR", async () => {
  const health = await check({ datasetStatus: (target) => (target === url.roads ? 200 : 404) });
  assert.equal(health.status, "error");
  assert.match(String(health.errorMessage), /2 of 3 published datasets are unavailable/);
  assert.equal(health.details?.datasets, "1 / 3 available");
});

test("20. all datasets unavailable is ERROR", async () => {
  const health = await check({ datasetStatus: () => 404 });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "HTTP_ERROR");
  assert.equal(health.details?.datasets, "0 / 3 available");
});

test("21. a manifest HTTP error is ERROR", async () => {
  const failed = await check({ manifestStatus: 500 });
  assert.equal(failed.status, "error");
  assert.equal(failed.errorType, "HTTP_ERROR");
  assert.equal(failed.httpStatus, 500);
  assert.equal(failed.networkOk, true);

  const offline = await check({ manifestThrows: true });
  assert.equal(offline.errorType, "NETWORK_ERROR");
  assert.equal(offline.networkOk, false);
});

test("22. a manifest parse error is ERROR", async () => {
  const broken = await check({ manifestBody: "{ not json" });
  assert.equal(broken.status, "error");
  assert.equal(broken.errorType, "PARSE_ERROR");
  assert.equal(broken.parseOk, false);
});

test("23. the full GeoJSON download only happens when the manifest changes", async () => {
  const cache = createIrcaContentCache();
  const calls: { url: string; method: string }[] = [];
  const options = { calls };

  await checkIrca({ now: NOW_FRESH, request: stubRequest(options), cache });
  const firstDownloads = calls.filter((call) => call.method === "GET" && call.url !== IRCA_MANIFEST_URL);
  assert.equal(firstDownloads.length, 3);

  calls.length = 0;
  await checkIrca({ now: NOW_FRESH, request: stubRequest(options), cache });
  assert.deepEqual(
    calls.filter((call) => call.method === "GET" && call.url !== IRCA_MANIFEST_URL),
    [],
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "HEAD", "HEAD", "HEAD"],
  );

  // A new publish changes generated_at, so the files are validated again.
  calls.length = 0;
  const republished = { calls, manifest: buildManifest(PRODUCTION_COUNTS, "2026-09-03T01:05:00.000Z") };
  await checkIrca({ now: new Date("2026-09-03T01:15:00Z"), request: stubRequest(republished), cache });
  assert.equal(calls.filter((call) => call.method === "GET" && call.url !== IRCA_MANIFEST_URL).length, 3);
});

test("24. an unchanged manifest reuses the validated in-memory result", async () => {
  const cache = createIrcaContentCache();
  const first = await checkIrca({ now: NOW_FRESH, request: stubRequest(), cache });
  assert.equal(first.details?.contentCheck, "downloaded and validated");

  const second = await checkIrca({ now: NOW_FRESH, request: stubRequest(), cache });
  assert.equal(second.details?.contentCheck, "cached (manifest unchanged)");
  assert.equal(second.status, "ok");
  assert.equal(second.details?.roads, 701);
  assert.equal(second.details?.trafficStations, 107);
});

test("25. every production request is a read-only GET or HEAD against the published output", async () => {
  const calls: { url: string; method: string }[] = [];
  await check({ calls });

  assert.equal(
    calls.every((call) => call.method === "GET" || call.method === "HEAD"),
    true,
  );
  assert.equal(
    calls.every((call) => call.url.startsWith(`${IRCA_PUBLIC_BASE_URL}/`)),
    true,
  );
  assert.deepEqual(
    calls.filter((call) => call.method === "HEAD").map((call) => call.url),
    [url.roads, url.incidents, url.stations],
  );
});

test("a core dataset outage outranks staleness, so an outage is never hidden by a STALE badge", async () => {
  const health = await check({
    now: agedNow(80),
    datasetStatus: (target) => (target === url.roads ? 404 : 200),
  });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "HTTP_ERROR");
  assert.match(String(health.errorMessage), /core road dataset is unavailable/);
});

test("a non-core outage is reported as DEGRADED rather than STALE while data is old", async () => {
  const health = await check({
    now: agedNow(80),
    datasetStatus: (target) => (target === url.incidents ? 404 : 200),
  });
  assert.equal(health.status, "degraded");
});
