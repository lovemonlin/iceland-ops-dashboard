import {
  GITHUB_ACTIONS_CHECK_INTERVAL_MS,
  GITHUB_API_ACCEPT,
  GITHUB_API_VERSION,
  GITHUB_LOW_RATE_LIMIT_INTERVAL_MS,
  GITHUB_LOW_RATE_LIMIT_REMAINING,
  GITHUB_RATE_LIMIT_HEADERS,
  GITHUB_REQUEST_TIMEOUT_MS,
  MONITORED_WORKFLOWS,
  runJobsUrl,
  workflowRunsUrl,
  type MonitoredWorkflow,
} from "@/config/github";
import { evaluateHealth } from "@/health/evaluate";
import type { MonitorHealth } from "@/health/model";
import {
  fetchWithDiagnosticsCore,
  type DiagnosticFetcher,
  type DiagnosticResult,
} from "@/lib/fetchWithDiagnosticsCore";
import {
  countConsecutiveFailures,
  describeCadence,
  findFailure,
  findLastSuccess,
  isFailure,
  isInFlight,
  isScheduleStale,
  parseJobsPayload,
  parseRunsPayload,
  type WorkflowRun,
} from "@/monitors/github/runs";

const defaultRequest: DiagnosticFetcher = (url, options) => fetchWithDiagnosticsCore(url, options);

export interface GithubRateLimit {
  limit?: number;
  remaining?: number;
  resetAt?: string;
}

/** Server-process memory only, so GitHub is polled far less often than the dashboard refreshes. */
export interface PipelineCache {
  fetchedAt?: number;
  monitors?: MonitorHealth[];
  rateLimit?: GithubRateLimit;
}

export function createPipelineCache(): PipelineCache {
  return {};
}

const sharedCache = createPipelineCache();

export interface PipelineCheckOptions {
  now?: Date;
  request?: DiagnosticFetcher;
  cache?: PipelineCache;
}

/** Anonymous and read-only: `Authorization` is never set, and only GET is ever used. */
function githubGet<T>(url: string, request: DiagnosticFetcher) {
  return request<T>(url, {
    init: {
      method: "GET",
      headers: { Accept: GITHUB_API_ACCEPT, "X-GitHub-Api-Version": GITHUB_API_VERSION },
    },
    responseType: "json",
    timeoutMs: GITHUB_REQUEST_TIMEOUT_MS,
    captureHeaders: GITHUB_RATE_LIMIT_HEADERS,
  });
}

function readRateLimit(result: DiagnosticResult<unknown>, current: GithubRateLimit): GithubRateLimit {
  const headers = result.diagnostics.capturedHeaders;
  if (!headers) return current;
  const number = (value: string | undefined) => (value === undefined ? undefined : Number(value));
  const reset = number(headers["x-ratelimit-reset"]);
  return {
    limit: number(headers["x-ratelimit-limit"]) ?? current.limit,
    remaining: number(headers["x-ratelimit-remaining"]) ?? current.remaining,
    resetAt: reset === undefined || Number.isNaN(reset) ? current.resetAt : new Date(reset * 1000).toISOString(),
  };
}

