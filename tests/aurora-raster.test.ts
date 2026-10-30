import assert from "node:assert/strict";
import test from "node:test";
import { sampleProbability, probabilityColor, probabilityCssColor, HEAT_LEGEND_GRADIENT, HEAT_STOPS, mercatorY, mercatorLatitude, drawAuroraRaster, applyAuroraRaster } from "../src/lib/auroraRaster";
import { decodeOvationGrid, encodeOvationGrid } from "../src/lib/ovationGrid";
import coast from "../src/lib/icelandCoastRing.json";
import { readFileSync } from "node:fs";

test("display interpolation remains between original neighbours and does not alter raw queries", () => {
  const grid = decodeOvationGrid(encodeOvationGrid([[338, 64, 0], [339, 64, 20], [338, 65, 40], [339, 65, 60]]))!;
  assert.equal(sampleProbability(grid, 64.5, -21.5), 30);
  assert.equal(grid.probabilityAt(64, -22), 0);
  assert.equal(sampleProbability(grid, 64, 338), sampleProbability(grid, 64, -22));
  assert.equal(sampleProbability(grid, 63, -23), 0);
  for (const lat of [45, 63, 65, 85]) assert.ok(Math.abs(mercatorLatitude(mercatorY(lat)) - lat) < 1e-10);
});

test("colour and opacity vary continuously across the former 10/30/50 percent hard bands", () => {
  assert.equal(probabilityColor(0)[3], 0);
  for (const threshold of [10, 30, 50]) {
    const before = probabilityColor(threshold - 0.01), after = probabilityColor(threshold + 0.01);
    assert.ok(before.every((channel, i) => Math.abs(channel - after[i]) <= 1));
  }
  assert.ok(probabilityColor(100)[3] < 255);
  assert.equal(probabilityColor(0.99)[3], 0, "no activity is painted below the existing threshold");
  const alphas = [1, 4, 8, 11, 30, 100].map((p) => probabilityColor(p)[3]);
  assert.ok(alphas[0] >= 90 && alphas.at(-1)! < 200, "low activity is legible and all activity stays translucent");
  assert.deepEqual(alphas, [...alphas].sort((a, b) => a - b));
  for (const [p] of HEAT_STOPS) assert.ok(HEAT_LEGEND_GRADIENT.includes(`${probabilityCssColor(p)} ${p}%`));
});

test("land texture uses the existing coast as destination-in mask; full oval has no land clipping", () => {
  const original = globalThis.document;
  const paths: number[][] = [];
  let image: { data: Uint8ClampedArray } | undefined;
  const ctx = {
    globalCompositeOperation: "source-over", createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (value: { data: Uint8ClampedArray }) => { image = value; }, beginPath() {}, closePath() {}, fill() {},
    moveTo: (x: number, y: number) => paths.push([x, y]), lineTo: (x: number, y: number) => paths.push([x, y]),
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } as unknown as Document;
  try {
    const grid = decodeOvationGrid(encodeOvationGrid([[341, 65, 11], [340, 67, 8]]))!;
    const land = drawAuroraRaster(grid, true);
    assert.equal(ctx.globalCompositeOperation, "destination-in");
    assert.equal(paths.length, coast.length);
    assert.deepEqual(land.coordinates, [[-25, 67], [-13, 67], [-13, 63], [-25, 63]]);
    ctx.globalCompositeOperation = "source-over";
    paths.length = 0;
    const oval = drawAuroraRaster(grid, false);
    assert.equal(paths.length, 0);
    assert.deepEqual(oval.coordinates, [[-180, 85], [180, 85], [180, 45], [-180, 45]]);
    const x = Math.floor((-20 + 180) / 360 * oval.canvas.width);
    const y = Math.floor((mercatorY(67) - mercatorY(85)) / (mercatorY(45) - mercatorY(85)) * oval.canvas.height);
    assert.ok(image!.data[(y * oval.canvas.width + x) * 4 + 3] > 0, "8% activity at sea north of Iceland remains visible");
    const sourceCalls: unknown[] = [], layerCalls: unknown[] = [];
    const map = { getLayer: () => false, getSource: () => false,
      addSource: (...args: unknown[]) => sourceCalls.push(args), addLayer: (...args: unknown[]) => layerCalls.push(args) };
    applyAuroraRaster(map as never, grid, false);
    assert.equal((sourceCalls[0] as [string, { type: string }])[1].type, "canvas");
    assert.equal((layerCalls[0] as unknown[])[1], "iceland-coastline-detail", "raster stays below coast and markers, above opaque land");
  } finally { globalThis.document = original; }
});

test("default mode includes the sea and the local snapshot contains real low activity", () => {
  const component = readFileSync("src/components/AuroraOvalMap.tsx", "utf8");
  assert.match(component, /\[landOnly, setLandOnly\] = useState\(false\)/);
  assert.match(component, /background: HEAT_LEGEND_GRADIENT/);
  assert.match(component, /background: probabilityCssColor\(probability\)/);
  const snapshot = JSON.parse(readFileSync("public/data/latest-health.json", "utf8"));
  const grid = decodeOvationGrid(snapshot.sources.ovation.data.grid)!;
  const before = [...grid.payload.values];
  for (let lat = 63; lat <= 67; lat++) for (let lon = -25; lon <= -13; lon++) {
    const p = sampleProbability(grid, lat, lon);
    assert.equal(p, grid.probabilityAt(lat, lon));
    if (p >= 1) assert.ok(probabilityColor(p)[3] > 0);
  }
  assert.deepEqual(grid.payload.values, before, "visual transfer never changes stored probabilities");
});
