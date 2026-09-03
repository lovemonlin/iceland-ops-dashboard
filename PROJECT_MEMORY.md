# Project Memory

No credential, API key, token, PAT or secret may ever be written in this file.

## Status (2026-09-03)

Phase one steps 1–5 are complete. **Four production monitors are live: ECMWF output (step 6),
IRCA output (step 7), and the IRCA and ECMWF GitHub Actions pipelines (steps 8 and 8.1).** The other five
sources are still mock data. Do not wire NOAA Kp, NOAA Solar Wind, NOAA OVATION, MET Norway or
IMO without explicit approval.

## Completed

- Independent Next.js 16 + TypeScript + App Router + ESLint project, own git repository.
- `MonitorHealth` / `MonitorErrorType` health and error models.
- `evaluateHealth` decides OK / INFO / STALE / DEGRADED / ERROR from one ordered rule set;
  every monitor, mock or live, goes through it.
- Dark, dense, responsive single-page dashboard with 60 s auto refresh, `Refresh now`,
  pause/resume, active incidents and a session event log.
- Server-only fetch wrapper plus an injectable, offline-testable diagnostics core.
- ECMWF cloud-forecast monitor reading live production data, read-only.
- IRCA road-data monitor reading live production data, read-only.
- GitHub Actions pipeline monitors for both publishers, anonymous and read-only.
- Incident correlation: a source and its pipeline are merged into one incident.

## Monitors

| Monitor | id | Source |
| --- | --- | --- |
| MET Norway Weather | `metno` | mock |
| IRCA Roads | `irca` | **live production (read-only)** |
| IRCA Road Publisher | `ircaPipeline` | **live GitHub Actions (read-only)** |
| NOAA Kp | `noaaKp` | mock |
| NOAA Solar Wind | `solarWind` | mock |
| NOAA OVATION | `ovation` | mock |
| ECMWF Cloud Forecast | `ecmwf` | **live production (read-only)** |
| ECMWF Cloud Publisher | `ecmwfPipeline` | **live GitHub Actions (read-only)** |
| IMO Warnings | `imo` | mock |

`MONITOR_IDS` in `src/config/monitors.ts` is the single list, and `LIVE_MONITOR_IDS` records which
have gone live. A monitor leaves `freshnessThresholds` when it goes live and gains its own freshness
policy file, so the mock thresholds and the production policies can never drift into each other.

## Safety boundary

Phase one is read only. Every outbound request is a `GET` or a `HEAD`, to `lovemonlin.github.io`
or `api.github.com` and nowhere else. A steady-state check issues eight to GitHub Pages (ECMWF
manifest `GET` + 2 frame `HEAD`s, IRCA manifest `GET` + 3 dataset `HEAD`s, plus the 3 IRCA GeoJSON
`GET`s only when the manifest changed) and, at most every 5 minutes, 2-4 to the GitHub REST API.
No `Authorization` header is ever sent and no GitHub mutation endpoint is ever called: no
dispatch, rerun, cancel, artifact download or repository write.
There is no credential, no write request, no repair action, no GitHub API call, no workflow
dispatch, no commit or push to any Iceland production repository, and no deployment automation.
Every monitor has a test asserting the shape of its requests: GET/HEAD only, correct host, and for
the pipeline monitor, no `Authorization` header.

## Production endpoints

- ECMWF manifest: `https://lovemonlin.github.io/iceland-aurora-cloud/manifest.json`
- ECMWF frames: `https://lovemonlin.github.io/iceland-aurora-cloud/tcc-<step>h.png`, step 00–48 by 3.
- IRCA manifest: `https://lovemonlin.github.io/iceland-aurora-cloud/road-manifest.json`
- IRCA datasets: `.../road-conditions.geojson`, `.../road-incidents.geojson`, `.../road-stations.geojson`
- GitHub Actions: `https://api.github.com/repos/lovemonlin/iceland-aurora-cloud/actions/...`

All are the public GitHub Pages output of `iceland-aurora-cloud`. The dashboard never touches
ECMWF Open Data, GRIB2, or IRCA (umferdin.is) itself.

## ECMWF manifest schema (verified read-only against production, 2026-09-03)

