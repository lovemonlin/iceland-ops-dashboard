import { MONITOR_IDS } from "@/config/monitors";
import type { MonitorHealth } from "@/health/model";
import type { DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";
import { checkEcmwf } from "@/monitors/ecmwf/monitor";
import { checkPipelines } from "@/monitors/github/monitor";
import { checkImo } from "@/monitors/imo/monitor";
import { checkIrca } from "@/monitors/irca/monitor";
import { checkMetno } from "@/monitors/metno/monitor";
import { checkNoaaKp, checkOvation, checkSolarWind } from "@/monitors/noaa/monitor";

export interface HealthSnapshot {
  checkedAt: string;
  monitors: MonitorHealth[];
}

export interface RunOptions {
  now?: Date;
  request?: DiagnosticFetcher;
}

const order = new Map(MONITOR_IDS.map((id, index) => [id as string, index]));

/** Identifies a check so a thrown error can still become a MonitorHealth. */
interface LiveCheck {
  covers: { id: string; name: string }[];
  run: Promise<MonitorHealth[]>;
}

/**
 * Runs every monitor. All of them read real production sources — there is deliberately no mock data
 * path here, so nothing the dashboard publishes can be a placeholder.
 *
 * Checks run concurrently and are settled individually, so one failing source can never stop the
 * snapshot from being produced: a rejected check still becomes a MonitorHealth.
 */
export async function runAllMonitors(options: RunOptions = {}): Promise<HealthSnapshot> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const request = options.request;

  const one = (id: string, name: string, run: Promise<MonitorHealth>): LiveCheck => ({
    covers: [{ id, name }],
    run: run.then((health) => [health]),
  });

  const live: LiveCheck[] = [
    one("metno", "MET Norway Weather", checkMetno({ now, request })),
    one("irca", "IRCA Roads", checkIrca({ now, request })),
    one("noaaKp", "NOAA Kp", checkNoaaKp({ now, request })),
    one("solarWind", "NOAA Solar Wind", checkSolarWind({ now, request })),
    one("ovation", "NOAA OVATION", checkOvation({ now, request })),
    one("ecmwf", "ECMWF Cloud Forecast", checkEcmwf({ now, request })),
    one("imo", "IMO Warnings", checkImo({ now, request })),
    {
      covers: [
        { id: "ircaPipeline", name: "IRCA Road Publisher" },
        { id: "ecmwfPipeline", name: "ECMWF Cloud Publisher" },
      ],
      run: checkPipelines({ now, request }),
    },
  ];

  const settled = await Promise.allSettled(live.map((check) => check.run));
  const monitors = settled
    .flatMap((result, index) => {
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
    })
    .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  return { checkedAt, monitors };
}
