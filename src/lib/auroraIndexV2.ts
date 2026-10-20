import {
  darknessFactor,
  levelOf,
  moonInterference,
  sunElevation,
  type AuroraForecastSite,
  type LightPollution,
} from "@/lib/auroraVisibility";
import { effectiveObstruction, type WeatherHour } from "@/lib/weatherMap";

interface AuroraIndexV2Factors {
  kp: number;
  obstruction: number;
  darkness: number;
  moonInterference: number;
  lightPollution: LightPollution;
}

export interface AuroraIndexV2Input {
  time: Date;
  site: AuroraForecastSite;
  weather?: WeatherHour;
  kp: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/** The briefing's score distribution; V1 Android-compatible assessment remains separate. */
export function calculateAuroraIndexV2(input: AuroraIndexV2Factors) {
  const activityPotential = (clamp(input.kp, 0, 9) / 9) ** 0.45;
  const clearSky = clamp(1 - input.obstruction / 100, 0, 1);
  const cloudModifier = Math.sqrt(clearSky);
  const darknessModifier = Math.sqrt(input.darkness);
  const moonModifier = 1 - clamp(input.moonInterference, 0, 1) * 0.15;
  const lightPollutionModifier =
    input.lightPollution === "DARK" ? 1 : input.lightPollution === "MODERATE" ? 0.92 : 0.78;

  const raw = 100 * activityPotential * cloudModifier * darknessModifier * moonModifier * lightPollutionModifier;
  let score = Math.round(clamp(raw, 0, 100));
  if (input.darkness === 0) score = 0;
  else if (input.darkness < 0.6) score = Math.min(score, 19);
  if (input.obstruction >= 90) score = Math.min(score, 19);
  else if (input.obstruction >= 75) score = Math.min(score, 39);

  return {
    score,
    ...levelOf(score),
    activityPotential,
    cloudModifier,
    darknessModifier,
    moonModifier,
    lightPollutionModifier,
  };
}

export interface AuroraIndexV2Assessment extends ReturnType<typeof calculateAuroraIndexV2> {
  time: string;
  kp: number;
  darknessFactor: number;
  effectiveObstruction: number;
  sunElevation: number;
  moonInterference: number;
}

export function assessAuroraIndexV2(input: AuroraIndexV2Input): AuroraIndexV2Assessment {
  const solarElevation = sunElevation(input.time, input.site.lat, input.site.lon);
  const lunarInterference = moonInterference(input.time, input.site.lat, input.site.lon);
  const darkness = darknessFactor(solarElevation);
  const obstruction = input.weather ? effectiveObstruction(input.weather) : 50;

  return {
    time: input.time.toISOString(),
    kp: input.kp,
    darknessFactor: darkness,
    effectiveObstruction: obstruction,
    sunElevation: solarElevation,
    moonInterference: lunarInterference,
    ...calculateAuroraIndexV2({
      kp: input.kp,
      obstruction,
      darkness,
      moonInterference: lunarInterference,
      lightPollution: input.site.lightPollution,
    }),
  };
}
