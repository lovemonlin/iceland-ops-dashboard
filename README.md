# Iceland Ops Dashboard

Read-only monitoring dashboard for the data sources behind the Iceland travel tooling.
**This is not a traveller-facing app.**

Phase one answers, in about ten seconds: is weather / roads / aurora / ECMWF / IMO data healthy right now,
is anything stale, is anything failing on HTTP, parse or schema, when did each source last succeed,
and which source needs attention first.

## Repository boundary

This is an independent repository. It must never modify, commit to, or write into:

- `lovemonlin/iceland-aurora` (Android)
- `lovemonlin/iceland-aurora-ios` (iOS)
- `lovemonlin/iceland-aurora-cloud` (cloud data pipeline)
- Notion or production data in any other repository

Monitoring and collection are **READ ONLY toward upstream production sources**. There is no repair
button, rerun button, production-action retry, or credential. The approved workflow writes only
`public/data/latest-health.json` in this repository and deploys this dashboard to GitHub Pages. Any
other production write access must first be approved and recorded in `PROJECT_MEMORY.md`.

Anything in `docs/reference/` is reference material only and does not apply to this project.
In particular, the Android project's Gradle, APK, emulator and Android Studio rules are irrelevant here.

## Data sources monitored

Phase one covers nine data sources plus two GitHub Actions pipeline monitors.
**Every one of them reads real production data — there is no mock data path in the runtime.**

| Section | Monitor | id | Source |
| --- | --- | --- | --- |
| Weather | MET Norway Weather | `metno` | `api.met.no` Locationforecast 2.0, the app's 32 curated sites |
| Roads | IRCA Roads | `irca` | `iceland-aurora-cloud` GitHub Pages (IRCA DATEX) |
| Pipelines | IRCA Road Publisher | `ircaPipeline` | GitHub Actions REST API |
| Pipelines | ECMWF Cloud Publisher | `ecmwfPipeline` | GitHub Actions REST API |
| Aurora | NOAA Kp | `noaaKp` | `services.swpc.noaa.gov` planetary K index |
| Aurora | NOAA Kp Forecast | `noaaKpForecast` | `services.swpc.noaa.gov` NOAA 3-day planetary K-index forecast |
| Aurora | NOAA Solar Wind | `solarWind` | `services.swpc.noaa.gov` solar wind summaries |
| Aurora | NOAA OVATION | `ovation` | `services.swpc.noaa.gov` aurora oval grid |
| Aurora | NOAA Hemispheric Power | `noaaHemiPower` | `services.swpc.noaa.gov` aurora nowcast hemispheric power |
| Forecast / Warnings | ECMWF Cloud Forecast | `ecmwf` | `iceland-aurora-cloud` GitHub Pages (ECMWF IFS Open Data) |
| Forecast / Warnings | IMO Warnings | `imo` | `api.vedur.is` CAP broker |

Every endpoint, coordinate and field name was read out of the Android app so the dashboard watches
exactly what the app uses. A monitor pointed at a different endpoint would tell the maintainer
nothing. `src/config/sources.ts` holds them all, and each snapshot entry records its `provenance`
so "is this real?" is checkable rather than assumed.

### Weather, aurora and warnings monitors

**MET Norway** queries the app's 32 curated sites through Locationforecast 2.0, with a compliant
User-Agent and coordinates trimmed to four decimals as MET's terms require. The snapshot records how
many locations were checked, how many answered and which did not, so a partial outage is visible
rather than averaged away. Each stored site also carries the Android app's `DARK`, `MODERATE`, or
`BRIGHT` light-pollution class. Set `METNO_USER_AGENT` to supply your own contact address; the default
identifies this project by its public repository, and no private email is committed.

**NOAA SWPC** is read through the same paths the app uses — the widely-copied
`/products/solar-wind/...` paths now 404 and are deliberately absent. Kp comes from the one-minute
planetary index, solar wind from the lightweight summary products (losing only the optional speed
product is DEGRADED, not ERROR), OVATION is summarised rather than stored whole: grid size, both
timestamps, and the strongest probability over Icelandic latitudes, and hemispheric power is the
last row of SWPC's 5-minute text table (north and south GW; the 功率 dial reads north).

