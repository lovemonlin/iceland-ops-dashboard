import { getSystemStatus } from "@/health/evaluate";
import {
  collectionSucceeded,
  describeCollection,
  formatNumber,
  formatPercent,
  formatRelativeAge,
  formatSigned,
  formatSourceStatus,
  formatTaipeiTime,
  formatWarningsHeadline,
  TONE_DOT,
} from "@/lib/display";
import dynamic from "next/dynamic";
import { MapDisclosure } from "@/components/MapDisclosure";
import { SourceCard, Stat, StatusPill, TechnicalDetails } from "@/components/StatusCard";
import { WeatherMap, type WeatherMapSite } from "@/components/WeatherMap";
import { dataAgeMinutes } from "@/monitors/correlate";
import type { SnapshotSource } from "@/snapshot/types";

/**
 * The four things a traveller came to find out — weather, roads, aurora, warnings — plus the
 * publishing pipelines, which are the dashboard's own plumbing and are kept out of the way.
 *
 * Every card reads the stored snapshot values and nothing else. No card recomputes health.
 */

/**
 * MapLibre and its stylesheet are ~800 KB. Loading them for a page whose whole point is a fast
 * status summary would be indefensible, so the road map is a separate chunk fetched only when the
 * disclosure mounts it. `ssr: false` because the library needs a real canvas.
 */
const RoadMap = dynamic(() => import("@/components/RoadMap").then((module) => module.RoadMap), {
  ssr: false,
  loading: () => <p className="muted-line">正在載入道路地圖…</p>,
});

const text = (value: unknown, fallback = "—") => (value === undefined || value === null ? fallback : String(value));

export function WeatherSection({
  metno,
  ecmwf,
  schemaVersion,
}: {
  metno?: SnapshotSource;
  ecmwf?: SnapshotSource;
  schemaVersion: number;
}) {
  return (
    <section>
      <h2>天氣</h2>
      <div className="cards">
        {metno && <WeatherCard entry={metno} schemaVersion={schemaVersion} />}
        {ecmwf && <CloudForecastCard entry={ecmwf} schemaVersion={schemaVersion} />}
      </div>
    </section>
  );
}

function WeatherCard({ entry, schemaVersion }: { entry: SnapshotSource; schemaVersion: number }) {
  const data = entry.data ?? {};
  const site = text(data.primarySite, "Reykjavík");
  const healthy = entry.status === "ok" || entry.status === "info";
  // Written by the MET Norway monitor from the same 32 responses the summary above came from.
  const sites = Array.isArray(data.sites) ? (data.sites as WeatherMapSite[]) : [];

  return (
    <SourceCard
      icon="🌤"
      title="天氣"
      entry={entry}
      schemaVersion={schemaVersion}
      headline={
        healthy
          ? `冰島 ${text(data.locationsSuccessful, "全部")} 個地點的天氣資料正常更新。`
          : describeCollection(entry)
      }
      dataTimeLabel="來源資料時間"
    >
      <div className="stats">
        <Stat label={`${site} 氣溫`} value={formatNumber(data.temperatureC, "°C")} />
        <Stat label="風速" value={formatNumber(data.windMps, "m/s")} />
        <Stat label="低層雲量" value={formatPercent(data.cloudLowPercent)} />
        <Stat label="中層雲量" value={formatPercent(data.cloudMediumPercent)} />
        <Stat label="高層雲量" value={formatPercent(data.cloudHighPercent)} />
      </div>
      {sites.length > 0 && (
        <MapDisclosure label="展開全島天氣">
          <WeatherMap sites={sites} />
        </MapDisclosure>
      )}
    </SourceCard>
  );
}

function CloudForecastCard({ entry, schemaVersion }: { entry: SnapshotSource; schemaVersion: number }) {
  const data = entry.data ?? {};
  const healthy = entry.status === "ok" || entry.status === "info";

  return (
    <SourceCard
      icon="☁"
      title="雲層預報"
      entry={entry}
      schemaVersion={schemaVersion}
      headline={healthy ? "未來兩天的雲層預報已備妥。" : describeCollection(entry)}
      dataTimeLabel="來源資料時間"
    >
      <div className="stats">
        <Stat label="模式時次" value={text(data.modelRun)} />
        <Stat label="預報涵蓋" value={text(data.coverage)} />
        <Stat label="預報時段" value={text(data.frames)} />
      </div>
    </SourceCard>
  );
}

