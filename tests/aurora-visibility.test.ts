import assert from "node:assert/strict";
import test from "node:test";
import { WEATHER_SITES } from "../src/config/sources";
import { encodeSiteForecast } from "../src/lib/forecastCodec";
import { encodeOvationGrid } from "../src/lib/ovationGrid";
import {
  assessAuroraVisibility,
  buildAuroraForecast48,
  correctedGeomagneticLatitude,
  darknessFactor,
  kpAt,
  latitudeAdvantage,
  levelOf,
  moonElevation,
  moonIllumination,
  moonInterference,
  sunElevation,
  type AuroraAssessment,
  type AuroraForecastSite,
} from "../src/lib/auroraVisibility";
import type { WeatherHour } from "../src/lib/weatherMap";
import type { DashboardSnapshot, KpForecastPoint, SnapshotSource } from "../src/snapshot/types";

const reykjavik = WEATHER_SITES.find((site) => site.id === "reykjavik")!;
const thingvellir = WEATHER_SITES.find((site) => site.id === "thingvellir")!;

function weather(time: string, low: number, mid = 0, high = 0): WeatherHour {
  return {
    time,
    cloudTotalPercent: low,
    cloudLowPercent: low,
    cloudMediumPercent: mid,
    cloudHighPercent: high,
  };
}

function close(actual: number, expected: number, field: string) {
  assert.equal(Math.abs(actual - expected) < 1e-12, true, `${field}: ${actual} != ${expected}`);
}

/**
 * Values printed by the Android app's already-compiled AuroraVisibility class for these exact
 * inputs. This is a cross-language fixture, not a second implementation of the expected values.
 */
const androidCases: {
  name: string;
  site: AuroraForecastSite;
  time: string;
  clouds: [number, number, number];
  kp: number;
  ovationProbability?: number;
  bzGsm?: number;
  expected: Omit<AuroraAssessment, "time" | "kp" | "levelLabel" | "color">;
}[] = [
  {
    name: "Reykjavík current conditions use OVATION and southward Bz",
    site: reykjavik,
    time: "2026-12-21T23:00:00Z",
    clouds: [10, 20, 30],
    kp: 2,
    ovationProbability: 20,
    bzGsm: -15,
    expected: {
      score: 12,
      level: "POOR",
      limitingFactor: "SOLAR_ACTIVITY",
      auroraStrength: 45,
      cloudFactor: 0.69273,
      darknessFactor: 1,
      moonFactor: 0.629910899060951,
      siteFactor: 0.6,
      effectiveObstruction: 30.726999999999993,
      sunElevation: -42.80173104708966,
      moonInterference: 0.740178201878098,
    },
  },
  {
    name: "Þingvellir future conditions use Kp without current-space-weather bonuses",
    site: thingvellir,
    time: "2026-12-22T02:00:00Z",
    clouds: [50, 50, 50],
    kp: 4,
    expected: {
      score: 8,
      level: "POOR",
      limitingFactor: "CLOUD",
      auroraStrength: 44.44444444444444,
      cloudFactor: 0.268125,
      darknessFactor: 1,
      moonFactor: 0.6686932105943,
      siteFactor: 1,
      effectiveObstruction: 73.1875,
      sunElevation: -48.72370864815397,
      moonInterference: 0.662613578811401,
    },
  },
  {
    name: "Reykjavík autumn moon below horizon",
    site: reykjavik,
    time: "2026-09-10T00:00:00Z",
    clouds: [0, 0, 100],
    kp: 1.5,
    expected: {
      score: 6,
      level: "POOR",
      limitingFactor: "SOLAR_ACTIVITY",
      auroraStrength: 16.666666666666664,
      cloudFactor: 0.65,
      darknessFactor: 1,
      moonFactor: 1,
      siteFactor: 0.6,
      effectiveObstruction: 35,
      sunElevation: -19.04594730780812,
      moonInterference: 0,
    },
  },
  {
    name: "Reykjavík summer daylight forces zero",
    site: reykjavik,
    time: "2026-06-21T13:28:00Z",
    clouds: [0, 0, 0],
    kp: 9,
    ovationProbability: 100,
    bzGsm: -15,
    expected: {
      score: 0,
      level: "NONE",
      limitingFactor: "NOT_DARK_ENOUGH",
      auroraStrength: 100,
      cloudFactor: 1,
      darknessFactor: 0,
      moonFactor: 0.98959207308447,
      siteFactor: 0.6,
      effectiveObstruction: 0,
      sunElevation: 49.28751238575371,
      moonInterference: 0.02081585383106,
    },
  },
];

