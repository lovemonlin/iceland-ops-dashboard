"use client";

import { useMemo } from "react";
import {
  createWarningMapProjection,
  regionLabelAt,
  ringToPath,
  summarizeWarningRegion,
  type ImoWarningMapModel,
} from "@/lib/imoWarningMap";

const FILL: Record<string, string> = {
  yellow: "rgba(253, 224, 71, 0.55)",
  orange: "rgba(251, 146, 60, 0.58)",
  red: "rgba(248, 113, 113, 0.58)",
  unknown: "rgba(148, 163, 184, 0.45)",
  "unknown-time": "rgba(148, 163, 184, 0.28)",
};

const STROKE: Record<string, string> = {
  yellow: "#FDE047",
  orange: "#FB923C",
  red: "#F87171",
  unknown: "#94A3B8",
  "unknown-time": "#CBD5E1",
};

export function ImoWarningMap({
  model,
  selectedId,
  onSelect,
}: {
  model: ImoWarningMapModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const projection = useMemo(() => createWarningMapProjection(model), [model]);
  const coastPath = useMemo(
    () => ringToPath(model.coast.length ? [...model.coast, model.coast[0]] : [], projection.project),
    [model.coast, projection],
  );

  if (model.status !== "ready") return null;

  return (
    <div className="imo-warning-map">
      <h3>冰島警報區域</h3>
      {model.stale && (
        <p className="imo-warnings-stale">⚠ 警報資料目前無法更新。地圖顯示最後一次成功取得的警報資料。</p>
      )}
      <svg
        className="imo-warning-map-svg"
        viewBox={`0 0 ${projection.width.toFixed(1)} ${projection.height.toFixed(1)}`}
        role="group"
        aria-label="冰島天氣警報區域地圖"
      >
        <rect width={projection.width.toFixed(1)} height={projection.height.toFixed(1)} className="imo-warning-map-sea" />
        <path d={coastPath} className="imo-warning-map-land" />
        {model.regions.map((region) => {
          const summary = summarizeWarningRegion(region);
          const paintKey = region.paint === "unknown-time" ? "unknown-time" : region.rank;
          const selected = selectedId === region.id;
          return region.rings.map((ring, index) => {
            const label = index === 0 ? regionLabelAt(ring, projection.project) : undefined;
            return (
              <g key={`${region.id}-${index}`}>
                <path
                  d={ringToPath(ring, projection.project)}
                  fill={FILL[paintKey]}
                  stroke={STROKE[paintKey]}
                  strokeWidth={selected ? 3.2 : 1.4}
                  strokeDasharray={region.paint === "unknown-time" ? "6 4" : undefined}
                  className={selected ? "imo-warning-map-region is-selected" : "imo-warning-map-region"}
                  tabIndex={0}
                  role="button"
                  aria-label={summary.ariaLabel}
                  aria-pressed={selected ? true : undefined}
                  onClick={() => onSelect(region.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(region.id);
                    }
                  }}
                />
                {label?.wide && (
                  <text className="imo-warning-map-label" x={label.x.toFixed(1)} y={label.y.toFixed(1)} textAnchor="middle">
                    {region.name}
                  </text>
                )}
              </g>
            );
          });
        })}
      </svg>
      <ul className="imo-warning-map-legend">
        <li>🟡 黃色警報</li>
        <li>🟠 橙色警報</li>
        <li>🔴 紅色警報</li>
        {model.regions.some((region) => region.rank === "unknown" || region.paint === "unknown-time") && (
          <li>⚪ 等級未知</li>
        )}
      </ul>
      <p className="imo-warning-map-hint">點選警報區域查看詳情</p>
    </div>
  );
}
