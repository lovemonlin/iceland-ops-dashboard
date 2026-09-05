/**
 * NOAA's OVATION grid, stored compactly and read back the way the app reads it.
 *
 * The app holds the whole 0..359 × -90..90 model in memory because it fetched it itself. The
 * dashboard cannot: the browser never calls NOAA, so the grid has to travel inside the hourly
 * snapshot, and the snapshot is committed every hour. Storing 65,160 `[lon, lat, probability]`
 * triples would be indefensible for that, so only the latitude band the aurora map actually draws
 * is kept, row-major, as bare numbers.
 *
 * `probabilityAt` is a direct port of `OvationGrid.probabilityAt` (SpaceWeather.kt): round the
 * latitude, normalise the longitude into 0..359, look the cell up, and answer 0 when there is
 * none. Nothing is interpolated here — the contour code does its own sampling on top, exactly as
 * `AuroraProbabilityContours` does on Android.
 */

/**
 * The band the aurora map draws, matching `AuroraProbabilityContours.LAT_FROM/LAT_TO`.
 *
 * The contour walk reads cell corners at `latitude + 1`, so 85 has to be present as data even
 * though the walk itself stops at 84.
 */
export const OVATION_GRID_LAT_FROM = 45;
export const OVATION_GRID_LAT_TO = 85;
/** Longitudes are stored signed, one column per degree: -180 … 179. */
export const OVATION_GRID_LON_FROM = -180;
export const OVATION_GRID_LON_TO = 179;
export const OVATION_GRID_SCHEMA_VERSION = 1;

const ROWS = OVATION_GRID_LAT_TO - OVATION_GRID_LAT_FROM + 1;
const COLUMNS = OVATION_GRID_LON_TO - OVATION_GRID_LON_FROM + 1;

/** Iceland, as `AuroraOvalUiState.icelandProbability` asks for it. */
export const ICELAND_LAT = 64.96;
export const ICELAND_LON = -18.97;

/**
 * The stored grid.
 *
 * `values` is row-major: latitude is the outer axis running `latFrom`…`latTo`, longitude the
 * inner one running `lonFrom`…`lonTo`, so `values[(lat - latFrom) * columns + (lon - lonFrom)]`.
 * It holds plain integers so the snapshot serializer keeps it on one line.
 */
export interface OvationGridPayload {
  schemaVersion: number;
  latFrom: number;
  latTo: number;
  lonFrom: number;
  lonTo: number;
  latStep: number;
  lonStep: number;
  values: number[];
}

/**
 * NOAA publishes longitudes as 0..359. The app normalises the same way before every lookup, so
 * the two representations address one and the same cell; 180 and -180 are that cell's two names.
 */
function normaliseLongitude(longitude: number): number {
  return ((longitude % 360) + 360) % 360;
}

/** 0..359 to the signed column this grid stores. 180 becomes -180, 359 becomes -1. */
function signedLongitude(normalised: number): number {
  return normalised >= 180 ? normalised - 360 : normalised;
}

/**
 * The OVATION response's own `coordinates` array, reduced to the stored band.
 *
 * Cells outside the band are dropped rather than summarised: the aurora map never asks for them,
 * and keeping them would multiply the stored grid by four for nothing.
 */
export function encodeOvationGrid(coordinates: unknown[]): OvationGridPayload {
  const values = new Array<number>(ROWS * COLUMNS).fill(0);
  for (const entry of coordinates) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [longitude, latitude, probability] = entry as number[];
    if (typeof longitude !== "number" || typeof latitude !== "number" || typeof probability !== "number") continue;
    if (latitude < OVATION_GRID_LAT_FROM || latitude > OVATION_GRID_LAT_TO) continue;
    if (!Number.isInteger(latitude)) continue;
    const column = signedLongitude(normaliseLongitude(longitude)) - OVATION_GRID_LON_FROM;
    if (column < 0 || column >= COLUMNS) continue;
    values[(latitude - OVATION_GRID_LAT_FROM) * COLUMNS + column] = probability;
  }
  return {
    schemaVersion: OVATION_GRID_SCHEMA_VERSION,
    latFrom: OVATION_GRID_LAT_FROM,
    latTo: OVATION_GRID_LAT_TO,
    lonFrom: OVATION_GRID_LON_FROM,
    lonTo: OVATION_GRID_LON_TO,
    latStep: 1,
    lonStep: 1,
    values,
  };
}

/** A decoded grid: the one operation the aurora map needs, and the times it labels itself with. */
export interface OvationGrid {
  probabilityAt(latitude: number, longitude: number): number;
  readonly payload: OvationGridPayload;
}

function isPayload(value: unknown): value is OvationGridPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OvationGridPayload>;
  return (
    typeof candidate.latFrom === "number" &&
    typeof candidate.latTo === "number" &&
    typeof candidate.lonFrom === "number" &&
    typeof candidate.lonTo === "number" &&
    Array.isArray(candidate.values)
  );
}

/**
 * The stored grid, back as something with the app's lookup.
 *
 * Returns `undefined` rather than an empty grid when the snapshot has no grid at all, so a caller
 * can tell "no data collected yet" from "collected, and the probability really is zero".
 */
export function decodeOvationGrid(stored: unknown): OvationGrid | undefined {
  if (!isPayload(stored)) return undefined;
  const payload = stored;
  const columns = payload.lonTo - payload.lonFrom + 1;
  const rows = payload.latTo - payload.latFrom + 1;
  if (columns <= 0 || rows <= 0 || payload.values.length !== rows * columns) return undefined;

  return {
    payload,
    probabilityAt(latitude: number, longitude: number): number {
      // OvationGrid.probabilityAt: Math.round, then the 0..359 normalisation, then a plain lookup
      // with 0 for a cell that is not there. JavaScript's Math.round rounds half towards +∞, which
      // is what Kotlin's Math.round does too, so a value like 64.5 lands on the same row.
      const roundedLat = Math.min(90, Math.max(-90, Math.round(latitude)));
      const column = signedLongitude(normaliseLongitude(Math.round(longitude))) - payload.lonFrom;
      const row = roundedLat - payload.latFrom;
      if (row < 0 || row >= rows || column < 0 || column >= columns) return 0;
      return payload.values[row * columns + column] ?? 0;
    },
  };
}

/** `AuroraOvalUiState.icelandProbability` — the model's own reading over Iceland. */
export function icelandProbability(grid: OvationGrid | undefined): number | undefined {
  return grid?.probabilityAt(ICELAND_LAT, ICELAND_LON);
}
