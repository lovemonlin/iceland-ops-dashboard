"use client";

import { useCallback, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { StandaloneViewerShell, type StandaloneKind } from "@/components/StandaloneViewerShell";
import { WeatherMap } from "@/components/WeatherMap";
import { buildWeatherViewerSites } from "@/lib/viewerData";
import { parseCloudFrameQuery, parseRoadModeQuery, parseWeatherQuery } from "@/lib/standaloneQuery";
import { usePublishedSnapshot } from "@/lib/usePublishedSnapshot";
import type { CloudFrame } from "@/lib/cloudForecast";
import type { RoadBundle } from "@/lib/roadFastLane";
import { isNoaaKpForecastData, snapshotEntry, type DashboardSnapshot } from "@/snapshot/types";

const CloudForecastMap = dynamic(
  () => import("@/components/CloudForecastMap").then((module) => module.CloudForecastMap),
  { ssr: false, loading: () => <p className="muted-line">正在載入雲層預報…</p> },
);
const RoadMap = dynamic(() => import("@/components/RoadMap").then((module) => module.RoadMap), {
  ssr: false,
  loading: () => <p className="muted-line">正在載入道路地圖…</p>,
});

const subscribeLocation = () => () => {};
const browserSearch = () => window.location.search;
const serverSearch = () => null;

export function StandaloneViewer({
  kind,
  initialSnapshot,
}: {
  kind: StandaloneKind;
  initialSnapshot: DashboardSnapshot;
}) {
  const { snapshot, reloadError } = usePublishedSnapshot(initialSnapshot);
  const search = useSyncExternalStore(subscribeLocation, browserSearch, serverSearch);
  const query = search === null ? null : new URLSearchParams(search);
  const onRoadBundle = useCallback((_bundle: RoadBundle) => {}, []);

  const weatherSource = snapshotEntry(snapshot, "metno");
  const cloudSource = snapshotEntry(snapshot, "ecmwf");
  const roadSource = snapshotEntry(snapshot, "irca");
  const sites = buildWeatherViewerSites(weatherSource);
  const frames = Array.isArray(cloudSource?.data?.forecastFrames)
    ? cloudSource.data.forecastFrames as CloudFrame[]
    : [];
  const weatherView = query ? parseWeatherQuery(query, sites.map((site) => site.id)) : undefined;
  const kpForecast = snapshotEntry(snapshot, "noaaKpForecast");
  const kp = snapshotEntry(snapshot, "noaaKp");
  const source = kind === "weather" ? weatherSource : kind === "cloud" ? cloudSource : roadSource;

  return (
    <StandaloneViewerShell
      kind={kind}
      generatedAt={snapshot.generatedAt}
      source={source}
      reloadError={reloadError}
    >
      {!query ? (
        <p className="muted-line">正在開啟獨立檢視…</p>
      ) : kind === "weather" ? (
        sites.length ? <WeatherMap
          sites={sites}
          initialMode={weatherView?.mode}
          initialOffsetHours={weatherView?.hour}
          initialFocusedId={weatherView?.site}
          standalone
        /> : <p className="muted-line">目前沒有可顯示的天氣站點。</p>
      ) : kind === "cloud" ? (
        frames.length ? <CloudForecastMap
          frames={frames}
          runAt={typeof cloudSource?.data?.forecastRunAt === "string" ? cloudSource.data.forecastRunAt : undefined}
          generatedAt={typeof cloudSource?.data?.forecastGeneratedAt === "string" ? cloudSource.data.forecastGeneratedAt : undefined}
          sites={sites}
          kpForecastPoints={isNoaaKpForecastData(kpForecast?.data) ? kpForecast.data.points : undefined}
          currentKp={typeof kp?.data?.kp === "number" ? kp.data.kp : undefined}
          initialFrameIndex={parseCloudFrameQuery(query, frames.length)}
          standalone
        /> : <p className="muted-line">目前沒有可顯示的雲層預報影格。</p>
      ) : (
        <RoadMap onBundle={onRoadBundle} initialMode={parseRoadModeQuery(query)} standalone />
      )}
    </StandaloneViewerShell>
  );
}
