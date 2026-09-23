import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  formatIcelandWarningWindow,
  imoSourceHealthLabel,
  imoWarningsLead,
  presentImoWarnings,
  readImoWarnings,
} from "../src/lib/imoWarningPresentation";
import type { NormalizedImoWarning } from "../src/monitors/imo/normalize";
import type { SnapshotSource } from "../src/snapshot/types";

const NOW = new Date("2026-09-24T16:00:00Z");
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function warning(over: Partial<NormalizedImoWarning> & Pick<NormalizedImoWarning, "identifier">): NormalizedImoWarning {
  return {
    warningColor: "Yellow",
    eventEn: "Weather Warning: Wind",
    areaNameEn: "South Iceland",
    onset: "2026-09-24T15:00:00Z",
    expires: "2026-09-24T21:00:00Z",
    ...over,
  };
}

function source(status: SnapshotSource["status"], warnings: NormalizedImoWarning[]): SnapshotSource {
  return {
    id: "imo",
    name: "IMO Warnings",
    status,
    lastAttemptAt: "2026-09-24T16:00:00Z",
    data: { activeWarnings: warnings.length, warnings },
  };
}

test("zero warnings is a clear feed and does not lead the dashboard", () => {
  const feed = presentImoWarnings(source("info", []), NOW);
  assert.equal(feed.state, "clear");
  assert.equal(feed.summary.effectiveCount, 0);
  assert.equal(feed.summary.highest, "none");
  assert.equal(imoWarningsLead(source("info", []), NOW), false);
});

test("one yellow warning is current and leads", () => {
  const feed = presentImoWarnings(source("ok", [warning({ identifier: "one" })]), NOW);
  assert.equal(feed.state, "current");
  assert.equal(feed.summary.yellow, 1);
  assert.equal(feed.summary.highest, "yellow");
  assert.equal(feed.cards[0].phase, "active");
  assert.equal(imoWarningsLead(source("ok", [warning({ identifier: "one" })]), NOW), true);
});

test("multiple yellow warnings keep official colour counts and unique areas and events", () => {
  const feed = presentImoWarnings(
    source("ok", [
      warning({ identifier: "a", areaNameEn: "South Iceland", eventEn: "Weather Warning: Wind" }),
      warning({ identifier: "b", areaNameEn: "Westfjords", eventEn: "Weather Warning: Wind" }),
      warning({ identifier: "c", areaNameEn: "South Iceland", eventEn: "Weather Warning: Precipitation" }),
    ]),
    NOW,
  );
  assert.equal(feed.summary.yellow, 3);
  assert.deepEqual(feed.summary.areas.sort(), ["South Iceland", "Westfjords"]);
  assert.equal(feed.summary.events.find((event) => event.label === "強風")?.count, 2);
  assert.equal(feed.summary.events.find((event) => event.label === "降雨")?.count, 1);
  assert.equal(feed.cards.every((card) => card.warning.eventEn?.includes("Weather Warning")), true);
});

test("synthetic yellow, orange, and red sort by official colour then phase then onset then identifier", () => {
  const feed = presentImoWarnings(
    source("ok", [
      warning({ identifier: "y-late", warningColor: "Yellow", onset: "2026-09-24T18:00:00Z", expires: "2026-09-24T22:00:00Z" }),
      warning({ identifier: "r", warningColor: "Red" }),
      warning({ identifier: "o", warningColor: "Orange" }),
      warning({ identifier: "y-b", warningColor: "Yellow", onset: "2026-09-24T12:00:00Z" }),
      warning({ identifier: "y-a", warningColor: "Yellow", onset: "2026-09-24T12:00:00Z" }),
    ]),
    NOW,
  );
  assert.equal(feed.summary.highest, "red");
  assert.deepEqual(
    feed.cards.map((card) => card.warning.identifier),
    ["r", "o", "y-a", "y-b", "y-late"],
  );
  assert.equal(feed.cards[3].phase, "active");
  assert.equal(feed.cards[4].phase, "upcoming");
});

