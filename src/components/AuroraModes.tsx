"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import type { DashboardSnapshot } from "@/snapshot/types";

/**
 * The aurora card's three views: instruments, aurora position map, and the 48-hour forecast.
 *
 * The gauges are the default, so a page load costs nothing extra. MapLibre, the world outline and
 * the contour walk all wait until the map is asked for, and once it has been asked for the map
 * stays mounted — merely hidden — so coming back to it is instant and the outline is fetched once.
 */

const AuroraOvalMap = dynamic(
  () => import("@/components/AuroraOvalMap").then((module) => module.AuroraOvalMap),
  { ssr: false, loading: () => <p className="muted-line">正在載入極光位置圖…</p> },
);

const AuroraForecast = dynamic(
  () => import("@/components/AuroraForecast").then((module) => module.AuroraForecast),
  { ssr: false, loading: () => <p className="muted-line">正在載入極光預測…</p> },
);

type AuroraMode = "GAUGES" | "MAP" | "FORECAST";

export function AuroraModes({
  ovationData,
  snapshot,
  now,
  children,
}: {
  ovationData: Record<string, unknown>;
  snapshot: DashboardSnapshot;
  now: Date;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<AuroraMode>("GAUGES");
  // Set on the first switch to the map and never cleared: that is what keeps the state loaded.
  const [mapRequested, setMapRequested] = useState(false);
  const [forecastRequested, setForecastRequested] = useState(false);

  return (
    <>
      <div className="road-modes aurora-view-modes" role="group" aria-label="極光顯示模式">
        <button
          type="button"
          className={mode === "GAUGES" ? "active" : undefined}
          aria-pressed={mode === "GAUGES"}
          onClick={() => setMode("GAUGES")}
        >
          ◉ 儀表板
        </button>
        <button
          type="button"
          className={mode === "MAP" ? "active" : undefined}
          aria-pressed={mode === "MAP"}
          onClick={() => {
            setMapRequested(true);
            setMode("MAP");
          }}
        >
          🗺 極光機率位置圖
        </button>
        <button
          type="button"
          className={mode === "FORECAST" ? "active" : undefined}
          aria-pressed={mode === "FORECAST"}
          onClick={() => {
            setForecastRequested(true);
            setMode("FORECAST");
          }}
        >
          極光預測
        </button>
      </div>

      <div hidden={mode !== "GAUGES"}>{children}</div>

      {mapRequested && (
        <div hidden={mode !== "MAP"}>
          <AuroraOvalMap ovation={ovationData} snapshot={snapshot} />
        </div>
      )}

      {forecastRequested && (
        <div hidden={mode !== "FORECAST"}>
          <AuroraForecast snapshot={snapshot} baseTime={now} />
        </div>
      )}
    </>
  );
}
