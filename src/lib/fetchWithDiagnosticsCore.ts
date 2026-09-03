import { DEFAULT_REQUEST_TIMEOUT_MS } from "@/config/network";
import type { MonitorErrorType } from "@/health/model";

export type ResponseMode = "json" | "text" | "arrayBuffer";

export type DiagnosticErrorType = Extract<
  MonitorErrorType,
  "NETWORK_ERROR" | "TIMEOUT" | "HTTP_ERROR" | "PARSE_ERROR"
>;

export interface FetchDiagnostics {
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  /** URL with credentials, fragment and common secret parameters removed. */
  safeUrl: string;
  responseReceived: boolean;
  httpStatus?: number;
  contentType?: string;
  responseBytes?: number;
}

export interface DiagnosticSuccess<T> {
  ok: true;
  data: T;
  diagnostics: FetchDiagnostics;
}

export interface DiagnosticFailure {
  ok: false;
  errorType: DiagnosticErrorType;
  message: string;
  diagnostics: FetchDiagnostics;
}

export type DiagnosticResult<T> = DiagnosticSuccess<T> | DiagnosticFailure;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DiagnosticRequestOptions {
  fetch?: FetchLike;
  init?: RequestInit;
  responseType?: ResponseMode;
  timeoutMs?: number;
}

/** Never let a URL reach a log, a UI string or an error message with a secret still in it. */
export function safeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(token|key|apikey|access_token)$/i.test(key)) url.searchParams.set(key, "REDACTED");
    }
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/**
 * Pure fetch core with an injectable fetch, so every failure mode can be tested offline.
 * Expected failures are returned as typed results, never thrown, and response bodies are
 * never retained in diagnostics or error messages.
 */
export async function fetchWithDiagnosticsCore<T = unknown>(
  url: string,
  options: DiagnosticRequestOptions = {},
): Promise<DiagnosticResult<T>> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let timedOut = false;

  // Caller cancellation is forwarded into the internal controller, which also owns the timeout.
  const forwardAbort = () => controller.abort();
  const callerSignal = options.init?.signal;
  if (callerSignal?.aborted) {
    forwardAbort();
  } else {
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const finish = (
    extra: Omit<FetchDiagnostics, "startedAt" | "finishedAt" | "latencyMs" | "safeUrl" | "responseReceived"> = {},
    responseReceived = false,
  ): FetchDiagnostics => ({
    startedAt,
    finishedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedMs,
    safeUrl: safeUrl(url),
    responseReceived,
    ...extra,
  });

  const failure = (
    errorType: DiagnosticErrorType,
    message: string,
    diagnostics?: FetchDiagnostics,
  ): DiagnosticFailure => ({ ok: false, errorType, message, diagnostics: diagnostics ?? finish() });

  // Set once a response arrives, so a later body-read failure keeps its status and content type.
  let responseDiagnostics: ((extra?: Pick<FetchDiagnostics, "responseBytes">) => FetchDiagnostics) | undefined;

  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, { ...options.init, signal: controller.signal });
    const contentType = response.headers.get("content-type") ?? undefined;
    responseDiagnostics = (extra = {}) => finish({ httpStatus: response.status, contentType, ...extra }, true);

    if (!response.ok) return failure("HTTP_ERROR", `HTTP ${response.status}.`, responseDiagnostics());

    const responseType = options.responseType ?? "json";

    if (responseType === "json") {
      if (!contentType?.toLowerCase().includes("json")) {
        return failure("PARSE_ERROR", "Expected a JSON content type.", responseDiagnostics());
      }
      const body = await response.text();
      const diagnostics = responseDiagnostics({ responseBytes: new TextEncoder().encode(body).byteLength });
      if (!body.trim()) return failure("PARSE_ERROR", "Response body is empty.", diagnostics);
      try {
        return { ok: true, data: JSON.parse(body) as T, diagnostics };
      } catch {
        return failure("PARSE_ERROR", "Response body is not valid JSON.", diagnostics);
      }
    }

    if (responseType === "text") {
      const data = await response.text();
      return {
        ok: true,
        data: data as T,
        diagnostics: responseDiagnostics({ responseBytes: new TextEncoder().encode(data).byteLength }),
      };
    }

    const data = await response.arrayBuffer();
    return { ok: true, data: data as T, diagnostics: responseDiagnostics({ responseBytes: data.byteLength }) };
  } catch {
    return failure(
      timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      timedOut ? `Request exceeded ${timeoutMs} ms.` : "Network request failed.",
      responseDiagnostics?.(),
    );
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
}
