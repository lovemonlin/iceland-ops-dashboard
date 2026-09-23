import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { IMO_ACTIVE_WARNINGS_URL } from "../src/config/sources";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import { checkImo, parseActiveWarnings } from "../src/monitors/imo/monitor";
import { normalizeImoWarning } from "../src/monitors/imo/normalize";
import { mergeSource } from "../src/snapshot/mergeSnapshot";

const NOW = new Date("2026-09-21T08:00:00Z");
const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/imo-yellow-warnings.json"), "utf8"),
) as Record<string, unknown>[];

interface Route {
  status?: number;
  body?: unknown;
  raw?: string;
  contentType?: string;
  throws?: boolean;
}

function stub(route: Route): DiagnosticFetcher {
  return (url, options) =>
    fetchWithDiagnosticsCore(url, {
      ...options,
      fetch: async () => {
        if (route.throws) throw new TypeError("offline");
        const status = route.status ?? 200;
        const body = status === 204 || status === 205 || status === 304 ? null : (route.raw ?? JSON.stringify(route.body));
        return new Response(body, {
          status,
          headers: { "content-type": route.contentType ?? "application/json" },
        });
      },
    });
}

const check = (route: Route) => checkImo({ now: NOW, request: stub(route) });

test("IMO empty body, quoted empty string, and [] are healthy zero-warning answers", async () => {
  for (const route of [{ status: 204, raw: "", contentType: "text/plain" }, { raw: '""' }, { body: [] }] as Route[]) {
    const parsed = parseActiveWarnings(route.raw ?? JSON.stringify(route.body ?? ""));
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.warnings, []);

    const health = await check(route);
    assert.equal(health.status, "info");
    assert.equal(health.data?.activeWarnings, 0);
    assert.deepEqual(health.data?.warnings, []);
  }
});

test("IMO stores two live-shaped yellow warnings with identity, event, area, times, and official colour", async () => {
  const health = await check({ body: FIXTURE });
  assert.equal(health.status, "ok");
  assert.equal(health.data?.activeWarnings, 2);

  const warnings = health.data?.warnings as Record<string, unknown>[];
  assert.equal(Array.isArray(warnings), true);
  assert.equal(warnings.length, 2);

  assert.equal(warnings[0].identifier, "is-IMO-1f34da8c-f3aa-47ba-9dea-30b0d9e4d79c");
  assert.equal(warnings[1].identifier, "is-IMO-1daece39-1639-4447-9e81-47ae88350b12");
  assert.equal(warnings[0].eventEn, "Weather Warning: Wind");
  assert.equal(warnings[0].eventIs, "Veðurviðvörun: Vindur");
  assert.equal(warnings[0].areaId, 3);
  assert.equal(warnings[1].areaId, 2);
  assert.equal(warnings[0].areaNameEn, "Faxafloi - Southwest Iceland");
  assert.equal(warnings[0].areaNameIs, "Faxaflói");
  assert.equal(warnings[1].areaNameEn, "South Iceland");
  assert.equal(warnings[0].sent, "2026-09-20T21:40:35-00:00");
  assert.equal(warnings[0].onset, "2026-09-21T05:00:00-00:00");
  assert.equal("effective" in warnings[0], false);
  assert.equal(warnings[0].expires, "2026-09-21T09:00:00-00:00");
  assert.equal(warnings[0].warningColor, "Yellow");
  assert.equal(warnings[0].severity, "Moderate");
  assert.equal(warnings[0].descriptionEn?.includes("Reykjanes"), true);
  assert.equal(warnings[0].descriptionIs?.includes("Reykjanesskaga"), true);
  assert.equal("instructionEn" in warnings[0], false);
  assert.equal("instructionIs" in warnings[0], false);
  assert.deepEqual((warnings[0].geocode as { en: { "Forecast Region": string[] } }).en["Forecast Region"], [
    "Faxafloi - Southwest Iceland",
  ]);
  assert.equal(warnings[0].polygon?.[0]?.startsWith("63.8,-22.8"), true);
  assert.equal("circle" in warnings[0], false);
  assert.equal(health.data?.events, "Weather Warning: Wind");
});