```
{
  "model":       "ECMWF IFS Open Data (0.25 degree)",
  "run_at":      "2026-09-02T12:00:00Z",
  "generated_at":"2026-09-02T23:22:12.417502Z",
  "source_url":  "https://www.ecmwf.int/en/forecasts/datasets/open-data",
  "attribution": "European Centre for Medium-Range Weather Forecasts (ECMWF), CC BY 4.0. ...",
  "frames": [ { "valid_at": "2026-09-02T12:00:00Z",
                "image_url": ".../tcc-00h.png" }, ... 17 entries ... ]
}
```

Observed live: 17 frames, steps 0–48 h every 3 h, first `valid_at` equal to `run_at`,
`content-type: application/json`, manifest latency ~130–450 ms.
Treated as required: `model`, `run_at`, `frames[].valid_at`, `frames[].image_url`.
Treated as informational: `generated_at`, `source_url`, `attribution`.
The manifest is **not** hardcoded anywhere; only the field names and the contract above are.

Note: `generated_at` can lag `run_at` by many hours (the observed 12Z run was generated at 23:22 UTC).
Never use `generated_at` for freshness — the schedule below is the only freshness authority.

## ECMWF run schedule and publication deadlines

Model cycles are 00 / 06 / 12 / 18 UTC. Our cloud workflow runs every 3 h at :20 UTC, and ECMWF
Open Data itself publishes with a delay, so a run is only *late* once its own deadline has passed.

| Cycle | Expected published by (UTC) |
| --- | --- |
| 00Z | 09:45 same day |
| 06Z | 15:45 same day |
| 12Z | 21:45 same day |
| 18Z | 03:45 **next** day |

These live in `ECMWF_PUBLICATION_DEADLINES` (`src/config/ecmwf.ts`) and nowhere else.
`expectedModelRun(now)` walks back from the current cycle and returns the newest run whose deadline
has passed; the `dayOffset: 1` on 18Z is what makes the UTC day boundary work.

**A simple age threshold is forbidden here.** At 09:30 UTC still being on the previous 18Z is
healthy; at 10:00 UTC without 00Z it is STALE. This is why `freshnessThresholds` has no `ecmwf` key
and `HealthInput` gained an explicit `stale` flag.

TODO: the deadlines are agreed operational values, not an ECMWF guarantee. Revisit if the cloud
workflow schedule changes.

## ECMWF validation

Transport (via the shared diagnostics core): HTTP status, latency, content type, JSON parse.

Schema, in order — first failure wins:
`model` present → `run_at` present → `run_at` parseable → `run_at` on a 00/06/12/18 UTC cycle →
`run_at` not in the future → `generated_at` parseable if present → `frames` is an array →
`frames` non-empty → each `valid_at` parseable and each `image_url` an absolute http(s) URL →
first frame equals `run_at` → every gap exactly 3 h → coverage exactly run +48 h → 17 frames.

The 17-frame count is checked **last**, on purpose: a manifest that fails sequence or coverage is
broken even when it happens to carry 17 entries, so `frames.length === 17` is never the health test.

## ECMWF image probe strategy

Only the **first and last** frame are probed, with `HEAD`, on every check. GitHub Pages answers HEAD
with the real status and `Content-Length` (verified: 200 with `content-length: 107195` for
`tcc-00h.png`, 404 for a missing file), so no image body is ever downloaded. Two probes per minute
instead of seventeen full-size PNGs.

Outcome: 2/2 available → fine; 1/2 → DEGRADED; 0/2 → ERROR (NETWORK_ERROR if both probes failed at
transport level, otherwise HTTP_ERROR).

## ECMWF status rules

| Status | Condition |
| --- | --- |
| OK | transport, schema, run cycle, frames and both sampled images healthy, and the run is the expected one |
| STALE | manifest healthy but the published run is older than the expected run (`STALE_DATA`) |
| DEGRADED | manifest and run healthy, exactly one sampled image unavailable (`HTTP_ERROR`) |
| ERROR | network / timeout / HTTP / parse / schema / invalid or future `run_at` / empty frames / bad sequence / both sampled images unavailable / latest `valid_at` already in the past |

The expired-coverage case reports status `error` with error type `STALE_DATA`: the forecast is
well-formed but no frame reaches the present, so nothing is usable. This is the one place where
`STALE_DATA` appears on an ERROR rather than a STALE.

## IRCA manifest schema (verified read-only against production, 2026-09-03)

