export function validateEcmwf(manifest: unknown, now = Date.now(), staleAfterSeconds?: number) {
  if (!manifest || typeof manifest !== "object") return "PARSE_ERROR";
  const value = manifest as { modelRun?: string; frames?: unknown[] };
  const modelRunMs = value.modelRun ? Date.parse(value.modelRun) : Number.NaN;
  if (Number.isNaN(modelRunMs)) return "INVALID_TIMESTAMP";
  if (!Array.isArray(value.frames) || value.frames.length === 0) return "EMPTY_DATA";
  if (value.frames.some((frame) => typeof frame !== "string" || !frame)) return "SCHEMA_ERROR";
  if (staleAfterSeconds !== undefined && now - modelRunMs > staleAfterSeconds * 1000) return "STALE_DATA";
  return "OK";
}
export function validateIrca(data: unknown) { return Array.isArray(data) && data.length > 0 ? "OK" : "EMPTY_DATA"; }
export function validateMet(successes: number, total: number) { return successes === total ? "OK" : successes === 0 ? "ERROR" : "DEGRADED"; }
export function validateNoaa(value: unknown, timestamp: unknown) { return typeof value === "number" && Number.isFinite(value) && typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp)) ? "OK" : "SCHEMA_ERROR"; }
