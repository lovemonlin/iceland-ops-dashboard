import assert from "node:assert/strict";
import test from "node:test";
import type { MonitorHealth } from "../src/health/model";
import { buildIncidents } from "../src/monitors/correlate";

const CHECKED_AT = "2026-09-03T02:45:00.000Z";

function monitor(overrides: Partial<MonitorHealth> & Pick<MonitorHealth, "id" | "name" | "status">): MonitorHealth {
  return { checkedAt: CHECKED_AT, networkOk: true, parseOk: true, ...overrides };
}

/** IRCA output that has not advanced for 126 minutes. */
const staleOutput = monitor({
  id: "irca",
  name: "IRCA Roads",
  status: "error",
  errorType: "STALE_DATA",
  errorMessage: "The last successful publish was 126 min ago.",
  dataTime: "2026-09-03T00:35:31.000Z",
  ageSeconds: 126 * 60,
});

const healthyOutput = monitor({
  id: "irca",
  name: "IRCA Roads",
  status: "ok",
  dataTime: "2026-09-03T02:35:00.000Z",
  ageSeconds: 10 * 60,
});

function pipeline(overrides: Partial<MonitorHealth>): MonitorHealth {
  return monitor({
    id: "ircaPipeline",
    name: "IRCA Road Publisher",
    status: "ok",
    details: { _workflowStatusKnown: true },
    ...overrides,
  });
}

const ecmwfPair = [
  monitor({ id: "ecmwf", name: "ECMWF Cloud Forecast", status: "ok" }),
  monitor({ id: "ecmwfPipeline", name: "ECMWF Cloud Publisher", status: "ok", details: { _workflowStatusKnown: true } }),
];

const summaryFor = (monitors: MonitorHealth[], key: string) =>
  buildIncidents(monitors).find((incident) => incident.key === key)?.summary ?? "";

test("20. a stale output plus failed workflow runs becomes one correlated incident", () => {
  const monitors = [
    staleOutput,
    pipeline({
      status: "error",
      errorType: "WORKFLOW_FAILED",
      errorMessage: "Run #214 finished with conclusion failure.",
      details: {
        _workflowStatusKnown: true,
        consecutiveFailures: 4,
        failedJob: "publish",
        failedStep: "Download IRCA DATEX and generate app data",
      },
    }),
    ...ecmwfPair,
  ];

  const incidents = buildIncidents(monitors);
  // One entry for IRCA, not two.
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].key, "irca");
  assert.equal(incidents[0].status, "error");
  assert.equal(incidents[0].monitors.length, 2);

  const summary = incidents[0].summary;
  assert.match(summary, /has not updated for 126 min/);
  assert.match(summary, /4 consecutive workflow failures/);
  assert.match(summary, /Download IRCA DATEX and generate app data/);
  assert.doesNotMatch(summary, /service is down/i);
});

test("21. a stale output with a later successful run reports a publish inconsistency", () => {
  const monitors = [
    staleOutput,
    pipeline({ status: "ok", dataTime: "2026-09-03T02:30:00.000Z" }),
    ...ecmwfPair,
  ];

  const summary = summaryFor(monitors, "irca");
  assert.match(summary, /completed successfully after that publish/);
  assert.match(summary, /timestamp did not advance/);
  assert.match(summary, /no-change publish logic/);
});

test("22. a stale output with no recent run reports a missing scheduled trigger", () => {
  const monitors = [
    staleOutput,
    pipeline({
      status: "stale",
      errorType: "WORKFLOW_NOT_RUN",
      errorMessage: "No recent scheduled workflow run was observed.",
      dataTime: "2026-09-03T00:34:54.000Z",
      details: { _workflowStatusKnown: true, consecutiveFailures: 0, lastRun: "2026-09-03 00:34 UTC" },
    }),
    ...ecmwfPair,
  ];

  const summary = summaryFor(monitors, "irca");
  assert.match(summary, /No recent scheduled workflow run was observed/);
  assert.match(summary, /newest run is from 2026-09-03 00:34 UTC/);
  assert.match(summary, /did not fail — it did not run/);
  assert.doesNotMatch(summary, /consecutive workflow failures/);
});

test("an unverifiable workflow never becomes a claim that the workflow failed", () => {
  const monitors = [
    staleOutput,
    pipeline({
      status: "error",
      errorType: "HTTP_ERROR",
      errorMessage: "GitHub Actions status unavailable — HTTP 403.",
      details: { _workflowStatusKnown: false },
    }),
    ...ecmwfPair,
  ];

  const summary = summaryFor(monitors, "irca");
  assert.match(summary, /could not be verified/);
  assert.match(summary, /the pipeline may be fine/);
  assert.doesNotMatch(summary, /consecutive workflow failures/);
});

test("a healthy output with a failing pipeline is still surfaced", () => {
  const monitors = [
    healthyOutput,
    pipeline({ status: "error", errorType: "WORKFLOW_FAILED", errorMessage: "Run #214 failed." }),
    ...ecmwfPair,
  ];

  const incident = buildIncidents(monitors).find((entry) => entry.key === "irca");
  assert.equal(incident?.status, "error");
  assert.match(String(incident?.summary), /output is healthy, but its publishing pipeline is not/);
});

test("a healthy source produces no incident at all", () => {
  assert.deepEqual(buildIncidents([healthyOutput, pipeline({}), ...ecmwfPair]), []);
});

test("monitors outside a family keep their own incident, sorted most severe first", () => {
  const monitors = [
    healthyOutput,
    pipeline({}),
    ...ecmwfPair,
    monitor({ id: "ovation", name: "NOAA OVATION", status: "degraded", errorMessage: "3 regions unavailable." }),
    monitor({ id: "noaaKp", name: "NOAA Kp", status: "error", errorMessage: "Kp field missing." }),
  ];

  const incidents = buildIncidents(monitors);
  assert.deepEqual(
    incidents.map((incident) => incident.key),
    ["noaaKp", "ovation"],
  );
  assert.equal(incidents[0].summary, "Kp field missing.");
});
