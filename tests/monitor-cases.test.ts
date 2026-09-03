import assert from "node:assert/strict";
import test from "node:test";
import { mockMonitors } from "../src/monitors/mockMonitors";
const byId = (id: string) => mockMonitors.find((monitor) => monitor.id === id)!;
test("ECMWF mock covers stale and frames", () => { assert.equal(byId("ecmwf").errorType, "STALE_DATA"); assert.equal(byId("ecmwf").details?.frameCount, 17); });
test("IRCA mock covers zero records", () => assert.equal(byId("irca").errorType, "EMPTY_DATA"));
test("MET mock represents all locations succeeding", () => assert.equal(byId("metno").status, "ok"));
test("NOAA mock covers schema change and partial failure", () => { assert.equal(byId("noaa-kp").errorType, "SCHEMA_ERROR"); assert.equal(byId("ovation").status, "degraded"); });
test("all five display statuses are represented", () => assert.deepEqual(new Set(mockMonitors.map((monitor) => monitor.status)), new Set(["ok", "info", "stale", "degraded", "error"])));
