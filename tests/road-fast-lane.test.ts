import assert from "node:assert/strict";
import test from "node:test";
import { IRCA_PUBLIC_BASE_URL } from "../src/config/irca";
import { ROAD_POLL_MS, startRoadFastLane } from "../src/lib/roadFastLane";

type Key = "roads" | "incidents" | "stations";
const keys: Key[] = ["roads", "incidents", "stations"];
const urls: Record<Key, string> = {
  roads: `${IRCA_PUBLIC_BASE_URL}/road-conditions.geojson`,
  incidents: `${IRCA_PUBLIC_BASE_URL}/road-incidents.geojson`,
  stations: `${IRCA_PUBLIC_BASE_URL}/road-stations.geojson`,
};
const counts = { roads: 500, incidents: 1, stations: 100, traffic: 50 };

function manifest(version: string) {
  return {
    schema_version: 2,
    generated_at: version,
    road_data_at: version,
    incident_data_at: version,
    measurement_data_at: version,
    road_count: counts.roads,
    incident_count: counts.incidents,
    station_count: counts.stations,
    traffic_station_count: counts.traffic,
    roads_url: urls.roads,
    incidents_url: urls.incidents,
    stations_url: urls.stations,
  };
}

function collection(key: Key) {
  const count = counts[key];
  return {
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_unused, index) => ({
      type: "Feature",
      properties: key === "stations" ? { has_traffic: index < counts.traffic } : {},
      geometry: { type: "Point", coordinates: [-20 + index / 100, 64] },
    })),
  };
}

class FakeVisibility {
  hidden = false;
  private listener: (() => void) | undefined;

  addEventListener(_event: "visibilitychange", listener: () => void) {
    this.listener = listener;
  }

  removeEventListener(_event: "visibilitychange", listener: () => void) {
    if (this.listener === listener) this.listener = undefined;
  }

  visible() {
    this.hidden = false;
    this.listener?.();
  }
}

async function flush() {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
}

