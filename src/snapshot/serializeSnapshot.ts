/**
 * The snapshot's on-disk JSON.
 *
 * It stays indented, because the file is committed every hour and a readable diff is how a bad
 * collection gets spotted. The one departure from `JSON.stringify(value, null, 2)` is that an
 * array holding only primitives is printed on a single line:
 *
 *     "forecast": [
 *       [8.2, 6.1, 253.6, 100, 11.7, 0, 100, "cloudy"],
 *       [8.1, 5.8, 250.1, 100, 9.4, 0, 100, "cloudy"]
 *     ]
 *
 * One forecast hour is a row you can read across, rather than eight lines each carrying a single
 * number and ten spaces of indentation. Objects, and arrays that contain them, are unaffected, so
 * the rest of the snapshot looks exactly as it did.
 *
 * The output is ordinary JSON — only whitespace differs from `JSON.stringify`, and
 * `JSON.parse(serializeSnapshot(x))` deep-equals `JSON.parse(JSON.stringify(x))`.
 */

const INDENT = 2;

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function serialize(value: unknown, depth: number): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";

  const pad = " ".repeat(depth + INDENT);
  const close = " ".repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // The whole point: a row of numbers is one line.
    if (value.every(isPrimitive)) return JSON.stringify(value);
    return `[\n${value.map((item) => pad + serialize(item, depth + INDENT)).join(",\n")}\n${close}]`;
  }

  // `undefined` members are omitted, matching JSON.stringify.
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([key, item]) => `${pad}${JSON.stringify(key)}: ${serialize(item, depth + INDENT)}`)
    .join(",\n")}\n${close}}`;
}

export function serializeSnapshot(snapshot: unknown): string {
  return `${serialize(snapshot, 0)}\n`;
}
