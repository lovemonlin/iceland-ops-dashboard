import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithDiagnosticsCore, safeUrl, type FetchLike } from "../src/lib/fetchWithDiagnosticsCore";

const exampleUrl = "https://example.test/data";

test("valid JSON succeeds with diagnostics", async () => {
  const fetch: FetchLike = async () =>
    new Response(JSON.stringify({ value: 1 }), { status: 200, headers: { "content-type": "application/json" } });

  const result = await fetchWithDiagnosticsCore<{ value: number }>(exampleUrl, { fetch });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.value, 1);
    assert.equal(result.diagnostics.httpStatus, 200);
    assert.equal(result.diagnostics.responseBytes, 11);
    assert.equal(result.diagnostics.responseReceived, true);
  }
});

test("500 JSON body remains HTTP_ERROR", async () => {
  const fetch: FetchLike = async () =>
    new Response(JSON.stringify({ error: "private" }), { status: 500, headers: { "content-type": "application/json" } });

  const result = await fetchWithDiagnosticsCore(exampleUrl, { fetch });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorType, "HTTP_ERROR");
    assert.equal(result.diagnostics.httpStatus, 500);
    assert.equal(result.diagnostics.responseReceived, true);
    assert.equal(result.message.includes("private"), false);
  }
});

test("404 preserves its status", async () => {
  const fetch: FetchLike = async () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });

  const result = await fetchWithDiagnosticsCore(exampleUrl, { fetch });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.diagnostics.httpStatus, 404);
});

test("TypeError becomes NETWORK_ERROR before a response", async () => {
  const fetch: FetchLike = async () => {
    throw new TypeError("offline");
  };

  const result = await fetchWithDiagnosticsCore(exampleUrl, { fetch });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorType, "NETWORK_ERROR");
    assert.equal(result.diagnostics.responseReceived, false);
  }
});

test("aborted mock becomes TIMEOUT", async () => {
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));

  const result = await fetchWithDiagnosticsCore(exampleUrl, { fetch, timeoutMs: 1 });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorType, "TIMEOUT");
    assert.equal(result.message, "Request exceeded 1 ms.");
    assert.equal(result.diagnostics.responseReceived, false);
  }
});

test("invalid JSON, HTML content type, and blank JSON are PARSE_ERROR", async () => {
  const malformed: FetchLike = async () => new Response("{", { status: 200, headers: { "content-type": "application/json" } });
  const html: FetchLike = async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  const blank: FetchLike = async () => new Response("   ", { status: 200, headers: { "content-type": "application/json" } });

  for (const fetch of [malformed, html, blank]) {
    const result = await fetchWithDiagnosticsCore(exampleUrl, { fetch });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorType, "PARSE_ERROR");
      assert.equal(result.diagnostics.responseReceived, true);
    }
  }
});

test("safe URL masks common secret parameters", () => {
  assert.equal(
    safeUrl("https://example.test/?TOKEN=one&key=two&apiKey=three&access_token=four&ok=yes"),
    "https://example.test/?TOKEN=REDACTED&key=REDACTED&apiKey=REDACTED&access_token=REDACTED&ok=yes",
  );
});

test("text and arrayBuffer response modes succeed", async () => {
  const textFetch: FetchLike = async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } });
  const bytesFetch: FetchLike = async () =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/octet-stream" } });

  const textResult = await fetchWithDiagnosticsCore<string>(exampleUrl, { fetch: textFetch, responseType: "text" });
  const bytesResult = await fetchWithDiagnosticsCore<ArrayBuffer>(exampleUrl, { fetch: bytesFetch, responseType: "arrayBuffer" });

  assert.equal(textResult.ok, true);
  if (textResult.ok) assert.equal(textResult.data, "hello");
  assert.equal(bytesResult.ok, true);
  if (bytesResult.ok) assert.equal(bytesResult.data.byteLength, 3);
});

test("request init is forwarded and the internal signal is supplied", async () => {
  let received: RequestInit | undefined;
  const fetch: FetchLike = async (_url, init) => {
    received = init;
    return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
  };

  await fetchWithDiagnosticsCore(exampleUrl, {
    fetch,
    responseType: "text",
    init: { method: "HEAD", headers: { "x-test": "yes" } },
  });

  assert.equal(received?.method, "HEAD");
  assert.equal(new Headers(received?.headers).get("x-test"), "yes");
  assert.ok(received?.signal);
});

test("caller abort is forwarded to the internal signal", async () => {
  const caller = new AbortController();
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));

  const pending = fetchWithDiagnosticsCore(exampleUrl, { fetch, init: { signal: caller.signal } });
  caller.abort();
  const result = await pending;

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorType, "NETWORK_ERROR");
});

test("body read errors retain response diagnostics", async () => {
  const fetch: FetchLike = async () =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => {
        throw new Error("stream failed");
      },
    }) as Response;

  const result = await fetchWithDiagnosticsCore(exampleUrl, { fetch });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorType, "NETWORK_ERROR");
    assert.equal(result.diagnostics.responseReceived, true);
    assert.equal(result.diagnostics.httpStatus, 200);
    assert.equal(result.diagnostics.contentType, "application/json");
  }
});

test("safe URL removes credentials and hash", () => {
  assert.equal(safeUrl("https://user:password@example.test/data?ok=yes#private"), "https://example.test/data?ok=yes");
});

test("invalid URL does not reveal an unknown secret", () => {
  assert.equal(safeUrl("not a url secret=unlisted-value"), "[invalid-url]");
});
