# Project Memory

No credential, API key, token, PAT or secret may ever be written in this file.

## Status (2026-09-03)

Phase one steps 1–5 are complete. **Step 6 has started: ECMWF is the first — and so far only —
production monitor.** The other six sources are still mock data. Do not wire IRCA, NOAA Kp,
NOAA Solar Wind, NOAA OVATION, MET Norway or IMO without explicit approval.

## Completed

- Independent Next.js 16 + TypeScript + App Router + ESLint project, own git repository.
- `MonitorHealth` / `MonitorErrorType` health and error models.
- `evaluateHealth` decides OK / INFO / STALE / DEGRADED / ERROR from one ordered rule set;
  every monitor, mock or live, goes through it.
- Dark, dense, responsive single-page dashboard with 60 s auto refresh, `Refresh now`,
  pause/resume, active incidents and a session event log.
- Server-only fetch wrapper plus an injectable, offline-testable diagnostics core.
- ECMWF cloud-forecast monitor reading live production data, read-only.

## Monitors

| Monitor | id | Source |
| --- | --- | --- |
| MET Norway Weather | `metno` | mock |
| IRCA Roads | `irca` | mock |
| NOAA Kp | `noaaKp` | mock |
| NOAA Solar Wind | `solarWind` | mock |
| NOAA OVATION | `ovation` | mock |
| ECMWF Cloud Forecast | `ecmwf` | **live production (read-only)** |
| IMO Warnings | `imo` | mock |

`MONITOR_IDS` in `src/config/monitors.ts` is the single list. Age-based monitors must also have a
`freshnessThresholds` entry; ECMWF is excluded from that record on purpose (see below).

## Safety boundary

Phase one is read only. The dashboard issues exactly three outbound requests per check, all to
`lovemonlin.github.io`: one `GET` for the ECMWF manifest and two `HEAD` probes for sampled frames.
There is no credential, no write request, no repair action, no GitHub API call, no workflow
dispatch, no commit or push to any Iceland production repository, and no deployment automation.
A test asserts that every request the ECMWF monitor makes is a GET or HEAD against the public base URL.

## Production endpoints

- ECMWF manifest: `https://lovemonlin.github.io/iceland-aurora-cloud/manifest.json`
- ECMWF frames: `https://lovemonlin.github.io/iceland-aurora-cloud/tcc-<step>h.png`, step 00–48 by 3.

Both are the public GitHub Pages output of `iceland-aurora-cloud`. The dashboard never touches
ECMWF Open Data or GRIB2 itself.

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

## Health rule order (do not reorder casually)

networkOk → httpStatus → parseOk → schemaOk → recordCount/allowEmpty → fatalError →
partialFailure → freshness (`stale` flag or age > `staleAfter`) → infoNote → ok.

Notes:
- `allowEmpty` exists so a legitimately empty dataset (IMO with zero active warnings) is not `EMPTY_DATA`.
- `infoNote` promotes an otherwise-OK monitor to `info`. INFO never changes the overall system status.
- `partialFailure` is checked before freshness, so a partly broken source reports DEGRADED rather than STALE.
- `stale` is a caller-determined flag for sources whose freshness is not an age (ECMWF).
- `fatalError` carries a source-specific fatal condition the generic rules cannot express; it
  outranks partial failure and staleness but never a transport or schema failure.
- The schema branch honours a caller `errorType`, so ECMWF can report `INVALID_TIMESTAMP` or
  `EMPTY_DATA` instead of a blanket `SCHEMA_ERROR`.

## Freshness thresholds (age-based monitors only)

`src/config/freshness.ts`, in seconds. **Conservative placeholders, not official guarantees.**
metno 7200 · noaaKp 21600 · solarWind 1800 · ovation 14400 · irca 10800 · imo 10800.

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
- The git working copy was created under a different Windows account; the current user needs
  `git config --global --add safe.directory C:/dev/iceland-ops-dashboard` (that one path only).

## Tests

`npm test` — 71 fully offline tests, no network access:

- health evaluator, including `stale`, `fatalError` and the schema error-type override
- ECMWF schedule: cycle detection, deadlines, month/year rollover, expected-run boundaries at
  09:30 / 09:45 / 10:00 and the 18Z → 03:45 next-day crossing — all against fixed clocks
- ECMWF monitor: the 15 required cases (expected run, in-window previous run, past-deadline previous
  run, UTC day crossing, malformed manifest, invalid `run_at`, future `run_at`, empty frames,
  17 valid frames, non-3 h sequence, expired latest `valid_at`, one image failing, both images
  failing, HTTP failure, parse failure) plus a request-shape test asserting GET/HEAD only
- mock monitor cases, time and session-event helpers, network diagnostics

No test depends on the wall clock.

## Next step

Do not proceed automatically. The remaining order is IRCA → NOAA Kp → NOAA Solar Wind →
NOAA OVATION → MET Norway → IMO, one at a time, each with a normal case and an error case tested
and this file updated before the next one starts.
