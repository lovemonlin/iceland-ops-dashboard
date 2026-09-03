import assert from "node:assert/strict";
import test from "node:test";
import { GITHUB_API_BASE, MONITORED_WORKFLOWS, runJobsUrl, workflowRunsUrl } from "../src/config/github";
import { fetchWithDiagnosticsCore, type DiagnosticFetcher } from "../src/lib/fetchWithDiagnosticsCore";
import { checkPipelines, createPipelineCache } from "../src/monitors/github/monitor";
import { expectedRunSlot } from "../src/monitors/github/runs";

const MINUTE = 60_000;
const NOW = new Date("2026-09-03T02:45:00Z");

const irca = MONITORED_WORKFLOWS[0];
const ecmwf = MONITORED_WORKFLOWS[1];

interface RunSpec {
  number: number;
  status?: string;
  conclusion?: string | null;
  createdAt: string;
  updatedAt?: string;
}

function run(spec: RunSpec) {
  return {
    id: 33_700_000_000 + spec.number,
    run_number: spec.number,
    status: spec.status ?? "completed",
    conclusion: spec.conclusion === undefined ? "success" : spec.conclusion,
    event: "schedule",
    created_at: spec.createdAt,
    updated_at: spec.updatedAt ?? spec.createdAt,
    html_url: `https://github.com/lovemonlin/iceland-aurora-cloud/actions/runs/${33_700_000_000 + spec.number}`,
  };
}

/** A healthy history: newest run just now, all successful. */
function freshRuns(count = 5) {
  return Array.from({ length: count }, (_unused, index) =>
    run({ number: 900 - index, createdAt: new Date(NOW.getTime() - (10 + index * 120) * MINUTE).toISOString() }),
  );
}

const jobsPayload = {
  total_count: 1,
  jobs: [
    {
      name: "publish",
      status: "completed",
      conclusion: "failure",
      started_at: "2026-09-03T02:40:00Z",
      completed_at: "2026-09-03T02:41:00Z",
      steps: [
        { number: 1, name: "Set up job", status: "completed", conclusion: "success" },
        { number: 5, name: "Test road data converter", status: "completed", conclusion: "success" },
        { number: 6, name: "Download IRCA DATEX and generate app data", status: "completed", conclusion: "failure" },
        { number: 7, name: "Publish updated road files", status: "completed", conclusion: "skipped" },
      ],
    },
  ],
};

interface StubOptions {
  ircaRuns?: unknown[];
  ecmwfRuns?: unknown[];
  jobs?: unknown;
  status?: number;
  jobsStatus?: number;
  body?: string;
  rateLimitRemaining?: number;
  calls?: { url: string; method: string; headers: Record<string, string> }[];
}

function stubRequest(options: StubOptions = {}): DiagnosticFetcher {
  return (url, requestOptions) =>
    fetchWithDiagnosticsCore(url, {
      ...requestOptions,
      fetch: async (target, init) => {
        options.calls?.push({
          url: target,
          method: init?.method ?? "GET",
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });

        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": String(options.rateLimitRemaining ?? 55),
          "x-ratelimit-reset": "1788407581",
        };

        if (target.includes("/jobs")) {
          const status = options.jobsStatus ?? 200;
          return new Response(JSON.stringify(options.jobs ?? jobsPayload), { status, headers });
        }

        const status = options.status ?? 200;
        if (options.body !== undefined) return new Response(options.body, { status, headers });
        const runs = target.includes(irca.file) ? (options.ircaRuns ?? freshRuns()) : (options.ecmwfRuns ?? freshRuns());
        return new Response(JSON.stringify({ total_count: runs.length, workflow_runs: runs }), { status, headers });
      },
    });
}

const check = (options: StubOptions & { now?: Date } = {}) =>
  checkPipelines({ now: options.now ?? NOW, request: stubRequest(options), cache: createPipelineCache() });

const byId = (monitors: Awaited<ReturnType<typeof check>>, id: string) => monitors.find((m) => m.id === id)!;

test("1. a successful latest run is OK", async () => {
  const monitors = await check();
  const pipeline = byId(monitors, "ircaPipeline");
  assert.equal(pipeline.status, "ok");
  assert.equal(pipeline.errorType, undefined);
  assert.equal(pipeline.details?.conclusion, "SUCCESS");
  assert.equal(pipeline.details?.latestRun, "#900");
});

test("2. a failed latest run is ERROR", async () => {
  const runs = [run({ number: 901, conclusion: "failure", createdAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() }), ...freshRuns()];
  const pipeline = byId(await check({ ircaRuns: runs }), "ircaPipeline");
  assert.equal(pipeline.status, "error");
  assert.equal(pipeline.errorType, "WORKFLOW_FAILED");
  assert.equal(pipeline.details?.conclusion, "FAILURE");
});

