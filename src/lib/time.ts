export const ICELAND_TIME_ZONE = "Atlantic/Reykjavik";
export const TAIWAN_TIME_ZONE = "Asia/Taipei";

/**
 * All formatting is anchored to an explicit time zone so that server render and
 * client hydration agree, and so freshness is never read from the browser clock.
 */
function format(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", ...options }).format(new Date(iso));
}

/** "08:52:13" */
export function formatClock(iso: string, timeZone: string) {
  return format(iso, timeZone, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "08:52" */
export function formatShortClock(iso: string, timeZone: string) {
  return format(iso, timeZone, { hour: "2-digit", minute: "2-digit" });
}

/** "2026-09-03 08:52:13" */
export function formatDateTime(iso: string, timeZone: string) {
  const parts = format(iso, timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const [date, clock] = parts.split(", ");
  return `${date.split("/").reverse().join("-")} ${clock}`;
}

/** Compact age for dense tables: "42s", "8m 13s", "17h 57m", "2d 4h". */
export function formatAge(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  if (total < 86400) return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
  return `${Math.floor(total / 86400)}d ${Math.floor((total % 86400) / 3600)}h`;
}
