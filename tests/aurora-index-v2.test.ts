import assert from "node:assert/strict";
import test from "node:test";
import { assessAuroraIndexV2, calculateAuroraIndexV2 } from "../src/lib/auroraIndexV2";
import { effectiveObstruction } from "../src/lib/weatherMap";

const ideal = {
  obstruction: 0,
  darkness: 1,
  moonInterference: 0,
  lightPollution: "DARK" as const,
};

test("perfect dark, clear, moonless conditions follow the V2 Kp curve", () => {
  for (const [kp, expected] of [[1, 37], [2, 51], [3, 61], [4, 69], [5, 77], [6, 83]]) {
    assert.equal(calculateAuroraIndexV2({ ...ideal, kp }).score, expected, `Kp ${kp}`);
  }
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: -1 }).score, 0);
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: 10 }).score, 100);
});

test("cloud caps apply after rounding at both obstruction boundaries", () => {
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: 9, obstruction: 75 }).score, 39);
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: 9, obstruction: 90 }).score, 19);
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: 9, obstruction: 100 }).score, 0);
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: 9, obstruction: 36 }).cloudModifier, 0.8);
});

test("daylight is zero and insufficient darkness is capped at 19", () => {
  const daylight = calculateAuroraIndexV2({ ...ideal, kp: 9, darkness: 0 });
  assert.equal(daylight.score, 0);
  assert.equal(daylight.level, "NONE");
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: 9, darkness: 0.59 }).score, 19);
  assert.equal(calculateAuroraIndexV2({ ...ideal, kp: 9, darkness: 0.6 }).score > 19, true);
});

test("moon interference costs at most 15% and light pollution has strict ordering", () => {
  const moon = calculateAuroraIndexV2({ ...ideal, kp: 9, moonInterference: 2 });
  assert.equal(moon.moonModifier, 0.85);
  assert.equal(moon.score, 85);
  const scores = (["DARK", "MODERATE", "BRIGHT"] as const).map((lightPollution) =>
    calculateAuroraIndexV2({ ...ideal, kp: 9, lightPollution }).score,
  );
  assert.deepEqual(scores, [100, 92, 78]);
});

test("V2 assessment reuses astronomy and effective obstruction without latitude scoring", () => {
  const time = new Date("2026-12-21T23:00:00Z");
  const weather = {
    time: time.toISOString(),
    cloudLowPercent: 10,
    cloudMediumPercent: 20,
    cloudHighPercent: 30,
  };
  const result = assessAuroraIndexV2({
    time,
    site: { id: "reykjavik", lat: 64.1466, lon: -21.9426, lightPollution: "DARK" },
    weather,
    kp: 2,
  });
  assert.equal(result.effectiveObstruction, effectiveObstruction(weather));
  assert.equal(result.darknessFactor, 1);
  assert.equal(result.lightPollutionModifier, 1);
  assert.equal(result.activityPotential, (2 / 9) ** 0.45);
  assert.equal(result.score, 38);
  assert.equal(result.level, "FAIR");
});
