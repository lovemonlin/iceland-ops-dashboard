import { isPipelineMonitor } from "@/config/monitors";
import { SNAPSHOT_INTERVAL_MINUTES, SNAPSHOT_SCHEMA_VERSION } from "@/config/snapshot";
import { getSystemStatus } from "@/health/evaluate";
import type { HealthStatus, MonitorHealth } from "@/health/model";
import { mergeSources } from "@/snapshot/mergeSnapshot";
import { allSnapshotEntries, type DashboardSnapshot } from "@/snapshot/types";

const STATUSES: HealthStatus[] = ["ok", "info", "stale", "degraded", "error"];

/**
 * Turns one round of monitor results into the next snapshot, folding them into the previous one so
 * a failed collection keeps the data it failed to refresh.
 */
export function buildSnapshot(
  previous: DashboardSnapshot | undefined,
  monitors: MonitorHealth[],
  now: Date,
  trigger?: string,
): DashboardSnapshot {
  const generatedAt = now.toISOString();

  const sourceMonitors = monitors.filter((monitor) => !isPipelineMonitor(monitor.id));
  const pipelineMonitors = monitors.filter((monitor) => isPipelineMonitor(monitor.id));

  const sources = mergeSources(previous?.sources, sourceMonitors, generatedAt);
  const pipelines = mergeSources(previous?.pipelines, pipelineMonitors, generatedAt);

  const snapshot: DashboardSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    scheduledFor: new Date(now.getTime() + SNAPSHOT_INTERVAL_MINUTES * 60_000).toISOString(),
    trigger: trigger ?? "local",
    overallStatus: "ok",
    sources,
    pipelines,
    summary: { ok: 0, info: 0, stale: 0, degraded: 0, error: 0 },
  };

  const entries = allSnapshotEntries(snapshot);
  snapshot.overallStatus = getSystemStatus(entries);
  for (const status of STATUSES) {
    snapshot.summary[status] = entries.filter((entry) => entry.status === status).length;
  }

  return snapshot;
}

/** Structural check used when reading a snapshot back off disk. */
export function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<DashboardSnapshot>;
  return (
    typeof snapshot.schemaVersion === "number" &&
    typeof snapshot.generatedAt === "string" &&
    !Number.isNaN(Date.parse(snapshot.generatedAt)) &&
    typeof snapshot.overallStatus === "string" &&
    typeof snapshot.sources === "object" &&
    snapshot.sources !== null &&
    typeof snapshot.summary === "object" &&
    snapshot.summary !== null
  );
}
