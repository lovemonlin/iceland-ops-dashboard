import assert from "node:assert/strict";
import test from "node:test";
import { checkNoaaKpForecast, checkOvation } from "../src/monitors/noaa/monitor";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import { decodeOvationGrid, encodeOvationGrid, icelandGridPeak } from "../src/lib/ovationGrid";

const NOW = new Date("2026-10-30T00:00:27.480Z");
const OVATION_NOW = new Date("2026-10-30T01:00:00.000Z");

function stub(body: unknown): DiagnosticFetcher {
  return (url, options) => fetchWithDiagnosticsCore(url, {
    ...options,
    fetch: async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
  });
}

test("the final Kp interval remains valid through its three-hour duration", async () => {
  const points = Array.from({ length: 17 }, (_, index) => ({
    time_tag: new Date(Date.UTC(2026, 9, 30, index * 3)).toISOString(),
    kp: 2,
    observed: "predicted",
    noaa_scale: null,
  }));
  const health = await checkNoaaKpForecast({ now: NOW, request: stub(points) });

  assert.equal(health.status, "ok");
  assert.equal(health.details?.forecastEnd, "2026-11-01T03:00:00.000Z");
});

function completeOvationGrid(cells: [number, number, number][] = []) {
  const grid: [number, number, number][] = [];
  for (let latitude = -90; latitude <= 90; latitude += 1) {
    for (let longitude = 0; longitude < 360; longitude += 1) grid.push([longitude, latitude, 0]);
  }
  for (const [longitude, latitude, probability] of cells) grid[(latitude + 90) * 360 + longitude] = [longitude, latitude, probability];
  return grid;
}

function ovationResponse(cells = completeOvationGrid([[341, 65, 11], [0, 65, 99]])) {
  return {
    "Observation Time": "2026-10-30T00:28:00Z",
    "Forecast Time": "2026-10-30T01:53:00Z",
    coordinates: cells,
  };
}

function deterministicStub(body: unknown): DiagnosticFetcher {
  return async () => ({
    ok: true,
    data: body,
    diagnostics: {
      startedAt: "2026-10-30T00:00:25.000Z",
      finishedAt: "2026-10-30T00:00:26.000Z",
      latencyMs: 1000,
      safeUrl: "https://example.test/ovation",
      responseReceived: true,
      httpStatus: 200,
    },
  });
}

test("OVATION stores source, forecast and fetch times as distinct UTC instants", async () => {
  const health = await checkOvation({ now: OVATION_NOW, request: deterministicStub(ovationResponse()) });
  assert.equal(health.status, "ok");
  assert.equal(health.data?.observationTime, "2026-10-30T00:28:00.000Z");
  assert.equal(health.data?.forecastTime, "2026-10-30T01:53:00.000Z");
  assert.equal(health.data?.fetchedAt, "2026-10-30T00:00:26.000Z");
  assert.equal(health.data?.icelandPeakProbabilityPercent, 11, "outside-Iceland longitude cannot raise the summary peak");
  assert.equal(health.data?.icelandLatitudeCells, 65);
});

test("OVATION rejects missing and duplicate source cells instead of publishing a partial grid", async () => {
  const complete = completeOvationGrid();
  const missing = await checkOvation({ now: OVATION_NOW, request: deterministicStub(ovationResponse(complete.slice(1))) });
  const duplicate = await checkOvation({ now: OVATION_NOW, request: deterministicStub(ovationResponse([...complete, complete[0]])) });
  assert.equal(missing.status, "error");
  assert.equal(duplicate.status, "error");
});

test("OVATION rejects impossible source times and marks an expired forecast as historical", async () => {
  const complete = completeOvationGrid();
  const futureObservation = await checkOvation({
    now: OVATION_NOW,
    request: deterministicStub({ ...ovationResponse(complete), "Observation Time": "2026-10-30T03:00:00Z" }),
  });
  const reversedTimes = await checkOvation({
    now: OVATION_NOW,
    request: deterministicStub({ ...ovationResponse(complete), "Forecast Time": "2026-10-29T23:00:00Z" }),
  });
  const expiredForecast = await checkOvation({
    now: OVATION_NOW,
    request: deterministicStub({
      ...ovationResponse(complete),
      "Observation Time": "2026-10-30T00:59:00Z",
      "Forecast Time": "2026-10-30T00:59:00Z",
    }),
  });

  assert.equal(futureObservation.errorType, "INVALID_TIMESTAMP");
  assert.equal(reversedTimes.errorType, "INVALID_TIMESTAMP");
  assert.equal(expiredForecast.status, "stale");
  assert.equal(expiredForecast.data?.gridCells, 65160);
});

test("the shared Iceland peak and grid decoder reject misleading payloads", () => {
  const grid = decodeOvationGrid(encodeOvationGrid([[341, 65, 11], [338, 64, 8], [342, 66, 10], [341, 63, 6], [345, 64, 7]]));
  assert.equal(icelandGridPeak(grid), 11);
  assert.equal(decodeOvationGrid({
    schemaVersion: 1, latFrom: 45, latTo: 85, lonFrom: -180, lonTo: 179, latStep: 1, lonStep: 1,
    values: new Array(14760).fill(101),
  }), undefined);
  assert.throws(() => encodeOvationGrid([[341.5, 65, 11]]));
});
