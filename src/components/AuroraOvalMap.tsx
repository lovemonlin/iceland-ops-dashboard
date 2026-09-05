"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { WEATHER_SITES } from "@/config/sources";
import {
  AURORA_LAYER_ANCHOR,
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
  SITE_TAP_TOLERANCE,
} from "@/lib/auroraOval";
import { decodeOvationGrid, icelandProbability } from "@/lib/ovationGrid";
import { getPublicAssetPath } from "@/lib/publicPath";

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
 * The app colours each site by `AuroraVisibility.assess`, which needs solar elevation, moon
 * interference, geomagnetic latitude advantage, the site's light-pollution class and a Kp
 * *forecast* series. The dashboard collects none of those, so a colour here would be invented.
 * `MapViewModel.neutralMarkers()` is the app's own answer to exactly that situation, and this is
 * its colour. The markers stay in place and stay clickable.
 */
const NEUTRAL_MARKER_COLOR = "#64748B";

interface SiteSelection {
  id: string;
  name: string;
  nameZh: string;
  nameIs: string;
  lat: number;
  lon: number;
}

function siteFeatureCollection() {
  return {
    type: "FeatureCollection" as const,
    features: WEATHER_SITES.map((site) => ({
      type: "Feature" as const,
      properties: {
        id: site.id,
        name: site.name,
        nameZh: site.nameZh,
        nameIs: site.nameIs,
        color: NEUTRAL_MARKER_COLOR,
        score: 0,
      },
      geometry: { type: "Point" as const, coordinates: [site.lon, site.lat] },
    })),
  };
}

/** The app wraps its own fit in `runCatching` and drops to a fixed centre and zoom; so does this. */
function frameOval(map: MapLibreMap, width: number, height: number) {
  try {
    map.fitBounds(OVAL_CAMERA_BOUNDS, { padding: ovalCameraPadding(width, height), duration: 0 });
  } catch {
    map.jumpTo({ center: OVAL_CAMERA_FALLBACK.center, zoom: OVAL_CAMERA_FALLBACK.zoom });
  }
}

export function AuroraOvalMap({ ovation }: { ovation: Record<string, unknown> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelected] = useState<SiteSelection | null>(null);
  // The map is created asynchronously, so the contour layers cannot simply be added in an effect
  // that runs at mount -- there is no map yet. This is what tells them the style is up.
  const [ready, setReady] = useState(false);

  const grid = useMemo(() => decodeOvationGrid(ovation.grid), [ovation.grid]);
  // The contour walk is the expensive part, so it runs once per stored grid, not once per render.
  const bands = useMemo(() => (grid ? buildContourBands(grid) : []), [grid]);
  const probability = useMemo(() => icelandProbability(grid), [grid]);

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
          siteFeatureCollection(),
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
            frameOval(map, container.clientWidth, container.clientHeight);
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
  }, []);

  /**
   * The contour bands, inserted above the detailed Iceland fill so they sit under the markers,
   * exactly as `AuroraOvalScreen` anchors them.
   *
   * `fill-antialias` is off because a band is made of many separately clipped faces of one
   * colour; antialiasing each edge leaves hairline seams between them.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || bands.length === 0) return;

    const apply = () => {
      let anchor = AURORA_LAYER_ANCHOR;
      for (const band of bands) {
        const sourceId = `aurora-${band.id}-source`;
        const layerId = `aurora-${band.id}-layer`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        map.addSource(sourceId, { type: "geojson", data: band.geoJson as never });
        map.addLayer(
          {
            id: layerId,
            type: "fill",
            source: sourceId,
            paint: { "fill-color": band.color, "fill-opacity": band.opacity, "fill-antialias": false },
          },
          map.getLayer(anchor) ? anchor : undefined,
        );
        anchor = layerId;
      }
      // Drawn last so a site is never buried under a band.
      if (map.getLayer("site-circles")) map.moveLayer("site-circles");
    };

    apply();
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
        frameOval(map, width, height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="aurora-oval">
      <div className="aurora-oval-canvas" ref={containerRef} />

      {failure && <p className="muted-line">地圖載入失敗：{failure}</p>}

      {/* AuroraOvalInfoCard, overlaid at the bottom of the map as the app overlays it. */}
      <div className="aurora-oval-card">
        <strong>{OVAL_TITLE}</strong>
        {grid ? (
          <>
            <p className="aurora-oval-times">{formatOvalTimes(observation, forecast)}</p>
            <p className="aurora-oval-probability">{formatIcelandProbability(probability ?? 0)}</p>
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
        <p className="aurora-oval-note">{OVAL_ATTRIBUTION}</p>
      </div>

      {selected && (
        <div className="aurora-oval-site" role="status">
          <div>
            <strong>{selected.nameZh}</strong>
            <span>{selected.nameIs}</span>
          </div>
          <p className="aurora-oval-note">
            OVATION 模型機率 {grid ? grid.probabilityAt(selected.lat, selected.lon) : 0}%
            （{selected.lat.toFixed(3)}, {selected.lon.toFixed(3)}）
          </p>
          {/* Stated rather than filled in with a number this dashboard cannot compute. */}
          <p className="aurora-oval-note">
            App 的綜合可見度評分需要日照高度、月光干擾、地磁緯度與光害分級，這份 Dashboard 尚未收集，因此不顯示分數。
          </p>
          <button type="button" onClick={() => setSelected(null)}>
            關閉
          </button>
        </div>
      )}
    </div>
  );
}
