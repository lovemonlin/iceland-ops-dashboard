"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublicAssetPath } from "@/lib/publicPath";
import {
  clampPan,
  COAST_STROKE,
  createProjection,
  DOT_RADIUS,
  DOT_STROKE,
  effectiveObstruction,
  FOCUS_CARD_BACKGROUND,
  FOCUS_RING_COLOR,
  FOCUS_RING_RADIUS,
  FOCUS_RING_STROKE,
  LABEL_FONT_SIZE,
  LABEL_HEIGHT,
  LABEL_OFFSET_X,
  LABEL_WIDTH,
  layoutMarkers,
  MAP_COAST,
  MAP_LABEL_COLOR,
  MAP_LAND,
  MAP_SURFACE,
  MARKER_ICON_SIZE,
  MAX_SCALE,
  obstructionColorFor,
  parseOutline,
  project,
  projectBase,
  TAP_TOLERANCE,
  weatherSymbolFor,
  WIND_ARROW_PATHS,
  ZOOM_STEP,
  type OutlineShape,
  type Point,
} from "@/lib/weatherMap";

/** One site as the snapshot stores it, written by the MET Norway monitor. */
export interface WeatherMapSite {
  id: string;
  name: string;
  nameIs: string;
  nameZh: string;
  lat: number;
  lon: number;
  region: string;
  temperatureC?: number;
  windMps?: number;
  windFromDirection?: number;
  cloudLowPercent?: number;
  cloudMediumPercent?: number;
  cloudHighPercent?: number;
  cloudTotalPercent?: number;
  symbolCode?: string;
}

/** IcelandAuroraSites.default. */
const DEFAULT_SITE_ID = "reykjavik";

