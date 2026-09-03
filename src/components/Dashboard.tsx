"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusCard } from "@/components/StatusCard";
import { LIVE_MONITOR_IDS, MONITOR_IDS } from "@/config/monitors";
import { getSystemStatus } from "@/health/evaluate";
import type { HealthStatus } from "@/health/model";
import { recordCheck, statusMap, type DashboardEvent } from "@/lib/events";
import { formatClock, formatDateTime, formatShortClock, ICELAND_TIME_ZONE, TAIWAN_TIME_ZONE } from "@/lib/time";
import type { HealthSnapshot } from "@/monitors";
import { buildIncidents, type IncidentGroup } from "@/monitors/correlate";

/** Deliberately slow: this is a maintenance console, not a live ticker. */
const AUTO_REFRESH_MS = 60_000;

const groups: [string, string[]][] = [
  ["WEATHER", ["metno"]],
  ["ROADS", ["irca"]],
  ["AURORA", ["noaaKp", "solarWind", "ovation"]],
  ["FORECAST / WARNINGS", ["ecmwf", "imo"]],
  ["PIPELINES", ["ircaPipeline", "ecmwfPipeline"]],
];

const order: HealthStatus[] = ["ok", "info", "stale", "degraded", "error"];
const dot: Record<HealthStatus, string> = { ok: "🟢", info: "🔵", stale: "🟡", degraded: "🟠", error: "🔴" };

export function Dashboard({ initialSnapshot }: { initialSnapshot: HealthSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [checking, setChecking] = useState(false);
  const [requestError, setRequestError] = useState<string | undefined>();

  const [events, setEvents] = useState<DashboardEvent[]>(() =>
    recordCheck([], initialSnapshot.monitors, null, initialSnapshot.checkedAt),
  );
  const lastStatuses = useRef<Record<string, HealthStatus>>(statusMap(initialSnapshot.monitors));
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runCheck = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error(`health endpoint returned HTTP ${response.status}`);
      const next = (await response.json()) as HealthSnapshot;
      if (!mounted.current) return;
      setEvents((existing) => recordCheck(existing, next.monitors, lastStatuses.current, next.checkedAt));
      lastStatuses.current = statusMap(next.monitors);
      setSnapshot(next);
      setRequestError(undefined);
    } catch (error) {
      // The dashboard's own request failed; the previous snapshot stays on screen and says so.
      if (mounted.current) setRequestError(error instanceof Error ? error.message : "unknown error");
    } finally {
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(runCheck, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, runCheck]);

  const { monitors, checkedAt } = snapshot;
  const summary = order.map((status) => [status, monitors.filter((monitor) => monitor.status === status).length] as const);
  const systemStatus = getSystemStatus(monitors);
  const incidents = buildIncidents(monitors);

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">
            READ-ONLY MONITOR · {LIVE_MONITOR_IDS.length} OF {MONITOR_IDS.length} SOURCES LIVE · REST STILL MOCK DATA
          </p>
          <h1>ICELAND OPS DASHBOARD</h1>
          <p>
            Last check: {formatDateTime(checkedAt, "UTC")} UTC · {formatClock(checkedAt, ICELAND_TIME_ZONE)} Iceland ·{" "}
            {formatClock(checkedAt, TAIWAN_TIME_ZONE)} Taipei
          </p>
          {requestError && <p className="error">Dashboard refresh failed ({requestError}); showing the last snapshot.</p>}
        </div>
        <div className="refresh">
          <span>
            Auto refresh: <strong className={autoRefresh ? "ok" : "stale"}>{autoRefresh ? "ON" : "OFF"}</strong> ({AUTO_REFRESH_MS / 1000}s)
          </span>
          <div className="refresh-buttons">
            <button type="button" onClick={runCheck} disabled={checking}>
              {checking ? "Checking…" : "Refresh now"}
            </button>
            <button type="button" onClick={() => setAutoRefresh((value) => !value)}>
              {autoRefresh ? "Pause auto refresh" : "Resume auto refresh"}
            </button>
          </div>
        </div>
      </header>

      <section className="summary">
        <h2>SYSTEM HEALTH</h2>
        <div>
          <span className={`summary-item ${systemStatus}`}>
            {dot[systemStatus]} OVERALL: {systemStatus.toUpperCase()}
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
              const monitor = monitors.find((candidate) => candidate.id === id);
              return monitor ? <StatusCard key={id} monitor={monitor} /> : null;
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
            incidents.map((incident, index) => <Incident key={incident.key} incident={incident} mostUrgent={index === 0} />)
          )}
        </div>
        <div>
          <h2>RECENT EVENTS (SESSION ONLY)</h2>
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

function Incident({ incident, mostUrgent }: { incident: IncidentGroup; mostUrgent: boolean }) {
  return (
    <article className={`incident ${incident.status}`}>
      <div className="incident-head">
        <strong>
          {dot[incident.status]} {incident.title}
        </strong>
        <span className={`status ${incident.status}`}>
          {incident.monitors
            .filter((monitor) => monitor.errorType)
            .map((monitor) => monitor.errorType)
            .join(" + ") || incident.status.toUpperCase()}
        </span>
      </div>
      <p>{incident.summary}</p>
      <p className="incident-meta">
        {incident.monitors.map((monitor) => (
          <span key={monitor.id} className="incident-part">
            <span className={monitor.status}>{dot[monitor.status]}</span> {monitor.name}
            {monitor.dataTime ? ` · last good data ${formatClock(monitor.dataTime, ICELAND_TIME_ZONE)}` : ""}
          </span>
        ))}
        {mostUrgent && <strong className="urgent">HANDLE THIS FIRST</strong>}
      </p>
    </article>
  );
}
