import { fetchWithDiagnostics } from "@/lib/fetchWithDiagnostics";
import { runAllMonitors } from "@/monitors";

/** Checks must run per request, never at build time. */
export const dynamic = "force-dynamic";

/** Read-only: this route only reads public production data and returns a health snapshot. */
export async function GET() {
  const snapshot = await runAllMonitors({ request: fetchWithDiagnostics });
  return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
}