function installTimers() {
  const realInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const realTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let interval: (() => void) | undefined;
  let intervalMs: number | undefined;
  let intervals = 0;
  (globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((callback: () => void, ms: number) => {
    intervals += 1;
    interval = callback;
    intervalMs = ms;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  (globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = (() => undefined) as typeof clearInterval;
  (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = (() => 1 as unknown as ReturnType<typeof setTimeout>) as typeof setTimeout;
  (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = (() => undefined) as typeof clearTimeout;
  return {
    tick: () => interval?.(),
    details: () => ({ intervals, intervalMs }),
    restore: () => {
      globalThis.setInterval = realInterval;
      globalThis.clearInterval = realClearInterval;
      globalThis.setTimeout = realTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

function createFetcher(versions: string[]) {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  const control: { fail?: Key; rollover: boolean; malformed: boolean; manifestFailure: boolean; version: number } = {
    rollover: false,
    malformed: false,
    manifestFailure: false,
    version: 0,
  };
  let manifestReads = 0;
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    inits.push(init ?? {});
    if (url.pathname.endsWith("road-manifest.json")) {
      if (control.manifestFailure) throw new TypeError("offline");
      const current = control.rollover && manifestReads % 2 === 1
        ? versions[Math.min(control.version + 1, versions.length - 1)]
        : versions[control.version];
      manifestReads += 1;
      return new Response(JSON.stringify(manifest(current)), { status: 200 });
    }
    const key = keys.find((candidate) => url.pathname.endsWith(`${candidate === "roads" ? "road-conditions" : candidate === "incidents" ? "road-incidents" : "road-stations"}.geojson`));
    if (!key || control.fail === key) return new Response("unavailable", { status: 503 });
    const data = control.malformed && key === "roads" ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: null }] } : collection(key);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return { calls, inits, control, fetcher: fetcher as typeof fetch };
}

test("initially loads one validated manifest bundle and preserves exact timestamp version", async () => {
  const timers = installTimers();
  try {
    const version = "2025-10-20T00:00:00.123456Z";
    const fake = createFetcher([version]);
    const bundles: string[] = [];
    const stop = startRoadFastLane({
      fetcher: fake.fetcher,
      visibility: new FakeVisibility(),
      onBundle: (bundle) => {
        bundles.push(bundle.version);
        assert.equal(bundle.manifest.generatedAt.getTime(), Date.parse(version));
        for (const field of ["roadDataAt", "incidentDataAt", "measurementDataAt"] as const) {
          assert.equal(bundle.manifest[field]?.getTime(), Date.parse(version));
        }
      },
      onError: (error) => assert.fail(String(error)),
    });
    await flush();
    assert.deepEqual(bundles, [version]);
    assert.equal(timers.details().intervalMs, ROAD_POLL_MS);
    assert.equal(timers.details().intervals, 1);
    assert.equal(fake.calls.filter((url) => url.includes("road-manifest.json")).length, 2);
    assert.equal(fake.inits.every((init) => init.cache === "no-store"), true);
    for (const key of keys) assert.equal(fake.calls.some((url) => url.includes(`${key === "roads" ? "road-conditions" : key === "incidents" ? "road-incidents" : "road-stations"}.geojson?v=${encodeURIComponent(version)}`)), true);
    stop();
  } finally {
    timers.restore();
  }
});

test("an unchanged five-minute manifest poll never downloads or commits GeoJSON again", async () => {
  const timers = installTimers();
  try {
    const fake = createFetcher(["2025-10-20T00:00:00Z"]);
    let bundles = 0;
    const stop = startRoadFastLane({ fetcher: fake.fetcher, visibility: new FakeVisibility(), onBundle: () => bundles++, onError: assert.fail });
    await flush();
    fake.calls.length = 0;
    timers.tick();
    await flush();
    assert.equal(bundles, 1);
    assert.equal(fake.calls.length, 1);
    assert.match(fake.calls[0], /road-manifest\.json\?t=/);
    stop();
  } finally {
    timers.restore();
  }
});

test("a new version fetches all three identical-version datasets before one atomic callback", async () => {
  const timers = installTimers();
  try {
    const next = "2025-10-20T00:20:00Z";
    const fake = createFetcher(["2025-10-20T00:10:00Z", next]);
    const visible = new FakeVisibility();
    const bundles: string[] = [];
    const stop = startRoadFastLane({ fetcher: fake.fetcher, visibility: visible, onBundle: (bundle) => bundles.push(bundle.version), onError: assert.fail });
    await flush();
    fake.calls.length = 0;
    fake.control.version = 1;
    timers.tick();
    await flush();
    assert.deepEqual(bundles, ["2025-10-20T00:10:00Z", next]);
    assert.equal(fake.calls.filter((url) => url.includes(".geojson")).length, 3);
    assert.equal(fake.calls.filter((url) => url.includes(`v=${encodeURIComponent(next)}`)).length, 3);
    stop();
  } finally {
    timers.restore();
  }
});

test("a failed, malformed, rolled-over, or missing manifest retains the last-known-good bundle", async () => {
  const cases: Array<(control: ReturnType<typeof createFetcher>["control"]) => void> = [
    (control) => { control.fail = "roads"; },
    (control) => { control.fail = "incidents"; },
    (control) => { control.fail = "stations"; },
    (control) => { control.malformed = true; },
    (control) => { control.rollover = true; },
    (control) => { control.manifestFailure = true; },
  ];
  for (const configureFailure of cases) {
    const timers = installTimers();
    try {
      const errors: unknown[] = [];
      const fake = createFetcher(["2025-10-20T00:30:00Z", "2025-10-20T00:31:00Z", "2025-10-20T00:32:00Z"]);
      const bundles: string[] = [];
      const stop = startRoadFastLane({ fetcher: fake.fetcher, visibility: new FakeVisibility(), onBundle: (bundle) => bundles.push(bundle.version), onError: (error) => errors.push(error) });
      await flush();
      fake.control.version = 1;
      configureFailure(fake.control);
      timers.tick();
      await flush();
      assert.deepEqual(bundles, ["2025-10-20T00:30:00Z"]);
      assert.equal(errors.length, 1);
      fake.control.fail = undefined;
      fake.control.malformed = false;
      fake.control.rollover = false;
      fake.control.manifestFailure = false;
      timers.tick();
      await flush();
      assert.deepEqual(bundles, ["2025-10-20T00:30:00Z", "2025-10-20T00:31:00Z"]);
      stop();
    } finally {
      timers.restore();
    }
  }
});

test("hidden pages skip polling, visible pages check immediately, and cleanup stops future callbacks", async () => {
  const timers = installTimers();
  try {
    const visibility = new FakeVisibility();
    visibility.hidden = true;
    const fake = createFetcher(["2025-10-20T00:40:00Z"]);
    let bundles = 0;
    const stop = startRoadFastLane({ fetcher: fake.fetcher, visibility, onBundle: () => bundles++, onError: assert.fail });
    await flush();
    assert.equal(fake.calls.length, 0);
    visibility.visible();
    await flush();
    assert.equal(bundles, 1);
    stop();
    const before = fake.calls.length;
    timers.tick();
    visibility.visible();
    await flush();
    assert.equal(fake.calls.length, before);
  } finally {
    timers.restore();
  }
});

test("a pending bundle prevents duplicate polls and cannot commit after cleanup", async () => {
  const timers = installTimers();
  try {
    let releaseStation: ((response: Response) => void) | undefined;
    const calls: string[] = [];
    const version = "2025-10-20T01:00:00Z";
    const fetcher = ((input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname.endsWith("road-manifest.json")) return Promise.resolve(new Response(JSON.stringify(manifest(version))));
      const key = keys.find((candidate) => url.pathname.endsWith(`${candidate === "roads" ? "road-conditions" : candidate === "incidents" ? "road-incidents" : "road-stations"}.geojson`));
      if (key === "stations") return new Promise<Response>((resolve) => { releaseStation = resolve; });
      return Promise.resolve(new Response(JSON.stringify(collection(key as Key))));
    }) as typeof fetch;
    let bundles = 0;
    const visibility = new FakeVisibility();
    const stop = startRoadFastLane({ fetcher, visibility, onBundle: () => bundles++, onError: assert.fail });
    await flush();
    assert.equal(bundles, 0, "the third download must complete before the callback");
    const before = calls.length;
    timers.tick();
    visibility.visible();
    await flush();
    assert.equal(calls.length, before, "an in-flight attempt must suppress duplicate polling");
    stop();
    releaseStation?.(new Response(JSON.stringify(collection("stations"))));
    await flush();
    assert.equal(bundles, 0, "late fetches after cleanup must not adopt data");
  } finally {
    timers.restore();
  }
});
