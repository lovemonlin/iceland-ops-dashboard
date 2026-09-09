/**
 * Pure TypeScript port of the Android app's AuroraVisibility, Astronomy, Geomagnetic and
 * KpForecast domain logic. It reads only the already-collected snapshot.
 */
import { decodeSiteForecast } from "@/lib/forecastCodec";
import { decodeOvationGrid } from "@/lib/ovationGrid";
import { effectiveObstruction, hourAt, type WeatherHour } from "@/lib/weatherMap";
import {
  isNoaaKpForecastData,
  type DashboardSnapshot,
  type KpForecastPoint,
} from "@/snapshot/types";

const DEG = Math.PI / 180;
const HOUR_MS = 3_600_000;
const KP_INTERVAL_MS = 3 * HOUR_MS;

export type LightPollution = "DARK" | "MODERATE" | "BRIGHT";
export type AuroraLevel = "NONE" | "POOR" | "FAIR" | "GOOD" | "EXCELLENT";
export type AuroraLimitingFactor =
  | "NOT_DARK_ENOUGH"
  | "CLOUD"
  | "MOON"
  | "SOLAR_ACTIVITY"
  | "LOCATION"
  | "NONE";

export interface AuroraForecastSite {
  id: string;
  lat: number;
  lon: number;
  lightPollution: LightPollution;
}

export interface AuroraAssessment {
  time: string;
  score: number;
  level: AuroraLevel;
  levelLabel: "看不到" | "不佳" | "普通" | "良好" | "極佳";
  color: "#64748B" | "#FB923C" | "#FDE047" | "#86EFAC" | "#4ADE80";
  limitingFactor: AuroraLimitingFactor;
  kp: number;
  auroraStrength: number;
  cloudFactor: number;
  darknessFactor: number;
  moonFactor: number;
  siteFactor: number;
  effectiveObstruction: number;
  sunElevation: number;
  moonInterference: number;
}