test("active, upcoming, and expired phases follow onset and expires", () => {
  const active = presentImoWarnings(source("ok", [warning({ identifier: "now" })]), NOW).cards[0];
  const upcoming = presentImoWarnings(
    source("ok", [warning({ identifier: "later", onset: "2026-09-24T18:00:00Z", expires: "2026-09-24T22:00:00Z" })]),
    NOW,
  ).cards[0];
  const expired = presentImoWarnings(
    source("ok", [warning({ identifier: "old", onset: "2026-09-24T10:00:00Z", expires: "2026-09-24T12:00:00Z" })]),
    NOW,
  );
  assert.equal(active.phase, "active");
  assert.equal(upcoming.phase, "upcoming");
  assert.equal(expired.cards[0].phase, "expired");
  assert.equal(expired.state, "clear");
});

test("Iceland windows drop the end date on the same day and keep it across midnight", () => {
  assert.equal(formatIcelandWarningWindow("2026-09-24T15:00:00Z", "2026-09-24T21:00:00Z"), "09/24 15:00 → 21:00");
  assert.equal(formatIcelandWarningWindow("2026-09-24T23:00:00Z", "2026-09-25T23:00:00Z"), "09/24 23:00 → 09/25 23:00");
});

test("missing description, instruction, and colour stay optional", () => {
  const bare = warning({
    identifier: "bare",
    warningColor: undefined,
    descriptionEn: undefined,
    instructionEn: undefined,
    onset: undefined,
    expires: undefined,
  });
  const feed = presentImoWarnings(source("ok", [bare]), NOW);
  assert.equal(feed.cards[0].rank, "unknown");
  assert.equal(feed.cards[0].phase, "unknown");
  assert.equal(feed.cards[0].warning.descriptionEn, undefined);
  assert.equal(feed.cards[0].warning.instructionEn, undefined);
  assert.equal(feed.state, "current");
  assert.equal(feed.summary.effectiveCount, 0);
});

test("a failed collection still shows an unexpired stored warning as stale", () => {
  const feed = presentImoWarnings(source("error", [warning({ identifier: "kept" })]), NOW);
  assert.equal(feed.state, "stale-current");
  assert.equal(feed.cards[0].warning.identifier, "kept");
  assert.equal(imoWarningsLead(source("error", [warning({ identifier: "kept" })]), NOW), true);
});

test("a failed collection with only expired warnings is not presented as a current yellow alert", () => {
  const feed = presentImoWarnings(
    source("error", [warning({ identifier: "gone", onset: "2026-09-24T08:00:00Z", expires: "2026-09-24T10:00:00Z" })]),
    NOW,
  );
  assert.equal(feed.state, "stale-expired");
  assert.equal(imoWarningsLead(source("error", [warning({ identifier: "gone", expires: "2026-09-24T10:00:00Z" })]), NOW), false);
});

test("a count without warning details is not presented as a clear sky", () => {
  const entry: SnapshotSource = {
    id: "imo",
    name: "IMO Warnings",
    status: "ok",
    lastAttemptAt: "2026-09-23T11:00:57.207Z",
    data: { activeWarnings: 6, events: "Weather Warning: Wind" },
  };
  const feed = presentImoWarnings(entry, NOW);
  assert.equal(feed.state, "undetailed");
  if (feed.state === "undetailed") assert.equal(feed.recordedCount, 6);
  assert.equal(imoWarningsLead(entry, NOW), false);
});

test("source health wording and the warnings UI do not call IMO from the browser", () => {
  assert.equal(imoSourceHealthLabel({ status: "ok" }), "🟢 資料來源正常");
  assert.equal(imoSourceHealthLabel({ status: "info" }), "🟢 資料來源正常");
  const panel = read("src/components/ImoWarningsPanel.tsx");
  const dialog = read("src/components/ImoWarningDetailDialog.tsx");
  const sections = read("src/components/SourceSections.tsx");
  const dashboard = read("src/components/Dashboard.tsx");
  const presentation = read("src/lib/imoWarningPresentation.ts");
  assert.match(presentation, /資料來源正常/);
  assert.match(panel, /imoSourceHealthLabel/);
  assert.match(dialog, /查看詳情/);
  assert.match(panel, /ImoWarningDetailDialog/);
  assert.match(panel, /技術詳細資料|TechnicalDetails/);
  assert.equal(/vedur\.is|fetch\s*\(/.test(panel + dialog + sections), false);
  assert.match(dashboard, /imoWarningsLead/);
  assert.equal(readImoWarnings({ warnings: [{ identifier: "x", severity: "Moderate" }] })[0].warningColor, undefined);
});
