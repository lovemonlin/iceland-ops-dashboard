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

/**
 * Monitors wired to real production data. Every monitor is: there is no mock data path left, so
 * nothing the dashboard publishes can be a placeholder.
 */
export const LIVE_MONITOR_IDS = MONITOR_IDS;

export type LiveMonitorId = (typeof LIVE_MONITOR_IDS)[number];

/** Monitors that describe a publishing pipeline rather than a data source. */
export const PIPELINE_MONITOR_IDS = ["ircaPipeline", "ecmwfPipeline"] as const;

export type PipelineMonitorId = (typeof PIPELINE_MONITOR_IDS)[number];

export function isPipelineMonitor(id: string): id is PipelineMonitorId {
  return (PIPELINE_MONITOR_IDS as readonly string[]).includes(id);
}

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
