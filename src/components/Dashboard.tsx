"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusCard } from "@/components/StatusCard";
import { LIVE_MONITOR_IDS, MONITOR_IDS } from "@/config/monitors";
import { SNAPSHOT_INTERVAL_MINUTES, SNAPSHOT_OVERDUE_MINUTES, SNAPSHOT_RELOAD_MS } from "@/config/snapshot";
import type { HealthStatus } from "@/health/model";
import { recordCheck, statusMap, type DashboardEvent } from "@/lib/events";
import { getSnapshotUrl } from "@/lib/publicPath";
import { formatClock, formatDateTime, formatShortClock, ICELAND_TIME_ZONE, TAIWAN_TIME_ZONE } from "@/lib/time";
import { buildIncidents, dataAgeMinutes, type IncidentGroup } from "@/monitors/correlate";
import { snapshotAgeMinutes, snapshotEntry, allSnapshotEntries, type DashboardSnapshot, type SnapshotSource } from "@/snapshot/types";

const groups: [string, string[]][] = [
  ["WEATHER", ["metno"]],
  ["ROADS", ["irca"]],
  ["AURORA", ["noaaKp", "solarWind", "ovation"]],
  ["FORECAST / WARNINGS", ["ecmwf", "imo"]],
  ["PIPELINES", ["ircaPipeline", "ecmwfPipeline"]],
];

const order: HealthStatus[] = ["ok", "info", "stale", "degraded", "error"];
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
  const summary = order.map((status) => [status, entries.filter((entry) => entry.status === status).length] as const);
  const incidents = buildIncidents(snapshot, now);
  const ageMinutes = snapshotAgeMinutes(snapshot, now);
  const overdue = ageMinutes !== undefined && ageMinutes > SNAPSHOT_OVERDUE_MINUTES;

  return (
    <main>
      {overdue && (
        <section className="overdue">
          <strong>⚠ SCHEDULED UPDATE OVERDUE</strong>
          <p>
            The dashboard snapshot has not been refreshed for {ageMinutes} minutes. Collection is expected every{" "}
            {SNAPSHOT_INTERVAL_MINUTES} minutes. Everything below is the last snapshot that was produced — the source
            statuses may no longer reflect reality.
          </p>
        </section>
      )}

      <header>
        <div>
          <p className="eyebrow">
            SCHEDULED SNAPSHOT · {LIVE_MONITOR_IDS.length} OF {MONITOR_IDS.length} SOURCES LIVE · ALL PRODUCTION DATA
          </p>
          <h1>ICELAND OPS DASHBOARD</h1>
          <p>
            Latest scheduled snapshot: {formatDateTime(snapshot.generatedAt, "UTC")} UTC ·{" "}
            {formatClock(snapshot.generatedAt, ICELAND_TIME_ZONE)} Iceland ·{" "}
            {formatClock(snapshot.generatedAt, TAIWAN_TIME_ZONE)} Taipei
          </p>
          <p>
            Snapshot age: <strong className={overdue ? "error" : "ok"}>{ageMinutes ?? "—"} min</strong> · data
            collection target: every {SNAPSHOT_INTERVAL_MINUTES} min
            {snapshot.scheduledFor ? ` · next due ${formatShortClock(snapshot.scheduledFor, "UTC")} UTC` : ""}
            {snapshot.trigger ? ` · started by ${snapshot.trigger}` : ""}
          </p>
          {reloadError && <p className="error">Could not re-read the snapshot ({reloadError}); showing the last one.</p>}
        </div>
        <div className="refresh">
          <span>
            Auto reload: <strong className={autoReload ? "ok" : "stale"}>{autoReload ? "ON" : "OFF"}</strong> (
            {SNAPSHOT_RELOAD_MS / 60_000} min)
          </span>
          <div className="refresh-buttons">
            <button type="button" onClick={reloadSnapshot} disabled={loading}>
              {loading ? "Reading…" : "Reload latest snapshot"}
            </button>
            <button type="button" onClick={() => setAutoReload((value) => !value)}>
              {autoReload ? "Pause auto reload" : "Resume auto reload"}
            </button>
          </div>
          <span className="eyebrow">Reload reads the snapshot file only; it does not re-check production.</span>
        </div>
      </header>

      <section className="summary">
        <h2>SYSTEM HEALTH</h2>
        <div>
          <span className={`summary-item ${snapshot.overallStatus}`}>
            {dot[snapshot.overallStatus]} OVERALL: {snapshot.overallStatus.toUpperCase()}
          </span>
          {summary.map(([status, count]) => (
            <span key={status} className={`summary-item ${status}`}>
              {dot[status]} {count} {status.toUpperCase()}
            </span>
          ))}
        </div>
      </section>

      {groups.map(([title, ids]) => (
        <section key={title}>
          <h2>{title}</h2>
          <div className="cards">
            {ids.map((id) => {
              const entry = snapshotEntry(snapshot, id);
              return entry ? <StatusCard key={id} entry={entry} /> : null;
            })}
          </div>
        </section>
      ))}

      <section className="bottom-grid">
        <div>
          <h2>ACTIVE INCIDENTS ({incidents.length})</h2>
          {incidents.length === 0 ? (
            <p className="empty">No stale, degraded, or failing source.</p>
          ) : (
            incidents.map((incident, index) => (
              <Incident key={incident.key} incident={incident} mostUrgent={index === 0} now={now} />
            ))
          )}
        </div>
        <div>
          <h2>SNAPSHOT CHANGES (SESSION ONLY)</h2>
          <ol className="events">
            {events.map((event) => (
              <li key={event.key}>
                <time dateTime={event.at}>{formatShortClock(event.at, ICELAND_TIME_ZONE)}</time>
                <span>
                  {event.label}
                  {event.detail && <em> · {event.detail}</em>}
                </span>
                <span className={`event-status ${event.status}`}>{event.status.toUpperCase()}</span>
              </li>
            ))}
          </ol>
        </div>
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
  return (
    <article className={`incident ${incident.status}`}>
      <div className="incident-head">
        <strong>
          {dot[incident.status]} {incident.title}
        </strong>
        <span className={`status ${incident.status}`}>
          {incident.entries
            .filter((entry) => entry.errorType)
            .map((entry) => entry.errorType)
            .join(" + ") || incident.status.toUpperCase()}
        </span>
      </div>
      <p>{incident.summary}</p>
      <p className="incident-meta">
        {incident.entries.map((entry) => (
          <IncidentPart key={entry.id} entry={entry} now={now} />
        ))}
        {mostUrgent && <strong className="urgent">HANDLE THIS FIRST</strong>}
      </p>
    </article>
  );
}

function IncidentPart({ entry, now }: { entry: SnapshotSource; now: Date }) {
  const age = dataAgeMinutes(entry, now);
  return (
    <span className="incident-part">
      <span className={entry.status}>{dot[entry.status]}</span> {entry.name}
      {entry.dataTime ? ` · data ${formatShortClock(entry.dataTime, ICELAND_TIME_ZONE)}${age === undefined ? "" : ` (${age} min old)`}` : ""}
      {entry.lastSuccessAt ? ` · collected ${formatShortClock(entry.lastSuccessAt, ICELAND_TIME_ZONE)}` : ""}
    </span>
  );
}