**IMO warnings** are read from the CAP broker with its required API-version header. The body is
parsed as text, because the broker answers `204 No Content` when nothing is active — reading it as
JSON would report a parse error for what is actually a healthy "no warnings". Zero active warnings
is INFO, never EMPTY_DATA.

### ECMWF monitor

Reads the public GitHub Pages output of `iceland-aurora-cloud` — the manifest, plus a `HEAD` probe of
the first and last frame. It never touches ECMWF Open Data, GRIB2, the cloud repository or GitHub Actions.

Its freshness rule is **not** an age threshold. Model cycles are 00/06/12/18 UTC and each has a
production publication deadline (00Z by 09:45, 06Z by 15:45, 12Z by 21:45, 18Z by 03:45 the next UTC
day). At 09:30 UTC still being on the previous 18Z run is healthy; at 10:00 UTC without the 00Z run it
is STALE. The schedule lives in `src/config/ecmwf.ts` and the comparison in `src/monitors/ecmwf/schedule.ts`.

A STALE ECMWF card names the expected run, the published run and the deadline, so the maintainer can
see at a glance that the API is fine and the cloud pipeline is behind.


### IRCA monitor

Reads the public GitHub Pages output of `iceland-aurora-cloud`: `road-manifest.json` plus `HEAD`
probes of the three GeoJSON datasets. It never talks to IRCA (umferdin.is), the cloud repository or
GitHub Actions.

The publisher is **all-or-nothing** — when IRCA fails upstream the publish fails and the previous
good output stays online — so HTTP 200 proves nothing here. The diagnosis comes from four signals:

- **Freshness.** The pipeline republishes about every 30 minutes. Past 45 minutes is `STALE`; past
  120 minutes is `ERROR`, because the data should no longer be read as a live picture of the roads.
  This is dashboard operational policy, not an IRCA or pipeline SLA.
- **Availability.** Losing `road-conditions.geojson` alone is `ERROR` (it is the core dataset);
  losing one of incidents or stations is `DEGRADED`; losing two or more is `ERROR`.
- **Sanity floors.** Roads >= 500, stations >= 100, traffic stations >= 50, derived from observed
  production scale (701 / 203 / 107) to catch a collapsed publish. Incidents legitimately reach
  zero and are never `EMPTY_DATA` on their own. Messages name both numbers, never "invalid data".
- **Consistency.** Every manifest count must equal the actual feature count in its file, and the
  traffic-station count is re-derived from the `has_traffic` flags on station features.

Transport, core-dataset and emptiness failures all outrank age, so an outage is never hidden behind
a STALE badge.

To keep a 60-second refresh cheap, only the manifest is fetched every check; the 1.3 MB road file
and its siblings are downloaded solely when the manifest identity changes. Since the publisher is
all-or-nothing, the files cannot change without the manifest changing. The cache is server-process
memory only — no database, and losing it on restart costs one extra download.


### GitHub Actions pipeline monitors

The output monitors can prove that published data is old. They cannot say why. The pipeline monitors
read the public GitHub REST API, anonymously and GET-only, to separate four very different problems:

- the workflow **ran and failed** — with the failing job and step named;
- the workflow **never ran** — a missing scheduled trigger, which needs a different fix entirely;
- the workflow **succeeded but the output did not advance** — a publish-side problem;
- **GitHub could not be checked** — stated as such, never as a workflow failure.

Each source and its pipeline are merged into a single incident, so one problem produces one entry.

No token is used, so GitHub allows 60 requests/hour/IP. GitHub is therefore polled at most every
5 minutes from an in-memory cache, and the jobs endpoint is only touched when the latest run failed.
Rate-limit headers are parsed and shown on the card; below 10 remaining the interval stretches to
10 minutes.

The monitor also reads scheduler-side metadata hourly — workflow state, the repository's default
branch, and the cron actually present in the workflow file on that branch — so a disabled workflow
or a file missing from the default branch is named as such instead of appearing as a mystery gap.
GitHub's platform status is shown as context and never changes any monitor's status.

**A note on GitHub scheduling.**

GitHub documents that scheduled events can be delayed during periods of high Actions load, and
that queued scheduled jobs may be dropped. A cron expression is therefore a request, not a
delivery guarantee.