interface AssessmentInput {
  time: Date;
  site: AuroraForecastSite;
  weather?: WeatherHour;
  kp: number;
  ovationProbability?: number;
  bzGsm?: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normaliseDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function daysSinceJ2000(time: Date) {
  return time.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545;
}

interface EquatorialCoordinate {
  rightAscensionDeg: number;
  declinationDeg: number;
}

export function sunPosition(time: Date): EquatorialCoordinate {
  const n = daysSinceJ2000(time);
  const meanLongitude = normaliseDegrees(280.46 + 0.9856474 * n);
  const meanAnomaly = normaliseDegrees(357.528 + 0.9856003 * n);
  const eclipticLongitude = normaliseDegrees(
    meanLongitude + 1.915 * Math.sin(meanAnomaly * DEG) + 0.02 * Math.sin(2 * meanAnomaly * DEG),
  );
  const obliquity = 23.439 - 0.0000004 * n;
  const rightAscensionDeg =
    Math.atan2(
      Math.cos(obliquity * DEG) * Math.sin(eclipticLongitude * DEG),
      Math.cos(eclipticLongitude * DEG),
    ) / DEG;
  const declinationDeg = Math.asin(Math.sin(obliquity * DEG) * Math.sin(eclipticLongitude * DEG)) / DEG;
  return { rightAscensionDeg: normaliseDegrees(rightAscensionDeg), declinationDeg };
}

function elevationOf(coordinate: EquatorialCoordinate, time: Date, lat: number, lon: number) {
  const n = daysSinceJ2000(time);
  const gmstHours = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const localSiderealDeg = normaliseDegrees(gmstHours * 15 + lon);
  const hourAngle = normaliseDegrees(localSiderealDeg - coordinate.rightAscensionDeg);
  const sinElevation =
    Math.sin(lat * DEG) * Math.sin(coordinate.declinationDeg * DEG) +
    Math.cos(lat * DEG) * Math.cos(coordinate.declinationDeg * DEG) * Math.cos(hourAngle * DEG);
  return Math.asin(clamp(sinElevation, -1, 1)) / DEG;
}

export function sunElevation(time: Date, lat: number, lon: number) {
  return elevationOf(sunPosition(time), time, lat, lon);
}

export function moonPosition(time: Date): EquatorialCoordinate {
  const d = daysSinceJ2000(time);
  const meanLongitude = normaliseDegrees(218.316 + 13.176396 * d);
  const meanAnomaly = normaliseDegrees(134.963 + 13.064993 * d);
  const argumentOfLatitude = normaliseDegrees(93.272 + 13.22935 * d);
  const eclipticLongitude = normaliseDegrees(meanLongitude + 6.289 * Math.sin(meanAnomaly * DEG));
  const eclipticLatitude = 5.128 * Math.sin(argumentOfLatitude * DEG);
  const obliquity = 23.439 - 0.0000004 * d;
  const lambda = eclipticLongitude * DEG;
  const beta = eclipticLatitude * DEG;
  const epsilon = obliquity * DEG;
  const rightAscensionDeg =
    Math.atan2(
      Math.sin(lambda) * Math.cos(epsilon) - Math.tan(beta) * Math.sin(epsilon),
      Math.cos(lambda),
    ) / DEG;
  const declinationDeg =
    Math.asin(
      Math.sin(beta) * Math.cos(epsilon) +
        Math.cos(beta) * Math.sin(epsilon) * Math.sin(lambda),
    ) / DEG;
  return { rightAscensionDeg: normaliseDegrees(rightAscensionDeg), declinationDeg };
}

export function moonElevation(time: Date, lat: number, lon: number) {
  return elevationOf(moonPosition(time), time, lat, lon);
}

export function moonIllumination(time: Date) {
  const d = daysSinceJ2000(time);
  const sunLongitude = normaliseDegrees(280.46 + 0.9856474 * d);
  const moonLongitude = normaliseDegrees(218.316 + 13.176396 * d);
  const elongation = normaliseDegrees(moonLongitude - sunLongitude);
  return clamp((1 - Math.cos(elongation * DEG)) / 2, 0, 1);
}

export function moonInterference(time: Date, lat: number, lon: number) {
  const elevation = moonElevation(time, lat, lon);
  if (elevation <= 0) return 0;
  const altitudeFactor = Math.sin(Math.min(elevation, 60) * DEG);
  return clamp(moonIllumination(time) * altitudeFactor, 0, 1);
}

export function dipoleGeomagneticLatitude(lat: number, lon: number) {
  const poleLat = 80.7;
  const poleLon = -72.7;
  const sinLatitude =
    Math.sin(lat * DEG) * Math.sin(poleLat * DEG) +
    Math.cos(lat * DEG) * Math.cos(poleLat * DEG) * Math.cos((lon - poleLon) * DEG);
  return Math.asin(clamp(sinLatitude, -1, 1)) / DEG;
}

export function correctedGeomagneticLatitude(lat: number, lon: number) {
  return dipoleGeomagneticLatitude(lat, lon) - 4;
}

export function auroralBoundaryLatitude(kp: number) {
  return 66 - 2 * kp;
}

export function latitudeAdvantage(lat: number, lon: number, kp: number) {
  const geomagneticLatitude = correctedGeomagneticLatitude(lat, lon);
  const boundary = auroralBoundaryLatitude(kp);
  if (geomagneticLatitude >= boundary) return 1;
  if (geomagneticLatitude >= boundary - 5) {
    return 0.4 + (0.6 * (geomagneticLatitude - (boundary - 5))) / 5;
  }
  return Math.max(0, 0.4 * (1 - ((boundary - 5) - geomagneticLatitude) / 10));
}

export function kpAt(points: KpForecastPoint[], time: Date, fallback: number) {
  const target = time.getTime();
  let latest: KpForecastPoint | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const start = Date.parse(point.time);
    if (!Number.isNaN(start) && start <= target && start > latestTime) {
      latest = point;
      latestTime = start;
    }
  }
  return latest && target < latestTime + KP_INTERVAL_MS ? latest.kp : fallback;
}

export function darknessFactor(solarElevation: number) {
  if (solarElevation >= -6) return 0;
  if (solarElevation >= -12) return clamp(((-6 - solarElevation) / 6) * 0.6, 0, 1);
  if (solarElevation >= -18) return clamp(0.6 + ((-12 - solarElevation) / 6) * 0.4, 0, 1);
  return 1;
}

export function auroraStrength(kp: number, ovationProbability?: number, bzGsm?: number) {
  const base =
    ovationProbability === undefined
      ? clamp((kp / 9) * 100, 0, 100)
      : ovationProbability;
  const bonus =
    bzGsm === undefined
      ? 0
      : bzGsm <= -15
        ? 25
        : bzGsm <= -10
          ? 15
          : bzGsm <= -5
            ? 8
            : bzGsm < 0
              ? 3
              : 0;
  return clamp(base + bonus, 0, 100);
}

function siteFactor(site: AuroraForecastSite, kp: number) {
  const lightPollution = site.lightPollution === "DARK" ? 1 : site.lightPollution === "MODERATE" ? 0.85 : 0.6;
  return latitudeAdvantage(site.lat, site.lon, kp) * lightPollution;
}

