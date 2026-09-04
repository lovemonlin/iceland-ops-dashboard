/**
 * Copies MapLibre's worker into `public/` so the static export can serve it.
 *
 * maplibre-gl 6 is ESM-only and spawns its worker from a URL it resolves at runtime. Under a
 * bundler that URL does not survive into the export, and the browser ends up requesting a path
 * that returns the site's HTML — the map then never finishes loading, with no CORS involved.
 * Serving the worker ourselves and pointing `setWorkerUrl` at it is MapLibre's supported answer.
 *
 * Copied at build time rather than committed, so the worker can never drift from the installed
 * version. The worker imports the shared chunk relative to itself, so both files move together.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "vendor", "maplibre");

mkdirSync(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(from, file), join(to, file));
}
console.log(`maplibre worker copied to ${to}`);
