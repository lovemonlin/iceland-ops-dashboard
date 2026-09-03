import { getSystemStatus } from "@/health/evaluate";
import type { HealthStatus, MonitorHealth } from "@/health/model";

export interface DashboardEvent {
  key: string;
  /** ISO 8601 check time. */
  at: string;
  label: string;
  status: HealthStatus;
  detail?: string;
}

/** Session-scoped only: nothing is persisted in phase one. */
export const MAX_SESSION_EVENTS = 40;

export function statusMap(monitors: MonitorHealth[]): Record<string, HealthStatus> {
  return Object.fromEntries(monitors.map((monitor) => [monitor.id, monitor.status]));
}

/**
 * Appends the newest check to the session log: one line per source on the first
 * check, then one cycle line plus a line for every source whose status changed.
 */
export function recordCheck(
  existing: DashboardEvent[],
  monitors: MonitorHealth[],
  previousStatuses: Record<string, HealthStatus> | null,
  checkedAt: string,
): DashboardEvent[] {
  if (previousStatuses === null) {
    const seed = monitors.map((monitor) => ({
      key: `${checkedAt}-${monitor.id}`,
      at: checkedAt,
      label: monitor.name,
      status: monitor.status,
      detail: monitor.errorType ?? "first check",
    }));
    return [...seed, ...existing].slice(0, MAX_SESSION_EVENTS);
  }

  const changed = monitors
    .filter((monitor) => previousStatuses[monitor.id] !== monitor.status)
    .map((monitor) => ({
      key: `${checkedAt}-${monitor.id}`,
      at: checkedAt,
      label: monitor.name,
      status: monitor.status,
      detail: `${(previousStatuses[monitor.id] ?? "unknown").toUpperCase()} → ${monitor.status.toUpperCase()}`,
    }));

  const cycle: DashboardEvent = {
    key: `${checkedAt}-cycle`,
    at: checkedAt,
    label: `Check cycle (${monitors.length} sources)`,
    status: getSystemStatus(monitors),
    detail: changed.length === 0 ? "no change" : `${changed.length} changed`,
  };

  return [...changed, cycle, ...existing].slice(0, MAX_SESSION_EVENTS);
}
