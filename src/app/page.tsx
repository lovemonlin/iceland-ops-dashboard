import { resolve } from "node:path";
import { Dashboard } from "@/components/Dashboard";
import { SNAPSHOT_RELATIVE_PATH } from "@/config/snapshot";
import { readSnapshot } from "@/snapshot/readSnapshot";

/** Read the snapshot file on every request, so a newly written snapshot appears immediately. */
export const dynamic = "force-dynamic";

/**
 * The dashboard's only data path is the snapshot file on disk.
 * It deliberately imports no monitor: opening this page must never contact a production API.
 */
export default async function Home() {
  const path = resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH);
  const result = await readSnapshot(path);

  if (!result.ok) {
    return (
      <main>
        <header>
          <div>
            <p className="eyebrow">SCHEDULED SNAPSHOT</p>
            <h1>ICELAND OPS DASHBOARD</h1>
            <p className="error">No snapshot is available yet.</p>
          </div>
        </header>
        <section className="summary">
          <h2>WAITING FOR THE FIRST SCHEDULED COLLECTION</h2>
          <p>{result.message}</p>
        </section>
      </main>
    );
  }

  return <Dashboard initialSnapshot={result.snapshot} />;
}
