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
/** The 1° cells in the dashboard's Iceland-and-nearby-sea summary box. */
export const ICELAND_GRID_LAT_FROM = 63;
export const ICELAND_GRID_LAT_TO = 67;
export const ICELAND_GRID_LON_FROM = -25;
export const ICELAND_GRID_LON_TO = -13;

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
  const seen = new Set<string>();
  for (const entry of coordinates) {
    if (!Array.isArray(entry) || entry.length !== 3) throw new RangeError("OVATION cells must be [longitude, latitude, probability] triples.");
    const [longitude, latitude, probability] = entry as number[];
    if (
      !Number.isInteger(longitude) || longitude < -180 || longitude > 359 ||
      !Number.isInteger(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isInteger(probability) || probability < 0 || probability > 100
    ) {
      throw new RangeError("OVATION cells require integer coordinates and a 0–100 probability.");
    }
    if (latitude < OVATION_GRID_LAT_FROM || latitude > OVATION_GRID_LAT_TO) continue;
    const signed = signedLongitude(normaliseLongitude(longitude));
    const key = `${latitude}:${signed}`;
    if (seen.has(key)) throw new RangeError("OVATION grid contains duplicate cells.");
    seen.add(key);
    const column = signed - OVATION_GRID_LON_FROM;
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
    candidate.schemaVersion === OVATION_GRID_SCHEMA_VERSION &&
    candidate.latFrom === OVATION_GRID_LAT_FROM &&
    candidate.latTo === OVATION_GRID_LAT_TO &&
    candidate.lonFrom === OVATION_GRID_LON_FROM &&
    candidate.lonTo === OVATION_GRID_LON_TO &&
    candidate.latStep === 1 &&
    candidate.lonStep === 1 &&
    Array.isArray(candidate.values) &&
    candidate.values.every((probability) => Number.isInteger(probability) && probability >= 0 && probability <= 100)
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

/** Highest published cell in the Iceland-and-nearby-sea summary box, never an island-wide average. */
export function icelandGridPeak(grid: OvationGrid | undefined): number | undefined {
  if (!grid) return undefined;
  let peak = 0;
  for (let latitude = ICELAND_GRID_LAT_FROM; latitude <= ICELAND_GRID_LAT_TO; latitude += 1) {
    for (let longitude = ICELAND_GRID_LON_FROM; longitude <= ICELAND_GRID_LON_TO; longitude += 1) {
      peak = Math.max(peak, grid.probabilityAt(latitude, longitude));
    }
  }
  return peak;
}
