import { MONITOR_IDS } from "@/config/monitors";
import type { MonitorHealth } from "@/health/model";
import type { DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";
import { checkEcmwf } from "@/monitors/ecmwf/monitor";
import { checkPipelines } from "@/monitors/github/monitor";
import { checkIrca } from "@/monitors/irca/monitor";
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

/** Identifies a live check so a thrown error can still become a MonitorHealth. */
interface LiveCheck {
  covers: { id: string; name: string }[];
  run: Promise<MonitorHealth[]>;
}

/**
 * Runs every monitor. Live checks run concurrently and are settled individually, so one failing
 * source can never stop the page from rendering — a rejected check still becomes a MonitorHealth.
 */
export async function runAllMonitors(options: RunOptions = {}): Promise<HealthSnapshot> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const request = options.request;

  const live: LiveCheck[] = [
    {
      covers: [{ id: "ecmwf", name: "ECMWF Cloud Forecast" }],
      run: checkEcmwf({ now, request }).then((health) => [health]),
    },
    {
      covers: [{ id: "irca", name: "IRCA Roads" }],
      run: checkIrca({ now, request }).then((health) => [health]),
    },
    {
      covers: [
        { id: "ircaPipeline", name: "IRCA Road Publisher" },
        { id: "ecmwfPipeline", name: "ECMWF Cloud Publisher" },
      ],
      run: checkPipelines({ now, request }),
    },
  ];

  const settled = await Promise.allSettled(live.map((check) => check.run));
  const liveResults = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const reason = result.reason instanceof Error ? result.reason.message : "unknown error";
    return live[index].covers.map(({ id, name }) => ({
      id,
      name,
      status: "error" as const,
      checkedAt,
      networkOk: false,
      parseOk: false,
      errorType: "UNKNOWN" as const,
      errorMessage: `The check itself threw: ${reason}`,
    }));
  });

  const monitors = [...getMockMonitors(checkedAt), ...liveResults].sort(
    (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
  );

  return { checkedAt, monitors };
}
