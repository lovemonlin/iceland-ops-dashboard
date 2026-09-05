import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { serializeSnapshot } from "@/snapshot/serializeSnapshot";
import type { DashboardSnapshot } from "@/snapshot/types";

/**
 * Writes the snapshot atomically: a temporary file is written and flushed, then renamed over the
 * real one. A crash or a full disk mid-write therefore leaves the previous good snapshot in place
 * rather than a half-written file the dashboard cannot parse.
 */
export async function writeSnapshot(path: string, snapshot: DashboardSnapshot) {
  const temporary = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, serializeSnapshot(snapshot), "utf8");
    await rename(temporary, path);
  } catch (error) {
    // Never leave a stray temp file behind to be mistaken for a snapshot.
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
