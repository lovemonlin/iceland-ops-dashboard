"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { WEATHER_SITES } from "@/config/sources";
import {
  applyAuroraContourLayers,
  buildAuroraOvalStyle,
  buildContourBands,
  formatIcelandProbability,
  formatOvalTime,
  formatOvalTimes,
  OVAL_ATTRIBUTION,
  OVAL_CAMERA_BOUNDS,
  OVAL_CAMERA_FALLBACK,
  OVAL_LEGEND,
  OVAL_LOADING,
  OVAL_RESOLUTION_NOTE,
  OVAL_TITLE,
  ovalCameraPadding,
  ovalSiteFeatureCollection,
  SITE_TAP_TOLERANCE,
} from "@/lib/auroraOval";
import { decodeOvationGrid, icelandProbability, icelandGridPeak } from "@/lib/ovationGrid";
import { ovationState } from "@/lib/auroraData";
import { getPublicAssetPath } from "@/lib/publicPath";
import type { DashboardSnapshot } from "@/snapshot/types";

/**
 * The app's aurora position screen, inside the dashboard's aurora card.
 *
 * Everything it draws comes from the stored snapshot: the OVATION grid was collected by the
 * hourly run, and the contours are computed here from that grid. The browser never calls NOAA,
 * and moving or zooming the map issues no request at all.
 *
 * Nothing loads until this component mounts, which the card defers until the map mode is chosen
 * for the first time. After that it stays mounted and merely hidden, so switching back and forth
 * is instant and the world outline is fetched exactly once.
 */

/**
 * The markers use the current-hour `buildAuroraForecast48(..., 1)` colour and score, the same
 * assessment the 48-hour forecast already shows at offset zero.
 */

interface SiteSelection {
  id: string;
  name: string;
  nameZh: string;
  nameIs: string;
  lat: number;
  lon: number;
}

/** The app wraps its own fit in `runCatching` and drops to a fixed centre and zoom; so does this. */
function frameOval(map: MapLibreMap, width: number, height: number) {
  try {
    map.fitBounds(OVAL_CAMERA_BOUNDS, { padding: ovalCameraPadding(width, height), duration: 0 });
  } catch {
    map.jumpTo({ center: OVAL_CAMERA_FALLBACK.center, zoom: OVAL_CAMERA_FALLBACK.zoom });
  }
}

