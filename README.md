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

**A note on GitHub scheduling.** A sample of the last 10 runs of each workflow showed IRCA running
every 105-277 minutes despite declaring a five-minute cron, and ECMWF every ~134-401 minutes against
a three-hourly cron. GitHub drops most scheduled triggers on free public repositories, so a cron is
an upper bound, never a promise — which is worth knowing before tuning any freshness threshold in
this repository.

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

```powershell
npm install
npm run dev
```

The server renders the first real snapshot; the browser re-checks `/api/health` every 60 seconds.
`Refresh now` and `Pause auto refresh` are in the header. Both `/` and `/api/health` are dynamic, so
no check ever runs at build time.

## Checks

```powershell
npm run lint
npm test
npm run build
```

## Architecture

```
src/
  app/          Next.js App Router page, layout, dark stylesheet
  components/   Dashboard (client, holds refresh + session event log), StatusCard
  app/api/      /api/health route: runs every monitor, returns a snapshot
  config/       monitor ids and incident families, mock freshness thresholds, request timeout,
                ECMWF / IRCA / GitHub contracts
  health/       MonitorHealth model, MonitorErrorType, evaluateHealth, getSystemStatus
  lib/          fetch diagnostics, session event log, time-zone formatting
  monitors/     runAllMonitors, live ECMWF / IRCA / pipeline monitors, incident correlation,
                mock monitors, validation helpers
tests/          offline Node test-runner suites
```

Every monitor status — mock or, later, production — is produced by `evaluateHealth`, so one set of
rules decides OK / INFO / STALE / DEGRADED / ERROR for every source.

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

## Network diagnostics

`src/lib/fetchWithDiagnosticsCore.ts` is an offline-testable core with an injectable fetch. It accepts a
`RequestInit`, owns its abort signal, forwards caller cancellation, and returns typed failures
(`NETWORK_ERROR`, `TIMEOUT`, `HTTP_ERROR`, `PARSE_ERROR`) with redacted URLs and no response bodies.
`src/lib/fetchWithDiagnostics.ts` is the server-only wrapper used in production. Monitors take an
injectable fetcher, so the whole test suite runs offline.

Every outbound request is a `GET` or `HEAD`, to the public GitHub Pages host or to
`api.github.com`, and nowhere else: the two manifests, two ECMWF frame probes, three IRCA dataset
probes, the three IRCA GeoJSON downloads only when the IRCA manifest has changed, and at most
every five minutes the GitHub Actions run listings. No credential, no `Authorization` header, no
write request, and no GitHub mutation endpoint — no dispatch, rerun, cancel or artifact download.
