import {
  GITHUB_METADATA_CACHE_MS,
  GITHUB_STATUS_SUMMARY_URL,
  repositoryUrl,
  workflowContentsUrl,
  workflowUrl,
  type MonitoredWorkflow,
} from "@/config/github";
import type { DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";
import { githubGet } from "@/monitors/github/client";
import { describeCron, extractCronSchedules } from "@/monitors/github/workflowFile";

/** What the scheduler-side diagnosis needs, none of which changes more than once in a blue moon. */
export interface WorkflowMetadata {
  /** GitHub's own workflow state: "active", "disabled_manually", "disabled_inactivity", ... */
  state?: string;
  path?: string;
  /** Whether the workflow file was found on the default branch. */
  fileOnDefaultBranch?: boolean;
  cron: string[];
  /** True when the file was read and contains no schedule at all. */
  scheduleMissing?: boolean;
  /** Set when the metadata could not be read; the runs-based diagnosis still applies. */
  unavailable?: string;
}

export interface RepositoryMetadata {
  defaultBranch?: string;
  unavailable?: string;
}

export interface GithubPlatformStatus {
  /** e.g. "All Systems Operational". Context only: it never changes any monitor's status. */
  description?: string;
  indicator?: string;
  actions?: string;
  unresolvedIncidents?: number;
  unavailable?: string;
}

export interface MetadataSnapshot {
  repository: RepositoryMetadata;
  byWorkflow: Record<string, WorkflowMetadata>;
  platform: GithubPlatformStatus;
}

export interface MetadataCache {
  fetchedAt?: number;
  snapshot?: MetadataSnapshot;
}

function decodeContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as { content?: unknown; encoding?: unknown };
  if (typeof value.content !== "string") return undefined;
  if (value.encoding !== undefined && value.encoding !== "base64") return undefined;
  try {
    return Buffer.from(value.content, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * Read-only platform status from GitHub's status page, which is a different service from the REST
 * API and takes none of its headers. Context only: failure here is never fatal and never changes a
 * monitor's status.
 */
async function readPlatformStatus(request: DiagnosticFetcher): Promise<GithubPlatformStatus> {
  const result = await request<unknown>(GITHUB_STATUS_SUMMARY_URL, { responseType: "json" });
  if (!result.ok) return { unavailable: result.message };

  const payload = result.data as {
    status?: { description?: string; indicator?: string };
    components?: { name?: string; status?: string }[];
    incidents?: unknown[];
  };
  return {
    description: payload.status?.description,
    indicator: payload.status?.indicator,
    actions: payload.components?.find((component) => component.name === "Actions")?.status,
    unresolvedIncidents: Array.isArray(payload.incidents) ? payload.incidents.length : undefined,
  };
}

async function readWorkflow(
  workflow: MonitoredWorkflow,
  defaultBranch: string | undefined,
  request: DiagnosticFetcher,
): Promise<WorkflowMetadata> {
  const details = await githubGet<unknown>(workflowUrl(workflow.file), request);
  if (!details.ok) return { cron: [], unavailable: details.message };

  const payload = details.data as { state?: unknown; path?: unknown };
  const metadata: WorkflowMetadata = {
    state: typeof payload.state === "string" ? payload.state : undefined,
    path: typeof payload.path === "string" ? payload.path : undefined,
    cron: [],
  };

  if (!defaultBranch || !metadata.path) return metadata;

  const file = await githubGet<unknown>(workflowContentsUrl(metadata.path, defaultBranch), request);
  if (!file.ok) {
    // A 404 here is a real finding: the workflow is not on the branch GitHub schedules from.
    metadata.fileOnDefaultBranch = file.diagnostics.httpStatus === 404 ? false : undefined;
    if (metadata.fileOnDefaultBranch === undefined) metadata.unavailable = file.message;
    return metadata;
  }

  const source = decodeContent(file.data);
  if (source === undefined) {
    metadata.unavailable = "Workflow file could not be decoded.";
    return metadata;
  }

  metadata.fileOnDefaultBranch = true;
  metadata.cron = extractCronSchedules(source);
  metadata.scheduleMissing = metadata.cron.length === 0;
  return metadata;
}

/**
 * Scheduler-side metadata: is the workflow active, which branch does GitHub schedule from, is the
 * file actually there, and what schedule does it declare.
 *
 * Cached for an hour: none of it changes often, and the unauthenticated GitHub budget is 60
 * requests per hour in total, shared with the far more valuable run listings.
 */
export async function readMetadata(
  workflows: MonitoredWorkflow[],
  now: Date,
  request: DiagnosticFetcher,
  cache: MetadataCache,
): Promise<MetadataSnapshot> {
  if (cache.fetchedAt !== undefined && cache.snapshot && now.getTime() - cache.fetchedAt < GITHUB_METADATA_CACHE_MS) {
    return cache.snapshot;
  }

  const repositoryResult = await githubGet<unknown>(repositoryUrl(), request);
  const repository: RepositoryMetadata = repositoryResult.ok
    ? { defaultBranch: (repositoryResult.data as { default_branch?: string }).default_branch }
    : { unavailable: repositoryResult.message };

  const byWorkflow: Record<string, WorkflowMetadata> = {};
  for (const workflow of workflows) {
    byWorkflow[workflow.id] = await readWorkflow(workflow, repository.defaultBranch, request);
  }

  const snapshot: MetadataSnapshot = { repository, byWorkflow, platform: await readPlatformStatus(request) };
  cache.fetchedAt = now.getTime();
  cache.snapshot = snapshot;
  return snapshot;
}

// The configured schedule as "<cron> (<plain English>)", never presented as a delivery guarantee.
export function describeConfiguredSchedule(metadata: WorkflowMetadata) {
  if (metadata.cron.length === 0) return undefined;
  return metadata.cron.map((cron) => `${cron} (${describeCron(cron)})`).join("; ");
}
