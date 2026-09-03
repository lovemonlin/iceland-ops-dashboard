import {
  GITHUB_API_ACCEPT,
  GITHUB_API_VERSION,
  GITHUB_RATE_LIMIT_HEADERS,
  GITHUB_REQUEST_TIMEOUT_MS,
} from "@/config/github";
import type { DiagnosticFetcher } from "@/lib/fetchWithDiagnosticsCore";

/**
 * The only way this project talks to the GitHub REST API.
 *
 * Anonymous and read-only: GET, the documented Accept and API-version headers, and never an
 * `Authorization` header. Rate-limit headers are captured on every response so the caller can back
 * off before exhausting the unauthenticated budget.
 */
export function githubGet<T>(url: string, request: DiagnosticFetcher) {
  return request<T>(url, {
    init: {
      method: "GET",
      headers: { Accept: GITHUB_API_ACCEPT, "X-GitHub-Api-Version": GITHUB_API_VERSION },
    },
    responseType: "json",
    timeoutMs: GITHUB_REQUEST_TIMEOUT_MS,
    captureHeaders: GITHUB_RATE_LIMIT_HEADERS,
  });
}
