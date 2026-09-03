/**
 * Scheduled snapshot architecture.
 *
 * Production data is collected on a schedule, not when someone opens the page. The dashboard reads
 * the most recent snapshot, so it is always available and always cheap, and a failed collection
 * never blanks out the last good data.
 */

/** Bump when the snapshot shape changes in a way a reader must notice. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Written by `npm run snapshot`, served as a static file, read by the page on the server. */
export const SNAPSHOT_RELATIVE_PATH = "public/data/latest-health.json";
/** Path within the site. Combine with the deployment base path via `getSnapshotUrl()`. */
export const SNAPSHOT_PUBLIC_PATH = "/data/latest-health.json";

/** How often the scheduled collection is expected to run. */
export const SNAPSHOT_INTERVAL_MINUTES = 60;

/**
 * Past this age the *scheduler* is the problem, not any individual source, and the dashboard says
 * so at the top of the page. Deliberately more than one missed run so a single late job is quiet.
 */
export const SNAPSHOT_OVERDUE_MINUTES = 90;

/**
 * How often the browser re-reads the snapshot file. This is a static file read, not a production
 * request — it must never be confused with the hourly collection interval above.
 */
export const SNAPSHOT_RELOAD_MS = 5 * 60_000;
