/**
 * ECMWF cloud-forecast production contract.
 *
 * The dashboard never touches ECMWF Open Data or GRIB2 directly. It only reads what the
 * `iceland-aurora-cloud` pipeline has already published to GitHub Pages, read-only.
 */

export const ECMWF_PUBLIC_BASE_URL = "https://lovemonlin.github.io/iceland-aurora-cloud";
export const ECMWF_MANIFEST_URL = `${ECMWF_PUBLIC_BASE_URL}/manifest.json`;

/** ECMWF IFS Open Data model cycles, in UTC hours. */
export const ECMWF_CYCLE_HOURS = [0, 6, 12, 18] as const;
export type EcmwfCycleHour = (typeof ECMWF_CYCLE_HOURS)[number];

/** Frames run 0–48 h inclusive, one every 3 h, so a healthy manifest carries 17 of them. */
export const ECMWF_FRAME_STEP_HOURS = 3;
export const ECMWF_FORECAST_HORIZON_HOURS = 48;
export const ECMWF_EXPECTED_FRAME_COUNT = ECMWF_FORECAST_HORIZON_HOURS / ECMWF_FRAME_STEP_HOURS + 1;

/**
 * When each model cycle should be published by our own cloud pipeline, in UTC.
 *
 * This is a *production* deadline, not an ECMWF one: it combines ECMWF Open Data's own
 * dissemination delay with the cloud workflow's fixed schedule (every 3 h at :20 UTC).
 * A run is only "late" once its deadline has passed — before that, still seeing the previous
 * run is entirely normal and must never be reported as STALE.
 *
 * `dayOffset` is days added to the run's own UTC date, which is what makes 18Z roll into
 * the following UTC day.
 *
 * TODO: these deadlines are agreed operational values, not an ECMWF guarantee. Revisit if the
 * cloud workflow schedule changes.
 */
export const ECMWF_PUBLICATION_DEADLINES: Record<EcmwfCycleHour, { dayOffset: number; hour: number; minute: number }> = {
  0: { dayOffset: 0, hour: 9, minute: 45 },
  6: { dayOffset: 0, hour: 15, minute: 45 },
  12: { dayOffset: 0, hour: 21, minute: 45 },
  18: { dayOffset: 1, hour: 3, minute: 45 },
};

/** Image probes are HEAD requests, so they should be quick; they never download a frame. */
export const ECMWF_IMAGE_PROBE_TIMEOUT_MS = 8_000;
