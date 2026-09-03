import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHealth, getSystemStatus } from "../src/health/evaluate";

const base = {
  id: "test",
  name: "Test",
  checkedAt: "2026-09-03T00:00:00Z",
  networkOk: true,
  parseOk: true,
  schemaOk: true,
  httpStatus: 200,
  recordCount: 1,
};

test("fresh data is OK", () => {
  assert.equal(evaluateHealth({ ...base, ageSeconds: 10, staleAfter: 60 }).status, "ok");
});

test("old data is STALE", () => {
  assert.equal(evaluateHealth({ ...base, ageSeconds: 61, staleAfter: 60 }).status, "stale");
});

test("network failure is NETWORK_ERROR", () => {
  assert.equal(evaluateHealth({ ...base, networkOk: false }).errorType, "NETWORK_ERROR");
});

test("missing or failed HTTP status is HTTP_ERROR", () => {
  assert.equal(evaluateHealth({ ...base, httpStatus: undefined }).errorType, "HTTP_ERROR");
  assert.equal(evaluateHealth({ ...base, httpStatus: 503 }).errorType, "HTTP_ERROR");
});

test("partial failure is DEGRADED", () => {
  assert.equal(evaluateHealth({ ...base, partialFailure: true }).status, "degraded");
});

test("zero records is ERROR", () => {
  assert.equal(evaluateHealth({ ...base, recordCount: 0 }).errorType, "EMPTY_DATA");
});

test("parse error is ERROR", () => {
  assert.equal(evaluateHealth({ ...base, parseOk: false }).errorType, "PARSE_ERROR");
});

test("system status prioritises error, degraded, stale, then ok", () => {
  assert.equal(getSystemStatus([{ status: "info" }]), "ok");
  assert.equal(getSystemStatus([{ status: "stale" }, { status: "info" }]), "stale");
  assert.equal(getSystemStatus([{ status: "stale" }, { status: "degraded" }]), "degraded");
  assert.equal(getSystemStatus([{ status: "error" }, { status: "degraded" }]), "error");
});

test("healthy source with a note is INFO, and INFO never breaks the system status", () => {
  const result = evaluateHealth({ ...base, recordCount: 0, allowEmpty: true, infoNote: "Zero active warnings." });
  assert.equal(result.status, "info");
  assert.equal(result.errorType, undefined);
  assert.equal(result.note, "Zero active warnings.");
  assert.equal(getSystemStatus([{ status: "info" }, { status: "ok" }]), "ok");
});

test("allowEmpty keeps a legitimately empty dataset out of EMPTY_DATA", () => {
  assert.equal(evaluateHealth({ ...base, recordCount: 0, allowEmpty: true }).status, "ok");
});

test("stale wins over an info note", () => {
  assert.equal(evaluateHealth({ ...base, ageSeconds: 120, staleAfter: 60, infoNote: "note" }).status, "stale");
});

test("degraded is reported even when data is fresh", () => {
  assert.equal(evaluateHealth({ ...base, ageSeconds: 1, staleAfter: 60, partialFailure: true }).status, "degraded");
});
