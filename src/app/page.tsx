import { resolve } from "node:path";
import { Dashboard } from "@/components/Dashboard";
import { SNAPSHOT_RELATIVE_PATH } from "@/config/snapshot";
import { readSnapshot } from "@/snapshot/readSnapshot";

/**
 * The dashboard's only data path is the snapshot file on disk.
 * It deliberately imports no monitor: opening this page must never contact a production API.
 *
 * The site is statically exported, so this runs at build time and the snapshot is baked into the
 * HTML. Every deployment ships the snapshot committed with it, and the client re-reads the JSON
 * file on load, so a browser holding a cached page still ends up on the newest data.
 */
export default async function Home() {
  const path = resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH);
  const result = await readSnapshot(path);

  if (!result.ok) {
    return (
      <main>
        <header>
          <div>
            <p className="eyebrow">ALL PRODUCTION DATA</p>
            <h1>ICELAND OPS DASHBOARD</h1>
            <p className="error">目前還沒有任何資料快照。</p>
          </div>
        </header>
        <section className="summary">
          <h2>等待第一次自動收集</h2>
          <p>{result.message}</p>
        </section>
      </main>
    );
  }

  return <Dashboard initialSnapshot={result.snapshot} />;
}
