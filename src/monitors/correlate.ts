import { INCIDENT_FAMILIES } from "@/config/monitors";
import { getSystemStatus } from "@/health/evaluate";
import type { HealthStatus, MonitorHealth } from "@/health/model";

export interface IncidentGroup {
  key: string;
  title: string;
  status: HealthStatus;
  /** What the combined evidence shows — never a guess at root cause. */
  summary: string;
  monitors: MonitorHealth[];
}

const UNHEALTHY: HealthStatus[] = ["stale", "degraded", "error"];

function isUnhealthy(monitor: MonitorHealth | undefined) {
  return monitor !== undefined && UNHEALTHY.includes(monitor.status);
}

function minutesOld(monitor: MonitorHealth) {
  return monitor.ageSeconds === undefined ? undefined : Math.round(monitor.ageSeconds / 60);
}

/**
 * Combines an output monitor with the pipeline that publishes it.
 *
 * The point is to separate four situations a single monitor cannot tell apart: the workflow ran and
 * failed, the workflow never ran, the workflow succeeded but the output did not advance, and the
 * workflow status could not be checked at all. It reports only what the two checks prove — it never
 * concludes that an upstream service is down.
 */
function correlate(output: MonitorHealth, pipeline: MonitorHealth) {
  const age = minutesOld(output);
  const outputLine =
    age === undefined
      ? `${output.name} output is unhealthy.`
      : `${output.name} production output has not updated for ${age} min.`;

  if (pipeline.details?._workflowStatusKnown === false) {
    return (
      `${outputLine} GitHub Actions status is unavailable, so the workflow could not be verified — ` +
      `the pipeline may be fine. ${pipeline.errorMessage ?? ""}`.trim()
    );
  }

  if (pipeline.errorType === "WORKFLOW_FAILED") {
    const failures = Number(pipeline.details?.consecutiveFailures ?? 0);
    const step = pipeline.details?.failedStep;
    const job = pipeline.details?.failedJob;
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

  if (pipeline.errorType === "WORKFLOW_NOT_RUN") {
    const lastRun = pipeline.details?.lastRun;
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
 * Groups stale, degraded and failing monitors into incidents, most severe first, merging each
 * source with its pipeline so one problem produces one entry.
 */
export function buildIncidents(monitors: MonitorHealth[]): IncidentGroup[] {
  const byId = new Map(monitors.map((monitor) => [monitor.id, monitor]));
  const grouped = new Set<string>();
  const incidents: IncidentGroup[] = [];

  for (const family of INCIDENT_FAMILIES) {
    const output = byId.get(family.output);
    const pipeline = byId.get(family.pipeline);
    if (!output || !pipeline) continue;
    grouped.add(family.output);
    grouped.add(family.pipeline);
    if (!isUnhealthy(output) && !isUnhealthy(pipeline)) continue;

    const members = [output, pipeline];
    incidents.push({
      key: family.key,
      title: family.title,
      status: getSystemStatus(members),
      summary: isUnhealthy(output)
        ? correlate(output, pipeline)
        : `${output.name} output is healthy, but its publishing pipeline is not: ${
            pipeline.errorMessage ?? pipeline.status
          }`,
      monitors: members,
    });
  }

  for (const monitor of monitors) {
    if (grouped.has(monitor.id) || !isUnhealthy(monitor)) continue;
    incidents.push({
      key: monitor.id,
      title: monitor.name,
      status: monitor.status,
      summary: monitor.errorMessage ?? monitor.note ?? "Status requires attention.",
      monitors: [monitor],
    });
  }

  const severity: Record<HealthStatus, number> = { error: 0, degraded: 1, stale: 2, info: 3, ok: 4 };
  return incidents.sort((a, b) => severity[a.status] - severity[b.status]);
}
