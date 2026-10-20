import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { FeatureCollection } from "geojson";
import type { Map } from "maplibre-gl";
import type { RoadBundle } from "../src/lib/roadFastLane";
import { applyRoadBundle, buildLiveRoadStyle, ROAD_BUNDLE_SOURCE } from "../src/lib/roadFastLaneMap";

const data = (id: string): FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { id }, geometry: { type: "Point", coordinates: [-19, 65] } }],
});
const bundle = {
  version: "2026-10-20T04:50:46.970695Z",
  data: { roads: data("road"), incidents: data("incident"), stations: data("station") },
} as RoadBundle;

test("live style starts empty and routes every road layer through one atomic source", () => {
  const style = buildLiveRoadStyle("/outline.geojson");
  assert.deepEqual(Object.keys(style.sources), ["iceland", ROAD_BUNDLE_SOURCE]);
  assert.deepEqual(style.sources[ROAD_BUNDLE_SOURCE], {
    type: "geojson", data: { type: "FeatureCollection", features: [] },
  });
  const expected = { "road-casing": "roads", "road-lines": "roads", "incident-markers": "incidents", "station-markers": "stations" };
  for (const [id, dataset] of Object.entries(expected)) {
    const layer = style.layers.find((entry) => entry.id === id)!;
    assert.equal("source" in layer && layer.source, ROAD_BUNDLE_SOURCE);
    assert.deepEqual("filter" in layer && layer.filter, ["==", ["get", "__roadDataset"], dataset]);
  }
});

test("one setData atomically replaces all datasets without rebuilding or changing interaction", async () => {
  const calls: FeatureCollection[] = [];
  const map = {
    getSource(id: string) {
      assert.equal(id, ROAD_BUNDLE_SOURCE);
      return Object.assign(new EventEmitter(), { async setData(value: FeatureCollection) { calls.push(value); } });
    },
    remove() { assert.fail("map must survive"); },
    setStyle() { assert.fail("style must survive"); },
    jumpTo() { assert.fail("camera must survive"); },
    setPaintProperty() { assert.fail("mode must survive"); },
  } as unknown as Map;
  await applyRoadBundle(map, bundle);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].features.map((feature) => feature.properties?.__roadDataset), ["roads", "incidents", "stations"]);
  assert.equal(calls[0].features.length, 3);
  assert.equal(bundle.data.roads.features[0].properties?.__roadDataset, undefined, "input is never mutated");
});

test("bundle adoption waits for the MapLibre worker, including errors", async () => {
  let resolve!: () => void;
  let adopted = false;
  const map = { getSource: () => Object.assign(new EventEmitter(), { setData: () => new Promise<void>((done) => { resolve = done; }) }) } as unknown as Map;
  const pending = applyRoadBundle(map, bundle).then(() => { adopted = true; });
  await Promise.resolve();
  assert.equal(adopted, false);
  resolve();
  await pending;
  assert.equal(adopted, true);
  await assert.rejects(applyRoadBundle({ getSource: () => undefined } as unknown as Map, bundle));
});

test("MapLibre error events reject adoption even when setData resolves", async () => {
  const source = Object.assign(new EventEmitter(), {
    async setData() { source.emit("error", { error: new Error("worker failed") }); },
  });
  await assert.rejects(applyRoadBundle({ getSource: () => source } as unknown as Map, bundle), /worker failed/);
  assert.equal(source.listenerCount("error"), 0);
});

test("live timestamps and counts are separate from the untouched hourly health entry", () => {
  const sections = readFileSync("src/components/SourceSections.tsx", "utf8");
  const road = sections.split("export function RoadsSection")[1].split("export function AuroraSection")[0];
  assert.match(road, /const \[liveRoad, setLiveRoad\] = useState<RoadBundle>/);
  for (const field of ["roadDataAt", "incidentDataAt", "measurementDataAt"]) {
    assert.ok(road.includes(`liveRoad.manifest.${field}?.toISOString()`));
  }
  assert.match(road, /value=\{liveRoad\?\.version/);
  assert.match(road, /entry=\{irca\}/);
  assert.match(road, /const healthy = irca\.status === "ok" \|\| irca\.status === "info"/);
  assert.doesNotMatch(road, /irca\.[a-zA-Z]+\s*=(?!=)|status=\{|\.status\s*=\s*"ok"/);
  const component = readFileSync("src/components/RoadMap.tsx", "utf8");
  assert.equal(component.match(/new maplibre\.Map\(/g)?.length, 1);
  assert.match(component, /await applyRoadBundle\(map, bundle\);[\s\S]*onBundle\(bundle\)/);
  assert.match(component, /\[map, ready, onBundle\]/);
  assert.match(component, /stop\(\)/);
});