```
{
  "schema_version": 2,
  "generated_at":        "2026-09-03T00:35:31.832760Z",
  "road_data_at":        "2026-09-03T00:35:19.3177126Z",
  "incident_data_at":    "2026-09-03T00:35:03.5945497Z",
  "measurement_data_at": "2026-09-03T00:35:30.054811Z",
  "road_count": 701, "incident_count": 41,
  "station_count": 203, "traffic_station_count": 107,
  "roads_url":     ".../road-conditions.geojson",
  "incidents_url": ".../road-incidents.geojson",
  "stations_url":  ".../road-stations.geojson",
  "attribution": "Based on information provided by the Icelandic Road and Coastal Administration (IRCA).",
  "source_url": "https://umferdin.is/en"
}
```

Required: `schema_version`, `generated_at`, the four counts, the three URLs.
Informational: the three per-source timestamps, `attribution`, `source_url`.
Freshness uses `generated_at` — the publish time.

The three datasets are plain `FeatureCollection`s served as `application/geo+json`:

| File | Geometry | Observed size | Observed features |
| --- | --- | --- | --- |
| road-conditions.geojson | MultiLineString | 1,307,471 B | 701 |
| road-incidents.geojson | Point | 19,699 B | 41 |
| road-stations.geojson | Point | 79,315 B | 203 |

Station features carry a boolean `properties.has_traffic`; the publisher computes
`traffic_station_count` as the number of true flags, so the dashboard derives and cross-checks it
the same way (107 observed, matching the manifest). If a schema change ever removes the flag, the
cross-check degrades to "not derivable" instead of reporting a false mismatch.

Dataset URLs come from the manifest, which is external data, so they are rejected unless they start
with the published base URL. The manifest is never hardcoded — only field names and the contract.

## IRCA publishing cadence and freshness policy

The cloud workflow republishes roughly **every 30 minutes**, and the publisher is
**all-or-nothing**: if IRCA is unreachable, returns malformed XML or returns no measurements, the
publish fails and the previous successful output stays online. HTTP 200 on these files therefore
proves nothing about the health of IRCA itself — only age, availability and count sanity do.

Dashboard operational policy, **not** an IRCA or pipeline SLA (`src/config/irca.ts`):

| Age of `generated_at` | Status |
| --- | --- |
| <= 45 min | OK |
| > 45 min and <= 120 min | STALE (`STALE_DATA`) |
| > 120 min | ERROR (`STALE_DATA`), message says the data is no longer a reliable live picture |

## IRCA sanity floors

`IRCA_SANITY_FLOORS`: roads >= 500, stations >= 100, traffic stations >= 50. Incidents have **no
floor** — zero incidents is a legitimate answer and must never be `EMPTY_DATA` on its own.

These are anomaly detectors derived from observed production scale (701 / 203 / 107), not IRCA
guarantees. They exist to catch a collapsed publish (701 to 0 roads, 203 to 0 stations). Messages
always name both numbers, e.g. `Expected at least 500 road features, received 82.`, and describe
only what is provable — never "IRCA is down", because the dashboard cannot yet tell IRCA upstream
from the converter, the workflow or GitHub Pages.

## IRCA consistency and caching strategy

Every check: `GET road-manifest.json` plus `HEAD` on all three datasets (availability, no bodies).

The three GeoJSON files are downloaded in full **only when the manifest identity changes** — key is
`schema_version | generated_at | the four counts`. Because the publisher is all-or-nothing, the
files cannot change without the manifest changing, so this is safe and keeps the 1.3 MB road file
off every 60-second check. The cache is server-process memory (`src/monitors/irca/datasets.ts`),
lost on restart, no database. Validation results are cached, including validation *failures*;
transport failures are never cached, so a network hiccup is retried on the next check.

On a full download the monitor checks: each file is a real `FeatureCollection` with a features
array; each manifest count equals the actual feature count (`Manifest reports 701 roads features,
but road-conditions.geojson contains 699.`); the derived traffic-station count equals
`traffic_station_count`; and every sanity floor holds.

## IRCA status rules

| Status | Condition |
| --- | --- |
| OK | manifest valid, age <= 45 min, 3/3 datasets available, valid GeoJSON, counts match, floors met (incidents may be 0) |
| STALE | everything readable and consistent, but age is 45-120 min |
| DEGRADED | exactly one **non-core** dataset (incidents or stations) unavailable, road data intact |
| ERROR | manifest unavailable / malformed / bad timestamp; road-conditions unavailable; 2 or more datasets unavailable; invalid GeoJSON; count mismatch; any sanity floor breached; age > 120 min |

