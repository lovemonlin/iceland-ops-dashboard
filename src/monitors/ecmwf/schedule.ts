import {
  ECMWF_CYCLE_HOURS,
  ECMWF_PUBLICATION_DEADLINES,
  type EcmwfCycleHour,
} from "@/config/ecmwf";

const HOUR_MS = 3_600_000;
const CYCLE_INTERVAL_HOURS = 24 / ECMWF_CYCLE_HOURS.length;

export function isCycleHour(hour: number): hour is EcmwfCycleHour {
  return (ECMWF_CYCLE_HOURS as readonly number[]).includes(hour);
}

/** True when a timestamp lands exactly on a 00/06/12/18 UTC model cycle. */
export function isModelCycle(date: Date) {
  return (
    isCycleHour(date.getUTCHours()) &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/** The most recent model cycle at or before `now`. */
export function currentCycleStart(now: Date) {
  const hour = Math.floor(now.getUTCHours() / CYCLE_INTERVAL_HOURS) * CYCLE_INTERVAL_HOURS;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
}

export function nextCycle(runAt: Date) {
  return new Date(runAt.getTime() + CYCLE_INTERVAL_HOURS * HOUR_MS);
}

/**
 * When our cloud pipeline should have published this run.
 * The 18Z deadline carries `dayOffset: 1`, which is what makes it land at 03:45 the next UTC day.
 */
export function publicationDeadline(runAt: Date) {
  const hour = runAt.getUTCHours();
  if (!isCycleHour(hour)) throw new RangeError(`${runAt.toISOString()} is not a model cycle.`);
  const deadline = ECMWF_PUBLICATION_DEADLINES[hour];
  return new Date(
    Date.UTC(
      runAt.getUTCFullYear(),
      runAt.getUTCMonth(),
      runAt.getUTCDate() + deadline.dayOffset,
      deadline.hour,
      deadline.minute,
    ),
  );
}

/**
 * The newest model run our cloud pipeline should already have published by `now`.
 *
 * This is what makes "still on the previous run" different from "late": at 09:30 UTC the 00Z run
 * is not due yet, so the expected run is still the previous 18Z. At 10:00 UTC it is due.
 */
export function expectedModelRun(now: Date) {
  let candidate = currentCycleStart(now);
  // Two UTC days of candidates is far more than any real publication delay.
  for (let step = 0; step < 8; step += 1) {
    if (publicationDeadline(candidate).getTime() <= now.getTime()) return candidate;
    candidate = new Date(candidate.getTime() - CYCLE_INTERVAL_HOURS * HOUR_MS);
  }
  return candidate;
}

/** "2026-09-02 12Z" — how maintainers talk about a model run. */
export function formatModelRun(runAt: Date) {
  const date = runAt.toISOString().slice(0, 10);
  return `${date} ${String(runAt.getUTCHours()).padStart(2, "0")}Z`;
}

/** "09:45 UTC" — the deadline clock time, without the date. */
export function formatDeadlineClock(deadline: Date) {
  return `${String(deadline.getUTCHours()).padStart(2, "0")}:${String(deadline.getUTCMinutes()).padStart(2, "0")} UTC`;
}
