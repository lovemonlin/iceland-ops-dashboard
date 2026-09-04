import { resolve } from "node:path";
import { SNAPSHOT_RELATIVE_PATH } from "../src/config/snapshot";
import { runAllMonitors } from "../src/monitors";
import { buildSnapshot } from "../src/snapshot/buildSnapshot";
import { readSnapshot } from "../src/snapshot/readSnapshot";
import { allSnapshotEntries } from "../src/snapshot/types";
import { writeSnapshot } from "../src/snapshot/writeSnapshot";

/**
 * One scheduled collection run.
 *
 * This is the only place production APIs are contacted. The dashboard itself never calls them; it
 * reads whatever this script last wrote. Intended to be invoked hourly by an external scheduler —
 * there is deliberately no built-in cron here.
 */
async function main() {
  const path = resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH);
  const now = new Date();

  const existing = await readSnapshot(path);
  if (!existing.ok && existing.reason !== "missing") {
    // Do not silently overwrite something unreadable; a human should look at it first.
    console.error(`Refusing to overwrite the existing snapshot: ${existing.message}`);
    process.exitCode = 1;
    return;
  }

  const { monitors } = await runAllMonitors({ now });
  // Set by the workflow to github.event_name; absent when run on a workstation.
  const snapshot = buildSnapshot(existing.ok ? existing.snapshot : undefined, monitors, now, process.env.SNAPSHOT_TRIGGER);
  await writeSnapshot(path, snapshot);

  const width = Math.max(...allSnapshotEntries(snapshot).map((entry) => entry.name.length));
  console.log("Snapshot generated\n");
  console.log(`Generated:  ${snapshot.generatedAt}`);
  console.log(`Next due:   ${snapshot.scheduledFor}`);
  console.log(`Overall:    ${snapshot.overallStatus.toUpperCase()}`);
  console.log(`Trigger:    ${snapshot.trigger}`);
  console.log(`Written to: ${path}\n`);

  for (const entry of allSnapshotEntries(snapshot)) {
    const status = entry.status.toUpperCase().padEnd(9);
    const detail = entry.errorType ? ` ${entry.errorType}` : "";
    const stored =
      entry.lastSuccessAt === entry.lastAttemptAt
        ? ""
        : entry.lastSuccessAt
          ? ` (showing data collected at ${entry.lastSuccessAt})`
          : " (never collected)";
    console.log(`${entry.name.padEnd(width)}  ${status}${detail}${stored}`);
  }
}

main().catch((error) => {
  console.error("Snapshot generation failed:", error);
  process.exitCode = 1;
});