test("3. a queued latest run is INFO, not a failure", async () => {
  const runs = [run({ number: 901, status: "queued", conclusion: null, createdAt: NOW.toISOString() }), ...freshRuns()];
  const pipeline = byId(await check({ ircaRuns: runs }), "ircaPipeline");
  assert.equal(pipeline.status, "info");
  assert.match(String(pipeline.note), /not a failure/);
});

test("4. an in-progress latest run is INFO, not a failure", async () => {
  const runs = [run({ number: 901, status: "in_progress", conclusion: null, createdAt: NOW.toISOString() }), ...freshRuns()];
  const pipeline = byId(await check({ ircaRuns: runs }), "ircaPipeline");
  assert.equal(pipeline.status, "info");
  assert.equal(pipeline.details?.conclusion, "IN_PROGRESS");
});

test("5-7. a failed run has its job and failed step identified", async () => {
  const runs = [run({ number: 901, conclusion: "failure", createdAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() }), ...freshRuns()];
  const calls: StubOptions["calls"] = [];
  const pipeline = byId(await check({ ircaRuns: runs, calls }), "ircaPipeline");

  assert.equal(calls.some((call) => call.url === runJobsUrl(runs[0].id)), true);
  assert.equal(pipeline.details?.failedJob, "publish");
  assert.equal(pipeline.details?.failedStep, "Download IRCA DATEX and generate app data");
  assert.match(String(pipeline.errorMessage), /failing in job "publish" at step "Download IRCA DATEX/);
});

test("8. one failure then a success is one consecutive failure", async () => {
  const runs = [
    run({ number: 901, conclusion: "failure", createdAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() }),
    ...freshRuns(),
  ];
  const pipeline = byId(await check({ ircaRuns: runs }), "ircaPipeline");
  assert.equal(pipeline.details?.consecutiveFailures, 1);
});

test("9. four failures before a success is four consecutive failures", async () => {
  const runs = [
    ...[901, 900, 899, 898].map((number, index) =>
      run({ number, conclusion: "failure", createdAt: new Date(NOW.getTime() - (5 + index * 30) * MINUTE).toISOString() }),
    ),
    run({ number: 897, createdAt: new Date(NOW.getTime() - 200 * MINUTE).toISOString() }),
  ];
  const pipeline = byId(await check({ ircaRuns: runs }), "ircaPipeline");
  assert.equal(pipeline.details?.consecutiveFailures, 4);
  assert.match(String(pipeline.errorMessage), /4 consecutive failed runs/);
});

test("10. a success resets the failure streak", async () => {
  const runs = [
    run({ number: 902, createdAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() }),
    run({ number: 901, conclusion: "failure", createdAt: new Date(NOW.getTime() - 40 * MINUTE).toISOString() }),
  ];
  const pipeline = byId(await check({ ircaRuns: runs }), "ircaPipeline");
  assert.equal(pipeline.details?.consecutiveFailures, 0);
  assert.equal(pipeline.status, "ok");
});

test("11. no IRCA run for more than 45 minutes is STALE, and says the run did not happen", async () => {
  const runs = [run({ number: 901, createdAt: new Date(NOW.getTime() - 46 * MINUTE).toISOString() })];
  const pipeline = byId(await check({ ircaRuns: runs }), "ircaPipeline");
  assert.equal(pipeline.status, "stale");
  assert.equal(pipeline.errorType, "WORKFLOW_NOT_RUN");
  assert.match(String(pipeline.errorMessage), /did not fail — it did not happen/);

  const justInside = [run({ number: 901, createdAt: new Date(NOW.getTime() - 44 * MINUTE).toISOString() })];
  assert.equal(byId(await check({ ircaRuns: justInside }), "ircaPipeline").status, "ok");
});

test("12. a GitHub 403 leaves the workflow unverified rather than declaring it failed", async () => {
  const pipeline = byId(await check({ status: 403, body: JSON.stringify({ message: "rate limited" }) }), "ircaPipeline");
  assert.equal(pipeline.status, "error");
  assert.equal(pipeline.errorType, "HTTP_ERROR");
  assert.equal(pipeline.details?._workflowStatusKnown, false);
  assert.match(String(pipeline.errorMessage), /could not verify it/);
  assert.doesNotMatch(String(pipeline.errorMessage), /workflow failed/i);
});

test("13. a GitHub 500 is handled the same way", async () => {
  const pipeline = byId(await check({ status: 500, body: "{}" }), "ircaPipeline");
  assert.equal(pipeline.status, "error");
  assert.equal(pipeline.details?._workflowStatusKnown, false);
  assert.equal(pipeline.httpStatus, 500);
});

test("14. rate limit headers are parsed and surfaced", async () => {
  const pipeline = byId(await check({ rateLimitRemaining: 54 }), "ircaPipeline");
  assert.equal(pipeline.details?.githubApi, "54 / 60 requests remaining");
});

test("15. a low remaining budget extends the cache window", async () => {
  const cache = createPipelineCache();
  await checkPipelines({ now: NOW, request: stubRequest({ rateLimitRemaining: 5 }), cache });

  // Seven minutes later the normal five-minute window would have expired; the low-budget one has not.
  const calls: StubOptions["calls"] = [];
  const later = new Date(NOW.getTime() + 7 * MINUTE);
  const monitors = await checkPipelines({ now: later, request: stubRequest({ calls }), cache });
  assert.deepEqual(calls, []);
  assert.match(String(byId(monitors, "ircaPipeline").details?.source), /^cached 7 min ago/);
});

test("16. inside the five-minute window GitHub is not requested at all", async () => {
  const cache = createPipelineCache();
  await checkPipelines({ now: NOW, request: stubRequest(), cache });

  const calls: StubOptions["calls"] = [];
  const monitors = await checkPipelines({ now: new Date(NOW.getTime() + 4 * MINUTE), request: stubRequest({ calls }), cache });
  assert.deepEqual(calls, []);
  assert.match(String(byId(monitors, "ircaPipeline").details?.source), /^cached 4 min ago/);
});

test("17. once the cache expires GitHub is queried again", async () => {
  const cache = createPipelineCache();
  await checkPipelines({ now: NOW, request: stubRequest(), cache });

  const calls: StubOptions["calls"] = [];
  const later = new Date(NOW.getTime() + 6 * MINUTE);
  const monitors = await checkPipelines({ now: later, request: stubRequest({ calls }), cache });
  assert.equal(calls.length, 2);
  assert.equal(byId(monitors, "ircaPipeline").details?.source, "live");
});

test("18-19. the jobs endpoint is called for a failed run and never for a successful one", async () => {
  const successCalls: StubOptions["calls"] = [];
  await check({ calls: successCalls });
  assert.equal(successCalls.some((call) => call.url.includes("/jobs")), false);
  assert.equal(successCalls.length, 2);

  const failing = [run({ number: 901, conclusion: "failure", createdAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() })];
  const failureCalls: StubOptions["calls"] = [];
  await check({ ircaRuns: failing, calls: failureCalls });
  assert.equal(failureCalls.filter((call) => call.url.includes("/jobs")).length, 1);
});

test("23-25. every request is an anonymous GET to api.github.com", async () => {
  const failing = [run({ number: 901, conclusion: "failure", createdAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString() })];
  const calls: StubOptions["calls"] = [];
  await check({ ircaRuns: failing, calls });

  assert.equal(calls.length > 0, true);
  for (const call of calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.url.startsWith(`${GITHUB_API_BASE}/`), true);
    const headerNames = Object.keys(call.headers).map((name) => name.toLowerCase());
    assert.equal(headerNames.includes("authorization"), false);
    assert.equal(call.headers.accept, "application/vnd.github+json");
  }
});

