import type { HealthStatus, MonitorHealth } from "@/health/model";
import { formatAge, formatClock, formatShortClock, ICELAND_TIME_ZONE } from "@/lib/time";

const labels: Record<HealthStatus, string> = { ok: "OK", info: "INFO", stale: "STALE", degraded: "DEGRADED", error: "ERROR" };
const dot: Record<HealthStatus, string> = { ok: "🟢", info: "🔵", stale: "🟡", degraded: "🟠", error: "🔴" };

/** Iceland local time plus UTC, so freshness is never read off a browser clock. */
function bothZones(iso: string | undefined, seconds = false) {
  if (!iso) return "—";
  const format = seconds ? formatClock : formatShortClock;
  return `${format(iso, ICELAND_TIME_ZONE)} IS · ${format(iso, "UTC")} UTC`;
}

/** "modelRun" -> "Model run", so a monitor can add a detail without touching the card. */
function humanise(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function StatusCard({ monitor }: { monitor: MonitorHealth }) {
  // Keys starting with "_" are for other code to read, not for the card.
  const visibleDetails = Object.entries(monitor.details ?? {}).filter(([key]) => !key.startsWith("_"));
  const checks = [
    `net ${monitor.networkOk ? "ok" : "fail"}`,
    `parse ${monitor.parseOk ? "ok" : "fail"}`,
    `schema ${monitor.schemaOk === undefined ? "n/a" : monitor.schemaOk ? "ok" : "fail"}`,
    `fresh ${monitor.fresh === undefined ? "n/a" : monitor.fresh ? "ok" : "no"}`,
  ].join(" · ");

  return (
    <article className="card">
      <div className="card-title">
        <h3>{monitor.name}</h3>
        <span className={`status ${monitor.status}`}>
          {dot[monitor.status]} {labels[monitor.status]}
        </span>
      </div>

      <p className="diagnostic">
        {monitor.errorType ? (
          <>
            <strong className={monitor.status}>{monitor.errorType}</strong>
            <br />
            {monitor.errorMessage}
          </>
        ) : (
          monitor.note ?? "All checks passed."
        )}
      </p>

      <dl>
        <Row label="Last data" value={bothZones(monitor.dataTime)} />
        <Row label="Data age" value={formatAge(monitor.ageSeconds)} />
        <Row label="Last success" value={bothZones(monitor.lastSuccess)} />
        <Row label="Checked" value={bothZones(monitor.checkedAt, true)} />
        <Row label="HTTP" value={monitor.httpStatus === undefined ? "—" : String(monitor.httpStatus)} />
        <Row label="Latency" value={monitor.latencyMs === undefined ? "—" : `${monitor.latencyMs} ms`} />
        <Row label="Records" value={monitor.recordCount === undefined ? "—" : String(monitor.recordCount)} />
        <Row label="Checks" value={checks} />
      </dl>

      {visibleDetails.length > 0 && (
        <dl className="details">
          {visibleDetails.map(([key, value]) => (
            <Row key={key} label={humanise(key)} value={String(value)} />
          ))}
        </dl>
      )}
    </article>
  );
}
