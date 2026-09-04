import type { SnapshotSource } from "../../src/snapshot/types";

/**
 * A fixed set of snapshot entries for tests of presentation-layer helpers.
 *
 * This is a test fixture and lives here on purpose: production code has no mock data path, so
 * nothing the dashboard publishes can come from a placeholder.
 */
export const SNAPSHOT_ENTRIES: SnapshotSource[] = [
  { id: "metno", name: "MET Norway Weather", status: "ok", lastAttemptAt: "2026-09-03T08:52:13.000Z" },
  { id: "irca", name: "IRCA Roads", status: "ok", lastAttemptAt: "2026-09-03T08:52:13.000Z" },
  {
    id: "noaaKp",
    name: "NOAA Kp",
    status: "error",
    errorType: "SCHEMA_ERROR",
    lastAttemptAt: "2026-09-03T08:52:13.000Z",
  },
  { id: "solarWind", name: "NOAA Solar Wind", status: "ok", lastAttemptAt: "2026-09-03T08:52:13.000Z" },
  {
    id: "ovation",
    name: "NOAA OVATION",
    status: "degraded",
    errorType: "HTTP_ERROR",
    lastAttemptAt: "2026-09-03T08:52:13.000Z",
  },
  { id: "ecmwf", name: "ECMWF Cloud Forecast", status: "ok", lastAttemptAt: "2026-09-03T08:52:13.000Z" },
  { id: "imo", name: "IMO Warnings", status: "info", lastAttemptAt: "2026-09-03T08:52:13.000Z" },
];
