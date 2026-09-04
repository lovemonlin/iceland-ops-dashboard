import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { SNAPSHOT_OVERDUE_MINUTES } from "../src/config/snapshot";
import {
  collectionSucceeded,
  describeCollection,
  formatHealthSummary,
  formatPercent,
  formatRelativeAge,
  formatSigned,
  formatSnapshotFreshness,
  formatSourceStatus,
  formatTaipeiTime,
  formatTrigger,
  formatWarningsHeadline,
} from "../src/lib/display";
import type { SnapshotSource } from "../src/snapshot/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const source = (over: Partial<SnapshotSource>): SnapshotSource => ({
  id: "test",
  name: "Test source",
  status: "ok",
  lastAttemptAt: "2026-09-04T14:07:05.038Z",
  ...over,
});

test("the trigger is named in words, not as a workflow event", () => {
  assert.equal(formatTrigger("windows"), "Windows 自動更新");
  assert.equal(formatTrigger("workflow_dispatch"), "GitHub 手動更新");
  assert.equal(formatTrigger("schedule"), "GitHub 自動排程");
  assert.equal(formatTrigger("push"), "GitHub 外部觸發");
  assert.equal(formatTrigger("local"), "本機手動更新");
  // An unfamiliar trigger is shown as-is rather than mislabelled.
  assert.equal(formatTrigger("cron"), "cron");
  assert.equal(formatTrigger(undefined), "未知來源");
});

test("stale data is described as old data, not as a failure", () => {
  const stale = formatSourceStatus(source({ status: "stale", errorType: "STALE_DATA" }));
  assert.equal(stale.label, "資料過舊");
  // Yellow, not red: old is not broken.
  assert.equal(stale.tone, "warn");

  // Past the error threshold it is red, and it says whose data is old.
  const failing = formatSourceStatus(source({ status: "error", errorType: "STALE_DATA" }));
  assert.equal(failing.label, "來源資料過舊");
  assert.equal(failing.tone, "error");
});

test("a workflow that never ran says so, at any severity", () => {
  assert.equal(formatSourceStatus(source({ status: "stale", errorType: "WORKFLOW_NOT_RUN" })).label, "更新排程未執行");
  assert.equal(formatSourceStatus(source({ status: "error", errorType: "WORKFLOW_NOT_RUN" })).label, "更新排程未執行");
});

test("each error cause gets its own words", () => {
  const label = (errorType: string) => formatSourceStatus(source({ status: "error", errorType })).label;
  assert.equal(label("NETWORK_ERROR"), "無法取得資料");
  assert.equal(label("TIMEOUT"), "無法取得資料");
  assert.equal(label("HTTP_ERROR"), "無法取得資料");
  assert.equal(label("SCHEMA_ERROR"), "資料格式異常");
  assert.equal(label("PARSE_ERROR"), "資料格式異常");
  assert.equal(label("WORKFLOW_FAILED"), "更新排程執行失敗");
  assert.equal(formatSourceStatus(source({ status: "degraded" })).label, "部分資料異常");
});

test("healthy and informational sources are both simply normal, and never red", () => {
  assert.deepEqual(formatSourceStatus(source({ status: "ok" })), { tone: "ok", label: "正常" });
  assert.deepEqual(formatSourceStatus(source({ status: "info" })), { tone: "info", label: "正常" });
});

test("a source we reached is never described as a failed fetch", () => {
  // The road feed: HTTP 200, collection fine, the authority simply has not published.
  const roads = source({
    status: "error",
    errorType: "STALE_DATA",
    diagnostics: { httpStatus: 200, latencyMs: 431, recordCount: 701 },
  });
  assert.equal(collectionSucceeded(roads), true);
  assert.equal(describeCollection(roads), "連線成功，但來源沒有發布更新資料。");
  assert.equal(describeCollection(roads).includes("無法連上"), false);

  // A real transport failure reads differently, which is the entire point.
  const unreachable = source({ status: "error", errorType: "NETWORK_ERROR" });
  assert.equal(collectionSucceeded(unreachable), false);
  assert.equal(describeCollection(unreachable), "無法連上來源，這次沒有取得資料。");

  // An HTTP error code is a failed fetch even though a response came back.
  assert.equal(collectionSucceeded(source({ errorType: "HTTP_ERROR", diagnostics: { httpStatus: 503 } })), false);
});