Separately — and this is an observation about this repository, not a statement about GitHub in
general — the production history contains substantial gaps between scheduled runs. A read-only
sample of the last 10 runs of each workflow on 2026-09-03 showed `update-road-info.yml` running
every 105-277 minutes (median 147) against a five-minute cron, and `update-cloud-forecast.yml`
every ~134-401 minutes against a three-hourly cron. Cron frequency must not be treated as an SLA.

The card therefore shows the **configured schedule** and this dashboard's own **alerting rule**
as two separate fields, and never presents a cron as an expected delivery interval.

## Status meanings

| Status | Colour | Meaning |
| --- | --- | --- |
| `ok` | green | Network, HTTP, parse, schema, required data and freshness are all healthy. |
| `info` | blue | Healthy, but worth saying — e.g. IMO reports zero active warnings. Never degrades the system status. |
| `stale` | yellow | Data is readable but older than its configured threshold. |
| `degraded` | orange | Partial failure — some sub-checks succeeded, some did not. |
| `error` | red | Network, timeout, HTTP, parse, schema, empty-dataset or invalid-timestamp failure. |

Overall system status: any `error` → ERROR; else any `degraded` → DEGRADED; else any `stale` → STALE; else OK.

**HTTP 200 is never treated as healthy on its own.** IRCA returning 200 with zero roads is `ERROR / EMPTY_DATA`;
an ECMWF manifest returning 200 with an old model run is `STALE`; NOAA returning 200 with a changed
schema is `ERROR / SCHEMA_ERROR`; IMO returning 200 with zero active warnings is `INFO`, not a failure.

## Run

The published dashboard is at **https://lovemonlin.github.io/iceland-ops-dashboard/** and needs
nothing running locally.

To work on it:

```powershell
git pull --ff-only
npm.cmd ci
npm.cmd run dev
```

**一般本機開發不得執行 `npm run snapshot`。** 它是唯一會連線到 production 的收集命令，且會
改寫 `public/data/latest-health.json`。本 repo 沒有內建 cron；正式 scheduler 是外部 Cloudflare
Worker，透過 GitHub Actions 執行收集。本機 snapshot 過期時以 `git pull --ff-only` 同步，不要自行收集。

In the browser, `Reload latest snapshot` re-reads the file, and the page does so on its own every
5 minutes. Neither re-checks production.

## Checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

## Architecture

```
Cloudflare Worker
  → workflow_dispatch
  → GitHub Actions / Update Dashboard Snapshot
  → npm run snapshot
  → public/data/latest-health.json
  → commit/push snapshot
  → explicit reusable Pages workflow
  → npm ci
  → npm test
  → npm run build
  → GitHub Pages
```

**Browser refresh and production data collection are different things.** Opening or reloading the
dashboard reads one static JSON file and contacts no production data API. The optional timezone
helper is the sole browser endpoint: it reads no dashboard data and returns only an IANA timezone.
Production data is collected only by the snapshot workflow, normally triggered by the external
Cloudflare scheduler. The dashboard does not need to be open for that to happen, and having it open
does not make it happen more often.

The scheduled collection is only ever allowed to change one file: `public/data/latest-health.json`.
It must not touch source code, `package.json`, the workflow, configuration or this README. After
committing and pushing that file to `main`, Update Dashboard Snapshot explicitly calls the reusable
Pages workflow to rebuild and redeploy it.

`npm run snapshot` is not a development command. Windows is a development environment, not a
production clock; nothing needs to run continuously on the local machine for production to stay up.

### Windows 與 cloud 的責任

`C:\dev\iceland-ops-dashboard` 是唯一正式本機 working copy，GitHub `main` 是 source of truth。
本機負責開發、驗證、commit 與 push；Cloudflare Worker 是 production scheduler，GitHub Actions 是
collector，GitHub Pages 負責顯示與部署。

這個 production scheduler 位於本 repo 之外，與 `cloudflare/timezone-worker` 的瀏覽器時區服務不同。

