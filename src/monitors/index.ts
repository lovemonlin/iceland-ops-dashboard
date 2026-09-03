import { MONITOR_IDS } from "@/config/monitors";
import type { MonitorHealth } from "@/health/model";
import { checkEcmwf, type DiagnosticFetcher } from "@/monitors/ecmwf/monitor";
import { getMockMonitors } from "@/monitors/mockMonitors";

export interface HealthSnapshot {
  checkedAt: string;
  monitors: MonitorHealth[];
}

export interface RunOptions {
  now?: Date;
  request?: DiagnosticFetcher;
}

const order = new Map(MONITOR_IDS.map((id, index) => [id as string, index]));

/**
 * Runs every monitor. Live checks run concurrently and are settled individually, so one failing
 * source can never stop the page from rendering — a rejected check still becomes a MonitorHealth.
 */
export async function runAllMonitors(options: RunOptions = {}): Promise<HealthSnapshot> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();

  const live: [string, string, Promise<MonitorHealth>][] = [
    ["ecmwf", "ECMWF Cloud Forecast", checkEcmwf({ now, request: options.request })],
  ];

  const settled = await Promise.allSettled(live.map(([, , promise]) => promise));
  const liveResults = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const [id, name] = live[index];
    return {
      id,
      name,
      status: "error" as const,
      checkedAt,
      networkOk: false,
      parseOk: false,
      errorType: "UNKNOWN" as const,
      errorMessage: `The check itself threw: ${result.reason instanceof Error ? result.reason.message : "unknown error"}`,
    };
  });

  const monitors = [...getMockMonitors(checkedAt), ...liveResults].sort(
    (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
  );

  return { checkedAt, monitors };
}
