# Project Memory

No credential, API key, token, PAT or secret may ever be written in this file.

## Status (2026-09-03)

Phase one steps 1–5 are complete. **Two production monitors are live: ECMWF (step 6) and IRCA
(step 7).** The other five sources are still mock data. Do not wire NOAA Kp, NOAA Solar Wind,
NOAA OVATION, MET Norway or IMO without explicit approval.

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

## Monitors

| Monitor | id | Source |
| --- | --- | --- |
| MET Norway Weather | `metno` | mock |
| IRCA Roads | `irca` | **live production (read-only)** |
| NOAA Kp | `noaaKp` | mock |
| NOAA Solar Wind | `solarWind` | mock |
| NOAA OVATION | `ovation` | mock |
| ECMWF Cloud Forecast | `ecmwf` | **live production (read-only)** |
| IMO Warnings | `imo` | mock |

`MONITOR_IDS` in `src/config/monitors.ts` is the single list, and `LIVE_MONITOR_IDS` records which
have gone live. A monitor leaves `freshnessThresholds` when it goes live and gains its own freshness
policy file, so the mock thresholds and the production policies can never drift into each other.

## Safety boundary

Phase one is read only. Every outbound request goes to `lovemonlin.github.io` and is a `GET` or a
`HEAD`. A steady-state check issues eight: ECMWF manifest `GET` + 2 frame `HEAD`s, IRCA manifest
`GET` + 3 dataset `HEAD`s, plus the 3 IRCA GeoJSON `GET`s only when the manifest changed.
There is no credential, no write request, no repair action, no GitHub API call, no workflow
dispatch, no commit or push to any Iceland production repository, and no deployment automation.
Both monitors have a test asserting every request they make is a GET or HEAD against the public base URL.

## Production endpoints

- ECMWF manifest: `https://lovemonlin.github.io/iceland-aurora-cloud/manifest.json`
- ECMWF frames: `https://lovemonlin.github.io/iceland-aurora-cloud/tcc-<step>h.png`, step 00–48 by 3.
- IRCA manifest: `https://lovemonlin.github.io/iceland-aurora-cloud/road-manifest.json`
- IRCA datasets: `.../road-conditions.geojson`, `.../road-incidents.geojson`, `.../road-stations.geojson`

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
- The same limit applies to IRCA, and matters more because of all-or-nothing publishing: when
  IRCA data is stale the dashboard can prove the output is old, but **cannot tell whether the
  failure is IRCA upstream, the XML converter, the GitHub Actions workflow, or GitHub Pages**.
  All four look identical from the published output. Resolving it needs the Actions monitor.
- The git working copy was created under a different Windows account; the current user needs
  `git config --global --add safe.directory C:/dev/iceland-ops-dashboard` (that one path only).

## Tests

`npm test` — 97 fully offline tests, no network access:

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
- mock monitor cases, time and session-event helpers, network diagnostics

No test depends on the wall clock, and no test reaches production.

## Next step

Do not proceed automatically. The remaining order is NOAA Kp → NOAA Solar Wind → NOAA OVATION →
MET Norway → IMO, one at a time, each with a normal case and an error case tested and this file
updated before the next one starts.

## Production verification (2026-09-03 02:37 UTC)

ECMWF: OK. Run 2026-09-02 12Z (the expected run), 17/17 frames, coverage to 2026-09-04 12:00 UTC,
both sampled images 200, manifest latency ~130 ms.

IRCA: **ERROR / STALE_DATA** — a real finding, not a monitor bug. All three datasets returned 200,
schema valid, counts fully consistent (701 roads / 41 incidents / 203 stations / 107 traffic
stations, manifest and GeoJSON agreeing), file sizes 1,307,471 / 19,699 / 79,315 B, manifest
latency ~130-330 ms. But `generated_at` was 2026-09-03 00:35 UTC, making the output **122 minutes
old** against a 30-minute cadence, past the 120-minute limit. At least four scheduled publishes
did not reach production. Which layer failed is not determinable from the published output.
