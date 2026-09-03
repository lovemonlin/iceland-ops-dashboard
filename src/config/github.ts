/**
 * GitHub Actions pipeline monitoring contract.
 *
 * Anonymous, read-only, GET only. No token is stored or sent, so no `Authorization` header is ever
 * set — which also caps us at GitHub's unauthenticated 60 requests/hour/IP budget and is the reason
 * this monitor is cached rather than run on every 60-second dashboard refresh.
 */

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_OWNER = "lovemonlin";
export const GITHUB_REPO = "iceland-aurora-cloud";

export const GITHUB_API_ACCEPT = "application/vnd.github+json";
export const GITHUB_API_VERSION = "2022-11-28";

/** Rate-limit headers worth surfacing to the maintainer. */
export const GITHUB_RATE_LIMIT_HEADERS = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];

/** GitHub is polled at most this often, no matter how often the dashboard refreshes. */
export const GITHUB_ACTIONS_CHECK_INTERVAL_MS = 5 * 60_000;

/** Below this many remaining requests, back off hard rather than burning the hourly budget. */
export const GITHUB_LOW_RATE_LIMIT_REMAINING = 10;
export const GITHUB_LOW_RATE_LIMIT_INTERVAL_MS = 10 * 60_000;

export const GITHUB_RUNS_PER_PAGE = 10;

/**
 * Workflow state, default branch and the cron in the workflow file change perhaps once a month,
 * so they get their own long cache and barely touch the shared hourly budget.
 */
export const GITHUB_METADATA_CACHE_MS = 60 * 60_000;

/** Platform status is diagnostic context only and never changes a monitor's status. */
export const GITHUB_STATUS_SUMMARY_URL = "https://www.githubstatus.com/api/v2/summary.json";

/** The only hosts this dashboard is allowed to talk to for pipeline diagnosis. */
export const GITHUB_ALLOWED_HOSTS = ["api.github.com", "www.githubstatus.com"];
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

/**
 * How often a workflow is expected to actually produce a run.
 *
 * `interval` is a plain age budget. `slots` asks the sharper question "should a run have happened
 * by now?" for cron-scheduled workflows, with a grace period for GitHub's queueing delay.
 */
/**
 * When to raise the alarm that no run has appeared. This is an alerting threshold, never a claim
 * about how often the workflow is supposed to run — the configured schedule is read from the
 * workflow file itself and reported separately.
 */
export type WorkflowCadence =
  | { kind: "interval"; staleAfterMinutes: number }
  | { kind: "slots"; everyHours: number; atMinute: number; graceMinutes: number };

export interface MonitoredWorkflow {
  /** Monitor id, distinct from the output monitor for the same source. */
  id: "ircaPipeline" | "ecmwfPipeline";
  name: string;
  /** Verified read-only against the repository, not guessed. */
  file: string;
  cadence: WorkflowCadence;
}

// GitHub documents that scheduled events can be delayed during periods of high Actions load, and
// that queued jobs may be dropped, so a cron expression is not a delivery guarantee.
//
// Separately, THIS repository's observed history (read-only sample of the last 10 runs of each
// workflow, 2026-09-03) contains substantial gaps: update-road-info.yml every 105-277 minutes
// (median 147) against a five-minute cron, update-cloud-forecast.yml every ~134-401 minutes
// against a three-hourly cron. That is an observation about this repository, not a statement
// about GitHub in general.
//
// The thresholds below are the operational alerting policy for Iceland road information. They are
// deliberately NOT relaxed to match observed delivery: if they stay red, that is the finding.
export const MONITORED_WORKFLOWS: MonitoredWorkflow[] = [
  {
    id: "ircaPipeline",
    name: "IRCA Road Publisher",
    file: "update-road-info.yml",
    cadence: { kind: "interval", staleAfterMinutes: 45 },
  },
  {
    id: "ecmwfPipeline",
    name: "ECMWF Cloud Publisher",
    file: "update-cloud-forecast.yml",
    // Cron is :20 past every third UTC hour; the grace covers GitHub's scheduling delay.
    cadence: { kind: "slots", everyHours: 3, atMinute: 20, graceMinutes: 45 },
  },
];

export function repositoryUrl() {
  return `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
}

/** The workflow filename is accepted wherever the numeric id is, and survives a recreated workflow. */
export function workflowUrl(file: string) {
  return `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${file}`;
}

export function workflowContentsUrl(path: string, ref: string) {
  return `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`;
}

export function workflowRunsUrl(file: string) {
  return `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${file}/runs?per_page=${GITHUB_RUNS_PER_PAGE}`;
}

export function runJobsUrl(runId: number) {
  return `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/jobs`;
}
