import {
  GITHUB_ACTIONS_CHECK_INTERVAL_MS,
  GITHUB_LOW_RATE_LIMIT_INTERVAL_MS,
  GITHUB_LOW_RATE_LIMIT_REMAINING,
  MONITORED_WORKFLOWS,
  runJobsUrl,
  workflowRunsUrl,
  type MonitoredWorkflow,
} from "@/config/github";
import { evaluateHealth } from "@/health/evaluate";
import { githubGet } from "@/monitors/github/client";
import type { MonitorHealth } from "@/health/model";
import {
  fetchWithDiagnosticsCore,
  type DiagnosticFetcher,
  type DiagnosticResult,
} from "@/lib/fetchWithDiagnosticsCore";
import {
  describeConfiguredSchedule,
  readMetadata,
  type MetadataCache,
  type MetadataSnapshot,
  type WorkflowMetadata,
} from "@/monitors/github/metadata";
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
  /** Scheduler metadata has its own, much longer window. */
  metadata?: MetadataCache;
}

export function createPipelineCache(): PipelineCache {
  return { metadata: {} };
}

const sharedCache = createPipelineCache();

export interface PipelineCheckOptions {
  now?: Date;
  request?: DiagnosticFetcher;
  cache?: PipelineCache;
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
  metadata: MetadataSnapshot,
): Promise<{ health: MonitorHealth; rateLimit: GithubRateLimit }> {
  const checkedAt = now.toISOString();
  const base = { id: workflow.id, name: workflow.name };
  const cadence = describeCadence(workflow.cadence);
  const scheduler: WorkflowMetadata = metadata.byWorkflow[workflow.id] ?? { cron: [], unavailable: "not read" };
  const schedulerDetails = schedulerDetailFields(scheduler, metadata);

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
          alertingRule: cadence,
          ...schedulerDetails,
          githubApi: rateLimitLabel(nextRateLimit),
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
          alertingRule: cadence,
          ...schedulerDetails,
          githubApi: rateLimitLabel(nextRateLimit),
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

  // Reaching here means the run history was read, so this attempt collected data.
  const data: Record<string, unknown> = { consecutiveFailures };
  if (latest) {
    data.latestRun = `#${latest.run_number}`;
    data.conclusion = (latest.conclusion ?? latest.status).toUpperCase();
    data.event = latest.event;
    data.lastRun = utcMinute(latest.created_at);
    if (latest.html_url) data.runUrl = latest.html_url;
  }
  if (lastSuccess) {
    data.lastSuccessfulRun = `#${lastSuccess.run_number}`;
    data.lastSuccessAt = utcMinute(lastSuccess.updated_at);
  }
  if (failure) {
    data.failedJob = failure.job;
    if (failure.step) data.failedStep = failure.step;
    if (failure.startedAt) data.failureStarted = utcMinute(failure.startedAt);
    if (failure.completedAt) data.failureFinished = utcMinute(failure.completedAt);
  }

  const details: Record<string, unknown> = {
    workflowFile: workflow.file,
    ...schedulerDetails,
    alertingRule: cadence,
    githubApi: rateLimitLabel(nextRateLimit),
    ...data,
  };

  const ageSeconds = latest ? (now.getTime() - Date.parse(latest.created_at)) / 1000 : undefined;
  if (ageSeconds !== undefined) details.lastObservedRunAge = `${Math.floor(ageSeconds / 60)} min ago`;

  // A workflow GitHub will not trigger, or a file that is not on the branch GitHub schedules from,
  // outranks anything the run history can say.
  const disabled = scheduler.state !== undefined && scheduler.state !== "active";
  const fileMissing = scheduler.fileOnDefaultBranch === false;
  // Without a schedule in the file, a missing scheduled run is expected, not a fault.
  const scheduled = scheduler.scheduleMissing !== true;
  const noRecentRun = scheduled && !latestFailed && !running && scheduleStale;

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
      fatalError: disabled
        ? {
            type: "WORKFLOW_DISABLED" as const,
            message:
              `GitHub reports this workflow as "${scheduler.state}", so it cannot be triggered. ` +
              `No schedule will fire until it is active again.`,
          }
        : fileMissing
          ? {
              type: "SCHEMA_ERROR" as const,
              message:
                `${scheduler.path ?? workflow.file} was not found on the default branch ` +
                `(${metadata.repository.defaultBranch ?? "unknown"}), which is the branch GitHub ` +
                `schedules from.`,
            }
          : latestFailed
        ? {
            type: "WORKFLOW_FAILED" as const,
            message:
              `Run #${latest?.run_number} finished with conclusion ${latest?.conclusion}` +
              (failure ? `, failing in job "${failure.job}"${failure.step ? ` at step "${failure.step}"` : ""}` : "") +
              (consecutiveFailures > 1 ? `. ${consecutiveFailures} consecutive failed runs.` : "."),
          }
        : undefined,
      // A missing trigger is not a failing run, and the message must not blur the two.
      stale: noRecentRun,
      errorType: noRecentRun ? ("WORKFLOW_NOT_RUN" as const) : undefined,
      errorMessage: noRecentRun ? missingRunMessage(workflow, latest, scheduler, metadata) : undefined,
      data,
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
  cache.metadata ??= {};
  const metadata = await readMetadata(MONITORED_WORKFLOWS, now, request, cache.metadata);
  const monitors: MonitorHealth[] = [];
  // Sequential on purpose: the rate-limit budget is shared and must be observed as it drops.
  for (const workflow of MONITORED_WORKFLOWS) {
    const result = await checkWorkflow(workflow, now, request, rateLimit, metadata);
    rateLimit = result.rateLimit;
    monitors.push({ ...result.health, details: { ...result.health.details, source: "live" } });
  }

  cache.fetchedAt = now.getTime();
  cache.monitors = monitors;
  cache.rateLimit = rateLimit;
  return monitors;
}

