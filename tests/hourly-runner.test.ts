import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const RUNNER = "scripts/hourly-snapshot.ps1";
const SNAPSHOT_FILE = "public/data/latest-health.json";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** The script with comment lines and doc blocks stripped, so prose cannot satisfy a check. */
function directives() {
  const source = read(RUNNER);
  const withoutBlocks = source.replace(/<#[\s\S]*?#>/g, "");
  return withoutBlocks
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

test("the runner exists and carries no credential of any kind", () => {
  assert.equal(existsSync(resolve(process.cwd(), RUNNER)), true);
  const source = read(RUNNER);

  for (const pattern of [
    /ghp_[A-Za-z0-9]/,
    /github_pat_/,
    /\bpassword\s*=/i,
    /PERSONAL_ACCESS_TOKEN/,
    /Authorization/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY/,
    /@gmail\.com/,
  ]) {
    assert.equal(pattern.test(source), false, `the runner must not contain ${pattern}`);
  }
});

test("it stages the snapshot by name and never sweeps the tree", () => {
  const script = directives();

  const staged = [...script.matchAll(/Invoke-Git add ([^\s\r\n]+)/g)].map((match) => match[1]);
  assert.deepEqual(staged, ["$SnapshotRelativePath"]);
  assert.equal(script.includes("$SnapshotRelativePath = 'public/data/latest-health.json'"), true);

  // A blanket add could carry someone's unrelated work into a snapshot commit.
  assert.equal(/git add \.|add -A|add --all|commit -a\b/.test(script), false);
});

test("it only ever fast-forwards, and never rewrites history or the working tree", () => {
  const script = directives();

  assert.match(script, /Invoke-Git pull --ff-only origin main/);
  assert.equal(/pull --rebase|merge\b|rebase\b/.test(script), false);

  // Nothing here may discard the user's work. Matched as git invocations, not as bare words:
  // "working tree is not clean" is a log message, not a `git clean`.
  for (const destructive of ["reset", "checkout", "switch", "stash", "clean", "revert", "restore"]) {
    const invocation = new RegExp(String.raw`(Invoke-Git|git)\s+(-C\s+\S+\s+)?${destructive}\b`);
    assert.equal(invocation.test(script), false, `the runner must not run git ${destructive}`);
  }
  assert.equal(/--force|-f\s+origin|\+refs\//.test(script), false, "the runner must never force-push");
});

test("a run cannot overlap another", () => {
  const script = directives();
  assert.match(script, /\$LockPath = Join-Path \$RuntimeDir 'hourly-snapshot\.lock'/);
  assert.match(script, /SKIPPED: previous hourly snapshot run still active/);
  // A crashed run must not block every later one for ever.
  assert.match(script, /LockStaleAfterMinutes/);
  assert.match(script, /Remove-Item \$LockPath/);
});

test("it refuses to touch a tree that has someone's own work in it", () => {
  const script = directives();
  assert.match(script, /ABORTED: working tree is not clean/);
  assert.match(script, /ABORTED: unexpected files changed/);
});

test("it never publishes a snapshot it could not validate", () => {
  const script = directives();
  assert.match(script, /SNAPSHOT FAILED/);
  assert.match(script, /failed validation, refusing to publish/);
  assert.match(script, /provenance\?\.mode !== "production"/);
  assert.match(script, /Date\.parse\(snapshot\.generatedAt\)/);
});

test("a commit that failed to push is sent by the next run", () => {
  const script = directives();
  assert.match(script, /rev-list --count 'origin\/main\.\.HEAD'/);
  assert.match(script, /PUSH FAILED/);
  // The commit is kept rather than unwound, so nothing is lost.
  assert.equal(/reset --hard|reset --soft/.test(script), false);
});

test("every run is logged, and the log cannot grow without bound", () => {
  const script = directives();
  assert.match(script, /\$LogPath = Join-Path \$LogDir 'hourly-snapshot\.log'/);
  assert.match(script, /Add-Content -Path \$LogPath/);
  assert.match(script, /\$MaxLogBytes = 5MB/);
  assert.match(script, /Move-Item \$LogPath \$rotated/);

  for (const marker of ["START", "DONE", "ERROR", "ABORTED", "SKIPPED"]) {
    assert.match(script, new RegExp(marker));
  }
});

test("the runner's own artefacts stay out of git", () => {
  const ignored = read(".gitignore");
  assert.match(ignored, /^logs\/$/m);
  assert.match(ignored, /^\.runtime\/$/m);
});

test("the two schedulers cannot both collect within the same hour", () => {
  const script = directives();
  assert.match(script, /\$SkipIfSnapshotYoungerThanMinutes = 45/);
  assert.match(script, /SKIPPED: snapshot is only/);
  // -Force exists so a person can still collect on demand.
  assert.match(script, /\[switch\] \$Force/);
});

test("a Windows collection is labelled so it can be told apart from GitHub's", () => {
  assert.match(directives(), /\$env:SNAPSHOT_TRIGGER = 'windows'/);
});

test("the Task Scheduler registration is documented and reproducible", () => {
  const readme = read("README.md");
  assert.match(readme, /Iceland Ops Dashboard Hourly Snapshot/);
  assert.match(readme, /schtasks|Register-ScheduledTask/);
  assert.match(readme, /-NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(readme, /hourly-snapshot\.ps1/);
  // Task Scheduler skips a run on battery and kills one mid-flight when the mains go, by default.
  assert.match(readme, /-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries/);
});

test("the safety behaviour is covered by a harness that never uses the real repository", () => {
  const harness = read("scripts/test-hourly-snapshot.ps1");
  assert.match(harness, /New-TestRepository/);
  assert.match(harness, /GetTempPath/);
  // Every case builds its own throwaway repo rather than pointing at this one.
  assert.equal(harness.includes("C:\\dev\\iceland-ops-dashboard"), false);
  assert.equal(SNAPSHOT_FILE.length > 0, true);
});
