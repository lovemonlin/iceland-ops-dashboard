/**
 * How old data may get, in seconds, before a monitor reports STALE.
 * These are conservative placeholders, not official source guarantees.
 * TODO: confirm each production source's documented update cadence before wiring its monitor.
 */
export const freshnessThresholds = {
  metno: { staleAfter: 7200 },
  noaaKp: { staleAfter: 21600 },
  solarWind: { staleAfter: 1800 },
  ovation: { staleAfter: 14400 },
  irca: { staleAfter: 10800 },
  ecmwf: { staleAfter: 54000 },
  imo: { staleAfter: 10800 },
} as const;

export type MonitorId = keyof typeof freshnessThresholds;
