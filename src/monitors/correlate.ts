import { INCIDENT_FAMILIES } from "@/config/monitors";
import { getSystemStatus } from "@/health/evaluate";
import type { HealthStatus } from "@/health/model";
import { allSnapshotEntries, snapshotEntry, type DashboardSnapshot, type SnapshotSource } from "@/snapshot/types";

export interface IncidentGroup {
  key: string;
  title: string;
  status: HealthStatus;
  /** What the combined evidence shows — never a guess at root cause. */
  summary: string;
  entries: SnapshotSource[];
}

const UNHEALTHY: HealthStatus[] = ["stale", "degraded", "error"];

function isUnhealthy(entry: SnapshotSource | undefined) {
  return entry !== undefined && UNHEALTHY.includes(entry.status);
}

/** How old the stored data is, from the data's own timestamp — not from the collection time. */
export function dataAgeMinutes(entry: SnapshotSource, now: Date) {
  if (!entry.dataTime) return undefined;
  const parsed = Date.parse(entry.dataTime);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, Math.round((now.getTime() - parsed) / 60_000));
}

/**
 * Combines a source with the pipeline that publishes it.
 *
 * It separates four situations a single check cannot tell apart: the workflow ran and failed, the
 * workflow never ran, the workflow succeeded but the output did not advance, and the workflow
 * status could not be checked at all. It reports only what the two checks prove — it never
 * concludes that an upstream service is down.
 */
function correlate(output: SnapshotSource, pipeline: SnapshotSource, now: Date) {
  const age = dataAgeMinutes(output, now);
  const outputLine =
    age === undefined
      ? `${output.name} data is unhealthy.`
      : `${output.name} production output has not updated for ${age} min.`;

  // No collected data from the pipeline check means GitHub itself could not be read.
  if (pipeline.data === undefined) {
    return (
      `${outputLine} GitHub Actions status is unavailable, so the workflow could not be verified — ` +
      `the pipeline may be fine. ${pipeline.errorMessage ?? ""}`.trim()
    );
  }

  if (pipeline.errorType === "WORKFLOW_FAILED") {
    const failures = Number(pipeline.data.consecutiveFailures ?? 0);
    const step = pipeline.data.failedStep;
    const job = pipeline.data.failedJob;
    return [
      outputLine,
      failures > 1
        ? `GitHub Actions also reports ${failures} consecutive workflow failures.`
        : `The latest GitHub Actions run also failed.`,
      step ? `Latest failed step: ${step}${job ? ` (job ${job})` : ""}.` : job ? `Latest failed job: ${job}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (pipeline.errorType === "WORKFLOW_DISABLED") {
    return `${outputLine} GitHub reports the publishing workflow as disabled, so no schedule can fire.`;
  }

  if (pipeline.errorType === "WORKFLOW_NOT_RUN") {
    const lastRun = pipeline.data.lastRun;
    return (
      `${outputLine} No recent scheduled workflow run was observed` +
      `${lastRun ? `; the newest run is from ${lastRun}` : ""}. ` +
      `The workflow did not fail — it did not run. Check the schedule trigger rather than the job itself.`
    );
  }

  // The workflow is healthy, so a stale output means the publish step did not move the timestamp.
  const ranAfterPublish =
    typeof pipeline.dataTime === "string" &&
    typeof output.dataTime === "string" &&
    Date.parse(pipeline.dataTime) > Date.parse(output.dataTime);

  if (ranAfterPublish) {
    return (
      `${outputLine} The latest workflow run completed successfully after that publish, but the public ` +
      `production timestamp did not advance. Worth checking the no-change publish logic, generated_at, ` +
      `the commit behaviour and Pages deployment before looking upstream.`
    );
  }

  return `${outputLine} The pipeline reports no workflow failure.`;
}

/**
 * Groups stale, degraded and failing entries into incidents, most severe first, merging each source
 * with its pipeline so one problem produces one entry.
 */
export function buildIncidents(snapshot: DashboardSnapshot, now: Date): IncidentGroup[] {
  const grouped = new Set<string>();
  const incidents: IncidentGroup[] = [];

  for (const family of INCIDENT_FAMILIES) {
    const output = snapshotEntry(snapshot, family.output);
    const pipeline = snapshotEntry(snapshot, family.pipeline);
    if (!output || !pipeline) continue;
    grouped.add(family.output);
    grouped.add(family.pipeline);
    if (!isUnhealthy(output) && !isUnhealthy(pipeline)) continue;

    const entries = [output, pipeline];
    incidents.push({
      key: family.key,
      title: family.title,
      status: getSystemStatus(entries),
      summary: isUnhealthy(output)
        ? correlate(output, pipeline, now)
        : `${output.name} output is healthy, but its publishing pipeline is not: ${
            pipeline.errorMessage ?? pipeline.status
          }`,
      entries,
    });
  }

  for (const entry of allSnapshotEntries(snapshot)) {
    if (grouped.has(entry.id) || !isUnhealthy(entry)) continue;
    incidents.push({
      key: entry.id,
      title: entry.name,
      status: entry.status,
      summary: entry.errorMessage ?? entry.note ?? "Status requires attention.",
      entries: [entry],
    });
  }

  const severity: Record<HealthStatus, number> = { error: 0, degraded: 1, stale: 2, info: 3, ok: 4 };
  return incidents.sort((a, b) => severity[a.status] - severity[b.status]);
}