test("IMO keeps optional multilingual and geometry fields off the object when the payload omits them", () => {
  const warning = normalizeImoWarning({
    identifier: "only-id",
    event_en: "Wind",
  });
  assert.equal(warning.identifier, "only-id");
  assert.equal(warning.eventEn, "Wind");
  assert.equal(warning.eventIs, undefined);
  assert.equal(warning.headlineEn, undefined);
  assert.equal(warning.descriptionIs, undefined);
  assert.equal(warning.instructionEn, undefined);
  assert.equal(warning.warningColor, undefined);
  assert.equal(warning.polygon, undefined);
  assert.equal(warning.circle, undefined);
  assert.equal(warning.geocode, undefined);
  assert.equal(warning.effective, undefined);
  assert.equal(warning.onset, undefined);
  assert.equal(warning.expires, undefined);
});

test("IMO stores instruction, effective, circle, status, and forecast area id when the payload has them", () => {
  const warning = normalizeImoWarning({
    identifier: "extra",
    status: "Actual",
    effective: "2026-09-21T04:00:00-00:00",
    onset: "2026-09-21T05:00:00-00:00",
    expires: "2026-09-21T09:00:00-00:00",
    instruction_en: "Secure loose objects.",
    instruction_is: "Gætið lausamuna.",
    forecast_area_id: 11,
    circle: ["64.1,-21.9 20"],
    web: "https://en.vedur.is/weather/warnings/",
  });
  assert.equal(warning.status, "Actual");
  assert.equal(warning.effective, "2026-09-21T04:00:00-00:00");
  assert.equal(warning.instructionEn, "Secure loose objects.");
  assert.equal(warning.instructionIs, "Gætið lausamuna.");
  assert.equal(warning.forecastAreaId, 11);
  assert.deepEqual(warning.circle, ["64.1,-21.9 20"]);
  assert.equal(warning.web, "https://en.vedur.is/weather/warnings/");
});

test("IMO does not invent a colour from severity", () => {
  const warning = normalizeImoWarning({
    identifier: "no-color",
    severity: "Moderate",
  });
  assert.equal(warning.severity, "Moderate");
  assert.equal(warning.warningColor, undefined);
});

test("IMO malformed JSON and a non-object warning entry fail without data", async () => {
  const badJson = await check({ raw: "{ oops" });
  assert.equal(badJson.status, "error");
  assert.equal(badJson.errorType, "PARSE_ERROR");
  assert.equal(badJson.data, undefined);

  const badEntry = await check({ body: ["not-an-object"] });
  assert.equal(badEntry.status, "error");
  assert.equal(badEntry.errorType, "SCHEMA_ERROR");
  assert.equal(badEntry.data, undefined);

  const missingId = await check({ body: [{ area_en: "no identifier" }] });
  assert.equal(missingId.status, "error");
  assert.equal(missingId.data, undefined);
});

test("IMO failed collection keeps the previous successful warnings payload", async () => {
  const good = await check({ body: FIXTURE });
  const stored = mergeSource(undefined, good, "2026-09-21T07:00:00.000Z");
  const failed = await check({ throws: true });
  const after = mergeSource(stored, failed, "2026-09-21T08:00:00.000Z");

  assert.equal(failed.data, undefined);
  assert.equal(after.status, "error");
  assert.equal(after.lastAttemptAt, "2026-09-21T08:00:00.000Z");
  assert.equal(after.lastSuccessAt, "2026-09-21T07:00:00.000Z");
  assert.deepEqual(after.data, good.data);
  assert.equal((after.data?.warnings as unknown[]).length, 2);
});

test("IMO still uses the CAP broker URL and does not fetch from the browser tree", () => {
  assert.equal(IMO_ACTIVE_WARNINGS_URL, "https://api.vedur.is/cap/capbroker/active/detailed/all");
  const dashboard = readFileSync(resolve(process.cwd(), "src/components/Dashboard.tsx"), "utf8");
  const warningsUi = readFileSync(resolve(process.cwd(), "src/components/SourceSections.tsx"), "utf8");
  assert.equal(/vedur\.is|IMO_ACTIVE_WARNINGS/.test(dashboard), false);
  assert.equal(/vedur\.is|IMO_ACTIVE_WARNINGS/.test(warningsUi), false);
});
