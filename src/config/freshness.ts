import type { MockMonitorId } from "@/config/monitors";

/**
 * How old mock data may get, in seconds, before a monitor reports STALE.
 * These are conservative placeholders, not official source guarantees.
 * A monitor leaves this file when it goes live and gains its own freshness policy
 * (`src/config/ecmwf.ts`, `src/config/irca.ts`).
 * TODO: confirm each production source's documented update cadence before wiring its monitor.
 */
export const freshnessThresholds: Record<MockMonitorId, { staleAfter: number }> = {
  metno: { staleAfter: 7200 },
  noaaKp: { staleAfter: 21600 },
  solarWind: { staleAfter: 1800 },
  ovation: { staleAfter: 14400 },
  imo: { staleAfter: 10800 },
};
