import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const RUNNER = "scripts/trigger-cloud-workflow.ps1";
const HARNESS = "scripts/test-trigger-cloud-workflow.ps1";
const CLOUD_REPO = "lovemonlin/iceland-aurora-cloud";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** The script with comment lines and doc blocks stripped, so prose cannot satisfy a check. */
function directives(path: string) {
  return read(path)
    .replace(/<#[\s\S]*?#>/g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

test("the trigger runner exists and carries no credential of any kind", () => {
  assert.equal(existsSync(resolve(process.cwd(), RUNNER)), true);
  const source = read(RUNNER);

  for (const pattern of [
    /gh[pousr]_[A-Za-z0-9]/,
    /github_pat_/,
    /\bpassword\s*=/i,
    /PERSONAL_ACCESS_TOKEN/,
    /GH_TOKEN\s*=/,
    /GITHUB_TOKEN\s*=/,
    /-----BEGIN [A-Z ]*PRIVATE KEY/,
    /@gmail\.com/,
  ]) {
    assert.equal(pattern.test(source), false, `the runner must not contain ${pattern}`);
  }
});

test("an unauthenticated machine aborts instead of guessing at a token", () => {
  const script = directives(RUNNER);
  assert.match(script, /Invoke-Gh auth status/);
  assert.match(script, /ABORTED: gh is not authenticated/);
  // Fixing it is a person's interactive job; nothing here may create or store a token.
  assert.match(script, /gh auth login/);
  assert.equal(/gh auth login --with-token|echo .* \| gh auth/.test(script), false);
});

test("it does not treat an accepted dispatch request as a successful publish", () => {
  const script = directives(RUNNER);

  // The run must be new — an id already present before the dispatch cannot be this one...
  assert.match(script, /\$knownIds -contains \$candidate\.databaseId/);
  // ...and it must have been created at or after the dispatch, allowing for clock skew.
  assert.match(script, /\$earliestAcceptable = \$triggerTime\.AddSeconds\(-\$ClockToleranceSeconds\)/);
  assert.match(script, /if \(\$created -lt \$earliestAcceptable\) \{ continue \}/);
  assert.match(script, /RUN NOT FOUND/);

  // Only a completed run with conclusion success counts.
  assert.match(script, /if \(\$conclusion -ne 'success'\)/);
  assert.match(script, /if \(\$status -ne 'completed'\)/);
});

test("only the dispatch request is retried, never a workflow that ran and failed", () => {
  const script = directives(RUNNER);

  assert.match(script, /\$DispatchRetries = 3/);
  assert.match(script, /\$RetryDelaySeconds = 30/);
  assert.match(script, /for \(\$attempt = 1; \$attempt -le \$DispatchRetries; \$attempt\+\+\)/);
  assert.match(script, /DISPATCH FAILED after \$DispatchRetries attempts/);

  // Exactly one place dispatches, so a failed run cannot be re-triggered from anywhere else.
  assert.equal([...script.matchAll(/Invoke-Gh workflow run/g)].length, 1);
  assert.match(script, /WORKFLOW FAILED/);
});

test("a run that never finishes ends the trigger rather than hanging", () => {
  const script = directives(RUNNER);
  assert.match(script, /\$TimeoutMinutes = 20/);
  assert.match(script, /\$deadline = \(Get-Date\)\.AddMinutes\(\$TimeoutMinutes\)/);
  assert.match(script, /ERROR: TIMEOUT after \$TimeoutMinutes minutes/);
});

test("each workflow holds its own lock, so one cannot block the other", () => {
  const script = directives(RUNNER);
  assert.match(script, /'\{0\}-trigger\.lock' -f \$TaskName\.ToLowerInvariant\(\)/);
  assert.match(script, /SKIPPED: previous trigger still active/);
  // A crashed run must not block every later one for ever.
  assert.match(script, /LockStaleAfterMinutes/);
  assert.match(script, /Remove-Item \$LockPath/);
});

test("every trigger is logged to one shared file that cannot grow without bound", () => {
  const script = directives(RUNNER);
  assert.match(script, /\$LogPath = Join-Path \$LogDir 'cloud-workflow-trigger\.log'/);
  assert.match(script, /Add-Content -Path \$LogPath/);
  assert.match(script, /\$MaxLogBytes = 5MB/);
  assert.match(script, /Move-Item \$LogPath \$rotated/);

  for (const marker of ["START", "DONE", "ERROR", "ABORTED", "SKIPPED"]) {
    assert.match(script, new RegExp(marker));
  }
});

test("it triggers the cloud repository and never publishes anything itself", () => {
  const script = directives(RUNNER);
  assert.equal(script.includes(`$Repository = '${CLOUD_REPO}'`), true);

  // Windows is the clock, not the publisher: the Python generators stay on GitHub Actions.
  assert.equal(/generate_road_data|generate_cloud_frames|python|pip install/i.test(script), false);
  // And it must never write to any repository: it dispatches, then reads run status.
  assert.equal(/git (commit|push|add)\b/.test(script), false);
});

test("both scheduled tasks are documented and reproducible", () => {
  const readme = read("README.md");

  assert.match(readme, /Iceland Cloud - IRCA Publisher/);
  assert.match(readme, /Iceland Cloud - ECMWF Publisher/);
  assert.match(readme, /trigger-cloud-workflow\.ps1/);
  assert.match(readme, /-NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(readme, /update-road-info\.yml/);
  assert.match(readme, /update-cloud-forecast\.yml/);

  // IRCA every 15 minutes; ECMWF on the four ECMWF cycles rather than a blind 3-hourly repeat.
  assert.match(readme, /New-TimeSpan -Minutes 15/);
  for (const cycle of ["05:55", "11:55", "17:55", "23:55"]) {
    assert.match(readme, new RegExp(cycle));
  }
  assert.match(readme, /-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries/);
});

test("the safety behaviour is covered by a harness that dispatches nothing real", () => {
  const harness = read(HARNESS);
  assert.match(harness, /GetTempPath/);
  assert.match(harness, /gh\.cmd/);
  // Every scenario runs against a fake gh on a temporary PATH, pointed at a repo that does not exist.
  assert.match(harness, /'-Repository', 'example\/fake-repo'/);
  assert.equal(harness.includes(CLOUD_REPO), false, "the harness must never name the real repository");
});
