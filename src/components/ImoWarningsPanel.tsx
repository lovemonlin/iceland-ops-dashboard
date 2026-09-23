"use client";

import { useState } from "react";
import { ImoWarningCard, ImoWarningDetailDialog } from "@/components/ImoWarningDetailDialog";
import { ImoWarningMap } from "@/components/ImoWarningMap";
import { TechnicalDetails } from "@/components/StatusCard";
import { buildImoWarningMap, resolveImoWarningDialog } from "@/lib/imoWarningMap";
import {
  formatIcelandWarningWindow,
  imoLevelLabel,
  imoSourceHealthLabel,
  presentImoWarnings,
  type ImoWarningRank,
} from "@/lib/imoWarningPresentation";
import { translateImoArea } from "@/lib/imoWarningZhTw";
import type { SnapshotSource } from "@/snapshot/types";

export function ImoWarningsPanel({
  imo,
  now,
  schemaVersion,
}: {
  imo: SnapshotSource;
  now: Date;
  schemaVersion: number;
}) {
  const feed = presentImoWarnings(imo, now);
  const map = buildImoWarningMap(feed);
  const [open, setOpen] = useState<{ regionId?: string; warningId?: string } | null>(null);
  const summary = feed.summary;
  const headlineRank: ImoWarningRank | "none" =
    feed.state === "stale-expired" || feed.state === "unavailable" || feed.state === "clear" || feed.state === "undetailed"
      ? "none"
      : summary.highest;
  const title =
    feed.state === "stale-expired" || feed.state === "unavailable"
      ? "⚠ IMO 警報資料目前無法更新"
      : feed.state === "undetailed"
        ? "⚠ 警報明細尚未寫入這份快照"
        : feed.state === "clear"
        ? "🟢 目前無有效警報"
        : headlineRank === "none"
          ? "⚠ 警報等級未知"
          : imoLevelLabel(headlineRank);

  return (
    <section className={feed.state === "clear" ? "imo-warnings imo-warnings-quiet" : "imo-warnings"} aria-labelledby="imo-warnings-title">
      <div className="imo-warnings-head">
        <h2 id="imo-warnings-title">⚠ 冰島天氣警報</h2>
        <p className={`imo-warnings-status warning-${headlineRank === "none" ? "unknown" : headlineRank}`}>{title}</p>
      </div>

      {feed.state === "current" && summary.effectiveCount > 0 && (
        <p className="imo-warnings-lead">冰島目前有 {summary.effectiveCount} 則有效天氣警報</p>
      )}
      {feed.state === "current" && summary.effectiveCount === 0 && (
        <p className="imo-warnings-lead">有警報資料，但開始或結束時間不足，無法判斷是否正在生效。</p>
      )}
      {feed.state === "stale-current" && (
        <p className="imo-warnings-stale">
          ⚠ 警報資料目前無法更新。以下內容為最後一次成功取得的資料。
        </p>
      )}
      {feed.state === "stale-expired" && (
        <p className="imo-warnings-stale">
          上一份成功取得的警報資料已超過有效時間，目前狀態無法確認。
        </p>
      )}
      {feed.state === "unavailable" && <p className="imo-warnings-stale">目前沒有可用的警報資料。</p>}
      {feed.state === "undetailed" && (
        <p className="imo-warnings-stale">
          這份資料記錄了 {feed.recordedCount} 則警報，但沒有各則內容，無法顯示顏色，也無法判斷是否仍在生效。
        </p>
      )}
      {feed.state === "clear" && <p className="imo-warnings-lead">冰島氣象局目前沒有發布有效天氣警報。</p>}

      {(feed.state === "current" || feed.state === "stale-current") && (
        <>
          <ul className="imo-warning-chips">
            {summary.yellow > 0 && <li>🟡 黃色 {summary.yellow}</li>}
            {summary.orange > 0 && <li>🟠 橙色 {summary.orange}</li>}
            {summary.red > 0 && <li>🔴 紅色 {summary.red}</li>}
            {summary.events.map((event) => (
              <li key={`${event.icon}-${event.label}`}>
                {event.icon} {event.label} {event.count}
              </li>
            ))}
            <li>📍 {summary.areas.length} 個影響區域</li>
          </ul>
          {summary.areas.length > 0 && (
            <p className="imo-warning-areas">主要影響：{summary.areas.map((area) => translateImoArea(area, "short").text).join(" · ")}</p>
          )}
          {(summary.earliestOnset || summary.latestExpires) && (
            <p className="imo-warning-span">
              冰島時間 {formatIcelandWarningWindow(summary.earliestOnset, summary.latestExpires)}
            </p>
          )}
          {map.status === "ready" && <ImoWarningMap model={map} mode="overview" onSelect={(id) => setOpen({ regionId: id })} />}
          {map.status === "no-geometry" && (
            <p className="imo-warnings-lead">目前警報有詳細文字資料，但沒有可用的區域圖形資料。</p>
          )}
          {map.status === "blocked" && <p className="imo-warnings-stale">目前警報狀態無法確認</p>}
          <div className="imo-warning-grid">
            {feed.cards.map((card) => (
              <ImoWarningCard key={card.warning.identifier} card={card} onOpen={() => setOpen({ warningId: card.warning.identifier })} />
            ))}
          </div>
        </>
      )}

      {open && resolveImoWarningDialog(feed, open) && (
        <ImoWarningDetailDialog
          key={`${open.regionId ?? ""}:${open.warningId ?? ""}`}
          feed={feed}
          map={map}
          open={open}
          stale={feed.state === "stale-current"}
          onClose={() => setOpen(null)}
        />
      )}

      <TechnicalDetails entries={[imo]} schemaVersion={schemaVersion} preface={imoSourceHealthLabel(imo)} />
    </section>
  );
}
