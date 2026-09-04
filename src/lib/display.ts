import { SNAPSHOT_INTERVAL_MINUTES, SNAPSHOT_OVERDUE_MINUTES } from "@/config/snapshot";
import type { HealthStatus } from "@/health/model";
import { formatShortClock, TAIWAN_TIME_ZONE } from "@/lib/time";
import type { SnapshotSource } from "@/snapshot/types";

/**
 * Presentation layer only.
 *
 * Everything here reads the snapshot exactly as the collector wrote it and turns it into words a
 * traveller can act on. Nothing in this file decides health: `status`, `errorType` and freshness
 * are the monitors' verdicts, and these functions only choose how to say them.
 */

/**
 * How a thing should *look*, which is not the same as its health status.
 *
 * `info` is healthy and must never be painted like a failure, and `stale`/`degraded` share one
 * "worth a look" colour so red is reserved for something actually broken.
 */
export type DisplayTone = "ok" | "info" | "warn" | "error";

const TONES: Record<HealthStatus, DisplayTone> = {
  ok: "ok",
  info: "info",
  stale: "warn",
  degraded: "warn",
  error: "error",
};

export const TONE_DOT: Record<DisplayTone, string> = { ok: "🟢", info: "🔵", warn: "🟡", error: "🔴" };

/**
 * Plain-language cause, keyed on what the monitor actually determined.
 *
 * The distinction that matters: a fetch that failed and a source that simply has not published
 * anything new are different problems, and must never share a label.
 */
const CAUSE_LABELS: Record<string, string> = {
  NETWORK_ERROR: "無法取得資料",
  TIMEOUT: "無法取得資料",
  HTTP_ERROR: "無法取得資料",
  PARSE_ERROR: "資料格式異常",
  SCHEMA_ERROR: "資料格式異常",
  INVALID_TIMESTAMP: "資料時間異常",
  EMPTY_DATA: "來源沒有回傳資料",
  STALE_DATA: "來源資料過舊",
  WORKFLOW_NOT_RUN: "更新排程未執行",
  WORKFLOW_FAILED: "更新排程執行失敗",
  WORKFLOW_DISABLED: "更新排程已停用",
  UNKNOWN: "狀態異常",
};

export interface StatusDisplay {
  tone: DisplayTone;
  label: string;
}

/** The badge for one source: a colour that matches severity and a label anyone can read. */
export function formatSourceStatus(entry: Pick<SnapshotSource, "status" | "errorType">): StatusDisplay {
  const tone = TONES[entry.status];
  if (tone === "ok" || tone === "info") return { tone, label: "正常" };

  const cause = entry.errorType ? CAUSE_LABELS[entry.errorType] : undefined;
  // "stale" already means the data is old, so it says so plainly. Only at "error" is it worth
  // pointing the finger at the source, which is where the extra word earns its place.
  if (entry.status === "stale" && (cause === undefined || entry.errorType === "STALE_DATA")) {
    return { tone, label: "資料過舊" };
  }
  return { tone, label: cause ?? (entry.status === "degraded" ? "部分資料異常" : "資料過舊") };
}

/**
 * Whether the collection itself worked.
 *
 * A source can be unhealthy for two completely different reasons, and the card must say which:
 * we could not reach it, or we reached it fine and it had nothing newer to give.
 */
export function collectionSucceeded(entry: Pick<SnapshotSource, "errorType" | "diagnostics">): boolean {
  if (entry.errorType === "NETWORK_ERROR" || entry.errorType === "TIMEOUT" || entry.errorType === "HTTP_ERROR") {
    return false;
  }
  const status = entry.diagnostics?.httpStatus;
  return status !== undefined && status >= 200 && status < 400;
}

/** One sentence saying whether the problem is ours or the source's. */
export function describeCollection(entry: Pick<SnapshotSource, "status" | "errorType" | "diagnostics">): string {
  if (entry.status === "ok" || entry.status === "info") return "連線成功，資料正常取得。";
  if (!collectionSucceeded(entry)) return "無法連上來源，這次沒有取得資料。";
  if (entry.errorType === "WORKFLOW_NOT_RUN") return "連線成功，但上游的更新排程沒有執行。";
  return "連線成功，但來源沒有發布更新資料。";
}

