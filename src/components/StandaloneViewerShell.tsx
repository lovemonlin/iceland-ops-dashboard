import { formatSourceStatus, formatTaipeiTime } from "@/lib/display";
import { getPublicPagePath } from "@/lib/publicPath";
import { formatDateTime } from "@/lib/time";
import type { SnapshotSource } from "@/snapshot/types";
import type { ReactNode } from "react";

const TITLES = {
  weather: { icon: "🌤", title: "冰島天氣" },
  cloud: { icon: "☁", title: "雲層預報" },
  roads: { icon: "🛣", title: "冰島道路狀況" },
  aurora: { icon: "🌌", title: "極光預報" },
} as const;

export type StandaloneKind = keyof typeof TITLES;

export function StandaloneViewerShell({
  kind,
  generatedAt,
  source,
  reloadError,
  children,
}: {
  kind: StandaloneKind;
  generatedAt: string;
  source?: SnapshotSource;
  reloadError?: string;
  children: ReactNode;
}) {
  const { icon, title } = TITLES[kind];
  const status = source ? formatSourceStatus(source) : { tone: "warn", label: "尚無資料" };
  return (
    <main className={`standalone-viewer standalone-${kind}`}>
      <header className="standalone-header">
        <div className="standalone-heading">
          <span aria-hidden="true">{icon}</span>
          <div>
            <h1>{title}</h1>
            {kind === "aurora" ? <p>Snapshot 更新：{formatDateTime(generatedAt, "UTC")} UTC（冰島 UTC+0） · 資料狀態：<strong className={status.tone}>{status.label}</strong></p> : <p>Snapshot 更新：{formatTaipeiTime(generatedAt)} · 資料狀態：<strong className={status.tone}>{status.label}</strong></p>}
          </div>
        </div>
        <a href={getPublicPagePath("/")} className="standalone-back">← 返回 Dashboard</a>
      </header>
      {reloadError && <p className="error standalone-reload-error">無法重新讀取資料（{reloadError}），目前顯示上一份資料。</p>}
      <div className="standalone-content">{children}</div>
    </main>
  );
}
