import assert from "node:assert/strict";
import test from "node:test";
import { validateEcmwf, validateIrca, validateMet, validateNoaa } from "../src/monitors/validation";
test("ECMWF accepts valid manifest", () => assert.equal(validateEcmwf({ modelRun:"2026-09-03T00:00:00Z", frames:["one.png"] }), "OK"));
test("ECMWF rejects malformed, missing, and empty frames", () => { assert.equal(validateEcmwf(null), "PARSE_ERROR"); assert.equal(validateEcmwf({ modelRun:"2026-09-03T00:00:00Z", frames:["", "two.png"] }), "SCHEMA_ERROR"); assert.equal(validateEcmwf({ modelRun:"2026-09-03T00:00:00Z", frames:[] }), "EMPTY_DATA"); });
test("ECMWF detects stale manifests when a threshold is supplied", () => assert.equal(validateEcmwf({ modelRun:"2026-09-03T00:00:00Z", frames:["one.png"] }, Date.parse("2026-09-03T02:00:01Z"), 7200), "STALE_DATA"));
test("IRCA accepts non-empty data and rejects zero or invalid data", () => { assert.equal(validateIrca([{}]), "OK"); assert.equal(validateIrca([]), "EMPTY_DATA"); assert.equal(validateIrca({}), "EMPTY_DATA"); });
test("MET distinguishes all, partial, and total failures", () => { assert.equal(validateMet(4, 4), "OK"); assert.equal(validateMet(3, 4), "DEGRADED"); assert.equal(validateMet(0, 4), "ERROR"); });
test("NOAA requires numeric data and a timestamp", () => { assert.equal(validateNoaa(3.5, "2026-09-03T00:00:00Z"), "OK"); assert.equal(validateNoaa("3.5", "2026-09-03T00:00:00Z"), "SCHEMA_ERROR"); assert.equal(validateNoaa(3.5, undefined), "SCHEMA_ERROR"); });