Priority is deliberate: transport, core-dataset and emptiness failures all outrank age, so a real
outage is never hidden behind a STALE badge. Two tests pin that behaviour.

## GitHub Actions pipeline monitor

Two monitors, `ircaPipeline` and `ecmwfPipeline`, answer a question the output monitors cannot:
did the workflow run at all, did it fail, where did it fail, and how long has it been failing.

### Endpoints and request strategy

Anonymous, read-only, GET only. No token exists, so no `Authorization` header is ever sent.

```
GET https://api.github.com/repos/lovemonlin/iceland-aurora-cloud/actions/workflows/{file}/runs?per_page=10
GET https://api.github.com/repos/lovemonlin/iceland-aurora-cloud/actions/runs/{run_id}/jobs
```

Headers: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.

The jobs endpoint is requested **only when the latest run failed** — never for a successful run and
never for older runs. A steady check therefore costs 2 requests, or 3-4 while something is failing.

Workflow filenames were confirmed against the repository read-only, not guessed:

| Monitor | Workflow file | GitHub name |
| --- | --- | --- |
| `ircaPipeline` | `update-road-info.yml` | Update IRCA road information |
| `ecmwfPipeline` | `update-cloud-forecast.yml` | Update ECMWF cloud forecast |

### Rate limit and caching

Unauthenticated GitHub allows 60 requests/hour/IP while the dashboard refreshes every 60 seconds, so
GitHub is polled at most every **5 minutes** from a server-process memory cache
(`src/monitors/github/monitor.ts`). Inside that window `/api/health` serves the cached result and
issues no GitHub request at all.

`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` are parsed from every response
(via a generic `captureHeaders` option on the diagnostics core) and shown on the card as
`53 / 60 requests remaining`. When remaining drops to 10 or below the poll interval stretches to
10 minutes rather than burning the hourly budget.

### Scheduler metadata (step 8.1)

Answering "why is there no run?" needs more than the run list, so the monitor also reads, hourly:

```
GET /repos/{owner}/{repo}                                   -> default_branch
GET /repos/{owner}/{repo}/actions/workflows/{file}          -> state, path
GET /repos/{owner}/{repo}/contents/{path}?ref={branch}      -> the cron actually on that branch
GET https://www.githubstatus.com/api/v2/summary.json        -> platform context only
```

The workflow filename is used rather than the numeric id: GitHub accepts either, and the filename
survives a recreated workflow. The cron is extracted by walking the `on.schedule` block by
indentation — no YAML dependency, and a stray `cron` word elsewhere in the file cannot leak in.

Metadata is cached for **1 hour** (it changes perhaps monthly) so it costs ~5 requests/hour of the
60-request budget, leaving the run listings their 24/hour. The status page is a different service
and takes none of the GitHub API headers; it is **context only and never changes any status**.

### Run status rules

| Status | Condition |
| --- | --- |
| INFO | latest run is `queued` / `in_progress` — a run in flight is never a failure |
| OK | latest completed run concluded `success` and a run happened recently enough |
| STALE | no run when one was due (`WORKFLOW_NOT_RUN`) |
| ERROR | workflow state is not `active` (`WORKFLOW_DISABLED`); the workflow file is not on the default branch (`SCHEMA_ERROR`); the latest completed run concluded failure / timed_out / cancelled / action_required / startup_failure (`WORKFLOW_FAILED`); or GitHub could not be reached |

Three error types were added to the shared model: `WORKFLOW_FAILED`, `WORKFLOW_NOT_RUN` and
`WORKFLOW_DISABLED`. They are deliberately distinct — "the run failed", "the run never happened"
and "GitHub will not trigger this workflow at all" need completely different fixes. A workflow
whose file declares no schedule never reports `WORKFLOW_NOT_RUN`.

The card separates two things that must not be confused: **Configured schedule** (read from the
file, e.g. `*/5 * * * * (every 5 minutes)`) and **Alerting rule** (this dashboard's own threshold,
e.g. `alert if no run for 45 min`), plus **Last observed run age**. The cron is never presented as
an expected delivery interval.

The missing-run message states only what was verified — that the workflow is active, that its
schedule exists on the default branch, and that GitHub has not created a matching run. It never
says the GitHub scheduler is broken.

Cadence is per workflow. IRCA uses a plain age budget (45 min). ECMWF uses cron slots (:20 past
every third UTC hour, 45 min grace) so the question is "should a run have happened by now?" rather
than "is the last run old?". The ECMWF *pipeline* check is independent of the ECMWF *output* check:
a workflow can run on time and still fail to publish, and that must be visible.

