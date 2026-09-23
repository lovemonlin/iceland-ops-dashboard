"use client";

import { useState } from "react";
import { ImoWarningMap } from "@/components/ImoWarningMap";
import { TechnicalDetails } from "@/components/StatusCard";
import { buildImoWarningMap, summarizeWarningRegion } from "@/lib/imoWarningMap";
import {
  formatIcelandWarningWindow,
  imoLevelLabel,
  imoSourceHealthLabel,
  presentImoWarnings,
  type ImoWarningPhase,
  type ImoWarningRank,
  type PresentedImoWarning,
} from "@/lib/imoWarningPresentation";
import {
  IMO_ZH_UNTRANSLATED,
  imoZhDisplay,
  translateImoArea,
  translateImoDescription,
  translateImoEvent,
  translateImoHeadline,
  translateImoInstruction,
} from "@/lib/imoWarningZhTw";
import type { SnapshotSource } from "@/snapshot/types";

const PHASE_LABEL: Record<ImoWarningPhase, string> = {
  active: "● 目前生效",
  upcoming: "○ 尚未生效",
  expired: "✓ 已結束",
  unknown: "時間狀態未知",
};

function preview(text: string | undefined) {
  if (!text) return undefined;
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function WarningCard({ card, selected }: { card: PresentedImoWarning; selected: boolean }) {
  const warning = card.warning;
  const area = translateImoArea(card.areaLabel);
  const event = translateImoEvent(warning.eventEn ?? warning.eventIs);
  const headline = translateImoHeadline(warning.headlineEn);
  const description = translateImoDescription(warning.descriptionEn);
  const instruction = translateImoInstruction(warning.instructionEn);
  const descriptionView = imoZhDisplay(description);
  const instructionView = imoZhDisplay(instruction);
  const icelandic = [warning.headlineIs, warning.descriptionIs, warning.instructionIs].filter(Boolean).join("\n\n");
  const officialEn = [warning.headlineEn, warning.descriptionEn, warning.instructionEn].filter(Boolean).join("\n\n");
  const expandable = Boolean(descriptionView.text || instructionView.text || officialEn || icelandic);
  return (
    <article
      id={`imo-warning-${warning.identifier}`}
      className={`imo-warning-card warning-${card.rank}${selected ? " is-selected" : ""}`}
    >
      <header className="imo-warning-card-head">
        <strong>{imoLevelLabel(card.rank)}</strong>
        <span>{area.text || card.areaLabel}</span>
      </header>
      <p className="imo-warning-event">
        <span aria-hidden="true">{card.icon}</span> {event.translated ? event.text : `🌐 ${event.text || "事件未提供"}`}
      </p>
      {!event.translated && event.text && <p className="imo-warning-zh-note">{IMO_ZH_UNTRANSLATED}</p>}
      <p className="imo-warning-phase">{PHASE_LABEL[card.phase]}</p>
      <p className="imo-warning-time">
        <span>冰島時間</span>
        {card.windowLabel}
      </p>
      {headline.text && <p className="imo-warning-headline">{headline.text}</p>}
      {!headline.translated && warning.headlineEn && <p className="imo-warning-zh-note">{IMO_ZH_UNTRANSLATED}</p>}
      {descriptionView.text && <p className="imo-warning-copy">{preview(descriptionView.text)}</p>}
      {descriptionView.untranslated && descriptionView.text && <p className="imo-warning-zh-note">{IMO_ZH_UNTRANSLATED}</p>}
      {instructionView.text && (
        <p className="imo-warning-instruction">
          <span aria-hidden="true">⚠</span> {preview(instructionView.text)}
        </p>
      )}
      {expandable && (
        <details className="imo-warning-more">
          <summary>查看完整警報內容</summary>
          {descriptionView.text && (
            <>
              <h4>官方警報說明</h4>
              <p>{descriptionView.text}</p>
            </>
          )}
          {instructionView.text && (
            <>
              <h4>安全建議</h4>
              <p>{instructionView.text}</p>
            </>
          )}
          {officialEn && (
            <>
              <h4>IMO 英文原文</h4>
              <p>{officialEn}</p>
            </>
          )}
          {icelandic && (
            <>
              <h4>IMO 冰島文原文</h4>
              <p>{icelandic}</p>
            </>
          )}
        </details>
      )}
    </article>
  );
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = map.regions.find((region) => region.id === selectedId);
  const selectedSummary = selected ? summarizeWarningRegion(selected) : undefined;
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
          {map.status === "ready" && (
            <ImoWarningMap
              model={map}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                const first = map.regions.find((region) => region.id === id)?.cards[0]?.warning.identifier;
                if (first) document.getElementById(`imo-warning-${first}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }}
            />
          )}
          {map.status === "no-geometry" && (
            <p className="imo-warnings-lead">目前警報有詳細文字資料，但沒有可用的區域圖形資料。</p>
          )}
          {map.status === "blocked" && <p className="imo-warnings-stale">目前警報狀態無法確認</p>}
          {selectedSummary && (
            <div className="imo-warning-selection">
              <h3>{translateImoArea(selectedSummary.name).text}</h3>
              <p>{selectedSummary.countLine}</p>
              <ul>
                {selectedSummary.events.map((event) => (
                  <li key={event.eventEn}>
                    {event.icon} {translateImoEvent(event.eventEn).text}
                  </li>
                ))}
              </ul>
              <a href={`#imo-warning-${selectedSummary.identifiers[0]}`}>查看下方詳細警報</a>
            </div>
          )}
          <div className="imo-warning-grid">
            {feed.cards.map((card) => (
              <WarningCard
                key={card.warning.identifier}
                card={card}
                selected={Boolean(selectedSummary?.identifiers.includes(card.warning.identifier))}
              />
            ))}
          </div>
        </>
      )}

      <TechnicalDetails entries={[imo]} schemaVersion={schemaVersion} preface={imoSourceHealthLabel(imo)} />
    </section>
  );
}
