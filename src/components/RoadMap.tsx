"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getPublicAssetPath } from "@/lib/publicPath";
import {
  ALL_MARKER_IDS,
  buildRoadStyle,
  drawMarker,
  ICELAND_CAMERA_BOUNDS,
  ICELAND_CAMERA_FALLBACK,
  MARKER_IDS,
  readFeature,
  EVENT_LEGEND,
  ROAD_ATTRIBUTION,
  ROAD_LEGEND,
  ROAD_MODES,
  ROAD_QUERY_ORDER,
  ROAD_TAP_TOLERANCE,
  roadDisplayTitle,
  roadStatusColor,
  roadStatusEnglish,
  roadStatusLabel,
  roadLayerVisibility,
  STATION_LABEL,
  STATION_LEGEND,
  type RoadFeatureItem,
  type RoadInfoMode,
} from "@/lib/roadMap";

/**
 * The app's road map, on MapLibre GL JS.
 *
 * Nothing is initialised until the disclosure is opened: the library, the style and the three
 * production GeoJSON files are all loaded on first expand and then kept, so toggling does not
 * re-download them. The dashboard's own hourly snapshot is unaffected either way.
 */
/** The app fits the same corners; the bottom is generous because the detail card sits over it. */
const CAMERA_PADDING = { padding: { top: 60, bottom: 120, left: 34, right: 34 } };

/** The app wraps its own fit in runCatching and drops to a fixed centre and zoom; so does this. */
function frameIceland(map: MapLibreMap) {
  try {
    map.fitBounds(ICELAND_CAMERA_BOUNDS, { ...CAMERA_PADDING, duration: 0 });
  } catch {
    map.jumpTo({ center: ICELAND_CAMERA_FALLBACK.center, zoom: ICELAND_CAMERA_FALLBACK.zoom });
  }
}

