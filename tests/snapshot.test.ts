import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MonitorHealth } from "../src/health/model";
import { buildSnapshot, isDashboardSnapshot } from "../src/snapshot/buildSnapshot";
import { mergeSource } from "../src/snapshot/mergeSnapshot";
import { readSnapshot } from "../src/snapshot/readSnapshot";
import type { SnapshotSource } from "../src/snapshot/types";
import { writeSnapshot } from "../src/snapshot/writeSnapshot";

const TEN = "2026-09-03T10:00:00.000Z";
const ELEVEN = "2026-09-03T11:00:00.000Z";
const TWELVE = "2026-09-03T12:00:00.000Z";

function monitor(overrides: Partial<MonitorHealth> = {}): MonitorHealth {
  return {
    id: "noaaKp",
    name: "NOAA Kp",
    status: "ok",
    checkedAt: TEN,
    networkOk: true,
    parseOk: true,
    data: { kp: 4.3 },
    dataTime: "2026-09-03T09:50:00.000Z",
    httpStatus: 200,
    latencyMs: 120,
    ...overrides,
  };
}

/** The 10:00 state: collected successfully. */
const collected = mergeSource(undefined, monitor(), TEN);

const failedAttempt = monitor({
  status: "error",
  checkedAt: ELEVEN,
  data: undefined,
  dataTime: undefined,
  errorType: "SCHEMA_ERROR",
  errorMessage: "Required numeric Kp field is missing.",
  httpStatus: 200,
  latencyMs: 90,
});

test("1. a successful attempt replaces the stored data", () => {
  const next = mergeSource(collected, monitor({ checkedAt: ELEVEN, data: { kp: 5.7 } }), ELEVEN);
  assert.deepEqual(next.data, { kp: 5.7 });
  assert.equal(next.status, "ok");
});

test("2. a successful attempt moves lastSuccessAt to the attempt time", () => {
  const next = mergeSource(collected, monitor({ checkedAt: ELEVEN }), ELEVEN);
  assert.equal(next.lastAttemptAt, ELEVEN);
  assert.equal(next.lastSuccessAt, ELEVEN);
});

test("3. a failed attempt preserves the previously collected data", () => {
  const next = mergeSource(collected, failedAttempt, ELEVEN);
  assert.equal(next.status, "error");
  assert.deepEqual(next.data, { kp: 4.3 }, "the last good reading must survive a failed update");
  assert.equal(next.dataTime, "2026-09-03T09:50:00.000Z");
});

test("4. a failed attempt preserves lastSuccessAt", () => {
  const next = mergeSource(collected, failedAttempt, ELEVEN);
  assert.equal(next.lastSuccessAt, TEN);
});

test("5. a failed attempt still updates lastAttemptAt and records the error", () => {
  const next = mergeSource(collected, failedAttempt, ELEVEN);
  assert.equal(next.lastAttemptAt, ELEVEN);
  assert.equal(next.errorType, "SCHEMA_ERROR");
  assert.match(String(next.errorMessage), /Kp field is missing/);
  assert.equal(next.diagnostics?.latencyMs, 90, "diagnostics describe the attempt, not the stored data");
});

test("6. a source that has never succeeded carries no data at all", () => {
  const next = mergeSource(undefined, failedAttempt, ELEVEN);
  assert.equal(next.data, undefined);
  assert.equal(next.lastSuccessAt, undefined);
  assert.equal(next.dataTime, undefined);
  assert.equal(next.status, "error");
});

test("7. recovery clears the previous error", () => {
  const failed = mergeSource(collected, failedAttempt, ELEVEN);
  const recovered = mergeSource(failed, monitor({ checkedAt: TWELVE, data: { kp: 2.0 } }), TWELVE);
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.errorType, undefined);
  assert.equal(recovered.errorMessage, undefined);
  assert.deepEqual(recovered.data, { kp: 2.0 });
  assert.equal(recovered.lastSuccessAt, TWELVE);
});

