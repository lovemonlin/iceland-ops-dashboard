import type { HealthStatus } from "@/health/model";
import { formatClock, formatShortClock, ICELAND_TIME_ZONE } from "@/lib/time";
import type { SnapshotSource } from "@/snapshot/types";

const labels: Record<HealthStatus, string> = {
  ok: "OK",
  info: "INFO",
  stale: "STALE",
  degraded: "DEGRADED",
  error: "UPDATE ERROR",
};

const dot: Record<HealthStatus, string> = { ok: "🟢", info: "🔵", stale: "🟡", degraded: "🟠", error: "🔴" };

/** "modelRun" -> "Model run", so a monitor can add a value without touching the card. */
function humanise(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Iceland local time plus UTC, so freshness is never read off a browser clock. */
function bothZones(iso: string | undefined, seconds = false) {
  if (!iso) return "—";
  const format = seconds ? formatClock : formatShortClock;
  return `${format(iso, ICELAND_TIME_ZONE)} IS · ${format(iso, "UTC")} UTC`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * One source as of the latest snapshot.
 *
 * Three different times are shown deliberately and never merged: when the source generated the
 * data, when this dashboard last collected it successfully, and when it last tried.
 */
export function StatusCard({ entry }: { entry: SnapshotSource }) {
  const values = Object.entries(entry.data ?? {});
  const carriedOver = entry.lastSuccessAt !== undefined && entry.lastSuccessAt !== entry.lastAttemptAt;

  const diagnostics =
    [
      entry.diagnostics?.httpStatus === undefined ? undefined : `HTTP ${entry.diagnostics.httpStatus}`,
      entry.diagnostics?.latencyMs === undefined ? undefined : `${entry.diagnostics.latencyMs} ms`,
      entry.diagnostics?.recordCount === undefined ? undefined : `${entry.diagnostics.recordCount} records`,
    ]
      .filter(Boolean)
      .join(" · ") || "—";

  return (
    <article className="card">
      <div className="card-title">
        <h3>{entry.name}</h3>
        <span className={`status ${entry.status}`}>
          {dot[entry.status]} {labels[entry.status]}
        </span>
      </div>

      <p className="diagnostic">
        {entry.errorType ? (
          <>
            <strong className={entry.status}>{entry.errorType}</strong>
            <br />
            {entry.errorMessage}
          </>
        ) : (
          (entry.note ?? "Collected successfully.")
        )}
      </p>

      <dl>
        <Row label="Data generated" value={bothZones(entry.dataTime)} />
        <Row label="Last successful collection" value={bothZones(entry.lastSuccessAt)} />
        <Row label="Latest collection attempt" value={bothZones(entry.lastAttemptAt, true)} />
        <Row label="Attempt diagnostics" value={diagnostics} />
      </dl>

      {values.length > 0 ? (
        <>
          <p className="details-label">
            {carriedOver ? "Stored data — kept from the last successful collection" : "Current stored data"}
          </p>
          <dl className="details">
            {values.map(([key, value]) => (
              <Row key={key} label={humanise(key)} value={String(value)} />
            ))}
          </dl>
        </>
      ) : (
        <p className="details-label">No data has ever been collected from this source.</p>
      )}
    </article>
  );
}
