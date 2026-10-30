import assert from "node:assert/strict";
import test from "node:test";
import { sampleProbability, probabilityColor, mercatorY, mercatorLatitude, drawAuroraRaster } from "../src/lib/auroraRaster";
import { decodeOvationGrid, encodeOvationGrid } from "../src/lib/ovationGrid";
import coast from "../src/lib/icelandCoastRing.json";

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
});

test("land texture uses the existing coast as destination-in mask; full oval has no land clipping", () => {
  const original = globalThis.document;
  const paths: number[][] = [];
  const ctx = {
    globalCompositeOperation: "source-over", createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, beginPath() {}, closePath() {}, fill() {},
    moveTo: (x: number, y: number) => paths.push([x, y]), lineTo: (x: number, y: number) => paths.push([x, y]),
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } as unknown as Document;
  try {
    const grid = decodeOvationGrid(encodeOvationGrid([[341, 65, 11]]))!;
    const land = drawAuroraRaster(grid, true);
    assert.equal(ctx.globalCompositeOperation, "destination-in");
    assert.equal(paths.length, coast.length);
    assert.deepEqual(land.coordinates, [[-25, 67], [-13, 67], [-13, 63], [-25, 63]]);
    ctx.globalCompositeOperation = "source-over";
    paths.length = 0;
    const oval = drawAuroraRaster(grid, false);
    assert.equal(paths.length, 0);
    assert.deepEqual(oval.coordinates, [[-180, 85], [180, 85], [180, 45], [-180, 45]]);
  } finally { globalThis.document = original; }
});