test("the ECMWF workflow is judged against its cron slots, not a flat age", async () => {
  // Slots are :20 past every third UTC hour, with a 45 minute grace.
  assert.equal(expectedRunSlot(new Date("2026-09-03T02:45:00Z"), 3, 20, 45).toISOString(), "2026-09-03T00:20:00.000Z");
  // At 01:00 the 00:20 slot is only 40 minutes old, still inside the grace, so it is not due yet.
  assert.equal(expectedRunSlot(new Date("2026-09-03T01:00:00Z"), 3, 20, 45).toISOString(), "2026-09-02T21:20:00.000Z");
  assert.equal(expectedRunSlot(new Date("2026-09-03T01:06:00Z"), 3, 20, 45).toISOString(), "2026-09-03T00:20:00.000Z");
  assert.equal(expectedRunSlot(new Date("2026-09-03T00:50:00Z"), 3, 20, 45).toISOString(), "2026-09-02T21:20:00.000Z");

  const missed = [run({ number: 300, createdAt: "2026-09-02T23:21:00Z" })];
  const pipeline = byId(await check({ ecmwfRuns: missed }), "ecmwfPipeline");
  assert.equal(pipeline.status, "stale");
  assert.equal(pipeline.errorType, "WORKFLOW_NOT_RUN");

  const onTime = [run({ number: 301, createdAt: "2026-09-03T00:21:00Z" })];
  assert.equal(byId(await check({ ecmwfRuns: onTime }), "ecmwfPipeline").status, "ok");
});

test("a malformed runs payload leaves the workflow unverified", async () => {
  const pipeline = byId(await check({ body: JSON.stringify({ nope: true }) }), "ircaPipeline");
  assert.equal(pipeline.status, "error");
  assert.equal(pipeline.errorType, "SCHEMA_ERROR");
  assert.equal(pipeline.details?._workflowStatusKnown, false);
});

test("both monitored workflow files are the ones verified against the repository", () => {
  assert.equal(irca.file, "update-road-info.yml");
  assert.equal(ecmwf.file, "update-cloud-forecast.yml");
  assert.match(workflowRunsUrl(irca.file), /per_page=10$/);
});
