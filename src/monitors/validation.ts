/**
 * Small per-source validation helpers shared by the mock monitors.
 * Each one answers a single question and never assumes HTTP 200 means healthy.
 */

/** Non-empty array of records, or EMPTY_DATA. */
export function validateIrca(data: unknown) {
  return Array.isArray(data) && data.length > 0 ? "OK" : "EMPTY_DATA";
}

/** MET Norway queries many locations: all, some, or none may succeed. */
export function validateMet(successes: number, total: number) {
  if (successes === total) return "OK";
  if (successes === 0) return "ERROR";
  return "DEGRADED";
}

/** NOAA values must be finite numbers carrying a parseable timestamp. */
export function validateNoaa(value: unknown, timestamp: unknown) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  const dated = typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp));
  return numeric && dated ? "OK" : "SCHEMA_ERROR";
}
