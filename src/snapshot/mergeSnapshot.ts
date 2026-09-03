import type { MonitorHealth } from "@/health/model";
import type { SnapshotSource } from "@/snapshot/types";

/**
 * Folds one collection attempt into what the snapshot already held for that source.
 *
 * The rule that matters: **a failed attempt never destroys the last good data.** Status, error and
 * diagnostics always describe the attempt that just ran; `data`, `dataTime` and `lastSuccessAt`
 * describe the most recent attempt that actually collected something.
 *
 * A monitor is treated as having collected data exactly when it produced a `data` payload.
 */
export function mergeSource(
  previous: SnapshotSource | undefined,
  monitor: MonitorHealth,
  attemptedAt: string,
): SnapshotSource {
  const collected = monitor.data !== undefined;

  const merged: SnapshotSource = {
    id: monitor.id,
    name: monitor.name,
    status: monitor.status,
    lastAttemptAt: attemptedAt,
  };

  // Success: take everything from this attempt, and drop any error the previous one left behind.
  // Failure: keep the stored data and the time it was collected, and record why this attempt failed.
  const lastSuccessAt = collected ? attemptedAt : previous?.lastSuccessAt;
  if (lastSuccessAt) merged.lastSuccessAt = lastSuccessAt;

  const dataTime = collected ? monitor.dataTime : previous?.dataTime;
  if (dataTime) merged.dataTime = dataTime;

  const data = collected ? monitor.data : previous?.data;
  if (data) merged.data = data;

  if (monitor.errorType) merged.errorType = monitor.errorType;
  if (monitor.errorMessage) merged.errorMessage = monitor.errorMessage;
  if (monitor.note) merged.note = monitor.note;

  const diagnostics: NonNullable<SnapshotSource["diagnostics"]> = {};
  if (monitor.httpStatus !== undefined) diagnostics.httpStatus = monitor.httpStatus;
  if (monitor.latencyMs !== undefined) diagnostics.latencyMs = monitor.latencyMs;
  if (monitor.recordCount !== undefined) diagnostics.recordCount = monitor.recordCount;
  if (Object.keys(diagnostics).length > 0) merged.diagnostics = diagnostics;

  return merged;
}

/**
 * Merges a whole round of results.
 * Sources the previous snapshot knew about but this round did not report are carried forward
 * untouched, so removing a monitor temporarily does not erase its history.
 */
export function mergeSources(
  previous: Record<string, SnapshotSource> | undefined,
  monitors: MonitorHealth[],
  attemptedAt: string,
): Record<string, SnapshotSource> {
  const merged: Record<string, SnapshotSource> = { ...(previous ?? {}) };
  for (const monitor of monitors) {
    merged[monitor.id] = mergeSource(previous?.[monitor.id], monitor, attemptedAt);
  }
  return merged;
}