function utcMinute(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function rateLimitLabel(rateLimit: GithubRateLimit) {
  if (rateLimit.remaining === undefined || rateLimit.limit === undefined) return "unknown";
  return `${rateLimit.remaining} / ${rateLimit.limit} requests remaining`;
}

/**
 * Reads one workflow's recent history. Costs one request, plus one more for the jobs of the latest
 * run only when that run failed — never for a successful run, and never for older runs.
 */
async function checkWorkflow(
  workflow: MonitoredWorkflow,
  now: Date,
  request: DiagnosticFetcher,
  rateLimit: GithubRateLimit,
): Promise<{ health: MonitorHealth; rateLimit: GithubRateLimit }> {
  const checkedAt = now.toISOString();
  const base = { id: workflow.id, name: workflow.name };
  const cadence = describeCadence(workflow.cadence);

  const response = await githubGet<unknown>(workflowRunsUrl(workflow.file), request);
  let nextRateLimit = readRateLimit(response, rateLimit);

  if (!response.ok) {
    const transportFailure = response.errorType === "NETWORK_ERROR" || response.errorType === "TIMEOUT";
    return {
      rateLimit: nextRateLimit,
      // Never claim the workflow failed: we could not verify it at all.
      health: evaluateHealth({
        ...base,
        checkedAt,
        latencyMs: response.diagnostics.latencyMs,
        httpStatus: response.diagnostics.httpStatus,
        networkOk: !transportFailure,
        parseOk: response.errorType !== "PARSE_ERROR",
        errorType: response.errorType,
        errorMessage:
          `GitHub Actions status unavailable — ${response.message} ` +
          `The workflow itself may be perfectly fine; this check could not verify it.`,
        details: {
          workflowFile: workflow.file,
          expectedCadence: cadence,
          githubApi: rateLimitLabel(nextRateLimit),
          _workflowStatusKnown: false,
        },
      }),
    };
  }

  const parsed = parseRunsPayload(response.data);
  if (!parsed.ok) {
    return {
      rateLimit: nextRateLimit,
      health: evaluateHealth({
        ...base,
        checkedAt,
        latencyMs: response.diagnostics.latencyMs,
        httpStatus: response.diagnostics.httpStatus,
        networkOk: true,
        parseOk: true,
        schemaOk: false,
        errorMessage: `GitHub Actions status unavailable — ${parsed.message}`,
        details: {
          workflowFile: workflow.file,
          expectedCadence: cadence,
          githubApi: rateLimitLabel(nextRateLimit),
          _workflowStatusKnown: false,
        },
      }),
    };
  }

  const runs = parsed.runs;
  const latest: WorkflowRun | undefined = runs[0];
  const lastSuccess = findLastSuccess(runs);
  const consecutiveFailures = countConsecutiveFailures(runs);
  const running = latest ? isInFlight(latest) : false;
  const latestFailed = latest ? isFailure(latest) : false;
  const scheduleStale = isScheduleStale(latest, workflow.cadence, now);

  let failure: ReturnType<typeof findFailure>;
  if (latest && latestFailed) {
    const jobs = await githubGet<unknown>(runJobsUrl(latest.id), request);
    nextRateLimit = readRateLimit(jobs, nextRateLimit);
    if (jobs.ok) failure = findFailure(parseJobsPayload(jobs.data));
  }

  const details: Record<string, unknown> = {
    workflowFile: workflow.file,
    expectedCadence: cadence,
    githubApi: rateLimitLabel(nextRateLimit),
    consecutiveFailures,
    _workflowStatusKnown: true,
  };
  if (latest) {
    details.latestRun = `#${latest.run_number}`;
    details.conclusion = (latest.conclusion ?? latest.status).toUpperCase();
    details.event = latest.event;
    details.lastRun = utcMinute(latest.created_at);
    if (latest.html_url) details.runUrl = latest.html_url;
  }
  if (lastSuccess) {
    details.lastSuccessfulRun = `#${lastSuccess.run_number}`;
    details.lastSuccessAt = utcMinute(lastSuccess.updated_at);
  }
  if (failure) {
    details.failedJob = failure.job;
    if (failure.step) details.failedStep = failure.step;
    if (failure.startedAt) details.failureStarted = utcMinute(failure.startedAt);
    if (failure.completedAt) details.failureFinished = utcMinute(failure.completedAt);
  }

  const ageSeconds = latest ? (now.getTime() - Date.parse(latest.created_at)) / 1000 : undefined;

  return {
    rateLimit: nextRateLimit,
    health: evaluateHealth({
      ...base,
      checkedAt,
      latencyMs: response.diagnostics.latencyMs,
      httpStatus: response.diagnostics.httpStatus,
      networkOk: true,
      parseOk: true,
      schemaOk: true,
      recordCount: runs.length,
      allowEmpty: true,
      dataTime: latest?.created_at,
      lastSuccess: lastSuccess?.updated_at,
      ageSeconds,
      fatalError: latestFailed
        ? {
            type: "WORKFLOW_FAILED" as const,
            message:
              `Run #${latest?.run_number} finished with conclusion ${latest?.conclusion}` +
              (failure ? `, failing in job "${failure.job}"${failure.step ? ` at step "${failure.step}"` : ""}` : "") +
              (consecutiveFailures > 1 ? `. ${consecutiveFailures} consecutive failed runs.` : "."),
          }
        : undefined,
      // A missing trigger is not a failing run, and the message must not blur the two.
      stale: !latestFailed && !running && scheduleStale,
      errorType: !latestFailed && !running && scheduleStale ? ("WORKFLOW_NOT_RUN" as const) : undefined,
      errorMessage:
        !latestFailed && !running && scheduleStale
          ? latest
            ? `No recent scheduled workflow run was observed. The newest run is #${latest.run_number} from ` +
              `${utcMinute(latest.created_at)}; this workflow is expected to run ${cadence}. The run itself did ` +
              `not fail — it did not happen.`
            : `No workflow runs are visible at all for ${workflow.file}.`
          : undefined,
      infoNote: running
        ? `Run #${latest?.run_number} is ${latest?.status.replace("_", " ")}. A run in flight is not a failure.`
        : undefined,
      details,
    }),
  };
}

/**
 * Read-only GitHub Actions pipeline health for the monitored workflows.
 *
 * Anonymous GETs only, and cached hard: GitHub allows 60 unauthenticated requests per hour per IP,
 * while the dashboard refreshes every 60 seconds.
 */
export async function checkPipelines(options: PipelineCheckOptions = {}): Promise<MonitorHealth[]> {
  const now = options.now ?? new Date();
  const request = options.request ?? defaultRequest;
  const cache = options.cache ?? sharedCache;

  const remaining = cache.rateLimit?.remaining;
  const interval =
    remaining !== undefined && remaining <= GITHUB_LOW_RATE_LIMIT_REMAINING
      ? GITHUB_LOW_RATE_LIMIT_INTERVAL_MS
      : GITHUB_ACTIONS_CHECK_INTERVAL_MS;

  if (cache.fetchedAt !== undefined && cache.monitors && now.getTime() - cache.fetchedAt < interval) {
    const ageMinutes = Math.floor((now.getTime() - cache.fetchedAt) / 60_000);
    return cache.monitors.map((monitor) => ({
      ...monitor,
      details: { ...monitor.details, source: `cached ${ageMinutes} min ago (GitHub polled every ${interval / 60_000} min)` },
    }));
  }

  let rateLimit: GithubRateLimit = cache.rateLimit ?? {};
  const monitors: MonitorHealth[] = [];
  // Sequential on purpose: the rate-limit budget is shared and must be observed as it drops.
  for (const workflow of MONITORED_WORKFLOWS) {
    const result = await checkWorkflow(workflow, now, request, rateLimit);
    rateLimit = result.rateLimit;
    monitors.push({ ...result.health, details: { ...result.health.details, source: "live" } });
  }

  cache.fetchedAt = now.getTime();
  cache.monitors = monitors;
  cache.rateLimit = rateLimit;
  return monitors;
}