export function AuroraOvalMap({
  ovation,
  snapshot,
  now = new Date(snapshot.generatedAt),
  standalone = false,
}: {
  ovation: Record<string, unknown>;
  snapshot: DashboardSnapshot;
  now?: Date;
  standalone?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelected] = useState<SiteSelection | null>(null);
  const [region, setRegion] = useState("ALL");
  // The map is created asynchronously, so the contour layers cannot simply be added in an effect
  // that runs at mount -- there is no map yet. This is what tells them the style is up.
  const [ready, setReady] = useState(false);

  const grid = useMemo(() => decodeOvationGrid(ovation.grid), [ovation.grid]);
  const state = ovationState(snapshot.sources.ovation, now);
  // The contour walk is the expensive part, so it runs once per stored grid, not once per render.
  const bands = useMemo(() => (grid ? buildContourBands(grid) : []), [grid]);
  const probability = useMemo(() => icelandProbability(grid), [grid]);
  const peak = useMemo(() => icelandGridPeak(grid), [grid]);
  const sites = useMemo(() => ovalSiteFeatureCollection(snapshot, now), [snapshot, now]);
  const initialSites = useRef(sites);

  const frameIceland = () => mapRef.current?.fitBounds([[-25, 63], [-13, 67]], { padding: 32, duration: 0 });
  const selectSite = (id: string) => {
    const site = WEATHER_SITES.find((candidate) => candidate.id === id);
    if (!site) { setSelected(null); return; }
    setSelected(site);
    mapRef.current?.easeTo({ center: [site.lon, site.lat], zoom: 6, duration: 0 });
  };
  const selectRegion = (value: string) => {
    setRegion(value);
    if (value === "ALL") { frameIceland(); return; }
    const points = WEATHER_SITES.filter((site) => site.region === value);
    if (!points.length) return;
    mapRef.current?.fitBounds([
      [Math.min(...points.map((site) => site.lon)) - 0.5, Math.min(...points.map((site) => site.lat)) - 0.25],
      [Math.max(...points.map((site) => site.lon)) + 0.5, Math.max(...points.map((site) => site.lat)) + 0.25],
    ], { padding: 32, duration: 0 });
  };

  const observation = formatOvalTime(ovation.observationTime as string | undefined);
  const forecast = formatOvalTime(ovation.forecastTime as string | undefined);

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
        maplibre.setWorkerUrl(getPublicAssetPath("/vendor/maplibre/maplibre-gl-worker.mjs"));

        const style = buildAuroraOvalStyle(
          getPublicAssetPath("/data/world_land.geojson"),
          getPublicAssetPath("/data/iceland.geojson"),
          initialSites.current,
        );

        const created = new maplibre.Map({
          container,
          style: style as never,
          bounds: OVAL_CAMERA_BOUNDS,
          fitBoundsOptions: { padding: ovalCameraPadding(container.clientWidth, container.clientHeight) },
          attributionControl: false,
          // The app disables both (AuroraOvalScreen.kt:180-181).
          dragRotate: false,
          pitchWithRotate: false,
          touchZoomRotate: true,
        });
        mapRef.current = created;
        const map = created;

        map.on("error", (event) => {
          const message = (event as { error?: { message?: string } }).error?.message ?? "unknown map error";
          setFailure(message);
        });

        map.on("load", () => {
          if (disposed) return;
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            map.resize();
            if (standalone) map.fitBounds([[-25, 63], [-13, 67]], { padding: 32, duration: 0 });
            else frameOval(map, container.clientWidth, container.clientHeight);
          }
          setReady(true);
        });

        // A 7 px dot is hard to hit exactly, so the click is queried through a tolerance box
        // centred on it — MapScreen.kt's 24 dp, in CSS pixels.
        map.on("click", (event) => {
          if (!map.getLayer("site-circles")) return;
          const box: [[number, number], [number, number]] = [
            [event.point.x - SITE_TAP_TOLERANCE, event.point.y - SITE_TAP_TOLERANCE],
            [event.point.x + SITE_TAP_TOLERANCE, event.point.y + SITE_TAP_TOLERANCE],
          ];
          const hit: MapGeoJSONFeature | undefined = map.queryRenderedFeatures(box, { layers: ["site-circles"] })[0];
          const id = hit?.properties?.id as string | undefined;
          const site = WEATHER_SITES.find((candidate) => candidate.id === id);
          setSelected(
            site
              ? {
                  id: site.id,
                  name: site.name,
                  nameZh: site.nameZh,
                  nameIs: site.nameIs,
                  lat: site.lat,
                  lon: site.lon,
                }
              : event.lngLat.lat >= 63 && event.lngLat.lat <= 67 && event.lngLat.lng >= -25 && event.lngLat.lng <= -13
                ? { id: "point", name: "", nameZh: "地圖選取位置", nameIs: "", lat: event.lngLat.lat, lon: event.lngLat.lng }
                : null,
          );
        });
      } catch (error) {
        if (!disposed) setFailure(error instanceof Error ? error.message : "map failed to load");
      }
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [standalone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("sites") as { setData?: (data: unknown) => void } | undefined;
    source?.setData?.(sites);
  }, [sites, ready]);

  /**
   * The contour bands, inserted above the detailed Iceland fill so they sit under the markers,
   * exactly as `AuroraOvalScreen` anchors them.
   *
   * `fill-antialias` is off because a band is made of many separately clipped faces of one
   * colour; antialiasing each edge leaves hairline seams between them.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    applyAuroraContourLayers(map, bands);
  }, [bands, ready]);

  /**
   * A map built while its container is `display: none` measures zero, and fitting the northern
   * hemisphere into zero pixels lands the camera at maximum zoom over empty ocean. `resize` alone
   * keeps the centre and zoom, so the bounds are fitted again the first time it has a size.
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
        if (standalone) map.fitBounds([[-25, 63], [-13, 67]], { padding: 32, duration: 0 });
        else frameOval(map, width, height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [standalone]);

  return (
    <div className="aurora-oval">
      <div className="aurora-map-controls">
        <label>區域
          <select aria-label="極光地圖區域" value={region} onChange={(event) => selectRegion(event.target.value)}>
            <option value="ALL">冰島全境</option>
            {Array.from(new Set(WEATHER_SITES.map((site) => site.region))).map((value) => <option key={value} value={value}>{({ CAPITAL: "首都圈", SOUTH: "南部", EAST: "東部", NORTH: "北部", WEST: "西部", WESTFJORDS: "西峽灣", HIGHLANDS: "高地" } as Record<string, string>)[value] ?? value}</option>)}
          </select>
        </label>
        <label>查詢地點
          <select aria-label="極光機率查詢地點" value={selected?.id === "point" ? "" : selected?.id ?? ""} onChange={(event) => selectSite(event.target.value)}>
            <option value="">點選地圖或選擇地點</option>
            {WEATHER_SITES.map((site) => <option key={site.id} value={site.id}>{site.nameZh}（{site.name}）</option>)}
          </select>
        </label>
        <div className="aurora-map-buttons">
          <button type="button" aria-label="極光地圖放大" onClick={() => mapRef.current?.zoomIn({ duration: 0 })}>＋</button>
          <button type="button" aria-label="極光地圖縮小" onClick={() => mapRef.current?.zoomOut({ duration: 0 })}>−</button>
          <button type="button" onClick={() => { setRegion("ALL"); frameIceland(); }}>冰島全境</button>
          <button type="button" onClick={() => { const map = mapRef.current; if (map) frameOval(map, containerRef.current?.clientWidth ?? 900, containerRef.current?.clientHeight ?? 440); }}>北半球</button>
        </div>
      </div>
      <div className="aurora-oval-mapframe">
      {selected && (
        <div className="aurora-oval-site" role="status">
          <div><strong>{selected.nameZh}</strong><span>{selected.nameIs}</span></div>
          <p className="aurora-oval-note">
            OVATION 極光活動機率 {grid ? `${grid.probabilityAt(selected.lat, selected.lon)}%` : "—"}{state.current ? "" : "（歷史值）"}
            （{selected.lat.toFixed(3)}, {selected.lon.toFixed(3)}）
          </p>
          <p className="aurora-oval-note">最近原始格點：{Math.round(selected.lat)}°N、{Math.abs(Math.round(selected.lon))}°W；不做內插。</p>
          {selected.id !== "point" && <p className="aurora-oval-note">綜合可見度 {sites.features.find((site) => site.properties.id === selected.id)?.properties.score ?? "—"} 分（另計天氣與黑夜，與底色機率不同）</p>}
          <button type="button" onClick={() => setSelected(null)}>關閉</button>
        </div>
      )}
      <div className="aurora-oval-canvas" ref={containerRef} aria-label="NOAA OVATION 極光機率地圖" />
      </div>

      {failure && <p className="muted-line">地圖載入失敗：{failure}</p>}

      {/* AuroraOvalInfoCard, overlaid at the bottom of the map as the app overlays it. */}
      <div className="aurora-oval-card">
        <strong>{standalone ? "冰島 OVATION 模型機率" : OVAL_TITLE}</strong>
        <p className={state.current ? "ok" : "warn"}>{state.current ? "有效模型預報" : `歷史資料 · ${state.label}`}</p>
        {grid ? (
          <>
            <p className="aurora-oval-times">{formatOvalTimes(observation, forecast)}</p>
            <p className="aurora-oval-probability">
              {probability === undefined ? "—" : formatIcelandProbability(probability)}
              <span className="aurora-oval-note">（冰島中心最近格點 65°N、19°W{state.current ? "" : "；歷史值"}）</span>
            </p>
          </>
        ) : (
          <p className="aurora-oval-times">{OVAL_LOADING}</p>
        )}

        <div className="aurora-oval-legend">
          <div className="aurora-oval-legend-bar" aria-hidden="true" />
          <div className="aurora-oval-legend-items">
            {OVAL_LEGEND.map((entry) => (
              <span key={entry.color}>
                <i style={{ background: entry.color }} aria-hidden="true" />
                {entry.label}
              </span>
            ))}
          </div>
        </div>

        <p className="aurora-oval-note">{OVAL_RESOLUTION_NOTE}</p>
        <p className="aurora-oval-note">未著色：低於 1%。低機率不保證看不到；模型未計入雲量、日照與光害。</p>
        {peak !== undefined && <p className="aurora-oval-note">{peak < 1
          ? "本批冰島及近海包圍框未達 1% 著色門檻；忠實保留 NOAA 原始範圍。"
          : `本批冰島及近海包圍框最高 ${peak}%（63–67°N、25–13°W，非全島平均）。`}</p>}
        <p className="aurora-oval-note">底色色帶表示 OVATION 機率；圓點顏色沿用綜合可見度評分。</p>
        <p className="aurora-oval-note">{OVAL_ATTRIBUTION}</p>
      </div>

    </div>
  );
}
