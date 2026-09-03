import assert from "node:assert/strict";
import test from "node:test";
import { ECMWF_MANIFEST_URL, ECMWF_PUBLIC_BASE_URL } from "../src/config/ecmwf";
import { fetchWithDiagnosticsCore } from "../src/lib/fetchWithDiagnosticsCore";
import { checkEcmwf, type DiagnosticFetcher } from "../src/monitors/ecmwf/monitor";

const HOUR_MS = 3_600_000;

/** Production is currently on the 2026-09-02 12Z run; at 02:04 UTC that is exactly what is expected. */
const NOW_ON_SCHEDULE = new Date("2026-09-03T02:04:00Z");
const RUN_ON_SCHEDULE = "2026-09-02T12:00:00.000Z";

function frameUrl(step: number) {
  return `${ECMWF_PUBLIC_BASE_URL}/tcc-${String(step).padStart(2, "0")}h.png`;
}

function buildManifest(runAt: string, options: { frameCount?: number; stepHours?: number } = {}) {
  const { frameCount = 17, stepHours = 3 } = options;
  const runMs = Date.parse(runAt);
  return {
    model: "ECMWF IFS Open Data (0.25 degree)",
    run_at: runAt,
    generated_at: new Date(runMs + 11 * HOUR_MS).toISOString(),
    source_url: "https://www.ecmwf.int/en/forecasts/datasets/open-data",
    attribution: "European Centre for Medium-Range Weather Forecasts (ECMWF), CC BY 4.0.",
    frames: Array.from({ length: frameCount }, (_unused, index) => ({
      valid_at: new Date(runMs + index * stepHours * HOUR_MS).toISOString(),
      image_url: frameUrl(index * stepHours),
    })),
  };
}

interface StubOptions {
  manifest?: unknown;
  manifestBody?: string;
  manifestStatus?: number;
  manifestContentType?: string;
  manifestThrows?: boolean;
  /** Status returned for each probed image URL; default 200. */
  imageStatus?: (url: string) => number;
  calls?: { url: string; method: string }[];
}

/** Drives the real diagnostics core with a stub transport, so nothing touches the network. */
function stubRequest(options: StubOptions = {}): DiagnosticFetcher {
  return (url, requestOptions) =>
    fetchWithDiagnosticsCore(url, {
      ...requestOptions,
      fetch: async (requestedUrl, init) => {
        options.calls?.push({ url: requestedUrl, method: init?.method ?? "GET" });
        if (requestedUrl === ECMWF_MANIFEST_URL) {
          if (options.manifestThrows) throw new TypeError("offline");
          const body = options.manifestBody ?? JSON.stringify(options.manifest ?? buildManifest(RUN_ON_SCHEDULE));
          return new Response(body, {
            status: options.manifestStatus ?? 200,
            headers: { "content-type": options.manifestContentType ?? "application/json" },
          });
        }
        const status = options.imageStatus?.(requestedUrl) ?? 200;
        return new Response(status === 200 ? "" : "missing", {
          status,
          headers: { "content-type": status === 200 ? "image/png" : "text/plain" },
        });
      },
    });
}

const check = (options: StubOptions & { now?: Date } = {}) =>
  checkEcmwf({ now: options.now ?? NOW_ON_SCHEDULE, request: stubRequest(options) });

test("1. the currently expected run with healthy frames and images is OK", async () => {
  const health = await check();
  assert.equal(health.status, "ok");
  assert.equal(health.errorType, undefined);
  assert.equal(health.httpStatus, 200);
  assert.equal(health.dataTime, RUN_ON_SCHEDULE);
  assert.equal(health.details?.modelRun, "2026-09-02 12Z");
  assert.equal(health.details?.expectedRun, "2026-09-02 12Z");
});

test("2. the previous run inside its publication window is OK, not STALE", async () => {
  // 09:30 UTC: the 00Z run is not due until 09:45, so still being on 18Z is normal.
  const health = await check({
    now: new Date("2026-09-03T09:30:00Z"),
    manifest: buildManifest("2026-09-02T18:00:00.000Z"),
  });
  assert.equal(health.status, "ok");
  assert.equal(health.details?.expectedRun, "2026-09-02 18Z");
});

test("3. the previous run past its publication deadline is STALE", async () => {
  // 10:00 UTC: the 00Z run was due at 09:45 and has not appeared.
  const health = await check({
    now: new Date("2026-09-03T10:00:00Z"),
    manifest: buildManifest("2026-09-02T18:00:00.000Z"),
  });
  assert.equal(health.status, "stale");
  assert.equal(health.errorType, "STALE_DATA");
  assert.equal(health.details?.expectedRun, "2026-09-03 00Z");
  assert.equal(health.details?.modelRun, "2026-09-02 18Z");
  assert.equal(health.details?.expectedBy, "09:45 UTC");
  assert.match(String(health.errorMessage), /API is healthy/);
  assert.match(String(health.errorMessage), /2026-09-03 00Z/);
  assert.match(String(health.errorMessage), /2026-09-02 18Z/);
});

test("4. the 18Z cycle is judged across the UTC day boundary", async () => {
  const manifest = buildManifest("2026-09-02T12:00:00.000Z");
  // 03:00 UTC: the 18Z run is not due until 03:45, so 12Z is still on schedule.
  const beforeDeadline = await check({ now: new Date("2026-09-03T03:00:00Z"), manifest });
  assert.equal(beforeDeadline.status, "ok");
  assert.equal(beforeDeadline.details?.expectedRun, "2026-09-02 12Z");

  // 04:00 UTC the next day: 18Z was due at 03:45, so staying on 12Z is late.
  const afterDeadline = await check({ now: new Date("2026-09-03T04:00:00Z"), manifest });
  assert.equal(afterDeadline.status, "stale");
  assert.equal(afterDeadline.details?.expectedRun, "2026-09-02 18Z");
  assert.equal(afterDeadline.details?.expectedBy, "03:45 UTC");
});

