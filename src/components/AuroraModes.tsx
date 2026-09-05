"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

/**
 * The aurora card's two views: the app's instrument panel, and the app's aurora position map.
 *
 * The gauges are the default, so a page load costs nothing extra. MapLibre, the world outline and
 * the contour walk all wait until the map is asked for, and once it has been asked for the map
 * stays mounted — merely hidden — so coming back to it is instant and the outline is fetched once.
 */

const AuroraOvalMap = dynamic(
  () => import("@/components/AuroraOvalMap").then((module) => module.AuroraOvalMap),
  { ssr: false, loading: () => <p className="muted-line">正在載入極光位置圖…</p> },
);

type AuroraMode = "GAUGES" | "MAP";

export function AuroraModes({
  ovationData,
  children,
}: {
  ovationData: Record<string, unknown>;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<AuroraMode>("GAUGES");
  // Set on the first switch to the map and never cleared: that is what keeps the state loaded.
  const [mapRequested, setMapRequested] = useState(false);

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
      </div>

      <div hidden={mode !== "GAUGES"}>{children}</div>

      {mapRequested && (
        <div hidden={mode !== "MAP"}>
          <AuroraOvalMap ovation={ovationData} />
        </div>
      )}
    </>
  );
}
