import { IP_TIMEZONE_ENDPOINT, IP_TIMEZONE_TIMEOUT_MS } from "@/config/ipTimezone";

export type LocalTimeZone = { source: "ip" | "device"; timeZone?: string };

type Fetcher = typeof fetch;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Options = { endpoint?: string; fetch?: Fetcher; storage?: StorageLike; timeoutMs?: number };

const CACHE_KEY = "iceland-ops-dashboard.ip-timezone.v1";
let inFlight: Promise<LocalTimeZone> | undefined;
let inFlightEndpoint: string | undefined;
let lastResolution: { endpoint: string; value: LocalTimeZone } | undefined;

/** Returns an Intl-accepted IANA timezone, canonicalised where the runtime does so. */
export function normaliseIanaTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) return undefined;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function deviceTimeZone(): LocalTimeZone {
  return { source: "device", timeZone: normaliseIanaTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone) };
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function cached(endpoint: string, storage: StorageLike): LocalTimeZone | undefined {
  try {
    const value: unknown = JSON.parse(storage.getItem(CACHE_KEY) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const record = value as { endpoint?: unknown; timeZone?: unknown };
    if (record.endpoint !== endpoint) return undefined;
    const timeZone = normaliseIanaTimeZone(record.timeZone);
    return timeZone ? { source: "ip", timeZone } : deviceTimeZone();
  } catch {
    return undefined;
  }
}

function store(storage: StorageLike, endpoint: string, timeZone?: string) {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ endpoint, timeZone: timeZone ?? null }));
  } catch {
    // Private browsing or disabled storage only loses the per-session cache; the UI still works.
  }
}

async function requestIpTimeZone(
  endpoint: string,
  fetcher: Fetcher,
  storage: StorageLike,
  timeoutMs: number,
): Promise<LocalTimeZone> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("IP timezone request failed");
    const body: unknown = await response.json();
    const timeZone = normaliseIanaTimeZone(
      body && typeof body === "object" && "timezone" in body ? (body as { timezone?: unknown }).timezone : undefined,
    );
    if (!timeZone) throw new Error("IP timezone response was invalid");
    store(storage, endpoint, timeZone);
    return { source: "ip", timeZone };
  } catch {
    store(storage, endpoint);
    return deviceTimeZone();
  } finally {
    clearTimeout(timeout);
  }
}

/** A shared request also prevents React Strict Mode from issuing a second session lookup. */
export function getIpTimeZone(options: Options = {}): Promise<LocalTimeZone> {
  const endpoint = options.endpoint ?? IP_TIMEZONE_ENDPOINT;
  const storage = options.storage ?? browserStorage();
  if (!endpoint || !storage) return Promise.resolve(deviceTimeZone());
  const saved = cached(endpoint, storage);
  if (saved) return Promise.resolve(saved);
  if (lastResolution?.endpoint === endpoint) return Promise.resolve(lastResolution.value);
  if (inFlight && inFlightEndpoint === endpoint) return inFlight;

  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) return Promise.resolve(deviceTimeZone());
  inFlightEndpoint = endpoint;
  inFlight = requestIpTimeZone(endpoint, fetcher, storage, options.timeoutMs ?? IP_TIMEZONE_TIMEOUT_MS)
    .then((value) => {
      lastResolution = { endpoint, value };
      return value;
    })
    .finally(() => {
      inFlight = undefined;
      inFlightEndpoint = undefined;
    });
  return inFlight;
}
