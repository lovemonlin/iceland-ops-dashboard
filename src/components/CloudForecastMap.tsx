"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SiteForecastDialog, type ForecastSite } from "@/components/SiteForecastDialog";
import {
  buildCloudForecastStyle,
  CLOUD_ATTRIBUTION,
  CLOUD_FORECAST_MAX_HOURS,
  CLOUD_FORECAST_NOTE,
  CLOUD_FORECAST_NOW,
  CLOUD_FORECAST_TITLE,
  CLOUD_FRAME_AVAILABLE,
  CLOUD_FRAME_UNAVAILABLE,
  CLOUD_GENERATED_PENDING,
  CLOUD_IMAGE_COORDINATES,
  CLOUD_LEGEND,
  cloudForecastMarkersAt,
  formatForecastOffset,
  formatForecastTime,
  formatGeneratedAt,
  formatIcelandDateTime,
  formatRunAt,
  formatValidAt,
  frameAt,
  siteFeatureCollection,
  type CloudFrame,
} from "@/lib/cloudForecast";
import { getPublicAssetPath } from "@/lib/publicPath";
import { effectiveObstruction, forecastBaseTime, hourAt, type WeatherHour } from "@/lib/weatherMap";

/**
 * The app's forecast-mode map, inside the dashboard's cloud-forecast card.
 *
 * The publisher keeps 17 frames out to +48 h; the app shows the first 24 h and so does this.
 * Nothing is fetched until the disclosure is open, and then only the frame being displayed —
 * moving the slider swaps that one image rather than rebuilding the map.
 */

const ICELAND_CENTER: [number, number] = [-18.7, 64.96];

export interface CloudForecastSite extends ForecastSite {
  lat: number;
  lon: number;
  region: string;
  hours?: WeatherHour[];
}

