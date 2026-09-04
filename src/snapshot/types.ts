import type { HealthStatus } from "@/health/model";

/**
 * One source as stored in a snapshot.
 *
 * The central contract: `status` describes the **latest collection attempt**, while `data` holds
 * the **last successfully collected values**. A failed attempt updates the status and the error and
 * keeps the data, so the dashboard never blanks out just because one collection went wrong.
 */
export interface SnapshotSource {
  id: string;
  name: string;
  /** Result of the latest collection attempt. */
  status: HealthStatus;
  /** ISO 8601. When collection was last attempted. */
  lastAttemptAt: string;
  /** ISO 8601. When collection last produced data — may be older than `lastAttemptAt`. */
  lastSuccessAt?: string;
  /** ISO 8601. The timestamp carried by the stored data itself, from the source. */
  dataTime?: string;
  /** From the latest attempt only; cleared when an attempt succeeds. */
  errorType?: string;
  errorMessage?: string;
  /** Healthy-but-worth-saying note from the latest attempt. */
  note?: string;
  /** Where the data came from. Every published source is a real production endpoint. */
  provenance?: { mode: "production"; provider?: string };
  /** Last successfully collected values. Absent only if the source has never succeeded. */
  data?: Record<string, unknown>;
  /** Diagnostics for the latest attempt, not for the stored data. */
  diagnostics?: {
    httpStatus?: number;
    latencyMs?: number;
    recordCount?: number;
  };
}

/** A publishing pipeline is stored exactly like a source; only its meaning differs. */
export type SnapshotPipeline = SnapshotSource;

export interface DashboardSnapshot {
  schemaVersion: number;
  /** ISO 8601. When this snapshot was produced. */
  generatedAt: string;
  /** ISO 8601. When the next scheduled collection is expected. */
  scheduledFor?: string;
  /**
   * What started this collection: "schedule" for the hourly GitHub job, "workflow_dispatch" for a
   * manual run, "push" for the trigger file, "local" for `npm run snapshot` on a workstation.
   */
  trigger?: string;
  overallStatus: HealthStatus;
  sources: Record<string, SnapshotSource>;
  pipelines?: Record<string, SnapshotPipeline>;
  summary: Record<HealthStatus, number>;
}

/** Every stored entry, sources and pipelines together, in one list. */
export function allSnapshotEntries(snapshot: DashboardSnapshot): SnapshotSource[] {
  return [...Object.values(snapshot.sources), ...Object.values(snapshot.pipelines ?? {})];
}

export function snapshotEntry(snapshot: DashboardSnapshot, id: string): SnapshotSource | undefined {
  return snapshot.sources[id] ?? snapshot.pipelines?.[id];
}

/** Age of the whole snapshot in minutes — the *scheduler's* freshness, not any source's. */
export function snapshotAgeMinutes(snapshot: DashboardSnapshot, now: Date) {
  const generated = Date.parse(snapshot.generatedAt);
  if (Number.isNaN(generated)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - generated) / 60_000));
}