export function RoadMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Also held in state: the labels overlay renders from it, and a ref must not be read during render.
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [selected, setSelected] = useState<RoadFeatureItem | null>(null);
  // The app reaches these as two separate screens; here they are one map with a toggle.
  const [mode, setMode] = useState<RoadInfoMode>("EVENTS");
  const modeRef = useRef<RoadInfoMode>(mode);
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const onSelect = useCallback((item: RoadFeatureItem) => setSelected(item), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let disposed = false;

    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (disposed) return;

        // maplibre-gl 6 is ESM-only and resolves its worker URL at runtime; that URL does not
        // survive bundling into a static export, so the worker is served from this site instead.
        // Without this the map creates a canvas and then silently never loads any source.
        maplibre.setWorkerUrl(getPublicAssetPath("/vendor/maplibre/maplibre-gl-worker.mjs"));

        const created = new maplibre.Map({
          container,
          style: buildRoadStyle(getPublicAssetPath("/data/iceland.geojson")) as never,
          bounds: ICELAND_CAMERA_BOUNDS,
          fitBoundsOptions: CAMERA_PADDING,
          attributionControl: false,
          // The app disables both; a rotated Iceland helps nobody.
          dragRotate: false,
          pitchWithRotate: false,
          touchZoomRotate: true,
        });
        mapRef.current = created;
        const map = created;
        setMap(created);

        map.on("error", (event) => {
          const message = (event as { error?: { message?: string } }).error?.message ?? "unknown map error";
          setFailure(message);
        });

        map.on("load", () => {
          if (disposed) return;
          // The marker artwork is generated here exactly as the app generates its bitmaps.
          for (const id of ALL_MARKER_IDS) {
            const image = drawMarker(id, 2);
            if (image && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
          }
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            map.resize();
            frameIceland(map);
          }
          setReady(true);
        });

        map.on("click", (event) => {
          const box: [[number, number], [number, number]] = [
            [event.point.x - ROAD_TAP_TOLERANCE, event.point.y - ROAD_TAP_TOLERANCE],
            [event.point.x + ROAD_TAP_TOLERANCE, event.point.y + ROAD_TAP_TOLERANCE],
          ];
          // Queried in the app's order, so a marker always wins over the road underneath it —
          // and only among the layers the current mode is showing.
          const visible = roadLayerVisibility(modeRef.current);
          for (const layer of ROAD_QUERY_ORDER) {
            if (layer === "incident-markers" && !visible.showIncidents) continue;
            if (layer === "station-markers" && !visible.showStations) continue;
            if (!map.getLayer(layer)) continue;
            const hit: MapGeoJSONFeature | undefined = map.queryRenderedFeatures(box, { layers: [layer] })[0];
            if (!hit) continue;
            const type = layer === "incident-markers" ? "INCIDENT" : layer === "station-markers" ? "STATION" : "ROAD";
            onSelect(readFeature(hit.properties ?? {}, type));
            return;
          }
        });
      } catch (error) {
        if (!disposed) setFailure(error instanceof Error ? error.message : "map failed to load");
      }
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, [onSelect]);

  /**
   * The mode is applied as layer opacity rather than by rebuilding the style, which is what the
   * app does (RoadInfoScreen.kt:409-413) — the data stays loaded, so switching back is instant.
   *
   * One addition: the app sets only `circleOpacity` on the station dots, which leaves their white
   * stroke drawn over the roads. That reads as a stray ring rather than a hidden station, so the
   * stroke is faded with the fill here.
   */
  useEffect(() => {
    modeRef.current = mode;
    const map = mapRef.current;
    if (!map || !ready) return;
    const { showRoads, showIncidents, showStations } = roadLayerVisibility(mode);
    map.setPaintProperty("road-casing", "line-opacity", showRoads ? 0.82 : 0);
    map.setPaintProperty("road-lines", "line-opacity", showRoads ? 1 : 0);
    map.setPaintProperty("incident-markers", "icon-opacity", showIncidents ? 1 : 0);
    map.setPaintProperty("station-markers", "circle-opacity", showStations ? 1 : 0);
    map.setPaintProperty("station-markers", "circle-stroke-opacity", showStations ? 1 : 0);
    // A selection made in the other mode would otherwise stay open over an invisible feature.
    setSelected(null);
  }, [mode, ready]);

  /**
   * A map built while its container is `display: none` measures zero, and fitting Iceland into
   * zero pixels lands the camera at maximum zoom over empty ocean. Resizing alone does not undo
   * that — `resize` keeps the centre and zoom — so the bounds are fitted again the first time the
   * container actually has a size.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let hadSize = container.clientWidth > 0 && container.clientHeight > 0;
    const observer = new ResizeObserver(([entry]) => {
      const map = mapRef.current;
      if (!map) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      map.resize();
      if (!hadSize) {
        hadSize = true;
        frameIceland(map);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="road-map">
      <div className="road-modes" role="group" aria-label="道路地圖顯示模式">
        {ROAD_MODES.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            className={entry.mode === mode ? "active" : undefined}
            aria-pressed={entry.mode === mode}
            onClick={() => setMode(entry.mode)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="road-map-canvas" />
      {!ready && !failure && <p className="muted-line">正在載入道路地圖…</p>}
      {failure && (
        <p className="error">
          無法載入道路地圖：{failure}
        </p>
      )}

      <StationLabels map={map} ready={ready && roadLayerVisibility(mode).showStations} />

      <div className="road-legend">
        <strong>道路狀態</strong>
        <div className="road-legend-rows">
          {ROAD_LEGEND.map((entry) => (
            <span key={entry.label}>
              <i style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
        <div className="road-legend-rows">
          {(mode === "EVENTS" ? EVENT_LEGEND : STATION_LEGEND).map((entry) => (
            <span key={entry.label}>
              <i style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
          {mode === "EVENTS" && <MarkerSample />}
        </div>
        <span className="muted-line">
          {mode === "EVENTS"
            ? "點擊道路或事件標記可查看官方詳細內容。"
            : "放大地圖後可看到站名。點選站點可查看完整測量值。"}
        </span>
      </div>

      {selected && <RoadDetailDialog item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/**
 * The app's `MarkerLegendItem`: the actual roadworks marker bitmap at 24dp beside its label, so
 * the legend and the map can never show different artwork.
 */
function MarkerSample() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Painted straight onto the canvas: the same generator the map installs its icons from.
  useEffect(() => {
    const canvas = canvasRef.current;
    const image = drawMarker(MARKER_IDS.ROADWORKS, 2);
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
  }, []);

  return (
    <span>
      <canvas ref={canvasRef} style={{ width: 20, height: 20 }} aria-hidden="true" />
      道路事件
    </span>
  );
}

/**
 * The app's `station-labels` layer, drawn as DOM.
 *
 * MapLibre GL JS renders symbol text from a glyphs endpoint; the app ships its fonts inside the
 * APK and has no such dependency, and adding one here would mean fetching fonts from a third
 * party. So the labels are positioned by hand with the layer's own size, colour, halo, offset and
 * minzoom, which keeps what the reader sees the same.
 */
