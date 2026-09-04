"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuroraSection, PipelineSection, RoadsSection, WarningsSection, WeatherSection } from "@/components/SourceSections";
import { StatusPill } from "@/components/StatusCard";
import { LIVE_MONITOR_IDS, MONITOR_IDS, PIPELINE_MONITOR_IDS } from "@/config/monitors";
import { SNAPSHOT_INTERVAL_MINUTES, SNAPSHOT_RELOAD_MS } from "@/config/snapshot";
import type { HealthStatus } from "@/health/model";
import {
  formatHealthSummary,
  formatRelativeAge,
  formatSnapshotFreshness,
  formatSourceStatus,
  formatTaipeiTime,
  formatTrigger,
  TONE_DOT,
} from "@/lib/display";
import { recordCheck, statusMap, type DashboardEvent } from "@/lib/events";
import { getSnapshotUrl } from "@/lib/publicPath";
import { formatShortClock, ICELAND_TIME_ZONE } from "@/lib/time";
import { buildIncidents, dataAgeMinutes, type IncidentGroup } from "@/monitors/correlate";
import { snapshotAgeMinutes, snapshotEntry, allSnapshotEntries, type DashboardSnapshot, type SnapshotSource } from "@/snapshot/types";

const dot: Record<HealthStatus, string> = { ok: "🟢", info: "🔵", stale: "🟡", degraded: "🟠", error: "🔴" };

export function Dashboard({ initialSnapshot }: { initialSnapshot: DashboardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [now, setNow] = useState(() => new Date(initialSnapshot.generatedAt));
  const [autoReload, setAutoReload] = useState(true);
  const [loading, setLoading] = useState(false);
  const [reloadError, setReloadError] = useState<string | undefined>();

  const [events, setEvents] = useState<DashboardEvent[]>(() =>
    recordCheck([], allSnapshotEntries(initialSnapshot), null, initialSnapshot.generatedAt),
  );
  const lastStatuses = useRef<Record<string, HealthStatus>>(statusMap(allSnapshotEntries(initialSnapshot)));
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Re-reads the snapshot file. This never contacts a production API — the hourly scheduled
   * collection is what refreshes the data; this only picks up what it wrote.
   */
  const reloadSnapshot = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      // Cache-busted so a redeployed snapshot is never hidden behind a cached copy.
      const response = await fetch(getSnapshotUrl({ cacheBust: true }), { cache: "no-store" });
      if (!response.ok) throw new Error(`snapshot file returned HTTP ${response.status}`);
      const next = (await response.json()) as DashboardSnapshot;
      if (!mounted.current) return;
      if (next.generatedAt !== snapshot.generatedAt) {
        const entries = allSnapshotEntries(next);
        setEvents((existing) => recordCheck(existing, entries, lastStatuses.current, next.generatedAt));
        lastStatuses.current = statusMap(entries);
        setSnapshot(next);
      }
      setNow(new Date());
      setReloadError(undefined);
    } catch (error) {
      if (mounted.current) setReloadError(error instanceof Error ? error.message : "unknown error");
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [snapshot.generatedAt]);

  // Leave the build-time clock behind, and re-read the snapshot in case this HTML was cached.
  // The page is statically exported, so a visitor can arrive on HTML older than the deployed JSON.
  useEffect(() => {
    const timer = setTimeout(() => {
      setNow(new Date());
      void reloadSnapshot();
    }, 0);
    return () => clearTimeout(timer);
    // Deliberately once on mount: later reads come from the interval and the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoReload) return;
    const timer = setInterval(reloadSnapshot, SNAPSHOT_RELOAD_MS);
    return () => clearInterval(timer);
  }, [autoReload, reloadSnapshot]);

  const entries = allSnapshotEntries(snapshot);
  const incidents = buildIncidents(snapshot, now);
  const ageMinutes = snapshotAgeMinutes(snapshot, now);
  const freshness = formatSnapshotFreshness(ageMinutes);
  const health = formatHealthSummary(entries);
  const pipelines = PIPELINE_MONITOR_IDS.map((id) => snapshotEntry(snapshot, id)).filter(
    (entry): entry is SnapshotSource => entry !== undefined,
  );

  return (
    <main>
      {freshness.overdue && (
        <section className="overdue">
          <strong>⚠ {freshness.title}</strong>
          <p>{freshness.detail}</p>
          <p className="eyebrow">snapshot 已超過 {ageMinutes} 分鐘沒有重新產生。</p>
        </section>
      )}

      <header>
        <div>
          <p className="eyebrow">
            ALL PRODUCTION DATA · {LIVE_MONITOR_IDS.length} / {MONITOR_IDS.length} 個來源皆為真實資料
          </p>
          <h1>ICELAND OPS DASHBOARD</h1>
          <div className="header-facts">
            <span>
              最後更新：<strong>{formatTaipeiTime(snapshot.generatedAt)}</strong>
            </span>
            <span>
              更新於：<strong>{formatRelativeAge(ageMinutes)}</strong>
            </span>
            {snapshot.scheduledFor && (
              <span>
                下一次更新：<strong>約 {formatTaipeiTime(snapshot.scheduledFor)}</strong>
              </span>
            )}
            <span>
              更新來源：<strong>{formatTrigger(snapshot.trigger)}</strong>
            </span>
          </div>
          <p className="eyebrow">
            時間為台北時間 · {formatShortClock(snapshot.generatedAt, "UTC")} UTC ·{" "}
            {formatShortClock(snapshot.generatedAt, ICELAND_TIME_ZONE)} Iceland · 每 {SNAPSHOT_INTERVAL_MINUTES}{" "}
            分鐘更新一次
          </p>
          {reloadError && <p className="error">無法重新讀取資料（{reloadError}），畫面顯示的是上一份資料。</p>}
        </div>
        <div className="refresh">
          <span>
            自動重新讀取：<strong className={autoReload ? "ok" : "warn"}>{autoReload ? "開啟" : "關閉"}</strong>（每{" "}
            {SNAPSHOT_RELOAD_MS / 60_000} 分鐘）
          </span>
          <div className="refresh-buttons">
            <button type="button" onClick={reloadSnapshot} disabled={loading}>
              {loading ? "讀取中…" : "重新讀取最新資料"}
            </button>
            <button type="button" onClick={() => setAutoReload((value) => !value)}>
              {autoReload ? "暫停自動讀取" : "恢復自動讀取"}
            </button>
          </div>
          <span className="eyebrow">只重新讀取 Dashboard 已發布的資料，不會重新向來源網站抓取。</span>
        </div>
      </header>

      <section className="summary">
        <h2>資料狀態</h2>
        <p className={`summary-headline ${health.tone}`}>
          {TONE_DOT[health.tone]} {health.headline}
        </p>
        <div className="summary-counts">
          <StatusPill tone="ok" label={`正常 ${health.normal}`} />
          <StatusPill tone="warn" label={`需注意 ${health.attention}`} />
          <StatusPill tone="error" label={`異常 ${health.failing}`} />
        </div>
      </section>

      <WeatherSection
        metno={snapshotEntry(snapshot, "metno")}
        ecmwf={snapshotEntry(snapshot, "ecmwf")}
        schemaVersion={snapshot.schemaVersion}
      />
      <RoadsSection irca={snapshotEntry(snapshot, "irca")} now={now} schemaVersion={snapshot.schemaVersion} />
      {/* Paired on a wide screen so all four answers fit one look, stacked on a narrow one. */}
      <div className="pair">
        <AuroraSection
          kp={snapshotEntry(snapshot, "noaaKp")}
          solarWind={snapshotEntry(snapshot, "solarWind")}
          ovation={snapshotEntry(snapshot, "ovation")}
          now={now}
          schemaVersion={snapshot.schemaVersion}
        />
        <WarningsSection imo={snapshotEntry(snapshot, "imo")} schemaVersion={snapshot.schemaVersion} />
      </div>
      <PipelineSection pipelines={pipelines} schemaVersion={snapshot.schemaVersion} />

      <section>
        <h2>診斷紀錄</h2>
        <details className="technical">
          <summary>需要處理的項目（{incidents.length}）</summary>
          {incidents.length === 0 ? (
            <p className="empty">沒有過舊、降級或失敗的來源。</p>
          ) : (
            incidents.map((incident, index) => (
              <Incident key={incident.key} incident={incident} mostUrgent={index === 0} now={now} />
            ))
          )}
        </details>
        <details className="technical">
          <summary>這次瀏覽期間的狀態變化（{events.length}）</summary>
          <ol className="events">
            {events.map((event) => (
              <li key={event.key}>
                <time dateTime={event.at}>{formatTaipeiTime(event.at)}</time>
                <span>
                  {event.label}
                  {event.detail && <em> · {event.detail}</em>}
                </span>
                <span className={`event-status ${event.status}`}>{event.status.toUpperCase()}</span>
              </li>
            ))}
          </ol>
        </details>
      </section>
    </main>
  );
}