function limitingFactor(
  dark: number,
  cloud: number,
  moon: number,
  strength: number,
  location: number,
): AuroraLimitingFactor {
  if (dark < 0.15) return "NOT_DARK_ENOUGH";
  const candidates: [AuroraLimitingFactor, number][] = [
    ["CLOUD", cloud],
    ["MOON", moon],
    ["SOLAR_ACTIVITY", strength / 100],
    ["LOCATION", location],
  ];
  const worst = candidates.reduce((lowest, candidate) => candidate[1] < lowest[1] ? candidate : lowest);
  return worst[1] >= 0.7 ? "NONE" : worst[0];
}

export function levelOf(score: number): Pick<AuroraAssessment, "level" | "levelLabel" | "color"> {
  if (score < 5) return { level: "NONE", levelLabel: "看不到", color: "#64748B" };
  if (score < 20) return { level: "POOR", levelLabel: "不佳", color: "#FB923C" };
  if (score < 40) return { level: "FAIR", levelLabel: "普通", color: "#FDE047" };
  if (score < 65) return { level: "GOOD", levelLabel: "良好", color: "#86EFAC" };
  return { level: "EXCELLENT", levelLabel: "極佳", color: "#4ADE80" };
}

export function assessAuroraVisibility(input: AssessmentInput): AuroraAssessment {
  const solarElevation = sunElevation(input.time, input.site.lat, input.site.lon);
  const lunarInterference = moonInterference(input.time, input.site.lat, input.site.lon);
  const dark = darknessFactor(solarElevation);
  const obstruction = input.weather ? effectiveObstruction(input.weather) : 50;
  const cloud = clamp(1 - obstruction / 100, 0, 1);
  const moon = clamp(1 - lunarInterference * 0.5, 0, 1);
  const location = siteFactor(input.site, input.kp);
  const strength = auroraStrength(input.kp, input.ovationProbability, input.bzGsm);
  const rawScore = clamp(strength * cloud * dark * moon * location, 0, 100);

  return {
    time: input.time.toISOString(),
    score: Math.round(rawScore),
    ...levelOf(rawScore),
    limitingFactor: limitingFactor(dark, cloud, moon, strength, location),
    kp: input.kp,
    auroraStrength: strength,
    cloudFactor: cloud,
    darknessFactor: dark,
    moonFactor: moon,
    siteFactor: location,
    effectiveObstruction: obstruction,
    sunElevation: solarElevation,
    moonInterference: lunarInterference,
  };
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * HomeViewModel's 48-hour loop. Offset zero alone receives current OVATION and Bz; offsets 1–47
 * use the applicable NOAA 3-hour Kp point, falling back to current Kp across gaps.
 */
export function buildAuroraForecast48(
  snapshot: DashboardSnapshot,
  site: AuroraForecastSite,
  baseTime: Date | string = snapshot.generatedAt,
): AuroraAssessment[] {
  const base = baseTime instanceof Date ? new Date(baseTime) : new Date(baseTime);
  if (Number.isNaN(base.getTime())) throw new RangeError("baseTime must be a valid date");

  const currentKp = finite(snapshot.sources.noaaKp?.data?.kp) ?? 0;
  const forecastData = snapshot.sources.noaaKpForecast?.data;
  const points = isNoaaKpForecastData(forecastData) ? forecastData.points : [];
  const metno = snapshot.sources.metno?.data ?? {};
  const storedSite = (Array.isArray(metno.sites) ? metno.sites : []).find(
    (candidate) => candidate && typeof candidate === "object" && (candidate as { id?: unknown }).id === site.id,
  ) as { forecast?: unknown } | undefined;
  const weather = decodeSiteForecast(metno.forecastTimes, storedSite?.forecast);
  const ovation = decodeOvationGrid(snapshot.sources.ovation?.data?.grid);
  const probability = ovation?.probabilityAt(site.lat, site.lon);
  const bzGsm = finite(snapshot.sources.solarWind?.data?.bzNt);

  return Array.from({ length: 48 }, (_, offset) => {
    const time = new Date(base.getTime() + offset * HOUR_MS);
    return assessAuroraVisibility({
      time,
      site,
      weather: hourAt(weather, time),
      kp: kpAt(points, time, currentKp),
      ovationProbability: offset === 0 ? probability : undefined,
      bzGsm: offset === 0 ? bzGsm : undefined,
    });
  });
}
