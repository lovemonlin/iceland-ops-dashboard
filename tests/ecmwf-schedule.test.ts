import assert from "node:assert/strict";
import test from "node:test";
import {
  currentCycleStart,
  expectedModelRun,
  formatDeadlineClock,
  formatModelRun,
  isModelCycle,
  nextCycle,
  publicationDeadline,
} from "../src/monitors/ecmwf/schedule";

const at = (iso: string) => new Date(iso);

test("only 00/06/12/18 UTC on the hour count as a model cycle", () => {
  assert.equal(isModelCycle(at("2026-09-03T00:00:00Z")), true);
  assert.equal(isModelCycle(at("2026-09-03T18:00:00Z")), true);
  assert.equal(isModelCycle(at("2026-09-03T01:00:00Z")), false);
  assert.equal(isModelCycle(at("2026-09-03T12:30:00Z")), false);
});

test("publication deadlines follow the agreed production schedule", () => {
  assert.equal(publicationDeadline(at("2026-09-03T00:00:00Z")).toISOString(), "2026-09-03T09:45:00.000Z");
  assert.equal(publicationDeadline(at("2026-09-03T06:00:00Z")).toISOString(), "2026-09-03T15:45:00.000Z");
  assert.equal(publicationDeadline(at("2026-09-03T12:00:00Z")).toISOString(), "2026-09-03T21:45:00.000Z");
  assert.equal(publicationDeadline(at("2026-09-03T18:00:00Z")).toISOString(), "2026-09-04T03:45:00.000Z");
});

test("the 18Z deadline rolls into the next UTC month and year correctly", () => {
  assert.equal(publicationDeadline(at("2026-09-30T18:00:00Z")).toISOString(), "2026-10-01T03:45:00.000Z");
  assert.equal(publicationDeadline(at("2026-12-31T18:00:00Z")).toISOString(), "2027-01-01T03:45:00.000Z");
});

test("current cycle start floors to the nearest 6 h UTC boundary", () => {
  assert.equal(currentCycleStart(at("2026-09-03T05:59:59Z")).toISOString(), "2026-09-03T00:00:00.000Z");
  assert.equal(currentCycleStart(at("2026-09-03T06:00:00Z")).toISOString(), "2026-09-03T06:00:00.000Z");
  assert.equal(nextCycle(at("2026-09-03T18:00:00Z")).toISOString(), "2026-09-04T00:00:00.000Z");
});

test("a run that is not due yet is not expected yet", () => {
  // 09:30 UTC: the 00Z run is due at 09:45, so the previous 18Z is still the expected run.
  assert.equal(expectedModelRun(at("2026-09-03T09:30:00Z")).toISOString(), "2026-09-02T18:00:00.000Z");
  // 09:45 UTC exactly: the deadline has arrived, so 00Z is now expected.
  assert.equal(expectedModelRun(at("2026-09-03T09:45:00Z")).toISOString(), "2026-09-03T00:00:00.000Z");
  assert.equal(expectedModelRun(at("2026-09-03T10:00:00Z")).toISOString(), "2026-09-03T00:00:00.000Z");
});

test("expected run crosses the UTC day boundary for the 18Z cycle", () => {
  // Just before the 18Z deadline of 03:45 the expected run is still the previous day's 12Z.
  assert.equal(expectedModelRun(at("2026-09-03T03:00:00Z")).toISOString(), "2026-09-02T12:00:00.000Z");
  assert.equal(expectedModelRun(at("2026-09-03T03:44:59Z")).toISOString(), "2026-09-02T12:00:00.000Z");
  // From 03:45 the previous day's 18Z is due.
  assert.equal(expectedModelRun(at("2026-09-03T03:45:00Z")).toISOString(), "2026-09-02T18:00:00.000Z");
  assert.equal(expectedModelRun(at("2026-09-03T04:00:00Z")).toISOString(), "2026-09-02T18:00:00.000Z");
  // Midnight UTC, before any of the new day's deadlines.
  assert.equal(expectedModelRun(at("2026-09-03T00:00:00Z")).toISOString(), "2026-09-02T12:00:00.000Z");
});

test("model runs and deadlines format the way maintainers talk about them", () => {
  assert.equal(formatModelRun(at("2026-09-02T12:00:00Z")), "2026-09-02 12Z");
  assert.equal(formatModelRun(at("2026-09-03T00:00:00Z")), "2026-09-03 00Z");
  assert.equal(formatDeadlineClock(at("2026-09-03T09:45:00Z")), "09:45 UTC");
});
