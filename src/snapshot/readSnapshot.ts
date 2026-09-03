import { readFile } from "node:fs/promises";
import { isDashboardSnapshot } from "@/snapshot/buildSnapshot";
import type { DashboardSnapshot } from "@/snapshot/types";

export type SnapshotRead =
  | { ok: true; snapshot: DashboardSnapshot }
  | { ok: false; reason: "missing" | "unreadable" | "malformed"; message: string };

/**
 * Reads the snapshot from disk. This is the dashboard's only production data path: it performs no
 * network requests, so opening the page cannot reach any production API.
 */
export async function readSnapshot(path: string): Promise<SnapshotRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ok: false,
      reason: missing ? "missing" : "unreadable",
      message: missing
        ? `No snapshot at ${path}. Run \`npm run snapshot\` to create the first one.`
        : `Snapshot at ${path} could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed", message: `Snapshot at ${path} is not valid JSON.` };
  }

  if (!isDashboardSnapshot(parsed)) {
    return { ok: false, reason: "malformed", message: `Snapshot at ${path} does not match the expected schema.` };
  }

  return { ok: true, snapshot: parsed };
}
