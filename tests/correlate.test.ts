import assert from "node:assert/strict";
import test from "node:test";
import { buildIncidents, dataAgeMinutes } from "../src/monitors/correlate";
import type { DashboardSnapshot, SnapshotSource } from "../src/snapshot/types";

const GENERATED_AT = "2026-09-03T13:00:00.000Z";
const NOW = new Date(GENERATED_AT);

function entry(overrides: Partial<SnapshotSource> & Pick<SnapshotSource, "id" | "name" | "status">): SnapshotSource {
  return { lastAttemptAt: GENERATED_AT, ...overrides };
}

/** IRCA output whose stored data was generated 126 minutes ago. */
const staleOutput = entry({
  id: "irca",
  name: "IRCA Roads",
  status: "error",
  errorType: "STALE_DATA",
  errorMessage: "The last successful publish was 126 min ago.",
  dataTime: "2026-09-03T10:54:00.000Z",
  lastSuccessAt: GENERATED_AT,
  data: { roads: 701 },
});

const healthyOutput = entry({
  id: "irca",
  name: "IRCA Roads",
  status: "ok",
  dataTime: "2026-09-03T12:50:00.000Z",
  lastSuccessAt: GENERATED_AT,
  data: { roads: 701 },
});

function pipeline(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return entry({
    id: "ircaPipeline",
    name: "IRCA Road Publisher",
    status: "ok",
    lastSuccessAt: GENERATED_AT,
    data: { consecutiveFailures: 0, latestRun: "#858" },
    ...overrides,
  });
}

const ecmwfPair: SnapshotSource[] = [
  entry({ id: "ecmwf", name: "ECMWF Cloud Forecast", status: "ok", data: {} }),
  entry({ id: "ecmwfPipeline", name: "ECMWF Cloud Publisher", status: "ok", data: {} }),
];

function snapshotOf(entries: SnapshotSource[]): DashboardSnapshot {
  const sources: Record<string, SnapshotSource> = {};
  const pipelines: Record<string, SnapshotSource> = {};
  for (const item of entries) {
    if (item.id.endsWith("Pipeline")) pipelines[item.id] = item;
    else sources[item.id] = item;
  }
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    overallStatus: "error",
    sources,
    pipelines,
    summary: { ok: 0, info: 0, stale: 0, degraded: 0, error: 0 },
  };
}

const summaryFor = (entries: SnapshotSource[], key: string) =>
  buildIncidents(snapshotOf(entries), NOW).find((incident) => incident.key === key)?.summary ?? "";

test("20. a stale output plus failed workflow runs becomes one correlated incident", () => {
  const entries = [
    staleOutput,
    pipeline({
      status: "error",
      errorType: "WORKFLOW_FAILED",
      errorMessage: "Run #214 finished with conclusion failure.",
      data: {
        consecutiveFailures: 4,
        failedJob: "publish",
        failedStep: "Download IRCA DATEX and generate app data",
      },
    }),
    ...ecmwfPair,
  ];

  const incidents = buildIncidents(snapshotOf(entries), NOW);
  // One entry for IRCA, not two.
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].key, "irca");
  assert.equal(incidents[0].status, "error");
  assert.equal(incidents[0].entries.length, 2);

  const summary = incidents[0].summary;
  assert.match(summary, /has not updated for 126 min/);
  assert.match(summary, /4 consecutive workflow failures/);
  assert.match(summary, /Download IRCA DATEX and generate app data/);
  assert.doesNotMatch(summary, /service is down/i);
});

test("21. a stale output with a later successful run reports a publish inconsistency", () => {
  const summary = summaryFor(
    [staleOutput, pipeline({ dataTime: "2026-09-03T12:30:00.000Z" }), ...ecmwfPair],
    "irca",
  );
  assert.match(summary, /completed successfully after that publish/);
  assert.match(summary, /timestamp did not advance/);
  assert.match(summary, /no-change publish logic/);
});

test("22. a stale output with no recent run reports a missing scheduled trigger", () => {
  const summary = summaryFor(
    [
      staleOutput,
      pipeline({
        status: "stale",
        errorType: "WORKFLOW_NOT_RUN",
        errorMessage: "No recent scheduled workflow run was observed.",
        dataTime: "2026-09-03T00:34:54.000Z",
        data: { consecutiveFailures: 0, lastRun: "2026-09-03 00:34 UTC" },
      }),
      ...ecmwfPair,
    ],
    "irca",
  );

  assert.match(summary, /No recent scheduled workflow run was observed/);
  assert.match(summary, /newest run is from 2026-09-03 00:34 UTC/);
  assert.match(summary, /did not fail — it did not run/);
  assert.doesNotMatch(summary, /consecutive workflow failures/);
});

test("an unverifiable workflow never becomes a claim that the workflow failed", () => {
  // No collected data from the pipeline check means GitHub itself could not be read.
  const summary = summaryFor(
    [
      staleOutput,
      pipeline({
        status: "error",
        errorType: "HTTP_ERROR",
        errorMessage: "GitHub Actions status unavailable — HTTP 403.",
        data: undefined,
        lastSuccessAt: undefined,
      }),
      ...ecmwfPair,
    ],
    "irca",
  );

  assert.match(summary, /could not be verified/);
  assert.match(summary, /the pipeline may be fine/);
  assert.doesNotMatch(summary, /consecutive workflow failures/);
});

test("a disabled publishing workflow is called out as such", () => {
  const summary = summaryFor(
    [
      staleOutput,
      pipeline({ status: "error", errorType: "WORKFLOW_DISABLED", errorMessage: "GitHub reports it as disabled." }),
      ...ecmwfPair,
    ],
    "irca",
  );
  assert.match(summary, /disabled, so no schedule can fire/);
});

test("a healthy output with a failing pipeline is still surfaced", () => {
  const incident = buildIncidents(
    snapshotOf([
      healthyOutput,
      pipeline({ status: "error", errorType: "WORKFLOW_FAILED", errorMessage: "Run #214 failed." }),
      ...ecmwfPair,
    ]),
    NOW,
  ).find((entry) => entry.key === "irca");

  assert.equal(incident?.status, "error");
  assert.match(String(incident?.summary), /output is healthy, but its publishing pipeline is not/);
});

test("a healthy source produces no incident at all", () => {
  assert.deepEqual(buildIncidents(snapshotOf([healthyOutput, pipeline(), ...ecmwfPair]), NOW), []);
});

test("entries outside a family keep their own incident, sorted most severe first", () => {
  const incidents = buildIncidents(
    snapshotOf([
      healthyOutput,
      pipeline(),
      ...ecmwfPair,
      entry({ id: "ovation", name: "NOAA OVATION", status: "degraded", errorMessage: "3 regions unavailable." }),
      entry({ id: "noaaKp", name: "NOAA Kp", status: "error", errorMessage: "Kp field missing." }),
    ]),
    NOW,
  );

  assert.deepEqual(
    incidents.map((incident) => incident.key),
    ["noaaKp", "ovation"],
  );
  assert.equal(incidents[0].summary, "Kp field missing.");
});

test("data age is measured from the data's own timestamp, not the collection time", () => {
  assert.equal(dataAgeMinutes(staleOutput, NOW), 126);
  assert.equal(dataAgeMinutes(entry({ id: "x", name: "X", status: "ok" }), NOW), undefined);
  assert.equal(dataAgeMinutes(entry({ id: "x", name: "X", status: "ok", dataTime: "nonsense" }), NOW), undefined);
});
