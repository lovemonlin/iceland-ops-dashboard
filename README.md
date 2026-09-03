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
- Notion, GitHub Pages production data, or GitHub Actions

Phase one is **READ ONLY**. There is no repair button, no rerun button, no retry of a production
action, no credential, and no deployment automation. If a future feature needs production write
access, stop and record it in `PROJECT_MEMORY.md` first.

Anything in `docs/reference/` is reference material only and does not apply to this project.
In particular, the Android project's Gradle, APK, emulator and Android Studio rules are irrelevant here.

## Data sources monitored

Phase one covers seven data sources plus the two GitHub Actions workflows that publish them.
ECMWF, IRCA and both pipelines are live; the rest are still mock.

| Section | Monitor | id | Data |
| --- | --- | --- | --- |
| Weather | MET Norway Weather | `metno` | mock |
| Roads | IRCA Roads | `irca` | **live, read-only** |
| Pipelines | IRCA Road Publisher | `ircaPipeline` | **live, read-only** |
| Pipelines | ECMWF Cloud Publisher | `ecmwfPipeline` | **live, read-only** |
| Aurora | NOAA Kp | `noaaKp` | mock |
| Aurora | NOAA Solar Wind | `solarWind` | mock |
| Aurora | NOAA OVATION | `ovation` | mock |
| Forecast / Warnings | ECMWF Cloud Forecast | `ecmwf` | **live, read-only** |
| Forecast / Warnings | IMO Warnings | `imo` | mock |

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
npm install
npm run snapshot   # collect production data once and write the snapshot
npm run dev        # serve the dashboard from that snapshot
npm run build      # static export into out/
```

`npm run snapshot` is the scheduled collection: it is the only thing that contacts production, and
it is meant to be invoked hourly by an external scheduler. There is deliberately no built-in cron.

In the browser, `Reload latest snapshot` re-reads the file, and the page does so on its own every
5 minutes. Neither re-checks production.

## Checks

```powershell
npm run lint
npm test
npm run build
```

## Architecture

```
Production public sources (ECMWF, IRCA, GitHub Actions, ...)
        |
        v
Hourly scheduled collection  --  npm run snapshot
        |
        v
public/data/latest-health.json  --  the snapshot
        |
        v
GitHub commit + push to main
        |
        v
GitHub Pages deployment (build on push, never on a schedule)
        |
        v
Iceland Ops Dashboard  --  https://lovemonlin.github.io/iceland-ops-dashboard/
```

**Browser refresh and production data collection are different things.** Opening or reloading the
dashboard reads one static JSON file and contacts no production API. Production data is collected
only when the scheduled task runs. The dashboard does not need to be open for that to happen, and
having it open does not make it happen more often.

The scheduled collection is only ever allowed to change one file: `public/data/latest-health.json`.
It must not touch source code, `package.json`, the workflow, configuration or this README. Pushing
that one file to `main` is what publishes new data: the Pages workflow rebuilds and redeploys.

`npm run snapshot` is a local development, manual validation and recovery tool. It is not something
that has to run on anyone's Windows machine for the site to stay up.

### Deployment

The site is a Next.js **static export** (`output: "export"`), served by GitHub Pages from
`out/`. GitHub Pages project sites live under `/<repository>/`, so the Pages build sets
`NEXT_PUBLIC_BASE_PATH=/iceland-ops-dashboard`; locally the variable is unset and everything is
served from `/`. Every path is built through `getPublicAssetPath()` / `getSnapshotUrl()` in
`src/lib/publicPath.ts` — the base path is never written out by hand in a component.

`public/.nojekyll` stops GitHub Pages from discarding the `_next/` directory. The snapshot request
is cache-busted with a timestamp so a redeployed snapshot is never hidden behind a cached copy; the
rest of the site stays ordinary cacheable static content.

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
  config/       monitor ids and incident families, snapshot policy, mock freshness thresholds,
                request timeout, ECMWF / IRCA / GitHub contracts
  health/       MonitorHealth model, MonitorErrorType, evaluateHealth, getSystemStatus
  lib/          fetch diagnostics, session event log, time-zone formatting, public path helpers
  monitors/     runAllMonitors, live ECMWF / IRCA / pipeline monitors, incident correlation,
                mock monitors, validation helpers
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

Mock thresholds live in `src/config/freshness.ts` and are **conservative placeholders, not
official source guarantees**. `TODO: confirm each production source's documented update cadence
before enabling a live monitor.`

A monitor leaves that file when it goes live and gains its own policy: ECMWF uses the model-cycle
publication schedule (`src/config/ecmwf.ts`), IRCA uses a 45-minute STALE / 120-minute ERROR
output-age policy (`src/config/irca.ts`). Both policies are dashboard operational choices, not
upstream guarantees.

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
