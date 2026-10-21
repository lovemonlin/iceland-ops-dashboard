import { resolve } from "node:path";
import { StandaloneViewer } from "@/components/StandaloneViewer";
import type { StandaloneKind } from "@/components/StandaloneViewerShell";
import { SNAPSHOT_RELATIVE_PATH } from "@/config/snapshot";
import { readSnapshot } from "@/snapshot/readSnapshot";

/** Static export bakes in a starting snapshot; the client immediately reloads the published JSON. */
export async function StandaloneViewerPage({ kind }: { kind: StandaloneKind }) {
  const result = await readSnapshot(resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH));
  if (!result.ok) return <main className="standalone-viewer"><p className="error">目前沒有可用的資料快照。</p></main>;
  return <StandaloneViewer kind={kind} initialSnapshot={result.snapshot} />;
}