function WeatherIcon({ paths, tint, size }: { paths: string[]; tint: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={tint} aria-hidden="true" focusable="false">
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

/**
 * The arrow points where the wind is *going*. MET publishes where it comes *from*, and the two are
 * 180° apart — the app rotates by `fromDirection + 180` and so does this.
 */
function WindArrow({ speed, fromDirection }: { speed?: number; fromDirection?: number }) {
  return (
    <span className="wind-arrow">
      {fromDirection !== undefined && (
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          style={{ transform: `rotate(${fromDirection + 180}deg)` }}
        >
          {WIND_ARROW_PATHS.map((path) => (
            <path key={path} d={path} />
          ))}
        </svg>
      )}
      <span>{speed === undefined ? "—" : Math.round(speed)}</span>
    </span>
  );
}

export function WeatherMap({ sites }: { sites: WeatherMapSite[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [shape, setShape] = useState<OutlineShape | null>(null);
  const [outlineFailed, setOutlineFailed] = useState(false);
  const [focusedId, setFocusedId] = useState(DEFAULT_SITE_ID);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  // The outline is a static asset of this site; it is never fetched from a production API.
  useEffect(() => {
    let alive = true;
    fetch(getPublicAssetPath("/data/iceland.geojson"))
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((json) => {
        if (!alive) return;
        const parsed = parseOutline(json);
        if (parsed) setShape(parsed);
        else setOutlineFailed(true);
      })
      .catch(() => {
        if (alive) setOutlineFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shape]);

  const projection = useMemo(
    () => (shape && width > 0 ? createProjection(shape.bounds, width) : null),
    [shape, width],
  );

  const focused = sites.find((site) => site.id === focusedId) ?? sites[0];

  const zoomToScale = useCallback(
    (target: number) => {
      if (!projection) return;
      const next = Math.min(MAX_SCALE, Math.max(1, target));
      const centre = { x: projection.viewportWidth / 2, y: projection.viewportHeight / 2 };
      const anchor = focused ? projectBase(projection, focused.lon, focused.lat) : centre;
      setScale(next);
      setPan(
        clampPan(
          { x: centre.x - anchor.x * next, y: centre.y - anchor.y * next },
          next,
          projection.viewportWidth,
          projection.viewportHeight,
        ),
      );
    },
    [projection, focused],
  );

  const reset = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const placed = useMemo(() => {
    if (!projection) return [];
    return layoutMarkers({
      points: sites,
      focusedId,
      viewportWidth: projection.viewportWidth,
      viewportHeight: projection.viewportHeight,
      project: (lon, lat) => project(projection, lon, lat, scale, pan),
    });
  }, [projection, sites, focusedId, scale, pan]);

  // ── Pointer handling ────────────────────────────────────────────────────────
  // Mirrors the app's rule: two fingers always take over (pinch), one finger only takes over once
  // zoomed in (pan). Un-zoomed single-finger gestures are left to the page so it can still scroll.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; centre: Point } | null>(null);

  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const selectNear = (at: Point) => {
    const nearest = placed
      .map((marker) => ({ marker, distance: Math.hypot(marker.position.x - at.x, marker.position.y - at.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance <= TAP_TOLERANCE) setFocusedId(nearest.marker.point.id);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && scale <= 1) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !projection || scale <= 1) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.current.moved = true;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    setPan((current) =>
      clampPan(
        { x: current.x + dx, y: current.y + dy },
        scale,
        projection.viewportWidth,
        projection.viewportHeight,
      ),
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const wasDrag = drag.current?.moved ?? false;
    drag.current = null;
    if (!wasDrag) selectNear(localPoint(event));
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!projection) return;
    event.preventDefault();
    zoomToScale(scale * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
  };

  const touchDistance = (touches: React.TouchList) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2 || !projection) return;
    event.preventDefault();
    const distance = touchDistance(event.touches);
    const centre = localPoint({
      clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2,
    });
    if (pinch.current) {
      const factor = distance / pinch.current.distance;
      const next = Math.min(MAX_SCALE, Math.max(1, scale * factor));
      // Keep the point under the two fingers still, so the zoom tracks the gesture.
      const anchorBase = { x: (centre.x - pan.x) / scale, y: (centre.y - pan.y) / scale };
      setScale(next);
      setPan(
        clampPan(
          { x: centre.x - anchorBase.x * next, y: centre.y - anchorBase.y * next },
          next,
          projection.viewportWidth,
          projection.viewportHeight,
        ),
      );
    }
    pinch.current = { distance, centre };
  };

  const onTouchEnd = () => {
    pinch.current = null;
  };

  if (outlineFailed) {
    return <p className="error">無法載入冰島輪廓，地圖檢視暫時不能用。</p>;
  }

  const height = projection?.viewportHeight ?? 0;

  return (
    <div className="weather-map">
      <div
        ref={containerRef}
        className="weather-map-canvas"
        style={{ height: height || undefined, background: MAP_SURFACE, touchAction: scale > 1 ? "none" : "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => zoomToScale(scale >= MAX_SCALE ? 1 : scale * 2)}
        onWheel={onWheel}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {shape && projection && (
          <svg
            width={projection.viewportWidth}
            height={projection.viewportHeight}
            aria-label="冰島各地天氣地圖"
            role="img"
          >
            <path
              d={shape.rings
                .map((ring) =>
                  ring
                    .map(([lon, lat], index) => {
                      const point = project(projection, lon, lat, scale, pan);
                      return `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
                    })
                    .join("") + "Z",
                )
                .join(" ")}
              fill={MAP_LAND}
              stroke={MAP_COAST}
              strokeWidth={COAST_STROKE}
            />
            {placed.map((marker) => {
              const isFocused = marker.point.id === focusedId;
              return (
                <g key={marker.point.id}>
                  {isFocused && (
                    <circle
                      cx={marker.position.x}
                      cy={marker.position.y}
                      r={FOCUS_RING_RADIUS}
                      fill="none"
                      stroke={FOCUS_RING_COLOR}
                      strokeWidth={FOCUS_RING_STROKE}
                    />
                  )}
                  <circle
                    cx={marker.position.x}
                    cy={marker.position.y}
                    r={DOT_RADIUS}
                    fill={obstructionColorFor(effectiveObstruction(marker.point))}
                    stroke="rgba(255, 255, 255, 0.85)"
                    strokeWidth={DOT_STROKE}
                  />
                </g>
              );
            })}
          </svg>
        )}

        {/*
          Labels sit above the drawing as ordinary DOM, the way the app layers Compose Text over its
          Canvas — so fonts, icons and text scaling follow the rest of the page.

          The icon and the dot answer different questions and both are kept: the icon says what the
          weather is, the dot colour says how much of the sky is blocked. A sunny icon on an amber
          dot is not a contradiction — it is high cloud, and it is exactly what matters here.
        */}
        {placed.map((marker) => {
          if (!marker.labelSide) return null;
          const symbol = weatherSymbolFor(marker.point.symbolCode);
          const left =
            marker.labelSide === "RIGHT"
              ? marker.position.x + LABEL_OFFSET_X
              : marker.position.x - LABEL_OFFSET_X - LABEL_WIDTH;
          return (
            <div
              key={marker.point.id}
              className="weather-map-label"
              style={{
                left: Math.round(left),
                top: Math.round(marker.position.y - LABEL_HEIGHT / 2),
                width: LABEL_WIDTH,
                height: LABEL_HEIGHT,
                justifyContent: marker.labelSide === "RIGHT" ? "flex-start" : "flex-end",
              }}
            >
              <WeatherIcon paths={symbol.paths} tint={symbol.tint} size={MARKER_ICON_SIZE} />
              {marker.point.temperatureC !== undefined && (
                <strong style={{ fontSize: LABEL_FONT_SIZE, lineHeight: `${LABEL_FONT_SIZE}px`, color: MAP_LABEL_COLOR }}>
                  {Math.round(marker.point.temperatureC)}°
                </strong>
              )}
            </div>
          );
        })}

        <div className="weather-map-zoom">
          <button type="button" onClick={() => zoomToScale(scale * ZOOM_STEP)} disabled={scale >= MAX_SCALE} aria-label="放大">
            +
          </button>
          <button type="button" onClick={() => zoomToScale(scale / ZOOM_STEP)} disabled={scale <= 1} aria-label="縮小">
            −
          </button>
          {scale > 1 && (
            <button type="button" className="weather-map-reset" onClick={reset}>
              重設
            </button>
          )}
        </div>

        {scale <= 1 && <div className="weather-map-hint">雙指縮放地圖，或用滾輪 / 雙擊</div>}
      </div>

      {focused && (
        <div className="weather-focus-card" style={{ background: FOCUS_CARD_BACKGROUND }}>
          {(() => {
            const symbol = weatherSymbolFor(focused.symbolCode);
            const obstruction = effectiveObstruction(focused);
            return (
              <>
                <WeatherIcon paths={symbol.paths} tint={symbol.tint} size={22} />
                <div className="weather-focus-name">
                  <strong>{focused.nameZh}</strong>
                  <span>{focused.nameIs}</span>
                </div>
                <div className="weather-focus-metric">
                  <strong>{focused.temperatureC === undefined ? "—" : `${Math.round(focused.temperatureC)}°`}</strong>
                  <span>氣溫</span>
                </div>
                <div className="weather-focus-metric">
                  <WindArrow speed={focused.windMps} fromDirection={focused.windFromDirection} />
                  <span>風速</span>
                </div>
                <div className="weather-focus-metric">
                  <strong style={{ color: obstructionColorFor(obstruction) }}>{Math.trunc(obstruction)}%</strong>
                  <span>雲量</span>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
