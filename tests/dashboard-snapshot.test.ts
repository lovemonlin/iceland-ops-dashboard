import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { SNAPSHOT_OVERDUE_MINUTES, SNAPSHOT_PUBLIC_PATH, SNAPSHOT_RELATIVE_PATH } from "../src/config/snapshot";
import type { MonitorHealth } from "../src/health/model";
import { buildSnapshot } from "../src/snapshot/buildSnapshot";
import { mergeSource } from "../src/snapshot/mergeSnapshot";
import { snapshotAgeMinutes, snapshotEntry } from "../src/snapshot/types";

const GENERATED_AT = "2026-09-03T12:00:00.000Z";

const source = (overrides: Partial<MonitorHealth> = {}): MonitorHealth => ({
  id: "irca",
  name: "IRCA Roads",
  status: "ok",
  checkedAt: GENERATED_AT,
  networkOk: true,
  parseOk: true,
  data: { roads: 701, incidents: 41, stations: 203 },
  dataTime: "2026-09-03T10:35:00.000Z",
  ...overrides,
});

const readProjectFile = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

test("12. the homepage reads the snapshot file and nothing else", async () => {
  const page = await readProjectFile("src/app/page.tsx");
  assert.match(page, /readSnapshot/);
  assert.match(page, /SNAPSHOT_RELATIVE_PATH/);
});

test("13. no page or component can reach a production monitor", async () => {
  const files = [
    "src/app/page.tsx",
    "src/app/layout.tsx",
    "src/components/Dashboard.tsx",
    "src/components/StatusCard.tsx",
  ];

  for (const file of files) {
    const source = await readProjectFile(file);
    for (const forbidden of [
      "runAllMonitors",
      "@/monitors/ecmwf",
      "@/monitors/irca",
      "@/monitors/github",
      "fetchWithDiagnostics",
    ]) {
      assert.equal(source.includes(forbidden), false, `${file} must not reference ${forbidden}`);
    }
  }
});

test("13b. only the scheduled snapshot script runs the monitors", async () => {
  const script = await readProjectFile("scripts/snapshot.ts");
  assert.match(script, /runAllMonitors/);

  // There is no live API route left that would collect on page load.
  await assert.rejects(() => readProjectFile("src/app/api/health/route.ts"));
});

test("14. the snapshot timestamp and age are derivable for the header", () => {
  const snapshot = buildSnapshot(undefined, [source()], new Date(GENERATED_AT));
  assert.equal(snapshot.generatedAt, GENERATED_AT);
  assert.equal(snapshotAgeMinutes(snapshot, new Date("2026-09-03T12:37:00Z")), 37);
  assert.equal(snapshotAgeMinutes(snapshot, new Date(GENERATED_AT)), 0);
  // A clock that has drifted backwards must not produce a negative age.
  assert.equal(snapshotAgeMinutes(snapshot, new Date("2026-09-03T11:00:00Z")), 0);
});

test("15. the overdue threshold fires only past the configured age", () => {
  const snapshot = buildSnapshot(undefined, [source()], new Date(GENERATED_AT));
  const ageAt = (iso: string) => snapshotAgeMinutes(snapshot, new Date(iso)) ?? 0;

  assert.equal(ageAt("2026-09-03T13:29:00Z") > SNAPSHOT_OVERDUE_MINUTES, false, "89 min is not overdue");
  assert.equal(ageAt("2026-09-03T13:31:00Z") > SNAPSHOT_OVERDUE_MINUTES, true, "91 min is overdue");
  assert.equal(ageAt("2026-09-03T13:37:00Z"), 97);
});

test("16. a failed collection still exposes the last successful data to the card", () => {
  const good = mergeSource(undefined, source(), "2026-09-03T11:00:00.000Z");
  const failed = mergeSource(
    good,
    source({
      status: "error",
      data: undefined,
      dataTime: undefined,
      errorType: "WORKFLOW_NOT_RUN",
      errorMessage: "No recent scheduled workflow run was observed.",
    }),
    "2026-09-03T13:00:00.000Z",
  );

  // Everything the card in the spec needs: stored values, when they were generated,
  // when they were last collected, when collection was last attempted, and why it failed.
  assert.deepEqual(failed.data, { roads: 701, incidents: 41, stations: 203 });
  assert.equal(failed.dataTime, "2026-09-03T10:35:00.000Z");
  assert.equal(failed.lastSuccessAt, "2026-09-03T11:00:00.000Z");
  assert.equal(failed.lastAttemptAt, "2026-09-03T13:00:00.000Z");
  assert.equal(failed.errorType, "WORKFLOW_NOT_RUN");
  assert.notEqual(failed.lastSuccessAt, failed.lastAttemptAt, "the card must be able to mark the data as carried over");
});

test("17. the browser reload path reads the snapshot file, not a monitor endpoint", async () => {
  const dashboard = await readProjectFile("src/components/Dashboard.tsx");
  assert.match(dashboard, /getSnapshotUrl/);
  assert.equal(dashboard.includes("/api/health"), false);
  assert.equal(SNAPSHOT_PUBLIC_PATH, "/data/latest-health.json");
  // The button says what it does.
  assert.match(dashboard, /Reload latest snapshot/);
});

test("the snapshot the dashboard reads is the one the script writes", () => {
  assert.equal(SNAPSHOT_RELATIVE_PATH, `public${SNAPSHOT_PUBLIC_PATH}`);
});

test("pipelines and sources are both reachable by id for the card grid", () => {
  const snapshot = buildSnapshot(
    undefined,
    [source(), source({ id: "ircaPipeline", name: "IRCA Road Publisher" })],
    new Date(GENERATED_AT),
  );
  assert.equal(snapshotEntry(snapshot, "irca")?.name, "IRCA Roads");
  assert.equal(snapshotEntry(snapshot, "ircaPipeline")?.name, "IRCA Road Publisher");
  assert.equal(snapshotEntry(snapshot, "nope"), undefined);
});