test("5. a malformed manifest is ERROR", async () => {
  const notAnObject = await check({ manifest: [1, 2, 3] });
  assert.equal(notAnObject.status, "error");
  assert.equal(notAnObject.errorType, "SCHEMA_ERROR");

  const { run_at: _dropped, ...withoutRun } = buildManifest(RUN_ON_SCHEDULE);
  const missingRun = await check({ manifest: withoutRun });
  assert.equal(missingRun.errorType, "SCHEMA_ERROR");

  const { model: _model, ...withoutModel } = buildManifest(RUN_ON_SCHEDULE);
  const missingModel = await check({ manifest: withoutModel });
  assert.equal(missingModel.errorType, "SCHEMA_ERROR");
});

test("6. an invalid run_at is ERROR", async () => {
  const unparseable = await check({ manifest: { ...buildManifest(RUN_ON_SCHEDULE), run_at: "yesterday" } });
  assert.equal(unparseable.status, "error");
  assert.equal(unparseable.errorType, "INVALID_TIMESTAMP");

  // Parseable, but not a 00/06/12/18 UTC model cycle.
  const offCycle = await check({ manifest: buildManifest("2026-09-02T13:00:00.000Z") });
  assert.equal(offCycle.errorType, "INVALID_TIMESTAMP");
  assert.match(String(offCycle.errorMessage), /model cycle/);
});

test("7. a future run_at is ERROR", async () => {
  const health = await check({ manifest: buildManifest("2026-09-03T06:00:00.000Z") });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "INVALID_TIMESTAMP");
  assert.match(String(health.errorMessage), /in the future/);
});

test("8. an empty frame list is ERROR", async () => {
  const health = await check({ manifest: { ...buildManifest(RUN_ON_SCHEDULE), frames: [] } });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "EMPTY_DATA");
});

test("9. seventeen valid frames covering run to +48 h is OK", async () => {
  const health = await check();
  assert.equal(health.status, "ok");
  assert.equal(health.recordCount, 17);
  assert.equal(health.details?.frames, "17 / 17");
  assert.equal(health.details?.latestValid, "2026-09-04 12:00 UTC");
});

test("10. a frame sequence that is not every 3 h is ERROR", async () => {
  const manifest = buildManifest(RUN_ON_SCHEDULE);
  manifest.frames[5].valid_at = new Date(Date.parse(RUN_ON_SCHEDULE) + 16 * HOUR_MS).toISOString();
  const health = await check({ manifest });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "SCHEMA_ERROR");
  assert.match(String(health.errorMessage), /expected 3 h/);

  // A short but internally consistent manifest fails on coverage, not on the count alone.
  const short = await check({ manifest: buildManifest(RUN_ON_SCHEDULE, { frameCount: 9 }) });
  assert.equal(short.errorType, "SCHEMA_ERROR");
  assert.match(String(short.errorMessage), /expected run \+48 h/);
});

test("11. a forecast whose last valid time has passed is ERROR", async () => {
  // A well-formed run from three days ago: every frame is already in the past.
  const health = await check({ manifest: buildManifest("2026-08-31T00:00:00.000Z") });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "STALE_DATA");
  assert.match(String(health.errorMessage), /no longer covers the present/);
});

test("12. the first image succeeding and the last failing is DEGRADED", async () => {
  const health = await check({ imageStatus: (url) => (url.endsWith("tcc-48h.png") ? 404 : 200) });
  assert.equal(health.status, "degraded");
  assert.equal(health.errorType, "HTTP_ERROR");
  assert.equal(health.details?.images, "1 / 2 sampled OK");
  assert.match(String(health.errorMessage), /1 of 2/);
  assert.match(String(health.details?.failedImages), /tcc-48h\.png/);
});

test("13. both sampled images failing is ERROR", async () => {
  const health = await check({ imageStatus: () => 404 });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "HTTP_ERROR");
  assert.equal(health.details?.images, "0 / 2 sampled OK");
  assert.match(String(health.errorMessage), /neither sampled frame/);
});

test("14. an HTTP failure on the manifest is ERROR", async () => {
  const health = await check({ manifestStatus: 500 });
  assert.equal(health.status, "error");
  assert.equal(health.errorType, "HTTP_ERROR");
  assert.equal(health.httpStatus, 500);
  assert.equal(health.networkOk, true);

  const offline = await check({ manifestThrows: true });
  assert.equal(offline.status, "error");
  assert.equal(offline.errorType, "NETWORK_ERROR");
  assert.equal(offline.networkOk, false);
});

test("15. a parse failure on the manifest is ERROR", async () => {
  const broken = await check({ manifestBody: "{ not json" });
  assert.equal(broken.status, "error");
  assert.equal(broken.errorType, "PARSE_ERROR");
  assert.equal(broken.parseOk, false);

  const html = await check({ manifestBody: "<html></html>", manifestContentType: "text/html" });
  assert.equal(html.errorType, "PARSE_ERROR");
});

test("images are sampled with HEAD, only first and last, and nothing is ever written", async () => {
  const calls: { url: string; method: string }[] = [];
  await check({ calls });

  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "HEAD", "HEAD"],
  );
  assert.deepEqual(
    calls.filter((call) => call.method === "HEAD").map((call) => call.url),
    [frameUrl(0), frameUrl(48)],
  );
  assert.equal(
    calls.every((call) => call.url.startsWith(ECMWF_PUBLIC_BASE_URL)),
    true,
  );
});