test("Android and TypeScript assessments match at representative times and sites", () => {
  for (const fixture of androidCases) {
    const actual = assessAuroraVisibility({
      time: new Date(fixture.time),
      site: fixture.site,
      weather: weather(fixture.time, ...fixture.clouds),
      kp: fixture.kp,
      ovationProbability: fixture.ovationProbability,
      bzGsm: fixture.bzGsm,
    });
    assert.equal(actual.score, fixture.expected.score, fixture.name);
    assert.equal(actual.level, fixture.expected.level, fixture.name);
    assert.equal(actual.limitingFactor, fixture.expected.limitingFactor, fixture.name);
    for (const field of [
      "auroraStrength",
      "cloudFactor",
      "darknessFactor",
      "moonFactor",
      "siteFactor",
      "effectiveObstruction",
      "sunElevation",
      "moonInterference",
    ] as const) {
      close(actual[field], fixture.expected[field], `${fixture.name} ${field}`);
    }
  }
});

test("Astronomy and Geomagnetic ports retain the Android reference boundaries", () => {
  close(sunElevation(new Date("2026-06-21T13:28:00Z"), reykjavik.lat, reykjavik.lon), 49.28751238575371, "summer sun");
  assert.equal(moonIllumination(new Date("2026-01-18T19:52:00Z")) < 0.1, true);
  assert.equal(moonIllumination(new Date("2026-02-01T22:09:00Z")) > 0.9, true);
  for (let hour = 0; hour < 24; hour += 1) {
    const time = new Date(Date.parse("2026-02-01T00:00:00Z") + hour * 3_600_000);
    if (moonElevation(time, reykjavik.lat, reykjavik.lon) <= 0) {
      assert.equal(moonInterference(time, reykjavik.lat, reykjavik.lon), 0);
    }
  }
  const geomagnetic = correctedGeomagneticLatitude(reykjavik.lat, reykjavik.lon);
  assert.equal(geomagnetic > 63 && geomagnetic < 66, true);
  assert.equal(latitudeAdvantage(reykjavik.lat, reykjavik.lon, 0) > 0.4, true);
  assert.equal(latitudeAdvantage(reykjavik.lat, reykjavik.lon, 3), 1);
});

test("darkness, level labels and colors use the app's exact thresholds", () => {
  assert.deepEqual([-6, -9, -12, -15, -18, -19].map(darknessFactor), [0, 0.3, 0.6, 0.8, 1, 1]);
  assert.deepEqual([4.999, 5, 19.999, 20, 39.999, 40, 64.999, 65].map(levelOf), [
    { level: "NONE", levelLabel: "看不到", color: "#64748B" },
    { level: "POOR", levelLabel: "不佳", color: "#FB923C" },
    { level: "POOR", levelLabel: "不佳", color: "#FB923C" },
    { level: "FAIR", levelLabel: "普通", color: "#FDE047" },
    { level: "FAIR", levelLabel: "普通", color: "#FDE047" },
    { level: "GOOD", levelLabel: "良好", color: "#86EFAC" },
    { level: "GOOD", levelLabel: "良好", color: "#86EFAC" },
    { level: "EXCELLENT", levelLabel: "極佳", color: "#4ADE80" },
  ]);
});

