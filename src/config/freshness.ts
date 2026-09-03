export const freshnessThresholds = {
  metno: { warningAfter: 3600, staleAfter: 7200 }, noaaKp: { warningAfter: 10800, staleAfter: 21600 }, solarWind: { warningAfter: 900, staleAfter: 1800 }, ovation: { warningAfter: 7200, staleAfter: 14400 }, irca: { warningAfter: 3600, staleAfter: 10800 }, ecmwf: { warningAfter: 32400, staleAfter: 54000 }, imo: { warningAfter: 3600, staleAfter: 10800 },
} as const;
export type MonitorId = keyof typeof freshnessThresholds;
