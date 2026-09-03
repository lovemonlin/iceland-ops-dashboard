import { Dashboard } from "@/components/Dashboard";
import { fetchWithDiagnostics } from "@/lib/fetchWithDiagnostics";
import { runAllMonitors } from "@/monitors";

/** Every visit runs a fresh check; nothing here may be prerendered at build time. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await runAllMonitors({ request: fetchWithDiagnostics });
  return <Dashboard initialSnapshot={snapshot} />;
}
