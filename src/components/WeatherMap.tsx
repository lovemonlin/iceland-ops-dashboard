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

type WeatherViewMode = "LIST" | "MAP";
type ViewState = { scale: number; pan: Point };
type PlacedMarkers = ReturnType<typeof layoutMarkers>;

/** The app's Region order and zh-TW labels. */
const REGION_ORDER = ["CAPITAL", "SOUTH", "WEST", "WESTFJORDS", "NORTH", "EAST", "HIGHLANDS"] as const;
const REGION_LABELS: Record<string, string> = {
  CAPITAL: "首都圈",
  SOUTH: "南部",
  WEST: "西部／斯奈山半島",
  WESTFJORDS: "西峽灣",
  NORTH: "北部",
  EAST: "東部",
  HIGHLANDS: "內陸高地",
};

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

function WeatherList({
  sites,
  focusedId,
  onFocus,
}: {
  sites: WeatherMapSite[];
  focusedId: string;
  onFocus: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const byRegion = new Map<string, WeatherMapSite[]>();
    for (const site of sites) {
      const group = byRegion.get(site.region) ?? [];
      group.push(site);
      byRegion.set(site.region, group);
    }
    const known = REGION_ORDER.filter((region) => byRegion.has(region)).map((region) => [region, byRegion.get(region)!] as const);
    const extras = [...byRegion.entries()].filter(([region]) => !REGION_ORDER.includes(region as (typeof REGION_ORDER)[number]));
    return [...known, ...extras];
  }, [sites]);

  return (
    <div
      className="weather-list"
      aria-label="冰島各地天氣清單"
      style={{ border: "1px solid var(--line)", borderRadius: 10, background: "rgba(20, 27, 45, 0.55)", padding: 10 }}
    >
      <p className="muted-line" style={{ margin: "0 0 8px" }}>
        清單可一次比較 32 個地點；點選地點後切回地圖會保留選取位置。
      </p>
      <div
        className="weather-list-header"
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: "26px minmax(110px, 1fr) 44px 52px 48px",
          gap: 6,
          alignItems: "center",
          padding: "2px 4px 6px",
          color: "var(--muted)",
          fontSize: 11,
          textAlign: "right",
        }}
      >
        <span />
        <span style={{ textAlign: "left" }}>地點</span>
        <span>氣溫</span>
        <span>風速</span>
        <span>雲量</span>
      </div>
      <div className="weather-list-scroll" style={{ maxHeight: 520, overflowY: "auto", paddingRight: 2 }}>
        {groups.map(([region, regionSites]) => {
          const obstructions = regionSites.map((site) => effectiveObstruction(site));
          const averageObstruction = obstructions.reduce((sum, value) => sum + value, 0) / Math.max(1, obstructions.length);
          const temperatures = regionSites
            .map((site) => site.temperatureC)
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
          const minTemp = temperatures.length > 0 ? Math.min(...temperatures) : undefined;
          const maxTemp = temperatures.length > 0 ? Math.max(...temperatures) : undefined;
          const range =
            minTemp === undefined || maxTemp === undefined
              ? ""
              : Math.round(minTemp) === Math.round(maxTemp)
                ? `${Math.round(minTemp)}°`
                : `${Math.round(minTemp)}–${Math.round(maxTemp)}°`;

          return (
            <section className="weather-list-region" key={region} style={{ marginTop: 8 }}>
              <div
                className="weather-list-region-head"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px 4px" }}
              >
                <i
                  style={{ width: 8, height: 8, borderRadius: 999, background: obstructionColorFor(averageObstruction), flex: "0 0 auto" }}
                  aria-hidden="true"
                />
                <strong style={{ flex: 1, fontSize: 13 }}>{REGION_LABELS[region] ?? region}</strong>
                <span className="muted-line">{range}</span>
              </div>
              {regionSites.map((site) => {
                const symbol = weatherSymbolFor(site.symbolCode);
                const obstruction = effectiveObstruction(site);
                const selected = site.id === focusedId;
                return (
                  <button
                    type="button"
                    className={`weather-list-row${selected ? " active" : ""}`}
                    key={site.id}
                    aria-pressed={selected}
                    onClick={() => onFocus(site.id)}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns: "26px minmax(110px, 1fr) 44px 52px 48px",
                      gap: 6,
                      alignItems: "center",
                      border: 0,
                      borderRadius: 6,
                      padding: "6px 4px",
                      background: selected ? "rgba(103, 212, 255, 0.12)" : "transparent",
                      color: "var(--text)",
                      font: "inherit",
                      textAlign: "right",
                      cursor: "pointer",
                    }}
                  >
                    <span className="weather-list-symbol">
                      <WeatherIcon paths={symbol.paths} tint={symbol.tint} size={18} />
                    </span>
                    <span className="weather-list-place" style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{site.nameZh || site.name}</span>
                    <span>{site.temperatureC === undefined ? "—" : `${Math.round(site.temperatureC)}°`}</span>
                    <WindArrow speed={site.windMps} fromDirection={site.windFromDirection} />
                    <span style={{ color: obstructionColorFor(obstruction) }}>{Math.trunc(obstruction)}%</span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Path2D construction is surprisingly expensive on repeated wheel events; cache each Material icon once. */
const canvasPathCache = new Map<string, Path2D[]>();

function drawCanvasWeatherIcon(
  context: CanvasRenderingContext2D,
  symbolCode: string | undefined,
  x: number,
  y: number,
  size: number,
) {
  const symbol = weatherSymbolFor(symbolCode);
  let paths = canvasPathCache.get(symbol.key);
  if (!paths) {
    paths = symbol.paths.map((path) => new Path2D(path));
    canvasPathCache.set(symbol.key, paths);
  }
  context.save();
  context.translate(x, y);
  context.scale(size / 24, size / 24);
  context.fillStyle = symbol.tint;
  for (const path of paths) context.fill(path);
  context.restore();
}

export function WeatherMap({ sites }: { sites: WeatherMapSite[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<WeatherViewMode>("LIST");
  const [width, setWidth] = useState(0);
  const [shape, setShape] = useState<OutlineShape | null>(null);
  const [outlineFailed, setOutlineFailed] = useState(false);
  const [focusedId, setFocusedId] = useState(DEFAULT_SITE_ID);
  const [uiScale, setUiScale] = useState(1);

  // The view itself lives in refs. Zooming and panning therefore redraw the canvas directly instead
  // of asking React to reconcile a 3,063-point SVG path plus 32 DOM labels on every animation frame.
  const viewRef = useRef<ViewState>({ scale: 1, pan: { x: 0, y: 0 } });
  const placedRef = useRef<PlacedMarkers>([]);
  const drawFrameRef = useRef<number | null>(null);
  const wheelCommitRef = useRef<number | null>(null);

  // Only load the outline once the user actually chooses map mode. List mode needs no geometry.
  useEffect(() => {
    if (mode !== "MAP" || shape || outlineFailed) return;
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
  }, [mode, shape, outlineFailed]);

  useEffect(() => {
    if (mode !== "MAP") return;
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, shape]);

  const projection = useMemo(
    () => (shape && width > 0 ? createProjection(shape.bounds, width) : null),
    [shape, width],
  );

  const baseRings = useMemo(() => {
    if (!projection || !shape) return [] as Point[][];
    return shape.rings.map((ring) => ring.map(([lon, lat]) => projectBase(projection, lon, lat)));
  }, [projection, shape]);

  const baseSites = useMemo(() => {
    const positions = new Map<string, Point>();
    if (!projection) return positions;
    for (const site of sites) positions.set(site.id, projectBase(projection, site.lon, site.lat));
    return positions;
  }, [projection, sites]);

  const focused = sites.find((site) => site.id === focusedId) ?? sites[0];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = projection.viewportWidth;
    const cssHeight = projection.viewportHeight;
    const bitmapWidth = Math.max(1, Math.round(cssWidth * dpr));
    const bitmapHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = MAP_SURFACE;
    context.fillRect(0, 0, cssWidth, cssHeight);

    const view = viewRef.current;

    // Island outline: one canvas draw, no huge SVG `d` string and no React reconciliation.
    context.save();
    context.translate(view.pan.x, view.pan.y);
    context.scale(view.scale, view.scale);
    context.beginPath();
    for (const ring of baseRings) {
      if (ring.length === 0) continue;
      context.moveTo(ring[0].x, ring[0].y);
      for (let index = 1; index < ring.length; index += 1) context.lineTo(ring[index].x, ring[index].y);
      context.closePath();
    }
    context.fillStyle = MAP_LAND;
    context.fill();
    context.strokeStyle = MAP_COAST;
    context.lineWidth = COAST_STROKE / view.scale;
    context.stroke();
    context.restore();

    const placed = layoutMarkers({
      points: sites,
      focusedId,
      viewportWidth: projection.viewportWidth,
      viewportHeight: projection.viewportHeight,
      project: (lon, lat) => {
        const base = projectBase(projection, lon, lat);
        return { x: base.x * view.scale + view.pan.x, y: base.y * view.scale + view.pan.y };
      },
    });
    placedRef.current = placed;

    // Dots and focus ring stay a constant physical size while the island moves underneath them,
    // exactly as the Compose map does.
    for (const marker of placed) {
      const isFocused = marker.point.id === focusedId;
      if (isFocused) {
        context.beginPath();
        context.arc(marker.position.x, marker.position.y, FOCUS_RING_RADIUS, 0, Math.PI * 2);
        context.strokeStyle = FOCUS_RING_COLOR;
        context.lineWidth = FOCUS_RING_STROKE;
        context.stroke();
      }
      context.beginPath();
      context.arc(marker.position.x, marker.position.y, DOT_RADIUS, 0, Math.PI * 2);
      context.fillStyle = obstructionColorFor(effectiveObstruction(marker.point));
      context.fill();
      context.strokeStyle = "rgba(255, 255, 255, 0.85)";
      context.lineWidth = DOT_STROKE;
      context.stroke();
    }

    context.textBaseline = "middle";
    context.font = `700 ${LABEL_FONT_SIZE}px system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif`;
    context.fillStyle = MAP_LABEL_COLOR;

    for (const marker of placed) {
      if (!marker.labelSide) continue;
      const temperature = marker.point.temperatureC;
      const temperatureText = temperature === undefined ? "" : `${Math.round(temperature)}°`;
      const textWidth = temperatureText ? context.measureText(temperatureText).width : 0;
      const contentWidth = MARKER_ICON_SIZE + (temperatureText ? 2 + textWidth : 0);
      const labelLeft =
        marker.labelSide === "RIGHT"
          ? marker.position.x + LABEL_OFFSET_X
          : marker.position.x - LABEL_OFFSET_X - LABEL_WIDTH;
      const contentLeft = marker.labelSide === "RIGHT" ? labelLeft : labelLeft + LABEL_WIDTH - contentWidth;
      const iconTop = marker.position.y - MARKER_ICON_SIZE / 2;
      drawCanvasWeatherIcon(context, marker.point.symbolCode, contentLeft, iconTop, MARKER_ICON_SIZE);
      if (temperatureText) {
        context.fillStyle = MAP_LABEL_COLOR;
        context.fillText(temperatureText, contentLeft + MARKER_ICON_SIZE + 2, marker.position.y + 0.5);
      }
    }
  }, [projection, baseRings, sites, focusedId]);

  const scheduleDraw = useCallback(() => {
    if (drawFrameRef.current !== null) return;
    drawFrameRef.current = requestAnimationFrame(() => {
      drawFrameRef.current = null;
      draw();
    });
  }, [draw]);

  // Drawn straight away rather than only scheduled: an animation frame may never arrive in a
  // browser that is not painting, and the first paint is the whole map rather than a missing
  // in-between step. Interaction still coalesces through scheduleDraw.
  useEffect(() => {
    if (mode === "MAP" && projection) draw();
  }, [mode, projection, focusedId, draw]);

  useEffect(
    () => () => {
      if (drawFrameRef.current !== null) cancelAnimationFrame(drawFrameRef.current);
      if (wheelCommitRef.current !== null) clearTimeout(wheelCommitRef.current);
    },
    [],
  );

  const animation = useRef<{ frame: number; timeout: number } | null>(null);

  const stopAnimation = useCallback(() => {
    if (!animation.current) return;
    cancelAnimationFrame(animation.current.frame);
    clearTimeout(animation.current.timeout);
    animation.current = null;
  }, []);

  const commitView = useCallback((view: ViewState) => {
    viewRef.current = view;
    setUiScale(view.scale);
    draw();
  }, [draw]);

  const animateTo = useCallback(
    (target: ViewState, duration = 220) => {
      stopAnimation();
      const from = viewRef.current;
      const started = performance.now();

      const settle = () => {
        if (!animation.current) return;
        const timeout = animation.current.timeout;
        animation.current = null;
        clearTimeout(timeout);
        commitView(target);
      };

      const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        // easeOutCubic feels much closer to MapLibre's zoom: immediate response, gentle landing.
        const eased = 1 - Math.pow(1 - t, 3);
        viewRef.current = {
          scale: from.scale + (target.scale - from.scale) * eased,
          pan: {
            x: from.pan.x + (target.pan.x - from.pan.x) * eased,
            y: from.pan.y + (target.pan.y - from.pan.y) * eased,
          },
        };
        draw();
        if (t < 1 && animation.current) animation.current.frame = requestAnimationFrame(step);
        else settle();
      };

      animation.current = {
        frame: requestAnimationFrame(step),
        timeout: window.setTimeout(settle, duration + 80),
      };
    },
    [commitView, draw, stopAnimation],
  );

  useEffect(() => stopAnimation, [stopAnimation]);

  /** Anchors on a point in unscaled map space and keeps it under the same screen position. */
  const viewAnchoredAt = useCallback(
    (nextScale: number, anchorBase: Point, screenPoint: Point) => {
      if (!projection) return null;
      const bounded = Math.min(MAX_SCALE, Math.max(1, nextScale));
      return {
        scale: bounded,
        pan: clampPan(
          { x: screenPoint.x - anchorBase.x * bounded, y: screenPoint.y - anchorBase.y * bounded },
          bounded,
          projection.viewportWidth,
          projection.viewportHeight,
        ),
      };
    },
    [projection],
  );

  /** The +/- buttons and double-tap keep the app's anchor: the site currently selected. */
  const zoomToScale = useCallback(
    (target: number) => {
      if (!projection) return;
      const centre = { x: projection.viewportWidth / 2, y: projection.viewportHeight / 2 };
      const anchor = focused ? baseSites.get(focused.id) ?? centre : centre;
      const view = viewAnchoredAt(target, anchor, centre);
      if (view) animateTo(view);
    },
    [projection, focused, baseSites, viewAnchoredAt, animateTo],
  );

  const reset = useCallback(() => {
    animateTo({ scale: 1, pan: { x: 0, y: 0 } });
  }, [animateTo]);

  // ── Pointer handling ────────────────────────────────────────────────────────
  // Mirrors the app's rule: two fingers always take over (pinch), one finger only takes over once
  // zoomed in (pan). Un-zoomed single-finger gestures are left to the page so it can still scroll.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number } | null>(null);

  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const selectNear = (at: Point) => {
    const nearest = placedRef.current
      .map((marker) => ({ marker, distance: Math.hypot(marker.position.x - at.x, marker.position.y - at.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance <= TAP_TOLERANCE) setFocusedId(nearest.marker.point.id);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && viewRef.current.scale <= 1) return;
    stopAnimation();
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !projection || viewRef.current.scale <= 1) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.current.moved = true;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    const current = viewRef.current;
    viewRef.current = {
      scale: current.scale,
      pan: clampPan(
        { x: current.pan.x + dx, y: current.pan.y + dy },
        current.scale,
        projection.viewportWidth,
        projection.viewportHeight,
      ),
    };
    scheduleDraw();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const wasDrag = drag.current?.moved ?? false;
    drag.current = null;
    setUiScale(viewRef.current.scale);
    if (!wasDrag) selectNear(localPoint(event));
  };

  const onWheel = (event: WheelEvent) => {
    if (!projection) return;
    event.preventDefault();
    stopAnimation();
    const current = viewRef.current;
    const at = localPoint(event);
    // MapLibre-like continuous zoom: small trackpad deltas stay small, mouse-wheel notches stay sane.
    const factor = Math.exp(-event.deltaY * 0.0022);
    const anchorBase = { x: (at.x - current.pan.x) / current.scale, y: (at.y - current.pan.y) / current.scale };
    const view = viewAnchoredAt(current.scale * factor, anchorBase, at);
    if (!view) return;
    viewRef.current = view;
    scheduleDraw();

    if (wheelCommitRef.current !== null) clearTimeout(wheelCommitRef.current);
    wheelCommitRef.current = window.setTimeout(() => {
      wheelCommitRef.current = null;
      setUiScale(viewRef.current.scale);
    }, 80);
  };

  const touchDistance = (touches: TouchList) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length < 2 || !projection) return;
    event.preventDefault();
    stopAnimation();
    const distance = touchDistance(event.touches);
    const centre = localPoint({
      clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2,
    });
    if (pinch.current) {
      const current = viewRef.current;
      const factor = distance / pinch.current.distance;
      const next = Math.min(MAX_SCALE, Math.max(1, current.scale * factor));
      const anchorBase = { x: (centre.x - current.pan.x) / current.scale, y: (centre.y - current.pan.y) / current.scale };
      viewRef.current = {
        scale: next,
        pan: clampPan(
          { x: centre.x - anchorBase.x * next, y: centre.y - anchorBase.y * next },
          next,
          projection.viewportWidth,
          projection.viewportHeight,
        ),
      };
      scheduleDraw();
    }
    pinch.current = { distance };
  };

  const onTouchEnd = () => {
    pinch.current = null;
    setUiScale(viewRef.current.scale);
  };

  /**
   * Wheel and pinch are bound directly rather than through React's props.
   *
   * React registers `wheel` and `touchmove` as passive listeners, so `preventDefault` inside a
   * synthetic handler does nothing except log "Unable to preventDefault inside passive event
   * listener invocation" — and the page scrolls away underneath while you are trying to zoom the
   * map. A non-passive listener is the only way to hold the gesture.
   */
  useEffect(() => {
    if (mode !== "MAP") return;
    const element = containerRef.current;
    if (!element) return;
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchmove", onTouchMove);
    };
  });

  const height = projection?.viewportHeight ?? 0;

  return (
    <div className="weather-map">
      <div className="road-modes weather-view-modes" role="group" aria-label="天氣檢視模式">
        <button type="button" className={mode === "LIST" ? "active" : ""} aria-pressed={mode === "LIST"} onClick={() => setMode("LIST")}>
          ☷ 清單
        </button>
        <button type="button" className={mode === "MAP" ? "active" : ""} aria-pressed={mode === "MAP"} onClick={() => setMode("MAP")}>
          🗺 地圖
        </button>
      </div>

      {mode === "LIST" ? (
        <WeatherList sites={sites} focusedId={focusedId} onFocus={setFocusedId} />
      ) : outlineFailed ? (
        <p className="error">無法載入冰島輪廓，請切回清單檢視。</p>
      ) : (
        <>
          <div
            ref={containerRef}
            className="weather-map-canvas"
            style={{ height: height || undefined, background: MAP_SURFACE, touchAction: uiScale > 1 ? "none" : "pan-y" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
            onDoubleClick={() => zoomToScale(viewRef.current.scale >= MAX_SCALE ? 1 : viewRef.current.scale * 2)}
            onTouchEnd={onTouchEnd}
          >
            {projection && (
              <canvas ref={canvasRef} aria-label="冰島各地天氣地圖" role="img" style={{ display: "block", width: "100%", height: "100%" }} />
            )}

            <div className="weather-map-zoom">
              <button
                type="button"
                onClick={() => zoomToScale(viewRef.current.scale * ZOOM_STEP)}
                disabled={uiScale >= MAX_SCALE}
                aria-label="放大"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => zoomToScale(viewRef.current.scale / ZOOM_STEP)}
                disabled={uiScale <= 1}
                aria-label="縮小"
              >
                −
              </button>
              {uiScale > 1 && (
                <button type="button" className="weather-map-reset" onClick={reset}>
                  重設
                </button>
              )}
            </div>

            {uiScale <= 1 && <div className="weather-map-hint">雙指縮放地圖，或用滾輪 / 雙擊</div>}
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
        </>
      )}
    </div>
  );
}
