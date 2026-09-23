/**
 * Parses the CAP broker's active-warning body the way the app does: as raw text.
 *
 * "No active warnings" has several shapes in practice — an empty body (the broker answers
 * `204 No Content`), the JSON string `""`, or `[]`. All of them are healthy empty answers, not
 * broken ones, so they are reported separately from a malformed response.
 */
export function parseActiveWarnings(
  body: string,
): { ok: true; warnings: Record<string, unknown>[] } | { ok: false; message: string } {
  const trimmed = body.trim();
  if (trimmed === "" || trimmed === '""' || trimmed === "[]") return { ok: true, warnings: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: "Active warnings body is not valid JSON." };
  }

  if (raw === "" || raw === null) return { ok: true, warnings: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "Active warnings payload is neither an array nor an empty string." };

  const warnings: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "An active warning entry is not an object." };
    }
    const warning = entry as Record<string, unknown>;
    if (!text(warning.identifier)) return { ok: false, message: "An active warning has no identifier." };
    warnings.push(warning);
  }
  return { ok: true, warnings };
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
