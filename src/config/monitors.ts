/** Every monitor the dashboard knows about. Adding one starts here. */
export const MONITOR_IDS = ["metno", "irca", "noaaKp", "solarWind", "ovation", "ecmwf", "imo"] as const;

export type MonitorId = (typeof MONITOR_IDS)[number];

/** Monitors wired to real production data. Each owns its freshness policy in `src/config/`. */
export const LIVE_MONITOR_IDS = ["ecmwf", "irca"] as const;

export type LiveMonitorId = (typeof LIVE_MONITOR_IDS)[number];

/** Everything still on placeholder data, and the only ids `freshnessThresholds` covers. */
export type MockMonitorId = Exclude<MonitorId, LiveMonitorId>;