export function RoadsSection({
  irca,
  now,
  schemaVersion,
}: {
  irca?: SnapshotSource;
  now: Date;
  schemaVersion: number;
}) {
  if (!irca) return null;

  const data = irca.data ?? {};
  const healthy = irca.status === "ok" || irca.status === "info";
  const age = dataAgeMinutes(irca, now);
  const reachable = collectionSucceeded(irca);

  return (
    <section>
      <h2>道路</h2>
      <div className="cards">
        <SourceCard
          icon="🛣"
          title="冰島道路狀況"
          entry={irca}
          schemaVersion={schemaVersion}
          headline={healthy ? "官方道路資料正常更新。" : describeCollection(irca)}
          dataTimeLabel="官方最後發布"
        >
          {/*
            The distinction this card exists to make: a stale road feed is the Icelandic road
            authority not publishing, not our collection failing. Saying "update error" for both
            sends people to debug the wrong thing.
          */}
          {!healthy && age !== undefined && (
            <p className={`emphasis ${formatSourceStatus(irca).tone}`}>
              {reachable ? `已 ${age} 分鐘沒有新資料` : `最後取得的資料已是 ${age} 分鐘前`}
            </p>
          )}
          <div className="stats">
            <Stat label="道路" value={formatNumber(data.roads, "條")} />
            <Stat label="事件" value={formatNumber(data.incidents, "件")} />
            <Stat label="觀測站" value={formatNumber(data.stations, "站")} />
          </div>
          <MapDisclosure label="展開全島道路">
            <RoadMap />
          </MapDisclosure>
        </SourceCard>
      </div>
    </section>
  );
}

