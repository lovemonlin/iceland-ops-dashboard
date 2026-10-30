import type { Map as MapLibreMap } from "maplibre-gl";
import type { OvationGrid } from "@/lib/ovationGrid";
import coast from "@/lib/icelandCoastRing.json";

export const HEAT_STOPS = [[0, 61, 91, 120], [10, 74, 222, 128], [30, 251, 146, 60], [50, 248, 113, 113], [100, 248, 113, 113]];
export const mercatorY = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
export const mercatorLatitude = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

/** Display-only interpolation; point queries continue to use the original nearest grid cell. */
export function sampleProbability(grid: OvationGrid, latitude: number, longitude: number) {
  const south = Math.floor(latitude), west = Math.floor(longitude);
  const x = longitude - west, y = latitude - south;
  const a = grid.probabilityAt(south, west) * (1 - x) + grid.probabilityAt(south, west + 1) * x;
  const b = grid.probabilityAt(south + 1, west) * (1 - x) + grid.probabilityAt(south + 1, west + 1) * x;
  return a * (1 - y) + b * y;
}

export function probabilityColor(probability: number): number[] {
  const index = HEAT_STOPS.findIndex((stop) => stop[0] >= probability);
  const high = HEAT_STOPS[Math.max(1, index)], low = HEAT_STOPS[Math.max(1, index) - 1];
  const fraction = Math.max(0, Math.min(1, (probability - low[0]) / (high[0] - low[0])));
  return [...low.slice(1).map((channel, i) => Math.round(channel + (high[i + 1] - channel) * fraction)),
    probability < 1 ? 0 : Math.round(150 * Math.sqrt(probability / 100))];
}

/** Canvas pixels are uniformly spaced in Mercator, matching MapLibre's raster texture mapping. */
export function drawAuroraRaster(grid: OvationGrid, landOnly: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = landOnly ? 1024 : 1440;
  canvas.height = landOnly ? 768 : 512;
  const [west, south, east, north] = landOnly ? [-25, 63, -13, 67] : [-180, 45, 180, 85];
  const top = mercatorY(north), bottom = mercatorY(south);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立極光機率圖層");
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const latitude = mercatorLatitude(top + (bottom - top) * (y + 0.5) / canvas.height);
    for (let x = 0; x < canvas.width; x++) {
      const longitude = west + (east - west) * (x + 0.5) / canvas.width;
      pixels.data.set(probabilityColor(sampleProbability(grid, latitude, longitude)), (y * canvas.width + x) * 4);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  if (landOnly) {
    // Reuse the existing Iceland coast, with no blur or dilation across the sea boundary.
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    coast.forEach(([lon, lat], i) => {
      const x = (lon - west) / (east - west) * canvas.width;
      const y = (mercatorY(lat) - top) / (bottom - top) * canvas.height;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  return { canvas, coordinates: [[west, north], [east, north], [east, south], [west, south]] as [[number, number], [number, number], [number, number], [number, number]] };
}

export function applyAuroraRaster(map: MapLibreMap, grid: OvationGrid | undefined, landOnly: boolean) {
  if (map.getLayer("aurora-probability")) map.removeLayer("aurora-probability");
  if (map.getSource("aurora-probability")) map.removeSource("aurora-probability");
  if (!grid) return;
  map.addSource("aurora-probability", { type: "canvas", ...drawAuroraRaster(grid, landOnly), animate: false });
  map.addLayer({ id: "aurora-probability", type: "raster", source: "aurora-probability",
    paint: { "raster-resampling": "linear", "raster-fade-duration": 0 } }, "iceland-coastline-detail");
}