test("no active weather warning reads as good news, not as missing data", () => {
  // IMO answers "nothing to report" with 204 No Content and zero records.
  const imo = source({
    status: "info",
    diagnostics: { httpStatus: 204, latencyMs: 1228, recordCount: 0 },
    data: { activeWarnings: 0 },
  });
  assert.equal(formatSourceStatus(imo).label, "正常");
  assert.equal(formatWarningsHeadline(imo), "冰島氣象局目前沒有發布有效天氣警報。");

  const active = source({ status: "info", diagnostics: { httpStatus: 200 }, data: { activeWarnings: 3 } });
  assert.equal(formatWarningsHeadline(active), "冰島氣象局目前發布了 3 則有效天氣警報。");
});

test("the top line never calls one stale source a system failure", () => {
  const entries = [
    source({ status: "ok" }),
    source({ status: "ok" }),
    source({ status: "info" }),
    source({ status: "stale" }),
    source({ status: "degraded" }),
  ];
  const summary = formatHealthSummary(entries);
  assert.equal(summary.headline, "部分資料來源需要注意");
  assert.equal(summary.tone, "warn");
  assert.deepEqual([summary.normal, summary.attention, summary.failing], [3, 2, 0]);

  const failing = formatHealthSummary([...entries, source({ status: "error" })]);
  assert.equal(failing.headline, "部分資料來源異常");
  assert.equal(failing.tone, "error");

  const allGood = formatHealthSummary([source({ status: "ok" }), source({ status: "info" })]);
  assert.equal(allGood.headline, "所有主要資料來源正常");
  assert.deepEqual([allGood.normal, allGood.attention, allGood.failing], [2, 0, 0]);
});

test("an overdue snapshot says the dashboard stopped updating, not that Iceland is broken", () => {
  const fresh = formatSnapshotFreshness(12);
  assert.equal(fresh.overdue, false);

  const stale = formatSnapshotFreshness(SNAPSHOT_OVERDUE_MINUTES + 35);
  assert.equal(stale.overdue, true);
  assert.equal(stale.title, "Dashboard 尚未更新");
  assert.match(stale.detail, /125 分鐘前/);
  assert.match(stale.detail, /上一份成功產生的資料快照/);

  // Exactly at the threshold is still fine; only past it is overdue.
  assert.equal(formatSnapshotFreshness(SNAPSHOT_OVERDUE_MINUTES).overdue, false);
  assert.equal(formatSnapshotFreshness(undefined).overdue, false);
});

test("ages are read as ages, without arithmetic", () => {
  assert.equal(formatRelativeAge(0), "剛剛");
  assert.equal(formatRelativeAge(12), "12 分鐘前");
  assert.equal(formatRelativeAge(174), "2 小時 54 分鐘前");
  assert.equal(formatRelativeAge(120), "2 小時前");
  assert.equal(formatRelativeAge(1500), "1 天 1 小時前");
  assert.equal(formatRelativeAge(undefined), "—");
});

test("times are shown on the reader's clock", () => {
  // 14:07 UTC is 22:07 in Taipei; the header leads with the latter.
  assert.equal(formatTaipeiTime("2026-09-04T14:07:05.038Z"), "22:07");
  assert.equal(formatTaipeiTime(undefined), "—");
});

test("numbers are rounded and signed the way they are read", () => {
  assert.equal(formatPercent(38.3), "38%");
  assert.equal(formatPercent(undefined), "—");
  assert.equal(formatSigned(2, "nT"), "+2 nT");
  assert.equal(formatSigned(-4, "nT"), "-4 nT");
  assert.equal(formatSigned(0, "nT"), "0 nT");
});

test("the front page shows no HTTP code, latency or record count outside a disclosure", () => {
  const sections = read("src/components/SourceSections.tsx");
  // Those three live only in the collapsed technical block, which is in StatusCard.tsx.
  for (const engineering of ["httpStatus", "latencyMs", "recordCount"]) {
    assert.equal(sections.includes(engineering), false, `${engineering} must not reach a card face`);
  }

  const card = read("src/components/StatusCard.tsx");
  assert.match(card, /<details className="technical">/);
  assert.match(card, /<summary>技術詳細資料<\/summary>/);
  // Collapsed by default: an open attribute would defeat the whole point.
  assert.equal(/<details[^>]*\bopen\b/.test(card), false);
  assert.equal(/<details[^>]*\bopen\b/.test(sections), false);
  assert.equal(/<details[^>]*\bopen\b/.test(read("src/components/Dashboard.tsx")), false);
});

test("the pipelines are separated from the travel data", () => {
  const sections = read("src/components/SourceSections.tsx");
  assert.match(sections, /資料更新系統/);
  assert.match(sections, /查看 Pipeline 狀態/);
  assert.match(sections, /個來源更新排程延遲/);
});
