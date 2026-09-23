"use client";

import { useMemo } from "react";
import {
  createWarningMapProjection,
  orderedImoMapRegions,
  regionLabelAt,
  ringsFromWarning,
  ringToPath,
  summarizeWarningRegion,
  type ImoWarningMapModel,
} from "@/lib/imoWarningMap";
import { translateImoArea, translateImoEvent } from "@/lib/imoWarningZhTw";

export function ImoWarningMap({
  model,
  selectedId = null,
  onSelect,
  mode = "overview",
  activeWarningId,
}: {
  model: ImoWarningMapModel;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  mode?: "overview" | "detail";
  activeWarningId?: string;
}) {
  const projection = useMemo(() => createWarningMapProjection(model), [model]);
  const coastPath = useMemo(
    () => ringToPath(model.coast.length ? [...model.coast, model.coast[0]] : [], projection.project),
    [model.coast, projection],
  );
  const layers = useMemo(() => orderedImoMapRegions(model.regions), [model.regions]);
  const detail = mode === "detail";
  const activeCard = model.regions.flatMap((region) => region.cards).find((card) => card.warning.identifier === activeWarningId);
  const activeRings = activeCard ? ringsFromWarning(activeCard.warning) : [];

  if (model.status !== "ready") return null;

  return (
    <div className={detail ? "imo-warning-map is-detail" : "imo-warning-map"}>
      {!detail && <h3>冰島警報區域</h3>}
      {model.stale && (
        <p className="imo-warnings-stale">⚠ 警報資料目前無法更新。地圖顯示最後一次成功取得的警報資料。</p>
      )}
      <svg
        className="imo-warning-map-svg"
        viewBox={`0 0 ${projection.width.toFixed(1)} ${projection.height.toFixed(1)}`}
        role="group"
        aria-label={detail ? "目前警報影響區域地圖" : "冰島天氣警報區域地圖"}
      >
        <rect width={projection.width.toFixed(1)} height={projection.height.toFixed(1)} className="imo-warning-map-sea" />
        <path d={coastPath} className="imo-warning-map-land" />
        {layers.map((region) => {
          const summary = summarizeWarningRegion(region);
          const areaZh = translateImoArea(region.name);
          const shortZh = translateImoArea(region.name, "short");
          const eventZh = region.events.map((event) => translateImoEvent(event.eventEn).text).join("、");
          const selected = selectedId === region.id;
          const dimmed = detail && activeWarningId ? !region.cards.some((card) => card.warning.identifier === activeWarningId) : false;
          const aria = `${areaZh.text}，${region.paint === "unknown-time" ? "時間狀態未知" : summary.countLine}，${eventZh}`;
          return region.rings.map((ring, index) => {
            const label = index === 0 ? regionLabelAt(ring, projection.project) : undefined;
            return (
              <g key={`${region.id}-${index}`}>
                <path
                  d={ringToPath(ring, projection.project)}
                  strokeWidth={selected && !detail ? 3.2 : 1.4}
                  strokeDasharray={region.paint === "unknown-time" ? "6 4" : undefined}
                  className={[
                    "imo-warning-map-region",
                    region.paint === "unknown-time" ? "is-unknown-time" : `is-${region.rank}`,
                    selected && !detail ? "is-selected" : "",
                    dimmed ? "is-dimmed" : "",
                    detail ? "is-context" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-region-id={region.id}
                  data-imo-rank={region.rank}
                  tabIndex={detail ? undefined : 0}
                  role={detail ? undefined : "button"}
                  aria-label={aria}
                  aria-pressed={!detail && selected ? true : undefined}
                  onClick={detail || !onSelect ? undefined : () => onSelect(region.id)}
                  onKeyDown={
                    detail || !onSelect
                      ? undefined
                      : (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect(region.id);
                          }
                        }
                  }
                />
                {label?.wide && (
                  <text className="imo-warning-map-label" x={label.x.toFixed(1)} y={label.y.toFixed(1)} textAnchor="middle">
                    {shortZh.text}
                  </text>
                )}
              </g>
            );
          });
        })}
        {detail &&
          activeRings.map((ring, index) => (
            <path
              key={`active-${activeWarningId}-${index}`}
              d={ringToPath(ring, projection.project)}
              strokeWidth={3.8}
              className={`imo-warning-map-region is-active-warning is-${activeCard?.rank ?? "unknown"}`}
              data-active-warning={activeWarningId}
              pointerEvents="none"
            />
          ))}
      </svg>
      {!detail && (
        <>
          <ul className="imo-warning-map-legend">
            <li>🟡 黃色警報</li>
            <li>🟠 橙色警報</li>
            <li>🔴 紅色警報</li>
            {model.regions.some((region) => region.rank === "unknown" || region.paint === "unknown-time") && (
              <li>⚪ 等級未知</li>
            )}
          </ul>
          <p className="imo-warning-map-note">地圖顏色表示目前類型中該區域的最高官方警報等級</p>
          <p className="imo-warning-map-hint">點選警報區域查看詳情</p>
        </>
      )}
    </div>
  );
}
