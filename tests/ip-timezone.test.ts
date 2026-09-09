import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import worker from "../cloudflare/timezone-worker/src/index";
import { deviceTimeZone, getIpTimeZone, normaliseIanaTimeZone } from "../src/lib/ipTimezone";

const ORIGIN = "https://lovemonlin.github.io";

function workerRequest(method: string, origin = ORIGIN, timezone: unknown = "Asia/Taipei") {
  const request = new Request("https://timezone.example", { method, headers: { Origin: origin } }) as Request & {
    cf?: { timezone?: unknown };
  };
  request.cf = { timezone };
  return request;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test("the Worker returns only Cloudflare's timezone and never caches a response", async () => {
  const response = await worker.fetch(workerRequest("GET"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { timezone: "Asia/Taipei" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Vary"), "Origin");

  const source = readFileSync(resolve(process.cwd(), "cloudflare/timezone-worker/src/index.ts"), "utf8");
  assert.equal(/console\.|\bcity\b|\blatitude\b|\blongitude\b/.test(source), false);
});

test("the Worker allows only the production origin and handles methods without caching", async () => {
  const denied = await worker.fetch(workerRequest("GET", "https://example.com"));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(denied.headers.get("Cache-Control"), "no-store");

  const preflight = await worker.fetch(workerRequest("OPTIONS"));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  assert.equal(preflight.headers.get("Cache-Control"), "no-store");

  const unsupported = await worker.fetch(workerRequest("POST"));
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Cache-Control"), "no-store");
  const missing = await worker.fetch(workerRequest("GET", ORIGIN, null));
  assert.equal(missing.status, 204);
  assert.equal(missing.headers.get("Cache-Control"), "no-store");
});

test("timezone validation accepts IANA names and rejects malformed values", () => {
  assert.equal(normaliseIanaTimeZone("Atlantic/Reykjavik"), "Atlantic/Reykjavik");
  assert.equal(normaliseIanaTimeZone("not-a-zone"), undefined);
  assert.equal(normaliseIanaTimeZone({ timezone: "Asia/Taipei" }), undefined);
});

test("a successful IP lookup is shared and reused for the browser session", async () => {
  const storage = memoryStorage();
  const endpoint = "https://timezone.example/success";
  let calls = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.equal(input, endpoint);
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    assert.deepEqual(init?.headers, { Accept: "application/json" });
    return Response.json({ timezone: "Asia/Taipei" });
  }) as typeof fetch;

  const [first, concurrent] = await Promise.all([
    getIpTimeZone({ endpoint, fetch: fetcher, storage }),
    getIpTimeZone({ endpoint, fetch: fetcher, storage }),
  ]);
  assert.deepEqual(first, { source: "ip", timeZone: "Asia/Taipei" });
  assert.deepEqual(concurrent, first);
  assert.deepEqual(await getIpTimeZone({ endpoint, fetch: fetcher, storage }), first);
  assert.equal(calls, 1);
});

async function assertFallsBackOnce(
  name: string,
  response: (init?: RequestInit) => Promise<Response>,
  timeoutMs = 3_000,
) {
  const storage = memoryStorage();
  const endpoint = `https://timezone.example/${name}`;
  let calls = 0;
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return response(init);
  }) as typeof fetch;

  const first = await getIpTimeZone({ endpoint, fetch: fetcher, storage, timeoutMs });
  const repeated = await getIpTimeZone({ endpoint, fetch: fetcher, storage, timeoutMs });
  assert.deepEqual(first, deviceTimeZone());
  assert.deepEqual(repeated, first);
  assert.equal(calls, 1);
}

test("invalid, failed and timed-out lookups fall back once to the device timezone", async () => {
  await assertFallsBackOnce("invalid", async () => Response.json({ timezone: "not-a-zone" }));
  await assertFallsBackOnce("http-error", async () => new Response(null, { status: 500 }));
  await assertFallsBackOnce(
    "timeout",
    (init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    5,
  );
});

test("an unconfigured endpoint makes no request and uses the device timezone", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return Response.json({ timezone: "Asia/Taipei" });
  }) as typeof fetch;
  assert.deepEqual(await getIpTimeZone({ endpoint: "", fetch: fetcher, storage: memoryStorage() }), deviceTimeZone());
  assert.equal(calls, 0);
});