function StationLabels({ map, ready }: { map: MapLibreMap | null; ready: boolean }) {
  const [labels, setLabels] = useState<{ id: string; text: string; x: number; y: number }[]>([]);

  useEffect(() => {
    if (!map || !ready) return;
    const update = () => {
      if (map.getZoom() < STATION_LABEL.minZoom || !map.getLayer("station-markers")) {
        setLabels([]);
        return;
      }
      const seen = new Set<string>();
      const next: { id: string; text: string; x: number; y: number }[] = [];
      for (const feature of map.queryRenderedFeatures({ layers: ["station-markers"] })) {
        const text = feature.properties?.map_label;
        if (typeof text !== "string" || text === "" || seen.has(text)) continue;
        seen.add(text);
        const geometry = feature.geometry;
        if (geometry.type !== "Point") continue;
        const point = map.project(geometry.coordinates as [number, number]);
        next.push({ id: `${text}-${next.length}`, text, x: point.x, y: point.y });
      }
      setLabels(next);
    };
    update();
    map.on("move", update);
    map.on("moveend", update);
    return () => {
      map.off("move", update);
      map.off("moveend", update);
    };
  }, [map, ready]);

  return (
    <>
      {labels.map((label) => (
        <span
          key={label.id}
          className="road-station-label"
          style={{
            left: label.x + STATION_LABEL.offsetEm.x * STATION_LABEL.fontSize,
            top: label.y + STATION_LABEL.offsetEm.y * STATION_LABEL.fontSize,
            fontSize: STATION_LABEL.fontSize,
            color: STATION_LABEL.color,
            textShadow: `0 0 ${STATION_LABEL.haloWidth}px ${STATION_LABEL.haloColor}, 0 0 ${STATION_LABEL.haloWidth}px ${STATION_LABEL.haloColor}, 0 0 ${STATION_LABEL.haloWidth}px ${STATION_LABEL.haloColor}`,
          }}
        >
          {label.text}
        </span>
      ))}
    </>
  );
}

/**
 * RoadInfoScreen.kt `RoadDetailCard`, shown in the same modal the weather forecast uses.
 *
 * It was rendered inline under the legend, where a station's full set of measurements pushed the
 * whole Dashboard down and left the map scrolled off screen. The interaction is deliberately the
 * one `SiteForecastDialog` already established — backdrop click, Escape, focus on the close
 * control — because two different modal behaviours on one page is a worse answer than either.
 *
 * Opening and closing only sets React state; the map effect keys on `onSelect`, which is stable,
 * so nothing here rebuilds MapLibre, refetches the GeoJSON or moves the camera.
 */
function RoadDetailDialog({ item, onClose }: { item: RoadFeatureItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes it, and focus starts on the close control so the keyboard is not trapped.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="road-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="road-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={roadDisplayTitle(item)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="road-dialog-head">
          <div>
            <strong>{roadDisplayTitle(item)}</strong>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>
        <div className="road-dialog-body">
          <RoadDetailBody item={item} />
        </div>
      </div>
    </div>
  );
}

/** The detail fields themselves, unchanged from the inline card — only its shell became a dialog. */
function RoadDetailBody({ item }: { item: RoadFeatureItem }) {
  const isStation = item.type === "STATION";
  return (
    <>
      {isStation && item.updatedAt && <p className="road-detail-updated">此筆資料更新於 {item.updatedAt}</p>}

      <p className="road-detail-status" style={{ color: roadStatusColor(item.status) }}>
        {roadStatusLabel(item.status)}
      </p>

      {isStation ? (
        <>
          <StationDetails item={item} />
          <p className="muted-line">測站數值由官方量測，僅供參考。</p>
        </>
      ) : (
        <>
          <p className="road-detail-label">英文原文</p>
          <p>{item.titleEnglish || roadStatusEnglish(item.status)}</p>
          {item.descriptionEnglish && <p className="muted-line">{item.descriptionEnglish}</p>}
          {item.descriptionIcelandic && <p className="muted-line">{item.descriptionIcelandic}</p>}
        </>
      )}

      <p className="muted-line">{ROAD_ATTRIBUTION}</p>
    </>
  );
}

function StationDetails({ item }: { item: RoadFeatureItem }) {
  const wind = item.windSpeed
    ? [
        `${item.windSpeed} m/s`,
        item.windDirection ? `${item.windDirection}°` : "",
        item.windGust ? `陣風 ${item.windGust} m/s` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <div className="road-detail-values">
      {item.temperature && <span>氣溫: {item.temperature}°C</span>}
      {item.roadTemperature && <span>路面溫度: {item.roadTemperature}°C</span>}
      {wind && <span>風（來向）: {wind}</span>}
      {item.humidity && <span>濕度: {item.humidity}%</span>}
      <span>
        {item.trafficRecent || item.trafficToday
          ? `車流: 最近 ${item.trafficRecent || "—"} · 今日 ${item.trafficToday || "—"}`
          : "此站沒有車流計數器"}
      </span>
    </div>
  );
}
