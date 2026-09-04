import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const TRIGGER_FILE = "automation/hourly-trigger.txt";
const SNAPSHOT_FILE = "public/data/latest-health.json";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Workflow YAML with comment lines removed, so prose about the config cannot satisfy a check. */
function directives(path: string) {
  return read(path)
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const snapshotWorkflow = () => directives(".github/workflows/update-dashboard-snapshot.yml");
const pagesWorkflow = () => directives(".github/workflows/deploy-pages.yml");

test("the trigger file exists and holds no production data", () => {
  assert.equal(existsSync(resolve(process.cwd(), TRIGGER_FILE)), true);
  const contents = read(TRIGGER_FILE);

  // Its wording is deliberately not asserted: the scheduler overwrites it every hour, typically
  // with nothing but a timestamp. What matters is that it stays a doorbell and never a payload.
  assert.equal(contents.length > 0, true);
  assert.equal(contents.length < 500, true, "the trigger file should stay a one-liner");
  assert.equal(/\{|\}|\[|"status"|"data"|"generatedAt"/.test(contents), false, "no collected data may live here");
});

test("the hourly schedule runs on the hour, in UTC", () => {
  const workflow = snapshotWorkflow();
  assert.match(workflow, /schedule:\s*\n\s*- cron: "0 \* \* \* \*"/);
  // Exactly one cron entry: a second would double-collect.
  assert.equal([...workflow.matchAll(/cron:/g)].length, 1);
});

test("all three triggers survive: schedule, trigger-file push and manual dispatch", () => {
  const workflow = snapshotWorkflow();
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /push:\s*\n\s*paths:\s*\n\s*- "automation\/hourly-trigger\.txt"/);
  assert.match(workflow, /workflow_dispatch:/);
});

test("every trigger runs the same job; there is no second snapshot runner", () => {
  const workflow = snapshotWorkflow();

  // One collecting job, one collection step, shared by all three triggers.
  assert.equal([...workflow.matchAll(/npm run snapshot/g)].length, 1);
  assert.equal([...workflow.matchAll(/^ {2}snapshot:$/gm)].length, 1);
  // Nothing in the job branches on which event started it.
  assert.equal(/if:\s*github\.event_name/.test(workflow), false);
  // And no other workflow collects.
  assert.equal(/npm run snapshot/.test(pagesWorkflow()), false);
});

test("only the snapshot workflow is scheduled; the Pages deploy never is", () => {
  const workflow = pagesWorkflow();
  assert.equal(/^\s*schedule:/m.test(workflow), false);
  assert.equal(/cron:/.test(workflow), false);
});

test("the collection records which trigger started it", () => {
  assert.match(snapshotWorkflow(), /SNAPSHOT_TRIGGER: \$\{\{ github\.event_name \}\}/);
  assert.match(read("scripts/snapshot.ts"), /process\.env\.SNAPSHOT_TRIGGER/);
});

test("an unchanged snapshot ends the run cleanly rather than failing it", () => {
  const workflow = snapshotWorkflow();
  // The commit step exits 0 when there is nothing to commit...
  assert.match(workflow, /Snapshot is unchanged; nothing to commit\./);
  assert.match(workflow, /changed=false/);
  // ...and the deploy is skipped rather than failing.
  assert.match(workflow, /if: needs\.snapshot\.outputs\.changed == 'true'/);
});

test("the collecting job holds the minimum permission it needs, and no credential", () => {
  const workflow = snapshotWorkflow();

  // contents: write is required to push the snapshot; nothing beyond it is granted to that job.
  assert.match(workflow, /snapshot:\s*\n\s*runs-on: ubuntu-latest\s*\n\s*permissions:\s*\n\s*contents: write/);
  assert.equal(/packages:|actions:\s*write|security-events:/.test(workflow), false);

  // The built-in GITHUB_TOKEN only: no personal token, no stored secret.
  assert.equal(/PERSONAL_ACCESS_TOKEN|\bPAT\b|secrets\./.test(workflow), false);
  assert.equal(/token:\s*\$\{\{/.test(workflow), false);
});

test("recursion is impossible: the job writes a file its own trigger does not watch", () => {
  const workflow = snapshotWorkflow();

  // It commits exactly one path...
  const staged = [...workflow.matchAll(/git add (\S+)/g)].map((match) => match[1]);
  assert.deepEqual(staged, [SNAPSHOT_FILE]);
  assert.equal(workflow.includes(`git add ${TRIGGER_FILE}`), false);
  assert.equal(/git add \.|git add -A|git commit -a/.test(workflow), false, "a blanket add could sweep in the trigger file");

  // ...and it is triggered by a different path, so its own commit cannot start it again.
  const triggerPaths = workflow.match(/paths:\s*\n\s*- "([^"]+)"/)?.[1];
  assert.equal(triggerPaths, TRIGGER_FILE);
  assert.notEqual(triggerPaths, SNAPSHOT_FILE);

  // A guard step fails the run if anything other than the snapshot changed.
  assert.match(workflow, /Refusing to commit/);
});

test("the Pages deploy ignores the trigger commit but still publishes the snapshot commit", () => {
  const workflow = pagesWorkflow();

  // Touching the trigger file changes nothing on the site, so it must not cause a deployment.
  assert.match(workflow, /paths-ignore:\s*\n\s*- "automation\/hourly-trigger\.txt"/);
  // Ordinary pushes still deploy.
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  // And the snapshot workflow can call it directly, which is how a snapshot commit gets published:
  // a push made with GITHUB_TOKEN does not start another workflow on its own.
  assert.match(workflow, /workflow_call:/);
  assert.match(snapshotWorkflow(), /uses: \.\/\.github\/workflows\/deploy-pages\.yml/);
});

test("the deploy builds the branch tip, so it includes a snapshot committed moments earlier", () => {
  assert.match(pagesWorkflow(), /uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  // The collecting job must also start from the tip, not from the triggering commit.
  assert.match(snapshotWorkflow(), /uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
});

test("the workflow refuses to publish a snapshot that is not valid production data", () => {
  const workflow = snapshotWorkflow();
  assert.match(workflow, /Refusing to publish an invalid snapshot/);
  assert.match(workflow, /provenance\?\.mode !== "production"/);
  assert.match(workflow, /Date\.parse\(snapshot\.generatedAt\)/);
});

test("collection happens in the workflow, never in the browser", () => {
  assert.match(snapshotWorkflow(), /npm run snapshot/);
  // The published page still reads only the snapshot file.
  const dashboard = read("src/components/Dashboard.tsx");
  assert.equal(/runAllMonitors|api\.met\.no|swpc|vedur\.is/i.test(dashboard), false);
});

test("the banner no longer claims any source is mock data", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  assert.match(dashboard, /ALL PRODUCTION DATA/);
  assert.equal(/MOCK/i.test(dashboard), false);
});

test("the overdue policy stays at 60 minutes expected, 90 minutes overdue", () => {
  const config = read("src/config/snapshot.ts");
  assert.match(config, /SNAPSHOT_INTERVAL_MINUTES = 60/);
  // Deliberately not relaxed because GitHub schedules can slip: slippage is the finding.
  assert.match(config, /SNAPSHOT_OVERDUE_MINUTES = 90/);
});
