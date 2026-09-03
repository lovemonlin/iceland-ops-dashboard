import "server-only";
import {
  fetchWithDiagnosticsCore,
  type DiagnosticRequestOptions,
  type DiagnosticResult,
} from "@/lib/fetchWithDiagnosticsCore";

/** Server-only wrapper that supplies the global fetch. Tests import the pure core instead. */
export function fetchWithDiagnostics<T = unknown>(
  url: string,
  options: Omit<DiagnosticRequestOptions, "fetch"> = {},
): Promise<DiagnosticResult<T>> {
  return fetchWithDiagnosticsCore<T>(url, { ...options, fetch: globalThis.fetch });
}