### Failed job and step analysis

On a failed latest run the jobs endpoint is read and the first job with a failing conclusion, then
its first failing step, are reported. Verified against a real failure (run #854): job `publish`,
failed step `Download IRCA DATEX and generate app data`. Log ZIP download and log parsing are
deliberately out of scope for this step.

`consecutiveFailures` counts back from the newest completed run until the first success; runs still
in flight are skipped rather than breaking the streak.

### Correlation with the output monitors

`src/monitors/correlate.ts` merges each source with its pipeline into a single incident, so a stale
IRCA output plus a failing IRCA workflow is one entry, not two alarms. It distinguishes four cases
that a single monitor cannot tell apart:

1. **Workflow failed** - output age plus consecutive failure count plus the failed step.
2. **Workflow never ran** - "The workflow did not fail - it did not run. Check the schedule trigger."
3. **Workflow succeeded after the publish, output did not advance** - points at no-change publish
   logic, generated_at, commit behaviour and Pages deployment.
4. **GitHub could not be reached** - says explicitly that the workflow could not be verified and may
   be fine. A failed API call never becomes a claim that the workflow failed.

None of these conclude that an upstream service is down; they report only what the two checks prove.

### GitHub scheduling: documented behaviour vs observed history

GitHub documents that scheduled events can be delayed during periods of high Actions load, and
that queued scheduled jobs may be dropped. A cron expression is therefore a request, not a
delivery guarantee.

Separately — and this is an observation about this repository, not a statement about GitHub in
general — the production history contains substantial gaps between scheduled runs. A read-only
sample of the last 10 runs of each workflow on 2026-09-03 showed `update-road-info.yml` running
every 105-277 minutes (median 147) against a five-minute cron, and `update-cloud-forecast.yml`
every ~134-401 minutes against a three-hourly cron. Cron frequency must not be treated as an SLA.

**Threshold policy decision (2026-09-03): the IRCA output thresholds stay at 45 min STALE /
120 min ERROR and are NOT relaxed.** They express the operational freshness required for Iceland
road information, not the historical average of GitHub's scheduler. If that means the monitor is
red much of the time, the finding is that the current publishing architecture does not meet the
service requirement — which is exactly what the dashboard exists to show.

## Health rule order (do not reorder casually)

networkOk → httpStatus → parseOk → schemaOk → recordCount/allowEmpty → fatalError →
partialFailure → freshness (`stale` flag or age > `staleAfter`) → infoNote → ok.

Notes:
- `allowEmpty` exists so a legitimately empty dataset (IMO with zero active warnings) is not `EMPTY_DATA`.
- `infoNote` promotes an otherwise-OK monitor to `info`. INFO never changes the overall system status.
- `partialFailure` is checked before freshness, so a partly broken source reports DEGRADED rather than STALE.
- `stale` is a caller-determined flag for sources whose freshness is not an age (ECMWF), or
  whose age policy lives in its own config file (IRCA).
- `fatalError` carries a source-specific fatal condition the generic rules cannot express; it
  outranks partial failure and staleness but never a transport or schema failure.
- The stale branch also honours a caller `errorType`, which is how a missing workflow run reports
  `WORKFLOW_NOT_RUN` rather than a generic `STALE_DATA`.
- The schema branch honours a caller `errorType`, so ECMWF can report `INVALID_TIMESTAMP` or
  `EMPTY_DATA` instead of a blanket `SCHEMA_ERROR`.

## Freshness thresholds (mock monitors only)

`src/config/freshness.ts`, in seconds. **Conservative placeholders, not official guarantees.**
metno 7200 · noaaKp 21600 · solarWind 1800 · ovation 14400 · imo 10800.
ECMWF and IRCA have left this file; each owns its policy in `src/config/`.

The unused `warningAfter` placeholder was removed: no code read it and the status model has no
warning band. Do not reintroduce it without adding a real status for it.

TODO: confirm each production source's documented update cadence before enabling its monitor.

## Network diagnostics

`DEFAULT_REQUEST_TIMEOUT_MS` is 12 s in `src/config/network.ts`, overridable per request; ECMWF
image probes use 8 s. The core accepts `RequestInit`, forwards caller cancellation into its internal
`AbortController`, and always cleans up its timer and listener. Failures return a discriminated
result: `NETWORK_ERROR`, `TIMEOUT`, `HTTP_ERROR`, `PARSE_ERROR`. Diagnostics say whether an HTTP
response arrived and keep status and content type on post-response body-read failures. Response
bodies are never retained. Safe URLs redact `token`, `key`, `apikey` and `access_token`
case-insensitively and strip credentials and fragments.

Monitors take an injectable `DiagnosticFetcher`. Production passes the server-only
`fetchWithDiagnostics`; tests pass a stub, so the whole suite runs offline.

## Rendering

`/` and `/api/health` are both `force-dynamic`: checks run per request, never at build time.
The server component renders the first real snapshot; the client re-fetches `/api/health` every
60 s and on demand. If the dashboard's own request fails, the last snapshot stays on screen with a
banner rather than blanking the page.

## Time handling

Internal timestamps are ISO 8601. Freshness is judged from the data timestamp, never browser-local
time. Formatting always names an explicit time zone (`src/lib/time.ts`). Cards show Iceland + UTC;
the header adds Taipei.

## Known issues / open questions

- MET Norway production requires a compliant User-Agent with contact details. Not configured, and no
  private email may be hardcoded. Must be resolved before the MET monitor is wired.
- Old NOAA solar wind endpoints are known to be dead. Use only endpoints confirmed by current
  production documentation.
- If ECMWF is STALE, the dashboard says the cloud pipeline is behind — it cannot say *why*.
  Distinguishing "workflow failed" from "ECMWF Open Data was late" needs the GitHub Actions monitor,
  which is deliberately out of scope for this step.
- Step 8 narrowed this considerably: the pipeline monitor now separates "the workflow failed",
  "the workflow never ran", "the workflow succeeded but the output did not advance" and "GitHub
  could not be checked". What it still cannot do is name the cause *inside* a failed step — an
  IRCA HTTP 503, an empty measurement table, a rejected git push all look the same. That needs a
  Failed Run Log Inspector, deliberately out of scope for this step.
- The git working copy was created under a different Windows account; the current user needs
  `git config --global --add safe.directory C:/dev/iceland-ops-dashboard` (that one path only).

## Tests

`npm test` — 136 fully offline tests, no network access:

- health evaluator, including `stale`, `fatalError` and the schema error-type override
- ECMWF schedule: cycle detection, deadlines, month/year rollover, expected-run boundaries at
  09:30 / 09:45 / 10:00 and the 18Z → 03:45 next-day crossing — all against fixed clocks
- ECMWF monitor: the 15 required cases (expected run, in-window previous run, past-deadline previous
  run, UTC day crossing, malformed manifest, invalid `run_at`, future `run_at`, empty frames,
  17 valid frames, non-3 h sequence, expired latest `valid_at`, one image failing, both images
  failing, HTTP failure, parse failure) plus a request-shape test asserting GET/HEAD only
- IRCA monitor: the 25 required cases (valid data, zero incidents OK, zero roads / stations /
  traffic stations, each sanity floor breached, ages 44:59 / 45:01 / 119:59 / >120 against fixed
  clocks, malformed manifest, malformed GeoJSON, count mismatch, conditions 404, stations 404,
  incidents 404, two and three datasets down, manifest HTTP error, manifest parse error,
  download-only-on-manifest-change, cache reuse, read-only request shape), plus two priority
  tests proving a core outage is not hidden behind STALE
- GitHub pipeline monitor: 32 cases covering the step 8 and step 8.1 checks — success, failure, queued,
  in_progress, jobs fetched only for a failed run, failed job and step detection, failure streaks
  of 1 and 4, streak reset, missing scheduled run, GitHub 403 and 500 leaving the workflow
  unverified, rate-limit header parsing, low-budget cache extension, cache hit and expiry, cron
  slot boundaries, workflow active/disabled/metadata-unreadable, file missing from the default
  branch, cron parsed from each workflow file, no-schedule files never reporting a missing run,
  platform status present/unavailable/incident, metadata cached for an hour, and a request-shape
  test asserting GET-only, allowed hosts only and no Authorization header
- Incident correlation: 7 cases covering the four correlation outcomes, grouping a source with
  its pipeline into one incident, and severity ordering
- mock monitor cases, time and session-event helpers, network diagnostics

No test depends on the wall clock, and no test reaches production or the GitHub API.

## Next step

Do not proceed automatically. The remaining order is NOAA Kp → NOAA Solar Wind → NOAA OVATION →
MET Norway → IMO, one at a time, each with a normal case and an error case tested and this file
updated before the next one starts.

## Scheduler diagnosis (2026-09-03 03:19 UTC, step 8.1)

Read-only metadata for both workflows. **Everything on the repository side checks out; the runs
simply are not being created.**

| | IRCA | ECMWF |
| --- | --- | --- |
| Workflow id | 325350214 | 324527398 |
| Path | `.github/workflows/update-road-info.yml` | `.github/workflows/update-cloud-forecast.yml` |
| State | **active** | **active** |
| Created / updated | 2026-08-02T02:44:09Z | 2026-07-31T14:22:04Z |
| On default branch | yes | yes |
| Configured cron | `*/5 * * * *` (every 5 minutes) | `20 */3 * * *` (:20 past every 3 hours) |
| Latest run | #858, success, 2026-09-03T00:34:54Z | #235, success, 2026-09-02T23:21:30Z |
| Gap at check time | 164 min | 237 min |

Repository: `lovemonlin/iceland-aurora-cloud`, default branch **main**, public, not archived, not
disabled, `pushed_at` 2026-09-03T00:41:08Z (the commit from run #858).

GitHub platform status at the time of checking: All Systems Operational, Actions operational,
0 unresolved incidents. Recorded as context only — it is not evidence about this repository.

### IRCA cron history (read-only `git log` / `git blame`, plus the remote commit list)

The engineering note that "IRCA schedule changed from every 5 minutes to every 30 minutes" is
**not supported by this repository's history**:

- The cron line traces to `026ac775` (2026-08-02, "Add IRCA road information publisher"), the
  commit that created the file, with the value `*/5 * * * *`.
- Only three commits have ever touched the file (`026ac77`, `ff99150`, `89f98a7`) and the cron is
  `*/5 * * * *` in every one, confirmed against the authoritative remote commit list, not just the
  local checkout.
- `git log --all -S'*/30' -- .github/workflows/` returns nothing: no commit on any branch ever
  introduced a 30-minute cron.

So it was never changed to 30 minutes and never changed back. The "30 minute" figure used when the
IRCA output monitor was written has no basis in the repository; the declared schedule has always
been every 5 minutes. Nothing was modified to establish this.

## Production verification (2026-09-03 03:02 UTC, step 8)

Read-only GitHub API sample. **The IRCA incident is a missing scheduler, not a failing pipeline.**

IRCA workflow (`update-road-info.yml`, 858 runs total):

- Latest run **#858, conclusion success**, created 2026-09-03T00:34:54Z, updated 00:35:39Z.
- **No run at all since 00:34:54Z** — 147 minutes at the time of checking, and still climbing.
- Consecutive failures: **0**. The last failure was #854 at 2026-09-02T14:04Z, which failed in
  job `publish` at step `Download IRCA DATEX and generate app data`; #855-858 all succeeded.
- Run #858 finishing at 00:35:39Z matches the production `generated_at` of 00:35:31Z exactly, so
  the current stale output is precisely what run #858 published.

ECMWF workflow (`update-cloud-forecast.yml`, 235 runs total): latest **#235, success**, created
2026-09-02T23:21:30Z. Also past its expected slot, so the pipeline reads STALE while the ECMWF
*output* is still OK — the forecast it published is valid for another 48 hours.

Conclusion supported by the evidence: both scheduled workflows stopped being triggered after
00:34 (IRCA) and 23:21 (ECMWF). Nothing failed. Why GitHub stopped delivering the schedule is not
determinable from these endpoints.

## Production verification (2026-09-03 02:37 UTC, step 7)

ECMWF: OK. Run 2026-09-02 12Z (the expected run), 17/17 frames, coverage to 2026-09-04 12:00 UTC,
both sampled images 200, manifest latency ~130 ms.

IRCA: **ERROR / STALE_DATA** — a real finding, not a monitor bug. All three datasets returned 200,
schema valid, counts fully consistent (701 roads / 41 incidents / 203 stations / 107 traffic
stations, manifest and GeoJSON agreeing), file sizes 1,307,471 / 19,699 / 79,315 B, manifest
latency ~130-330 ms. But `generated_at` was 2026-09-03 00:35 UTC, making the output **122 minutes
old** against a 30-minute cadence, past the 120-minute limit. At least four scheduled publishes
did not reach production. Which layer failed is not determinable from the published output.