| Responsibility | Current production role |
| --- | --- |
| Windows 11 local working copy | 開發、測試、commit/push 到 `main`；不執行 production clock |
| Cloudflare Worker | 外部 scheduler，以 `workflow_dispatch` 觸發 collection |
| Update Dashboard Snapshot | 收集、驗證，且只 commit/push `latest-health.json` |
| Deploy dashboard to GitHub Pages | `npm ci`、`npm test`、`npm run build`，再部署 Pages |

GitHub Actions snapshot workflow 本身沒有 cron。除了 Cloudflare 的 `workflow_dispatch` 外，推送
`automation/hourly-trigger.txt` 仍是 fallback / external trigger path。snapshot commit 使用
`GITHUB_TOKEN` 不會再觸發 push workflow，因此 Update Dashboard Snapshot 會明確呼叫 reusable
Pages workflow；它包含 `npm ci`、`npm test` 和 `npm run build`。

### Legacy / Historical / Fallback

`scripts\hourly-snapshot.ps1` 與 `scripts\trigger-cloud-workflow.ps1` 均保留為 legacy /
historical / fallback，並不是目前 production 必要元件。不可將它們當成預設路徑或重新註冊 Windows
Task Scheduler。

`hourly-snapshot.ps1` 的安全行為由 `scripts\test-hourly-snapshot.ps1` 覆蓋；
`trigger-cloud-workflow.ps1` 的 harness 使用假 `gh`，不會 dispatch 真實工作。後者會對
`lovemonlin/iceland-aurora-cloud` 的 `update-road-info.yml` 或 `update-cloud-forecast.yml` 發出
workflow dispatch，因此仍須遵守 repository boundary，不能視為本 dashboard production 架構的一部分。

### The remaining GitHub triggers

`.github/workflows/update-dashboard-snapshot.yml` 沒有內建 cron。正式 scheduler 是外部
Cloudflare Worker，使用 `workflow_dispatch` 觸發 collection；workflow_dispatch 同時也可供人工操作。
`automation/hourly-trigger.txt` 的 push 則保留為 fallback / external trigger path。

| Trigger | When |
| --- | --- |
| `push` to `automation/hourly-trigger.txt` | fallback / external triggering |
| `workflow_dispatch` | Cloudflare scheduler 或人工 dispatch |

Which one started a round is recorded in the snapshot as `trigger`.

Using only the built-in `GITHUB_TOKEN` with `contents: write`, the job:

1. checks out the branch tip, so a monitor or endpoint changed since the trigger is included;
2. runs `npm run snapshot`;
3. refuses to continue unless the result is a valid snapshot whose every entry declares
   production provenance;
4. refuses to commit if anything other than the snapshot changed;
5. commits `public/data/latest-health.json` alone and pushes;
6. calls the Pages workflow to publish it.

**Recursion is structurally impossible.** The workflow watches `automation/hourly-trigger.txt`
and writes `public/data/latest-health.json`; those are different paths, so its own commit cannot
start it again. A blanket `git add` is never used, and a guard step fails the run if any other
file changed.

Step 6 of that list exists because a push made with `GITHUB_TOKEN` deliberately does not start
another workflow. Without the explicit call, the snapshot commit would land but never deploy.

### Deployment

The site is a Next.js **static export** (`output: "export"`), served by GitHub Pages from
`out/`. GitHub Pages project sites live under `/<repository>/`, so the Pages build sets
`NEXT_PUBLIC_BASE_PATH=/iceland-ops-dashboard`; locally the variable is unset and everything is
served from `/`. Every path is built through `getPublicAssetPath()` / `getSnapshotUrl()` in
`src/lib/publicPath.ts` — the base path is never written out by hand in a component.

`public/.nojekyll` stops GitHub Pages from discarding the `_next/` directory. The snapshot request
is cache-busted with a timestamp so a redeployed snapshot is never hidden behind a cached copy; the
rest of the site stays ordinary cacheable static content.

#### Optional IP timezone helper

The cloud forecast uses the browser/device timezone by default. To prefer the visitor's IP timezone,
deploy `cloudflare/timezone-worker` separately and set its URL in `NEXT_PUBLIC_IP_TIMEZONE_ENDPOINT`.
For local development put the value in root `.env.local`; for GitHub Pages set the repository Actions
variable `IP_TIMEZONE_ENDPOINT`. `NEXT_PUBLIC_*` values are frozen into the static bundle at build time,
so changing the Worker URL requires a new Pages build. The Worker returns only
`{ "timezone": "Area/City" }`, contains no IP logging, and failures fall back to the device timezone.