/** Scheduler-side facts, kept separate from the alerting rule so neither is read as the other. */
function schedulerDetailFields(scheduler: WorkflowMetadata, metadata: MetadataSnapshot) {
  const fields: Record<string, unknown> = {};
  if (scheduler.state) fields.workflowState = scheduler.state.toUpperCase();
  if (metadata.repository.defaultBranch) fields.defaultBranch = metadata.repository.defaultBranch;
  if (scheduler.fileOnDefaultBranch !== undefined) {
    fields.fileOnDefaultBranch = scheduler.fileOnDefaultBranch ? "yes" : "NO";
  }
  const schedule = describeConfiguredSchedule(scheduler);
  if (schedule) fields.configuredSchedule = schedule;
  else if (scheduler.scheduleMissing) fields.configuredSchedule = "none declared";
  if (scheduler.unavailable) fields.schedulerMetadata = `unavailable (${scheduler.unavailable})`;

  const platform = metadata.platform;
  if (platform.unavailable) fields.githubPlatformStatus = "unavailable";
  else if (platform.description) {
    fields.githubPlatformStatus =
      `${platform.description}${platform.actions ? ` · Actions ${platform.actions}` : ""}` +
      `${platform.unresolvedIncidents ? ` · ${platform.unresolvedIncidents} open incident(s)` : ""}`;
  }
  return fields;
}

/**
 * States only what is verified: the workflow is active, its schedule exists on the default branch,
 * and GitHub has not created a matching run. It never asserts that the GitHub scheduler is broken.
 */
function missingRunMessage(
  workflow: MonitoredWorkflow,
  latest: WorkflowRun | undefined,
  scheduler: WorkflowMetadata,
  metadata: MetadataSnapshot,
) {
  if (!latest) return `No workflow runs are visible at all for ${workflow.file}.`;

  const verified: string[] = [];
  if (scheduler.state === "active") verified.push("The workflow is active");
  if (scheduler.fileOnDefaultBranch && scheduler.cron.length > 0) {
    verified.push(`its schedule exists on the default branch (${metadata.repository.defaultBranch ?? "unknown"})`);
  }

  return (
    `No recent scheduled workflow run was observed. The newest run is #${latest.run_number} from ` +
    `${utcMinute(latest.created_at)}. ` +
    (verified.length > 0 ? `${verified.join(" and ")}, but ` : "") +
    `GitHub has not created a recent run matching the configured schedule. The run itself did not ` +
    `fail — it did not happen.`
  );
}
