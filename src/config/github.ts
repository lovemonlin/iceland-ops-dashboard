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
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

/**
 * How often a workflow is expected to actually produce a run.
 *
 * `interval` is a plain age budget. `slots` asks the sharper question "should a run have happened
 * by now?" for cron-scheduled workflows, with a grace period for GitHub's queueing delay.
 */
export type WorkflowCadence =
  | { kind: "interval"; expectedIntervalMinutes: number; staleAfterMinutes: number }
  | { kind: "slots"; everyHours: number; atMinute: number; graceMinutes: number };

export interface MonitoredWorkflow {
  /** Monitor id, distinct from the output monitor for the same source. */
  id: "ircaPipeline" | "ecmwfPipeline";
  name: string;
  /** Verified read-only against the repository, not guessed. */
  file: string;
  cadence: WorkflowCadence;
}

// MEASURED REALITY (read-only sample of the last 10 runs, 2026-09-03):
//
// `update-road-info.yml` declares a five-minute cron, but GitHub actually delivered runs every
// 105-277 minutes (median 147). `update-cloud-forecast.yml` declares a cron at :20 past every third
// hour and was delivered every ~134-401 minutes. GitHub drops most scheduled triggers on free public
// repositories, so a workflow cron is an upper bound on frequency, never a promise.
//
// The values below are the agreed operational policy, deliberately tighter than observed delivery.
// TODO: revisit against a longer sample. As written these report STALE often, which is a policy
// decision about how loudly to complain, not a measurement.
export const MONITORED_WORKFLOWS: MonitoredWorkflow[] = [
  {
    id: "ircaPipeline",
    name: "IRCA Road Publisher",
    file: "update-road-info.yml",
    cadence: { kind: "interval", expectedIntervalMinutes: 30, staleAfterMinutes: 45 },
  },
  {
    id: "ecmwfPipeline",
    name: "ECMWF Cloud Publisher",
    file: "update-cloud-forecast.yml",
    // Cron is :20 past every third UTC hour; the grace covers GitHub's scheduling delay.
    cadence: { kind: "slots", everyHours: 3, atMinute: 20, graceMinutes: 45 },
  },
];

export function workflowRunsUrl(file: string) {
  return `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${file}/runs?per_page=${GITHUB_RUNS_PER_PAGE}`;
}

export function runJobsUrl(runId: number) {
  return `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/jobs`;
}