/**
 * The weather-warnings headline.
 *
 * Zero active warnings is the good news the whole card exists to deliver, and the API answers it
 * with `204 No Content` — so "0 records" must never be shown as if something were missing.
 */
export function formatWarningsHeadline(entry: Pick<SnapshotSource, "status" | "errorType" | "diagnostics" | "data">): string {
  if (!collectionSucceeded(entry)) return describeCollection(entry);
  const active = entry.data?.activeWarnings;
  if (typeof active !== "number") return describeCollection(entry);
  return active === 0
    ? "冰島氣象局目前沒有發布有效天氣警報。"
    : `冰島氣象局目前發布了 ${active} 則有效天氣警報。`;
}

/** What kicked off the collection, in words rather than a workflow event name. */
const TRIGGER_LABELS: Record<string, string> = {
  windows: "Windows 自動更新",
  workflow_dispatch: "GitHub 手動更新",
  schedule: "GitHub 自動排程",
  push: "GitHub 外部觸發",
  local: "本機手動更新",
};

export function formatTrigger(trigger: string | undefined): string {
  if (!trigger) return "未知來源";
  return TRIGGER_LABELS[trigger] ?? trigger;
}

/** "剛剛", "12 分鐘前", "2 小時 54 分鐘前", "1 天 3 小時前". */
export function formatRelativeAge(minutes: number | undefined): string {
  if (minutes === undefined || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  if (total < 1) return "剛剛";
  if (total < 60) return `${total} 分鐘前`;
  if (total < 1440) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${hours} 小時前` : `${hours} 小時 ${rest} 分鐘前`;
  }
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  return hours === 0 ? `${days} 天前` : `${days} 天 ${hours} 小時前`;
}

/** Taipei is the reader's clock, so it is the one shown first everywhere. */
export function formatTaipeiTime(iso: string | undefined): string {
  return iso ? formatShortClock(iso, TAIWAN_TIME_ZONE) : "—";
}

export interface HealthSummary {
  /** ok and info together: nothing to do. */
  normal: number;
  /** stale and degraded: worth a look, not an outage. */
  attention: number;
  /** error only. */
  failing: number;
  tone: DisplayTone;
  headline: string;
}

/**
 * The one line at the top of the page.
 *
 * A single stale source used to render as "OVERALL: ERROR", which reads as "the whole thing is
 * down". The counts are unchanged — only the headline is written from the traveller's side.
 */
export function formatHealthSummary(entries: Pick<SnapshotSource, "status">[]): HealthSummary {
  const count = (statuses: HealthStatus[]) => entries.filter((entry) => statuses.includes(entry.status)).length;
  const normal = count(["ok", "info"]);
  const attention = count(["stale", "degraded"]);
  const failing = count(["error"]);

  if (failing > 0) return { normal, attention, failing, tone: "error", headline: "部分資料來源異常" };
  if (attention > 0) return { normal, attention, failing, tone: "warn", headline: "部分資料來源需要注意" };
  return { normal, attention, failing, tone: "ok", headline: "所有主要資料來源正常" };
}

export interface SnapshotFreshness {
  overdue: boolean;
  title: string;
  detail: string;
}

/**
 * Whether the dashboard itself has stopped updating — a different question from any source's
 * freshness, and the only case where the page should say something is broken at the top.
 */
export function formatSnapshotFreshness(ageMinutes: number | undefined): SnapshotFreshness {
  const overdue = ageMinutes !== undefined && ageMinutes > SNAPSHOT_OVERDUE_MINUTES;
  if (!overdue) {
    return { overdue: false, title: "Dashboard 已更新", detail: `每 ${SNAPSHOT_INTERVAL_MINUTES} 分鐘自動更新一次。` };
  }
  return {
    overdue: true,
    title: "Dashboard 尚未更新",
    detail:
      `最後一次 Dashboard 更新已是 ${ageMinutes} 分鐘前。` +
      `下方顯示的是上一份成功產生的資料快照，各來源狀態可能已經不是現在的情況。`,
  };
}

/** Rounds a percentage that arrives as a float, so a card never shows "38.3%". */
export function formatPercent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "—";
}

/** Bz is only meaningful with its sign, so it never loses the leading "+". */
export function formatSigned(value: unknown, unit: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value} ${unit}`;
}

export function formatNumber(value: unknown, unit = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return unit ? `${value} ${unit}` : String(value);
}
