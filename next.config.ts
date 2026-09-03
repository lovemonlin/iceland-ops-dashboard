import type { NextConfig } from "next";

/**
 * The dashboard is a pure static site: it reads a snapshot file and never collects data itself,
 * so there is nothing left for a server to do. It is exported to `out/` and served by GitHub Pages.
 *
 * GitHub Pages project sites live under `/<repository>/`, so the build sets
 * `NEXT_PUBLIC_BASE_PATH=/iceland-ops-dashboard`. Locally the variable is unset and everything is
 * served from `/`, so `npm run dev` keeps working unchanged.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  // `basePath` prefixes both the routes and the `_next` assets; nothing may hardcode a host or path.
  ...(basePath ? { basePath } : {}),
  // Directory-style URLs so a static host can serve every route without rewrite rules.
  trailingSlash: true,
};

export default nextConfig;
