/** Every monitor the dashboard knows about. Adding one starts here. */
export const MONITOR_IDS = ["metno", "irca", "noaaKp", "solarWind", "ovation", "ecmwf", "imo"] as const;

export type MonitorId = (typeof MONITOR_IDS)[number];

/**
 * Monitors whose freshness is a plain "how old is the data" threshold.
 * ECMWF is excluded on purpose: its freshness is decided by the production model-cycle
 * publication schedule in `src/config/ecmwf.ts`, not by a fixed age.
 */
export type AgeBasedMonitorId = Exclude<MonitorId, "ecmwf">;