test("8. a mixed round produces the right overall status and summary", () => {
  const monitors: MonitorHealth[] = [
    monitor({ id: "noaaKp", name: "NOAA Kp", status: "ok" }),
    monitor({ id: "irca", name: "IRCA Roads", status: "error", errorType: "STALE_DATA" }),
    monitor({ id: "imo", name: "IMO Warnings", status: "info" }),
    monitor({ id: "ovation", name: "NOAA OVATION", status: "degraded" }),
    monitor({ id: "ircaPipeline", name: "IRCA Road Publisher", status: "stale" }),
  ];

  const snapshot = buildSnapshot(undefined, monitors, new Date(TEN));

  assert.equal(snapshot.overallStatus, "error");
  assert.deepEqual(snapshot.summary, { ok: 1, info: 1, stale: 1, degraded: 1, error: 1 });
  // Pipelines are stored apart from sources.
  assert.deepEqual(Object.keys(snapshot.pipelines ?? {}), ["ircaPipeline"]);
  assert.equal(snapshot.sources.ircaPipeline, undefined);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.generatedAt, TEN);
  assert.equal(snapshot.scheduledFor, "2026-09-03T11:00:00.000Z");
});

test("8b. INFO never makes the overall status unhealthy", () => {
  const snapshot = buildSnapshot(undefined, [monitor({ status: "info" }), monitor({ id: "imo", name: "IMO", status: "ok" })], new Date(TEN));
  assert.equal(snapshot.overallStatus, "ok");
});

test("a source the round did not report is carried forward untouched", () => {
  const first = buildSnapshot(undefined, [monitor()], new Date(TEN));
  const second = buildSnapshot(first, [monitor({ id: "imo", name: "IMO Warnings" })], new Date(ELEVEN));
  assert.deepEqual(second.sources.noaaKp, first.sources.noaaKp);
});

async function scratchDirectory() {
  return mkdtemp(join(tmpdir(), "iceland-snapshot-"));
}

test("9. the writer produces valid, re-readable JSON", async () => {
  const directory = await scratchDirectory();
  const path = join(directory, "data", "latest-health.json");
  const snapshot = buildSnapshot(undefined, [monitor()], new Date(TEN));

  await writeSnapshot(path, snapshot);

  const raw = await readFile(path, "utf8");
  assert.deepEqual(JSON.parse(raw), snapshot);
  const read = await readSnapshot(path);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.snapshot.generatedAt, TEN);
});

test("10. the writer leaves no temporary file behind", async () => {
  const directory = await scratchDirectory();
  const path = join(directory, "latest-health.json");
  await writeSnapshot(path, buildSnapshot(undefined, [monitor()], new Date(TEN)));

  assert.deepEqual(await readdir(directory), ["latest-health.json"]);
});

test("11. a failed write leaves the previous snapshot intact", async () => {
  const directory = await scratchDirectory();
  const path = join(directory, "latest-health.json");
  const good = buildSnapshot(undefined, [monitor()], new Date(TEN));
  await writeSnapshot(path, good);

  // A value JSON.stringify cannot serialise makes the write throw partway.
  const broken = { ...good, sources: { bad: { get id(): string { throw new Error("boom"); } } } } as unknown as typeof good;
  await assert.rejects(() => writeSnapshot(path, broken));

  const read = await readSnapshot(path);
  assert.equal(read.ok, true);
  if (read.ok) assert.deepEqual(read.snapshot, good);
  assert.deepEqual(await readdir(directory), ["latest-health.json"], "no .tmp file may survive a failed write");
});

test("the reader reports a missing snapshot without throwing", async () => {
  const directory = await scratchDirectory();
  const read = await readSnapshot(join(directory, "nothing.json"));
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.equal(read.reason, "missing");
    assert.match(read.message, /npm run snapshot/);
  }
});

test("the reader rejects malformed JSON and wrong-shaped JSON", async () => {
  const directory = await scratchDirectory();
  const path = join(directory, "latest-health.json");

  await writeFile(path, "{ not json", "utf8");
  const broken = await readSnapshot(path);
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.reason, "malformed");

  await writeFile(path, JSON.stringify({ hello: "world" }), "utf8");
  const wrongShape = await readSnapshot(path);
  assert.equal(wrongShape.ok, false);
  if (!wrongShape.ok) assert.equal(wrongShape.reason, "malformed");

  assert.equal(isDashboardSnapshot({ hello: "world" }), false);
});

test("a stored source keeps every field the dashboard needs to explain itself", () => {
  const next: SnapshotSource = mergeSource(collected, failedAttempt, ELEVEN);
  assert.deepEqual(Object.keys(next).sort(), [
    "data",
    "dataTime",
    "diagnostics",
    "errorMessage",
    "errorType",
    "id",
    "lastAttemptAt",
    "lastSuccessAt",
    "name",
    "status",
  ]);
});