test("Kp intervals start at time_tag, last three hours, and fall back across gaps", () => {
  const points: KpForecastPoint[] = [
    { time: "2026-01-01T18:00:00Z", kp: 2, status: "predicted", noaaScale: null },
    { time: "2026-01-01T21:00:00Z", kp: 5, status: "predicted", noaaScale: null },
  ];
  assert.equal(kpAt(points, new Date("2026-01-01T17:59:59Z"), 1.5), 1.5);
  assert.equal(kpAt(points, new Date("2026-01-01T20:59:59Z"), 1.5), 2);
  assert.equal(kpAt(points, new Date("2026-01-01T21:00:00Z"), 1.5), 5);
  assert.equal(kpAt(points.slice(0, 1), new Date("2026-01-01T21:00:00Z"), 1.5), 1.5);
});

function source(id: string, data: Record<string, unknown>): SnapshotSource {
  return {
    id,
    name: id,
    status: "ok",
    lastAttemptAt: "2026-12-21T23:00:00.000Z",
    lastSuccessAt: "2026-12-21T23:00:00.000Z",
    data,
  };
}

function forecastSnapshot(): DashboardSnapshot {
  const base = Date.parse("2026-12-21T23:00:00Z");
  const hours = Array.from({ length: 48 }, (_, offset) =>
    weather(new Date(base + offset * 3_600_000).toISOString(), offset === 47 ? 100 : 10, 20, 30),
  );
  const times = hours.map((hour) => hour.time);
  return {
    schemaVersion: 2,
    generatedAt: "2026-12-21T23:00:00.000Z",
    overallStatus: "ok",
    summary: { ok: 5, info: 0, stale: 0, degraded: 0, error: 0 },
    sources: {
      noaaKp: source("noaaKp", { kp: 1.5 }),
      noaaKpForecast: source("noaaKpForecast", {
        points: [
          { time: "2026-12-21T21:00:00.000Z", kp: 2, status: "estimated", noaaScale: null },
          { time: "2026-12-22T00:00:00.000Z", kp: 4, status: "predicted", noaaScale: null },
        ],
      }),
      solarWind: source("solarWind", { bzNt: -15, btNt: 12, speedKms: 500 }),
      ovation: source("ovation", { grid: encodeOvationGrid([[-22, 64, 20]]) }),
      metno: source("metno", {
        forecastTimes: times,
        sites: [{
          id: reykjavik.id,
          lat: reykjavik.lat,
          lon: reykjavik.lon,
          lightPollution: reykjavik.lightPollution,
          forecast: encodeSiteForecast(hours, times),
        }],
      }),
    },
  };
}

test("the snapshot-only builder returns all 48 hours with current-only OVATION/Bz and future Kp fallback", () => {
  const result = buildAuroraForecast48(forecastSnapshot(), reykjavik);
  assert.equal(result.length, 48);
  assert.equal(result[0].time, "2026-12-21T23:00:00.000Z");
  assert.equal(result[47].time, "2026-12-23T22:00:00.000Z");

  assert.equal(result[0].kp, 2);
  assert.equal(result[0].auroraStrength, 45, "offset zero: OVATION 20 + Bz bonus 25");
  assert.equal(result[1].kp, 4);
  close(result[1].auroraStrength, 4 / 9 * 100, "offset one uses Kp only");
  assert.equal(result[4].kp, 1.5, "the expired 00Z interval falls back to current Kp");
  close(result[4].auroraStrength, 1.5 / 9 * 100, "fallback Kp has no Bz bonus");

  close(result[0].cloudFactor, 0.69273, "layered cloud transmission");
  assert.equal(result[47].cloudFactor, 0, "the 48th stored weather hour is still calculated");
});

test("missing optional raw inputs still produces 48 honest fallback assessments", () => {
  const snapshot = forecastSnapshot();
  delete snapshot.sources.noaaKpForecast;
  delete snapshot.sources.ovation;
  delete snapshot.sources.solarWind;
  delete snapshot.sources.metno;
  const result = buildAuroraForecast48(snapshot, reykjavik, snapshot.generatedAt);
  assert.equal(result.length, 48);
  assert.equal(result.every((point) => point.kp === 1.5), true);
  assert.equal(result.every((point) => point.effectiveObstruction === 50), true);
});
