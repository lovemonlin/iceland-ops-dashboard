import type { WorkflowCadence } from "@/config/github";

/** The subset of the GitHub run object this monitor relies on. */
export interface WorkflowRun {
  id: number;
  run_number: number;
  status: string;
  conclusion: string | null;
  event: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  html_url?: string;
}

export interface WorkflowJob {
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: { name: string; number?: number; status: string; conclusion: string | null }[];
}

/** GitHub run conclusions, per the REST API enum. `null` means the run has not finished. */
const FAILING_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure", "action_required", "cancelled"]);
const IN_FLIGHT_STATUSES = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);

export function isInFlight(run: WorkflowRun) {
  return IN_FLIGHT_STATUSES.has(run.status);
}

export function isFailure(run: WorkflowRun) {
  return run.status === "completed" && run.conclusion !== null && FAILING_CONCLUSIONS.has(run.conclusion);
}

export function isSuccess(run: WorkflowRun) {
  return run.status === "completed" && run.conclusion === "success";
}

/**
 * Counts failures back from the newest completed run until the first success.
 * Runs still in flight are skipped rather than breaking the streak.
 */
export function countConsecutiveFailures(runs: WorkflowRun[]) {
  let failures = 0;
  for (const run of runs) {
    if (isInFlight(run)) continue;
    if (isFailure(run)) {
      failures += 1;
      continue;
    }
    break;
  }
  return failures;
}

export function findLastSuccess(runs: WorkflowRun[]) {
  return runs.find(isSuccess);
}

/** The first step GitHub reports as failed, which is what a maintainer needs to look at. */
export function findFailure(jobs: WorkflowJob[]) {
  const job = jobs.find((candidate) => candidate.conclusion !== null && FAILING_CONCLUSIONS.has(candidate.conclusion));
  if (!job) return undefined;
  const step = job.steps?.find(
    (candidate) => candidate.conclusion !== null && FAILING_CONCLUSIONS.has(candidate.conclusion),
  );
  return { job: job.name, step: step?.name, startedAt: job.started_at ?? undefined, completedAt: job.completed_at ?? undefined };
}

const HOUR_MS = 3_600_000;

/**
 * The most recent cron slot that should already have produced a run, allowing for GitHub's
 * scheduling delay. Slots are `atMinute` past every `everyHours`-th UTC hour.
 */
export function expectedRunSlot(now: Date, everyHours: number, atMinute: number, graceMinutes: number) {
  const deadline = now.getTime() - graceMinutes * 60_000;
  const hour = Math.floor(new Date(deadline).getUTCHours() / everyHours) * everyHours;
  const candidate = new Date(new Date(deadline).setUTCHours(hour, atMinute, 0, 0));
  if (candidate.getTime() <= deadline) return candidate;
  return new Date(candidate.getTime() - everyHours * HOUR_MS);
}

/**
 * Whether the workflow has failed to *run* recently — a missing scheduled trigger, which looks
 * nothing like a run that executed and failed.
 */
export function isScheduleStale(latestRun: WorkflowRun | undefined, cadence: WorkflowCadence, now: Date) {
  if (!latestRun) return true;
  const latestMs = Date.parse(latestRun.created_at);
  if (Number.isNaN(latestMs)) return true;
  if (cadence.kind === "interval") {
    return now.getTime() - latestMs > cadence.staleAfterMinutes * 60_000;
  }
  const slot = expectedRunSlot(now, cadence.everyHours, cadence.atMinute, cadence.graceMinutes);
  return latestMs < slot.getTime();
}

/** Describes the alerting rule, not a claimed cadence: the real schedule comes from the workflow file. */
export function describeCadence(cadence: WorkflowCadence) {
  return cadence.kind === "interval"
    ? `alert if no run for ${cadence.staleAfterMinutes} min`
    : `alert if no run for a :${String(cadence.atMinute).padStart(2, "0")} slot every ${cadence.everyHours}h UTC`;
}

/** Validates the parts of the runs payload the monitor depends on. */
export function parseRunsPayload(raw: unknown): { ok: true; runs: WorkflowRun[] } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "Runs payload is not an object." };
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.workflow_runs)) return { ok: false, message: "Runs payload has no workflow_runs array." };

  const runs: WorkflowRun[] = [];
  for (const entry of value.workflow_runs) {
    if (!entry || typeof entry !== "object") return { ok: false, message: "A workflow run entry is not an object." };
    const run = entry as Record<string, unknown>;
    if (typeof run.id !== "number" || typeof run.status !== "string" || typeof run.created_at !== "string") {
      return { ok: false, message: "A workflow run is missing id, status or created_at." };
    }
    if (Number.isNaN(Date.parse(run.created_at))) return { ok: false, message: "A workflow run has an invalid created_at." };
    runs.push(run as unknown as WorkflowRun);
  }
  return { ok: true, runs };
}

export function parseJobsPayload(raw: unknown): WorkflowJob[] {
  if (!raw || typeof raw !== "object") return [];
  const value = raw as Record<string, unknown>;
  return Array.isArray(value.jobs) ? (value.jobs as WorkflowJob[]) : [];
}
