"use client";

import { useState } from "react";
import { ImoWarningCard, ImoWarningDetailDialog } from "@/components/ImoWarningDetailDialog";
import { ImoWarningMap } from "@/components/ImoWarningMap";
import { TechnicalDetails } from "@/components/StatusCard";
import {
  filterImoWarningFeedByFamily,
  imoFamilyRegionLine,
  imoWarningFamilyTabs,
  type ImoWarningFamily,
} from "@/lib/imoWarningFamily";
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
  const familyTabs = imoWarningFamilyTabs(feed.cards);
  const [family, setFamily] = useState<ImoWarningFamily>();
  const [open, setOpen] = useState<{ regionId?: string; warningId?: string } | null>(null);
  const selectedFamily = familyTabs.some((tab) => tab.family === family) ? family : familyTabs[0]?.family;
  const visible = selectedFamily ? filterImoWarningFeedByFamily(feed, selectedFamily) : feed;
  const map = buildImoWarningMap(visible);
  const summary = feed.summary;
  const local = visible.summary;
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
          ? feed.cards.some((card) => card.rank === "green" && card.phase !== "expired")
            ? imoLevelLabel("green")
            : "⚠ 警報等級未知"
          : imoLevelLabel(headlineRank);

  return (
    <section className={feed.state === "clear" ? "imo-warnings imo-warnings-quiet" : "imo-warnings"} aria-labelledby="imo-warnings-title">
      <div className="imo-warnings-head">
        <h2 id="imo-warnings-title">⚠ 冰島天氣警報</h2>
        <p className={`imo-warnings-status warning-${headlineRank === "none" ? "unknown" : headlineRank}`}>{title}</p>
      </div>

      {feed.state === "current" && summary.effectiveCount > 0 && (
        <p className="imo-warnings-lead">冰島目前有 {summary.effectiveCount} 則有效／即將生效警報</p>
      )}
      {feed.state === "current" && summary.effectiveCount === 0 && (
        <p className="imo-warnings-lead">
          {feed.cards.some((card) => card.rank === "green" && card.phase !== "expired")
            ? "目前沒有有效的黃色、橙色或紅色警報。"
            : "有警報資料，但開始或結束時間不足，無法判斷是否正在生效。"}
        </p>
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
          {familyTabs.length > 0 && (
            <div className="imo-warning-family-tabs" role="tablist" aria-label="警報類型">
              {familyTabs.map((tab) => {
                const selected = tab.family === selectedFamily;
                return (
                  <button
                    key={tab.family}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`imo-warning-family-tab${selected ? " is-active" : ""}`}
                    onClick={() => {
                      setFamily(tab.family);
                      setOpen(null);
                    }}
                  >
                    {tab.label}
                    <span>{tab.count}</span>
                  </button>
                );
              })}
            </div>
          )}
          <ul className="imo-warning-chips">
            {local.yellow > 0 && <li>🟡 黃色 {local.yellow}</li>}
            {local.orange > 0 && <li>🟠 橙色 {local.orange}</li>}
            {local.red > 0 && <li>🔴 紅色 {local.red}</li>}
            {local.events.map((event) => (
              <li key={`${event.icon}-${event.label}`}>
                {event.icon} {event.label} {event.count}
              </li>
            ))}
            {selectedFamily && <li>📍 {imoFamilyRegionLine(selectedFamily, local.areas.length)}</li>}
          </ul>
          {local.areas.length > 0 && (
            <p className="imo-warning-areas">主要影響：{local.areas.map((area) => translateImoArea(area, "short").text).join(" · ")}</p>
          )}
          {(local.earliestOnset || local.latestExpires) && (
            <p className="imo-warning-span">
              冰島時間 {formatIcelandWarningWindow(local.earliestOnset, local.latestExpires)}
            </p>
          )}
          {map.status === "ready" && <ImoWarningMap model={map} mode="overview" onSelect={(id) => setOpen({ regionId: id })} />}
          {map.status === "no-geometry" && (
            <p className="imo-warnings-lead">目前警報有詳細文字資料，但沒有可用的區域圖形資料。</p>
          )}
          {map.status === "blocked" && <p className="imo-warnings-stale">目前警報狀態無法確認</p>}
          <div className="imo-warning-grid">
            {visible.cards.map((card) => (
              <ImoWarningCard key={card.warning.identifier} card={card} onOpen={() => setOpen({ warningId: card.warning.identifier })} />
            ))}
          </div>
        </>
      )}

      {open && resolveImoWarningDialog(visible, open) && (
        <ImoWarningDetailDialog
          key={`${selectedFamily ?? ""}:${open.regionId ?? ""}:${open.warningId ?? ""}`}
          feed={visible}
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
