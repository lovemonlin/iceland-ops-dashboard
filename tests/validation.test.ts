import assert from "node:assert/strict";
import test from "node:test";
import { validateIrca, validateMet, validateNoaa } from "../src/monitors/validation";

test("IRCA accepts non-empty data and rejects zero or invalid data", () => {
  assert.equal(validateIrca([{}]), "OK");
  assert.equal(validateIrca([]), "EMPTY_DATA");
  assert.equal(validateIrca({}), "EMPTY_DATA");
});

test("MET distinguishes all, partial, and total failures", () => {
  assert.equal(validateMet(4, 4), "OK");
  assert.equal(validateMet(3, 4), "DEGRADED");
  assert.equal(validateMet(0, 4), "ERROR");
});

test("NOAA requires numeric data and a timestamp", () => {
  assert.equal(validateNoaa(3.5, "2026-09-03T00:00:00Z"), "OK");
  assert.equal(validateNoaa("3.5", "2026-09-03T00:00:00Z"), "SCHEMA_ERROR");
  assert.equal(validateNoaa(3.5, undefined), "SCHEMA_ERROR");
});