The snapshot's central contract: **a failed collection never erases the last good data.** Each source
stores the result of the latest attempt (`status`, `errorType`, `lastAttemptAt`) alongside the last
values that were successfully collected (`data`, `dataTime`, `lastSuccessAt`). A source can therefore
show `UPDATE ERROR` while still displaying the readings it last managed to fetch, and the card names
all three times separately.

Three kinds of freshness are shown and never conflated:

| Question | Field | Example |
| --- | --- | --- |
| When did the scheduler last run? | snapshot `generatedAt` | 13:00 |
| How old is the source's own data? | source `dataTime` | 10:35 (IRCA `generated_at`) |
| When did we last collect it successfully? | source `lastSuccessAt` | 12:00 |

If the snapshot itself goes stale (older than 90 minutes) the dashboard shows a **SCHEDULED UPDATE
OVERDUE** banner at the top. That is the *scheduler's* freshness, not any source's.

```
src/
  app/          page (reads the snapshot file at build time), layout, dark stylesheet
  components/   Dashboard (client, reloads the snapshot), StatusCard
  config/       monitor ids and incident families, snapshot policy, request timeout,
                canonical source endpoints, ECMWF / IRCA / GitHub contracts
  health/       MonitorHealth model, MonitorErrorType, evaluateHealth, getSystemStatus
  lib/          fetch diagnostics, session event log, time-zone formatting, public path helpers
  monitors/     runAllMonitors and every live monitor (metno, noaa, imo, ecmwf, irca, github),
                incident correlation. No mock data path exists.
  snapshot/     schema, merge, build, atomic write, read
scripts/        snapshot.ts - the scheduled collection entry point
public/data/    latest-health.json - the snapshot the dashboard reads
.github/        deploy-pages.yml - builds and deploys on push to main
tests/          offline Node test-runner suites
```

## Time handling

All internal timestamps are ISO 8601. Freshness is judged from the data's own timestamp, never the
browser time zone. Every rendered time is formatted against an explicit zone: cards show Iceland time
and UTC side by side, and the header adds Taipei.

## Freshness and safety

Each source owns its freshness policy: MET Norway, NOAA Kp, solar wind and OVATION use age
thresholds in `src/config/sources.ts`; ECMWF uses the model-cycle publication schedule
(`src/config/ecmwf.ts`); IRCA uses a 45-minute STALE / 120-minute ERROR output-age policy
(`src/config/irca.ts`). IMO has no age policy at all — the broker lists what is active now, and
an absence of warnings has no timestamp to age against.

All of these are dashboard operational choices, not upstream guarantees.

The IRCA thresholds are deliberately **not** relaxed to match how often the publishing pipeline
actually delivers. They state the freshness Iceland road information needs. If the dashboard stays
red against them, that is the finding — the publishing architecture is not meeting the requirement.

## Network diagnostics

`src/lib/fetchWithDiagnosticsCore.ts` is an offline-testable core with an injectable fetch. It accepts a
`RequestInit`, owns its abort signal, forwards caller cancellation, and returns typed failures
(`NETWORK_ERROR`, `TIMEOUT`, `HTTP_ERROR`, `PARSE_ERROR`) with redacted URLs and no response bodies.
`src/lib/fetchWithDiagnostics.ts` is the server-only wrapper used in production. Monitors take an
injectable fetcher, so the whole test suite runs offline.

All of these happen during `npm run snapshot` only — never when someone opens the dashboard.
Every outbound request is a `GET` or `HEAD`, to the public GitHub Pages host or to
`api.github.com`, and nowhere else: the two manifests, two ECMWF frame probes, three IRCA dataset
probes, the three IRCA GeoJSON downloads only when the IRCA manifest has changed, and at most
every five minutes the GitHub Actions run listings. No credential, no `Authorization` header, no
write request, and no GitHub mutation endpoint — no dispatch, rerun, cancel or artifact download.
