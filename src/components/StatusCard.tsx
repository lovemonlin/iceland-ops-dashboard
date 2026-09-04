import type { ReactNode } from "react";
import {
  formatSourceStatus,
  formatTaipeiTime,
  TONE_DOT,
  type DisplayTone,
} from "@/lib/display";
import { formatClock, formatShortClock, ICELAND_TIME_ZONE } from "@/lib/time";
import type { SnapshotSource } from "@/snapshot/types";

/** "modelRun" -> "Model run", so a monitor can add a value without touching the card. */
function humanise(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Taipei first because that is the reader's clock; UTC after it so nothing is ambiguous. */
function allZones(iso: string | undefined, seconds = false) {
  if (!iso) return "—";
  const format = seconds ? formatClock : formatShortClock;
  return `${formatTaipeiTime(iso)} Taipei · ${format(iso, ICELAND_TIME_ZONE)} Iceland · ${format(iso, "UTC")} UTC`;
}

export function StatusPill({ tone, label }: { tone: DisplayTone; label: string }) {
  return (
    <span className={`pill ${tone}`}>
      {TONE_DOT[tone]} {label}
    </span>
  );
}

/** One headline number: big value, small caption. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
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
 * Everything an engineer wants and a traveller does not, behind one disclosure.
 *
 * Collapsed by default and never summarised on the card face: HTTP codes, latencies and record
 * counts describe the request, not the road or the sky.
 */
export function TechnicalDetails({
  entries,
  schemaVersion,
}: {
  entries: SnapshotSource[];
  schemaVersion?: number;
}) {
  return (
    <details className="technical">
      <summary>技術詳細資料</summary>
      {entries.map((entry) => {
        const values = Object.entries(entry.data ?? {});
        return (
          <div key={entry.id} className="technical-block">
            <p className="technical-name">{entry.name}</p>
            <dl>
              <Row label="Status" value={entry.status} />
              <Row
                label="HTTP status"
                value={entry.diagnostics?.httpStatus === undefined ? "—" : String(entry.diagnostics.httpStatus)}
              />
              <Row
                label="Latency"
                value={entry.diagnostics?.latencyMs === undefined ? "—" : `${entry.diagnostics.latencyMs} ms`}
              />
              <Row
                label="Record count"
                value={entry.diagnostics?.recordCount === undefined ? "—" : String(entry.diagnostics.recordCount)}
              />
              <Row label="Data time" value={allZones(entry.dataTime)} />
              <Row label="Last attempt at" value={allZones(entry.lastAttemptAt, true)} />
              <Row label="Last success at" value={allZones(entry.lastSuccessAt, true)} />
              <Row label="Provenance" value={entry.provenance?.mode ?? "—"} />
              <Row label="Provider" value={entry.provenance?.provider ?? "—"} />
              <Row label="Schema version" value={schemaVersion === undefined ? "—" : String(schemaVersion)} />
              <Row label="Error type" value={entry.errorType ?? "—"} />
            </dl>
            {entry.errorMessage && <p className="technical-message">{entry.errorMessage}</p>}
            {entry.note && <p className="technical-message">{entry.note}</p>}
            {values.length > 0 ? (
              <dl className="details">
                {values.map(([key, value]) => (
                  <Row key={key} label={humanise(key)} value={String(value)} />
                ))}
              </dl>
            ) : (
              <p className="technical-message">No data has ever been collected from this source.</p>
            )}
          </div>
        );
      })}
    </details>
  );
}

/**
 * The shell every card on the page shares.
 *
 * Two times are always spelled out and never merged, because they answer different questions:
 * when the *source* produced the data, and when *we* last looked. The third — when we last
 * succeeded — appears only when it differs, so a healthy card does not print the same clock twice.
 */
export function SourceCard({
  icon,
  title,
  entry,
  headline,
  dataTimeLabel = "來源資料時間",
  dataTime,
  children,
  technical,
  schemaVersion,
  status,
}: {
  icon: string;
  title: string;
  entry: SnapshotSource;
  headline: string;
  dataTimeLabel?: string;
  dataTime?: string;
  children?: ReactNode;
  technical?: SnapshotSource[];
  schemaVersion?: number;
  status?: { tone: DisplayTone; label: string };
}) {
  const badge = status ?? formatSourceStatus(entry);
  const shownDataTime = dataTime ?? entry.dataTime;
  const carriedOver = entry.lastSuccessAt !== undefined && entry.lastSuccessAt !== entry.lastAttemptAt;

  return (
    <article className={`card tone-${badge.tone}`}>
      <div className="card-title">
        <h3>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <StatusPill tone={badge.tone} label={badge.label} />
      </div>

      <p className="headline">{headline}</p>

      {children}

      <div className="times">
        {shownDataTime && (
          <span>
            {dataTimeLabel}：<strong>{formatTaipeiTime(shownDataTime)}</strong>
          </span>
        )}
        <span>
          最後檢查：<strong>{formatTaipeiTime(entry.lastAttemptAt)}</strong>
        </span>
        {carriedOver && (
          <span>
            最後成功取得：<strong>{formatTaipeiTime(entry.lastSuccessAt)}</strong>
          </span>
        )}
      </div>

      <TechnicalDetails entries={technical ?? [entry]} schemaVersion={schemaVersion} />
    </article>
  );
}
