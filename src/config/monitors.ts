/** Every monitor the dashboard knows about. Adding one starts here. */
export const MONITOR_IDS = [
  "metno",
  "irca",
  "ircaPipeline",
  "noaaKp",
  "solarWind",
  "ovation",
  "ecmwf",
  "ecmwfPipeline",
  "imo",
] as const;

export type MonitorId = (typeof MONITOR_IDS)[number];

/** Monitors wired to real production data. Each owns its freshness policy in `src/config/`. */
export const LIVE_MONITOR_IDS = ["ecmwf", "irca", "ircaPipeline", "ecmwfPipeline"] as const;

export type LiveMonitorId = (typeof LIVE_MONITOR_IDS)[number];

/** Everything still on placeholder data, and the only ids `freshnessThresholds` covers. */
export type MockMonitorId = Exclude<MonitorId, LiveMonitorId>;

/**
 * A source and the pipeline that publishes it are two monitors but one problem, so incidents are
 * grouped: a stale IRCA output plus a failing IRCA workflow is one story, not two alarms.
 */
export interface IncidentFamily {
  key: string;
  title: string;
  output: MonitorId;
  pipeline: MonitorId;
}

export const INCIDENT_FAMILIES: IncidentFamily[] = [
  { key: "irca", title: "IRCA Roads", output: "irca", pipeline: "ircaPipeline" },
  { key: "ecmwf", title: "ECMWF Cloud Forecast", output: "ecmwf", pipeline: "ecmwfPipeline" },
];
