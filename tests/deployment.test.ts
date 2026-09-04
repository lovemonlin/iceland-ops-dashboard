import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { SNAPSHOT_PUBLIC_PATH, SNAPSHOT_RELATIVE_PATH } from "../src/config/snapshot";
import { isDashboardSnapshot } from "../src/snapshot/buildSnapshot";
import { basePath, getPublicAssetPath, getSnapshotUrl } from "../src/lib/publicPath";

const PAGES_BASE_PATH = "/iceland-ops-dashboard";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Runs `body` with the base path the GitHub Pages build sets, then restores the environment. */
function withPagesBasePath(body: () => void) {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  process.env.NEXT_PUBLIC_BASE_PATH = PAGES_BASE_PATH;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
}

test("1. the build is configured as a static export", () => {
  const config = read("next.config.ts");
  assert.match(config, /output:\s*"export"/);
  // Nothing may hardcode a host or a deployment path.
  assert.equal(config.includes("localhost"), false);
  assert.match(config, /NEXT_PUBLIC_BASE_PATH/);
});

test("2. the GitHub Pages base path is applied to site assets", () => {
  withPagesBasePath(() => {
    assert.equal(basePath(), PAGES_BASE_PATH);
    assert.equal(getPublicAssetPath("/data/latest-health.json"), "/iceland-ops-dashboard/data/latest-health.json");
    // A path without a leading slash must not produce a doubled or missing separator.
    assert.equal(getPublicAssetPath("data/x.json"), "/iceland-ops-dashboard/data/x.json");
  });
});

test("3. the snapshot URL carries the production base path", () => {
  withPagesBasePath(() => {
    assert.equal(getSnapshotUrl(), "/iceland-ops-dashboard/data/latest-health.json");
    assert.match(getSnapshotUrl({ cacheBust: true }), /^\/iceland-ops-dashboard\/data\/latest-health\.json\?t=\d+$/);
  });
});

test("4. local development still serves the snapshot from the site root", () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    assert.equal(basePath(), "");
    assert.equal(getSnapshotUrl(), "/data/latest-health.json");
  } finally {
    if (previous !== undefined) process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});

test("5. only the snapshot request is cache-busted, not the whole site", () => {
  const first = getSnapshotUrl({ cacheBust: true });
  assert.match(first, /\?t=\d+$/);
  assert.equal(getSnapshotUrl().includes("?"), false, "plain asset URLs stay cacheable");

  const dashboard = read("src/components/Dashboard.tsx");
  assert.match(dashboard, /getSnapshotUrl\(\{ cacheBust: true \}\)/);
  // The base path must never be written out by hand in a component.
  assert.equal(dashboard.includes(PAGES_BASE_PATH), false);
});

test("6. nothing the browser loads can reach a production API", () => {
  for (const file of [
    "src/app/page.tsx",
    "src/app/layout.tsx",
    "src/components/Dashboard.tsx",
    "src/components/StatusCard.tsx",
    "src/components/SourceSections.tsx",
  ]) {
    const source = read(file);
    for (const forbidden of [
      "runAllMonitors",
      "@/monitors/ecmwf",
      "@/monitors/irca",
      "@/monitors/github",
      "fetchWithDiagnostics",
      "api.github.com",
      "githubstatus.com",
      "lovemonlin.github.io",
      "met.no",
      "noaa.gov",
    ]) {
      assert.equal(source.includes(forbidden), false, `${file} must not reference ${forbidden}`);
    }
  }
});

test("7. the exported site ships the snapshot and disables Jekyll processing", () => {
  // Everything in public/ is copied verbatim into the export.
  assert.equal(existsSync(resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH)), true);
  assert.equal(existsSync(resolve(process.cwd(), "public/.nojekyll")), true, "GitHub Pages would otherwise drop _next/");
  assert.equal(SNAPSHOT_RELATIVE_PATH, `public${SNAPSHOT_PUBLIC_PATH}`);

  // When a build has already run, check the real output too. Its snapshot is only asserted to be a
  // valid snapshot, not to equal the current source: `out/` may predate a later `npm run snapshot`.
  if (existsSync(resolve(process.cwd(), "out"))) {
    for (const file of ["out/index.html", "out/data/latest-health.json", "out/.nojekyll"]) {
      assert.equal(existsSync(resolve(process.cwd(), file)), true, `${file} missing from the static export`);
    }
    assert.equal(isDashboardSnapshot(JSON.parse(read("out/data/latest-health.json"))), true);
  }
});

/** Workflow YAML with comment lines removed, so prose about the config cannot satisfy a check. */
function workflowDirectives() {
  return read(".github/workflows/deploy-pages.yml")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

test("9. the Pages workflow deploys on push and is not a scheduled job", () => {
  const workflow = workflowDirectives();

  assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
  assert.equal(/^\s*schedule:/m.test(workflow), false, "this must not become a scheduled workflow");
  assert.equal(/cron:/.test(workflow), false);

  // Least privilege: enough to publish Pages and nothing more.
  assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*pages: write\s*\n\s*id-token: write/);
  assert.equal(/contents:\s*write/.test(workflow), false);
  assert.equal(/packages:|actions:\s*write|deployments:\s*write/.test(workflow), false);

  assert.match(workflow, /NEXT_PUBLIC_BASE_PATH/);
  assert.match(workflow, /path:\s*\.\/out/);
});

test("10. no credential or token is referenced anywhere in the tree", () => {
  const workflow = workflowDirectives();
  // The Pages deploy uses the job's OIDC identity; no personal token is involved.
  assert.equal(/PERSONAL_ACCESS_TOKEN|secrets\./.test(workflow), false);
  assert.equal(/Authorization/.test(workflow), false);
  assert.equal(existsSync(resolve(process.cwd(), ".env")), false);
});

test("11. no external host, scheduler or platform was introduced", () => {
  const workflow = workflowDirectives();
  const config = read("next.config.ts");
  const packageJson = read("package.json");

  for (const forbidden of ["cloudflare", "vercel", "netlify", "docker", "railway", "fly.io"]) {
    assert.equal(workflow.toLowerCase().includes(forbidden), false, `workflow must not introduce ${forbidden}`);
    assert.equal(config.toLowerCase().includes(forbidden), false, `next.config must not introduce ${forbidden}`);
    assert.equal(packageJson.toLowerCase().includes(forbidden), false, `dependencies must not introduce ${forbidden}`);
  }
});

test("the deployment writes only what the hourly collection is allowed to change", () => {
  // The scheduled collection must only ever touch the snapshot file; the workflow rebuilds from it.
  const script = read("scripts/snapshot.ts");
  assert.match(script, /SNAPSHOT_RELATIVE_PATH/);
  assert.equal(/writeFile\(|writeFileSync\(/.test(script), false, "the script writes only through writeSnapshot");
});
