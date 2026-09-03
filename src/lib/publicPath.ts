import { SNAPSHOT_PUBLIC_PATH } from "@/config/snapshot";

/**
 * Where the site is mounted.
 *
 * Empty during local development (`http://localhost:3000/`) and `/iceland-ops-dashboard` on GitHub
 * Pages, which serves project sites from a subdirectory. Next.js inlines this at build time.
 *
 * Read through the helpers below rather than inline anywhere else: a base path scattered across
 * components is exactly how a deployment ends up requesting `/data/...` and getting a 404.
 */
export function basePath() {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

/** Turns a path rooted at the site into one that works under the deployment's base path. */
export function getPublicAssetPath(path: string) {
  return `${basePath()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * URL of the snapshot the dashboard reads.
 *
 * `cacheBust` appends a timestamp so a manual or scheduled reload always sees the newest file even
 * when the browser or GitHub Pages has cached the previous one. It is applied *only* here — the
 * rest of the site is ordinary cacheable static content.
 */
export function getSnapshotUrl(options: { cacheBust?: boolean } = {}) {
  const url = getPublicAssetPath(SNAPSHOT_PUBLIC_PATH);
  return options.cacheBust ? `${url}?t=${Date.now()}` : url;
}
