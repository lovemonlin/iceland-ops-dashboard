import assert from "node:assert/strict";
import test from "node:test";
import { getMockMonitors, MOCK_BASELINE_CHECKED_AT } from "../src/monitors/mockMonitors";

const monitors = getMockMonitors();
const byId = (id: string) => monitors.find((monitor) => monitor.id === id)!;

test("ECMWF is no longer a mock; it is a live production monitor", () => {
  assert.equal(
    monitors.find((monitor) => monitor.id === "ecmwf"),
    undefined,
  );
});

test("IRCA mock is ERROR on zero records despite HTTP 200", () => {
  const irca = byId("irca");
  assert.equal(irca.status, "error");
  assert.equal(irca.errorType, "EMPTY_DATA");
  assert.equal(irca.httpStatus, 200);
});

test("MET mock represents all locations succeeding", () => {
  assert.equal(byId("metno").status, "ok");
});

test("NOAA mocks cover schema change and partial failure", () => {
  assert.equal(byId("noaaKp").status, "error");
  assert.equal(byId("noaaKp").errorType, "SCHEMA_ERROR");
  assert.equal(byId("ovation").status, "degraded");
  assert.equal(byId("solarWind").status, "ok");
});

test("IMO mock treats zero active warnings as INFO, not a failure", () => {
  const imo = byId("imo");
  assert.equal(imo.status, "info");
  assert.equal(imo.recordCount, 0);
  assert.equal(imo.errorType, undefined);
  assert.ok(imo.note);
});

test("the mock set still covers ok, info, degraded and error", () => {
  assert.deepEqual(new Set(monitors.map((monitor) => monitor.status)), new Set(["ok", "info", "degraded", "error"]));
});

test("mock timestamps follow the supplied check time", () => {
  const later = "2026-09-04T00:00:00.000Z";
  const shifted = getMockMonitors(later);
  assert.equal(shifted[0].checkedAt, later);
  assert.notEqual(shifted[0].dataTime, byId("metno").dataTime);
  assert.equal(monitors[0].checkedAt, MOCK_BASELINE_CHECKED_AT);
});

test("statuses stay stable across check times, so freshness is data-driven", () => {
  const shifted = getMockMonitors("2027-01-01T00:00:00.000Z");
  assert.deepEqual(
    shifted.map((monitor) => monitor.status),
    monitors.map((monitor) => monitor.status),
  );
});