export function AuroraSection({
  kp,
  solarWind,
  ovation,
  now,
  schemaVersion,
}: {
  kp?: SnapshotSource;
  solarWind?: SnapshotSource;
  ovation?: SnapshotSource;
  now: Date;
  schemaVersion: number;
}) {
  const entries = [kp, solarWind, ovation].filter((entry): entry is SnapshotSource => entry !== undefined);
  if (entries.length === 0) return null;

  // Three feeds, one question — "can I see the aurora tonight?" — so they share one card.
  // The combined status uses the shared precedence rule; nothing here re-decides health.
  const worst = getSystemStatus(entries);
  const failing = entries.find((entry) => entry.status === worst && entry.status !== "ok");
  const badge = formatSourceStatus({ status: worst, errorType: failing?.errorType });
  const healthy = worst === "ok";

  const dated = entries.filter((entry) => entry.dataTime !== undefined);
  const oldestEntry = dated.reduce<SnapshotSource | undefined>(
    (worst, entry) =>
      worst === undefined || Date.parse(entry.dataTime!) < Date.parse(worst.dataTime!) ? entry : worst,
    undefined,
  );
  const oldest = oldestEntry === undefined ? undefined : dataAgeMinutes(oldestEntry, now);

  const kpData = kp?.data ?? {};
  const windData = solarWind?.data ?? {};
  const ovationData = ovation?.data ?? {};

  return (
    <section>
      <h2>極光</h2>
      <div className="cards">
        <SourceCard
          icon="🌌"
          title="極光"
          entry={kp ?? entries[0]}
          status={badge}
          schemaVersion={schemaVersion}
          technical={entries}
          headline={healthy ? "太空天氣資料正常更新。" : describeCollection(failing ?? entries[0])}
          dataTime={oldestEntry?.dataTime}
          dataTimeLabel="來源資料時間"
        >
          <div className="stats">
            <Stat label="Kp 指數" value={formatNumber(kpData.kp)} />
            <Stat label="太陽風速" value={formatNumber(windData.speedKms, "km/s")} />
            <Stat label="Bt" value={formatNumber(windData.btNt, "nT")} />
            <Stat label="Bz" value={formatSigned(windData.bzNt, "nT")} />
            <Stat label="冰島上空機率" value={formatPercent(ovationData.icelandPeakProbabilityPercent)} />
          </div>
          <p className="muted-line">資料更新：約 {formatRelativeAge(oldest)}</p>
          <details className="technical">
            <summary>查看極光資料來源</summary>
            <ul className="source-list">
              {entries.map((entry) => {
                const status = formatSourceStatus(entry);
                return (
                  <li key={entry.id}>
                    <span>{entry.name}</span>
                    <StatusPill tone={status.tone} label={status.label} />
                    <span className="muted-line">資料時間 {formatTaipeiTime(entry.dataTime)}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        </SourceCard>
      </div>
    </section>
  );
}

export function WarningsSection({ imo, schemaVersion }: { imo?: SnapshotSource; schemaVersion: number }) {
  if (!imo) return null;

  const active = imo.data?.activeWarnings;
  const count = typeof active === "number" ? active : undefined;
  const headline = formatWarningsHeadline(imo);

  return (
    <section>
      <h2>天氣警報</h2>
      <div className="cards">
        <SourceCard
          icon="⚠"
          title="冰島天氣警報"
          entry={imo}
          schemaVersion={schemaVersion}
          headline={headline}
          dataTimeLabel="來源資料時間"
        >
          <p className={`emphasis ${count === 0 ? "ok" : "warn"}`}>
            {count === 0 ? "目前無警報" : count === undefined ? "—" : `${count} 則警報`}
          </p>
        </SourceCard>
      </div>
    </section>
  );
}

/**
 * The dashboard's own plumbing: the upstream GitHub workflows that publish the road and cloud
 * data. Interesting when it breaks, noise when it does not, so it is one line plus a disclosure.
 */
export function PipelineSection({
  pipelines,
  schemaVersion,
}: {
  pipelines: SnapshotSource[];
  schemaVersion: number;
}) {
  if (pipelines.length === 0) return null;

  const delayed = pipelines.filter((entry) => entry.status !== "ok" && entry.status !== "info");
  const tone = delayed.length === 0 ? "ok" : formatSourceStatus(delayed[0]).tone;
  const summary =
    delayed.length === 0
      ? "所有資料更新排程正常"
      : `${delayed.length} 個來源更新排程延遲`;

  return (
    <section className="pipelines">
      <h2>資料更新系統</h2>
      <div className={`pipeline-summary tone-${tone}`}>
        <span className={`pill ${tone}`}>
          {TONE_DOT[tone]} {summary}
        </span>
        <span className="muted-line">這是上游資料發布流程的狀態，不是旅遊資料本身。</span>
      </div>
      <details className="technical">
        <summary>查看 Pipeline 狀態</summary>
        {pipelines.map((entry) => {
          const status = formatSourceStatus(entry);
          const data = entry.data ?? {};
          const runUrl = typeof data.runUrl === "string" ? data.runUrl : undefined;
          return (
            <div key={entry.id} className="technical-block">
              <div className="card-title">
                <p className="technical-name">{entry.name}</p>
                <StatusPill tone={status.tone} label={status.label} />
              </div>
              <div className="stats">
                <Stat label="最新執行" value={text(data.latestRun)} />
                <Stat label="結果" value={text(data.conclusion)} />
                <Stat label="觸發事件" value={text(data.event)} />
                <Stat label="最後執行" value={formatTaipeiTime(entry.dataTime)} />
                <Stat label="最後成功" value={text(data.lastSuccessfulRun)} />
              </div>
              {entry.errorMessage && <p className="muted-line">{entry.errorMessage}</p>}
              {runUrl && (
                <p className="muted-line">
                  <a href={runUrl} target="_blank" rel="noreferrer">
                    在 GitHub Actions 查看這次執行
                  </a>
                </p>
              )}
              <TechnicalDetails entries={[entry]} schemaVersion={schemaVersion} />
            </div>
          );
        })}
      </details>
    </section>
  );
}