export function CloudForecastMap({
  frames,
  runAt,
  generatedAt,
  sites,
}: {
  frames: CloudFrame[];
  runAt?: string;
  generatedAt?: string;
  sites: CloudForecastSite[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [offsetHours, setOffsetHours] = useState(0);
  const [detailSiteId, setDetailSiteId] = useState<string | null>(null);

  /**
   * Zero is the first hour the stored weather describes, the same base the weather timeline
   * uses — a snapshot may be an hour old, and "now" would then run off the end of the series.
   */
  // The viewer is only rendered when there is at least one frame, so the fallback is the run's
  // own first valid time rather than the reader's clock -- which would also not be pure here.
  const baseTime = useMemo(
    () => forecastBaseTime(sites) ?? new Date(frames[0]?.validAt ?? 0),
    [sites, frames],
  );
  const selectedTime = useMemo(
    () => new Date(baseTime.getTime() + offsetHours * 3_600_000),
    [baseTime, offsetHours],
  );

  const frame = useMemo(() => frameAt(frames, selectedTime), [frames, selectedTime]);
  const markers = useMemo(
    // `forecasts[site.id]?.at(time)?.effectiveObstruction` — an hour the site does not have
    // stays undefined rather than being read as clear sky.
    () => cloudForecastMarkersAt(sites, selectedTime, (hour) => (hour ? effectiveObstruction(hour) : undefined), hourAt),
    [sites, selectedTime],
  );

  const detailSite = sites.find((site) => site.id === detailSiteId);

  const openSite = useCallback((id: string) => setDetailSiteId(id), []);

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

        const created = new maplibre.Map({
          container,
          style: buildCloudForecastStyle(
            getPublicAssetPath("/data/iceland.geojson"),
            frame?.imageUrl,
            markers,
          ) as never,
          center: ICELAND_CENTER,
          zoom: 4.6,
          attributionControl: false,
          // The app disables both.
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
          if (container.clientWidth > 0 && container.clientHeight > 0) map.resize();
          setReady(true);
        });

        map.on("click", (event) => {
          if (!map.getLayer("site-circles")) return;
          const box: [[number, number], [number, number]] = [
            [event.point.x - 24, event.point.y - 24],
            [event.point.x + 24, event.point.y + 24],
          ];
          const hit: MapGeoJSONFeature | undefined = map.queryRenderedFeatures(box, { layers: ["site-circles"] })[0];
          const id = hit?.properties?.id as string | undefined;
          if (id) openSite(id);
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
    // Built once. The frame and the markers below are updated in place rather than by rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Moving the slider swaps the image and recolours the dots.
   *
   * The app rebuilds its whole style for this because that is cheap on its side; doing the same
   * here would re-download the Iceland outline and drop the reader's pan and zoom on every step.
   * Updating the two sources gives the same picture without that.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const source = map.getSource("ecmwf-cloud-forecast") as
      | { updateImage?: (options: { url: string; coordinates: [number, number][] }) => void }
      | undefined;
    if (frame && source?.updateImage) {
      source.updateImage({ url: frame.imageUrl, coordinates: CLOUD_IMAGE_COORDINATES });
    }
  }, [frame, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("sites") as { setData?: (data: unknown) => void } | undefined;
    source?.setData?.(siteFeatureCollection(markers));
  }, [markers, ready]);

  /**
   * A map built while its container is `display: none` measures zero. Resizing when it first has
   * a size is enough here — the camera is a fixed centre and zoom, not a fitted bounds, so there
   * is nothing to re-fit.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const map = mapRef.current;
      if (!map) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      map.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const generated = formatIcelandDateTime(generatedAt);
  const run = formatIcelandDateTime(runAt) ?? "—";
  const valid = formatIcelandDateTime(frame?.validAt) ?? "—";

  return (
    <div className="cloud-forecast">
      <div className="cloud-forecast-canvas" ref={containerRef} />
      {failure && <p className="muted-line">地圖載入失敗：{failure}</p>}

      <div className="cloud-forecast-panel">
        <strong>{CLOUD_FORECAST_TITLE}</strong>

        <p className="cloud-forecast-offset">
          {offsetHours === 0
            ? CLOUD_FORECAST_NOW
            : formatForecastOffset(formatForecastTime(selectedTime.toISOString()), offsetHours)}
        </p>

        <input
          type="range"
          min={0}
          max={CLOUD_FORECAST_MAX_HOURS}
          step={1}
          value={offsetHours}
          onChange={(event) => setOffsetHours(Number(event.target.value))}
          aria-label="雲層預報時間"
        />

        {/*
          The app prints a forecast Kp here. It reads `kpForecast.kpAt(time, kpNow.estimatedKp)`,
          a NOAA 3-day Kp *forecast* series; this dashboard's Kp monitor collects only the current
          planetary index, so there is nothing to put on that line and inventing one would be
          worse than leaving it out. It is stated rather than silently dropped.
        */}
        <p className="cloud-forecast-missing">
          Kp 預報：本 Dashboard 只收集目前 Kp，未收集 NOAA 三日 Kp 預報序列，因此不顯示。
        </p>

        <div className="cloud-forecast-timing">
          <span className="cloud-forecast-generated">
            {generated ? formatGeneratedAt(generated) : CLOUD_GENERATED_PENDING}
          </span>
          <span>{formatRunAt(run)}</span>
          <span>{formatValidAt(valid)}</span>
        </div>

        <div className="cloud-forecast-legend">
          {CLOUD_LEGEND.map((entry) => (
            <span key={entry.color}>
              <i style={{ background: entry.color }} aria-hidden="true" />
              {entry.label}
            </span>
          ))}
        </div>

        <p className="muted-line">{frame ? CLOUD_FRAME_AVAILABLE : CLOUD_FRAME_UNAVAILABLE}</p>
        <p className="muted-line">{CLOUD_FORECAST_NOTE}</p>
        <p className="muted-line">{CLOUD_ATTRIBUTION} · 海岸線：Natural Earth</p>
      </div>

      {detailSite && (
        <SiteForecastDialog site={detailSite} from={selectedTime} onClose={() => setDetailSiteId(null)} />
      )}
    </div>
  );
}
