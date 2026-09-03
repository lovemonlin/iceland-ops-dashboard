import assert from "node:assert/strict";
import test from "node:test";
import { recordCheck, statusMap, MAX_SESSION_EVENTS } from "../src/lib/events";
import { formatAge, formatClock, formatDateTime, ICELAND_TIME_ZONE } from "../src/lib/time";
import { getMockMonitors } from "../src/monitors/mockMonitors";

const monitors = getMockMonitors();

test("time formatting is time-zone explicit, never browser-local", () => {
  const winter = "2026-01-15T08:52:13.000Z";
  assert.equal(formatClock(winter, ICELAND_TIME_ZONE), "08:52:13");
  assert.equal(formatClock(winter, "UTC"), "08:52:13");
  assert.equal(formatClock(winter, "Asia/Taipei"), "16:52:13");
  assert.equal(formatDateTime(winter, "UTC"), "2026-01-15 08:52:13");
});

test("Iceland stays on UTC through northern summer", () => {
  assert.equal(formatClock("2026-07-15T08:00:00.000Z", ICELAND_TIME_ZONE), "08:00:00");
});

test("age formatting stays compact across magnitudes", () => {
  assert.equal(formatAge(undefined), "—");
  assert.equal(formatAge(42), "42s");
  assert.equal(formatAge(493), "8m 13s");
  assert.equal(formatAge(64633), "17h 57m");
  assert.equal(formatAge(180000), "2d 2h");
});

test("first check seeds one event per source", () => {
  const events = recordCheck([], monitors, null, "2026-09-03T08:52:13.000Z");
  assert.equal(events.length, monitors.length);
  assert.deepEqual(new Set(events.map((event) => event.label)), new Set(monitors.map((monitor) => monitor.name)));
});

test("an unchanged check logs only the cycle line", () => {
  const seeded = recordCheck([], monitors, null, "2026-09-03T08:52:13.000Z");
  const next = recordCheck(seeded, monitors, statusMap(monitors), "2026-09-03T08:53:13.000Z");
  assert.equal(next.length, seeded.length + 1);
  assert.equal(next[0].detail, "no change");
  assert.equal(next[0].status, "error");
});

test("a status change is logged with its transition", () => {
  const previous = { ...statusMap(monitors), irca: "ok" as const };
  const events = recordCheck([], monitors, previous, "2026-09-03T08:53:13.000Z");
  const change = events.find((event) => event.label === "IRCA Roads");
  assert.equal(change?.detail, "OK → ERROR");
  assert.equal(change?.status, "error");
});

test("the session log is capped", () => {
  let events = recordCheck([], monitors, null, "2026-09-03T08:52:13.000Z");
  for (let index = 0; index < 60; index += 1) {
    events = recordCheck(events, monitors, statusMap(monitors), `2026-09-03T09:${String(index).padStart(2, "0")}:00.000Z`);
  }
  assert.equal(events.length, MAX_SESSION_EVENTS);
});

test("event keys are unique so the list renders without collisions", () => {
  const seeded = recordCheck([], monitors, null, "2026-09-03T08:52:13.000Z");
  const next = recordCheck(seeded, monitors, statusMap(monitors), "2026-09-03T08:53:13.000Z");
  assert.equal(new Set(next.map((event) => event.key)).size, next.length);
});
