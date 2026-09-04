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
  readFeature,
  ROAD_ATTRIBUTION,
  ROAD_LEGEND,
  ROAD_QUERY_ORDER,
  ROAD_TAP_TOLERANCE,
  roadDisplayTitle,
  roadStatusColor,
  roadStatusEnglish,
  roadStatusLabel,
  STATION_LABEL,
  STATION_LEGEND,
  type RoadFeatureItem,
} from "@/lib/roadMap";

/**
 * The app's road map, on MapLibre GL JS.
 *
 * Nothing is initialised until the disclosure is opened: the library, the style and the three
 * production GeoJSON files are all loaded on first expand and then kept, so toggling does not
 * re-download them. The dashboard's own hourly snapshot is unaffected either way.
 */
export function RoadMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Also held in state: the labels overlay renders from it, and a ref must not be read during render.
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [selected, setSelected] = useState<RoadFeatureItem | null>(null);
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
          // The app fits the same corners with this padding; the bottom is generous because the
          // detail card sits over the map there.
          fitBoundsOptions: { padding: { top: 60, bottom: 120, left: 34, right: 34 } },
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
          setReady(true);
        });

        map.on("click", (event) => {
          const box: [[number, number], [number, number]] = [
            [event.point.x - ROAD_TAP_TOLERANCE, event.point.y - ROAD_TAP_TOLERANCE],
            [event.point.x + ROAD_TAP_TOLERANCE, event.point.y + ROAD_TAP_TOLERANCE],
          ];
          // Queried in the app's order, so a marker always wins over the road underneath it.
          for (const layer of ROAD_QUERY_ORDER) {
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

  // A map created while its container was display:none measures zero. Resizing once the element is
  // actually laid out is what stops it rendering as a blank or offset canvas.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="road-map">
      <div ref={containerRef} className="road-map-canvas" />
      {!ready && !failure && <p className="muted-line">正在載入道路地圖…</p>}
      {failure && (
        <p className="error">
          無法載入道路地圖：{failure}
        </p>
      )}

      <StationLabels map={map} ready={ready} />

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
          {STATION_LEGEND.map((entry) => (
            <span key={entry.label}>
              <i style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
        <span className="muted-line">點擊道路、事件標記或測站可查看官方詳細內容。</span>
      </div>

      {selected && <RoadDetailCard item={selected} onClose={() => setSelected(null)} />}
    </div>
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

/** RoadInfoScreen.kt `RoadDetailCard`. */
function RoadDetailCard({ item, onClose }: { item: RoadFeatureItem; onClose: () => void }) {
  const isStation = item.type === "STATION";
  return (
    <div className="road-detail">
      <div className="road-detail-head">
        <strong>{roadDisplayTitle(item)}</strong>
        <button type="button" onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>

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
    </div>
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
