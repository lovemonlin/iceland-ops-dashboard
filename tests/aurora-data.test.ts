import assert from "node:assert/strict";
import test from "node:test";
import { encodeOvationGrid } from "../src/lib/ovationGrid";
import { auroraSourceAt, ovationState } from "../src/lib/auroraData";
import type { SnapshotSource } from "../src/snapshot/types";

const now = new Date("2026-10-30T01:00:00Z");

function source(id: string, data: Record<string, unknown>, extra: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    id,
    name: id,
    status: "ok",
    lastAttemptAt: "2026-10-30T00:55:00Z",
    lastSuccessAt: "2026-10-30T00:55:00Z",
    data,
    ...extra,
  };
}

test("OVATION keeps UTC times distinct and stops being current at its forecast time", () => {
  const entry = source("ovation", {
    observationTime: "2026-10-30 00:28 UTC",
    forecastTime: "2026-10-30T01:53:00Z",
    fetchedAt: "2026-10-30T00:55:02Z",
    grid: encodeOvationGrid([[-22, 64, 8]]),
  });
  const current = ovationState(entry, now);
  assert.equal(current.current, true);
  assert.equal(current.observedAt, "2026-10-30T00:28:00.000Z");
  assert.equal(current.forecastAt, "2026-10-30T01:53:00.000Z");
  assert.equal(current.fetchedAt, "2026-10-30T00:55:02.000Z");
  assert.equal(current.checkedAt, "2026-10-30T00:55:00.000Z");
  assert.equal(current.grid?.probabilityAt(64, -22), 8);
  assert.equal(ovationState(entry, new Date("2026-10-30T01:53:00Z")).current, false);
});

test("failed or malformed OVATION keeps historical grid but cannot be current", () => {
  const entry = source("ovation", {
    observationTime: "2026-10-30 00:28 UTC",
    forecastTime: "2026-10-30 01:53 UTC",
    grid: encodeOvationGrid([[-22, 64, 8]]),
  }, { status: "error" });
  const failed = ovationState(entry, now);
  assert.equal(failed.current, false);
  assert.equal(failed.grid?.probabilityAt(64, -22), 8);
  assert.equal(ovationState(source("ovation", { observationTime: "bad", forecastTime: "also bad" }), now).current, false);
  assert.equal(ovationState(source("ovation", {
    observationTime: "2026-10-30 00:28", forecastTime: "2026-10-30T01:53:00Z",
    grid: encodeOvationGrid([[-22, 64, 8]]),
  }, { dataTime: "2026-10-30T00:28:00Z" }), now).current, false, "an invalid provided observation is not replaced by another clock");
  assert.equal(ovationState(source("ovation", {
    observationTime: "2026-10-29T20:00:00Z",
    forecastTime: "2026-10-30T02:00:00Z",
    grid: encodeOvationGrid([[-22, 64, 8]]),
  }), now).current, false, "a far-future forecast cannot revive an old observation");
});

test("source overlays use UTC data ages and never promote a failed last-good value", () => {
  const fresh = source("solarWind", { bzNt: -4 }, { dataTime: "2026-10-30T00:30:00Z" });
  assert.equal(auroraSourceAt(fresh, now)?.status, "ok");
  const old = source("solarWind", { bzNt: -4 }, { dataTime: "2026-10-29T23:00:00Z" });
  assert.equal(auroraSourceAt(old, now)?.status, "stale");
  const failed = source("solarWind", { bzNt: -4 }, { status: "error", dataTime: "2026-10-30T00:30:00Z" });
  assert.equal(auroraSourceAt(failed, now), failed);
  assert.equal(ovationState(source("ovation", {
    observationTime: "2026-10-30 00:28 UTC",
    forecastTime: "2026-10-30 01:53 UTC",
    fetchedAt: "2026-10-30 00:55",
    grid: encodeOvationGrid([[-22, 64, 8]]),
  }, { lastSuccessAt: undefined }), now).fetchedAt, undefined, "zone-less time never depends on the browser zone");
});

test("Kp forecast needs a full final three-hour interval plus 48 hours of coverage", () => {
  const points = Array.from({ length: 17 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 9, 30, index * 3)).toISOString(),
    kp: 2,
    status: "predicted" as const,
    noaaScale: null,
  }));
  const usable = source("noaaKpForecast", { points });
  assert.equal(auroraSourceAt(usable, now)?.status, "ok");
  const short = source("noaaKpForecast", { points: points.slice(0, -1) });
  assert.equal(auroraSourceAt(short, now)?.status, "stale");
});
