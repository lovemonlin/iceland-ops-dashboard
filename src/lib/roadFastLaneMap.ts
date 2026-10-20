import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map, StyleSpecification } from "maplibre-gl";
import { buildRoadStyle } from "@/lib/roadMap";
import type { RoadBundle } from "@/lib/roadFastLane";

export const ROAD_BUNDLE_SOURCE = "road-bundle";

/** One worker update for all three datasets prevents cross-source mixed-version frames. */
export function buildLiveRoadStyle(outlineUrl: string): StyleSpecification {
  const style = buildRoadStyle(outlineUrl) as StyleSpecification;
  style.sources = {
    iceland: style.sources.iceland,
    [ROAD_BUNDLE_SOURCE]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  };
  for (const layer of style.layers) {
    if (!("source" in layer) || !["roads", "incidents", "stations"].includes(layer.source)) continue;
    const dataset = layer.source;
    layer.source = ROAD_BUNDLE_SOURCE;
    layer.filter = ["==", ["get", "__roadDataset"], dataset];
  }
  return style;
}

export async function applyRoadBundle(map: Pick<Map, "getSource">, bundle: RoadBundle) {
  const source = map.getSource(ROAD_BUNDLE_SOURCE) as GeoJSONSource | undefined;
  if (!source) throw new Error("Road source is not ready");
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: (["roads", "incidents", "stations"] as const).flatMap((dataset) =>
      bundle.data[dataset].features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, __roadDataset: dataset },
      })),
    ),
  };
  // MapLibre reports worker failures as events rather than rejected setData promises.
  let failure: unknown;
  const onError = (event: { error: unknown }) => { failure = event.error; };
  source.on("error", onError);
  try {
    await source.setData(data);
    if (failure) throw failure;
  } finally {
    source.off("error", onError);
  }
}
