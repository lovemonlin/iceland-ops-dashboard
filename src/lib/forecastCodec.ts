/**
 * How a site's hourly forecast is stored in the snapshot, and how it is read back.
 *
 * The snapshot is regenerated and committed every hour, so its size is a running cost rather than
 * a one-off. Storing each hour as `{"time": ..., "temperatureC": ..., ...}` under the snapshot's
 * pretty-printed JSON spent about 420 bytes to carry about 160 bytes of forecast. The same numbers
 * are therefore stored positionally: the timestamps once, in `forecastTimes`, and each site's
 * readings as fixed-order tuples aligned to them.
 *
 * This is purely a storage format. Nothing above the decoder knows about it: `decodeSiteForecast`
 * hands back ordinary `WeatherHour` objects, so the timeline, the map and the dialog are written
 * against named fields exactly as before.
 *
 * Nothing is lost, rounded or interpolated in either direction. A reading MET did not publish is
 * `null` in the tuple and absent from the decoded object — never zero, and never borrowed from a
 * neighbouring hour.
 */

import type { WeatherHour } from "@/lib/weatherMap";

/**
 * The tuple's field order. This array *is* the contract — the encoder and the decoder both walk
 * it, so a tuple slot is never addressed by a bare number anywhere in the codebase.
 *
 * Append-only: adding a field at the end leaves every stored tuple readable, whereas inserting or
 * reordering one would silently reinterpret every snapshot already committed.
 */
export const FORECAST_FIELDS = [
  "temperatureC",
  "windMps",
  "windFromDirection",
  "cloudLowPercent",
  "cloudMediumPercent",
  "cloudHighPercent",
  "cloudTotalPercent",
  "symbolCode",
] as const;

export type ForecastField = (typeof FORECAST_FIELDS)[number];

/** The last field is MET's condition code; the rest are numeric. `null` means "not published". */
export type ForecastTuple = [
  temperatureC: number | null,
  windMps: number | null,
  windFromDirection: number | null,
  cloudLowPercent: number | null,
  cloudMediumPercent: number | null,
  cloudHighPercent: number | null,
  cloudTotalPercent: number | null,
  symbolCode: string | null,
];

/** A site's series, one slot per entry in `forecastTimes`. `null` = that site has no such hour. */
export type ForecastRow = (ForecastTuple | null)[];

/** The index of the condition code, derived from the field list rather than written as `7`. */
const SYMBOL_INDEX = FORECAST_FIELDS.indexOf("symbolCode");

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One decoded hour back to its stored tuple. Absent readings become `null`. */
export function encodeForecastHour(hour: WeatherHour): ForecastTuple {
  return FORECAST_FIELDS.map((field) =>
    field === "symbolCode"
      ? typeof hour.symbolCode === "string"
        ? hour.symbolCode
        : null
      : finiteOrNull(hour[field]),
  ) as ForecastTuple;
}

/**
 * One stored tuple back to an hour.
 *
 * A `null` slot is left off the object rather than set to `null`, so `hour.windMps === undefined`
 * reads the same whether the field was absent from MET's response or absent from the tuple.
 */
export function decodeForecastHour(time: string, tuple: ForecastTuple): WeatherHour {
  const hour: WeatherHour = { time };
  FORECAST_FIELDS.forEach((field, index) => {
    const value = tuple[index];
    if (value === null || value === undefined) return;
    if (index === SYMBOL_INDEX) {
      if (typeof value === "string") hour.symbolCode = value;
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) hour[field as Exclude<ForecastField, "symbolCode">] = value;
  });
  return hour;
}

/**
 * The shared time axis for a round of sites.
 *
 * It is the union of every site's own timestamps, sorted, because MET issues each point
 * separately and a site can sit an hour off its neighbours. A union keeps every published hour;
 * intersecting would quietly drop the odd one out, and snapping to a nominal grid would move a
 * reading to a time MET never gave it.
 */
export function buildForecastTimes(series: { time: string }[][]): string[] {
  const times = new Set<string>();
  for (const hours of series) for (const hour of hours) times.add(hour.time);
  return [...times].sort();
}

/** A site's hours laid onto `forecastTimes`. Hours the site does not have stay `null`. */
export function encodeSiteForecast(hours: WeatherHour[], forecastTimes: string[]): ForecastRow {
  const slot = new Map(forecastTimes.map((time, index) => [time, index]));
  const row: ForecastRow = new Array(forecastTimes.length).fill(null);
  for (const hour of hours) {
    const index = slot.get(hour.time);
    if (index !== undefined) row[index] = encodeForecastHour(hour);
  }
  return row;
}

/**
 * A stored row back to the hours the UI reads.
 *
 * Empty slots are skipped, so a site that is an hour behind its neighbours returns its own
 * unbroken series rather than a list with a hole at the front.
 */
export function decodeSiteForecast(
  forecastTimes: unknown,
  forecast: unknown,
): WeatherHour[] {
  if (!Array.isArray(forecastTimes) || !Array.isArray(forecast)) return [];
  const hours: WeatherHour[] = [];
  forecast.forEach((tuple, index) => {
    const time = forecastTimes[index];
    if (typeof time !== "string" || !Array.isArray(tuple)) return;
    hours.push(decodeForecastHour(time, tuple as ForecastTuple));
  });
  return hours;
}
