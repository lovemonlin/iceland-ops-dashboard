import { ovationState } from "@/lib/auroraData";
import { formatDateTime } from "@/lib/time";
import type { SnapshotSource } from "@/snapshot/types";

export function AuroraDataStatus({ source, now, generatedAt }: {
  source?: SnapshotSource;
  now: Date;
  generatedAt: string;
}) {
  const state = ovationState(source, now);
  const time = (value?: string) => value ? `${formatDateTime(value, "UTC")} UTC` : "—";
  return (
    <div className="aurora-data-status">
      <p className={state.current ? "ok" : "warn"} role="status"><strong>OVATION：{state.label}</strong></p>
      <dl className="aurora-data-times">
        {[
          ["觀測時間", state.observedAt],
          ["預報有效時間", state.forecastAt],
          [typeof source?.data?.fetchedAt === "string" ? "資料取得時間" : "資料取得時間（舊版記錄）", state.fetchedAt],
          ["最後檢查時間", state.checkedAt],
          ["Dashboard Snapshot", generatedAt],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{time(value)}</dd></div>)}
      </dl>
      <p className="muted-line">全部時間為 UTC（冰島 UTC+0）。正式收集每 60 分鐘執行；頁面每 5 分鐘讀取已發布 Snapshot。</p>
      {typeof source?.data?.fetchedAt !== "string" && <p className="muted-line">舊版 Snapshot 未記錄請求完成時間，此處顯示最後成功收集批次時間；新版會獨立記錄取得時間。</p>}
      <p className="muted-line">「預報有效時間」是 NOAA 模型對應的單一時刻，並非可沿用數小時的有效區間。過期資料保留供歷史查詢。</p>
    </div>
  );
}