function Incident({
  incident,
  mostUrgent,
  now,
}: {
  incident: IncidentGroup;
  mostUrgent: boolean;
  now: Date;
}) {
  const status = formatSourceStatus({
    status: incident.status,
    errorType: incident.entries.find((entry) => entry.errorType)?.errorType,
  });
  return (
    <article className={`incident ${incident.status}`}>
      <div className="incident-head">
        <strong>
          {dot[incident.status]} {incident.title}
        </strong>
        <StatusPill tone={status.tone} label={status.label} />
      </div>
      <p>{incident.summary}</p>
      <p className="incident-meta">
        {incident.entries.map((entry) => (
          <IncidentPart key={entry.id} entry={entry} now={now} />
        ))}
        {mostUrgent && <strong className="urgent">請優先處理</strong>}
      </p>
    </article>
  );
}

function IncidentPart({ entry, now }: { entry: SnapshotSource; now: Date }) {
  const age = dataAgeMinutes(entry, now);
  return (
    <span className="incident-part">
      <span className={entry.status}>{dot[entry.status]}</span> {entry.name}
      {entry.dataTime ? ` · 來源資料 ${formatTaipeiTime(entry.dataTime)}${age === undefined ? "" : `（${age} 分鐘前）`}` : ""}
      {entry.lastSuccessAt ? ` · 最後成功取得 ${formatTaipeiTime(entry.lastSuccessAt)}` : ""}
    </span>
  );
}
