# Project Memory

No credential, API key, token, PAT or secret may ever be written in this file.

## Status (2026-09-03)

Phase one steps 1–5 are complete. Steps 1–4 (project, health model, mock monitors, dashboard layout)
and step 5 (network diagnostics core) are done and verified. **No production monitor is connected.**
Step 6 (wiring one real source at a time) has not started and must not start without explicit approval.

## Completed

- Independent Next.js 16 + TypeScript + App Router + ESLint project, own git repository.
- `MonitorHealth` / `MonitorErrorType` health and error models.
- `evaluateHealth` decides OK / INFO / STALE / DEGRADED / ERROR from one ordered rule set.
  Every mock monitor's status is *derived* by it, never hand-written, so the mock exercises
  the same code path a production monitor will.
- Seven mock monitors covering all five display statuses.
- Dark, dense, responsive single-page dashboard: header with live clock, system summary,
  Weather / Roads / Aurora / Forecast-Warnings sections, active incidents, session event log.
- 60-second auto refresh, working `Refresh now`, and a pause/resume toggle.
- Session-only event log (`src/lib/events.ts`), capped at 40 entries. No database, no persistence.
- Server-only fetch wrapper plus an injectable, offline-testable diagnostics core.

## Monitors

MET Norway Weather (`metno`); IRCA Roads (`irca`); NOAA Kp (`noaaKp`); NOAA Solar Wind (`solarWind`);
NOAA OVATION (`ovation`); ECMWF Cloud Forecast (`ecmwf`); IMO Warnings (`imo`).

Monitor ids deliberately match the keys of `freshnessThresholds`, so a monitor cannot exist without a
declared freshness threshold.

## Safety boundary

Phase one is read only. No production URL, request, credential, write action, automatic repair,
GitHub Actions trigger, Notion write, backend service or deployment automation exists.
The public fetch wrapper is server-only; Node tests import only the pure core.

## Production endpoints

None recorded — nothing is connected yet. Record each endpoint here only when it is approved
and wired, together with its observed schema and cadence.

## Health rule order (do not reorder casually)

networkOk → httpStatus → parseOk → schemaOk → recordCount/allowEmpty → partialFailure → freshness → infoNote → ok.

Notes:
- `allowEmpty` exists so a legitimately empty dataset (IMO with zero active warnings) is not `EMPTY_DATA`.
- `infoNote` promotes an otherwise-OK monitor to `info`. INFO never changes the overall system status.
- `partialFailure` is checked before freshness, so a partly broken source reports DEGRADED rather than STALE.

## Schema notes

HTTP 200 is explicitly insufficient. Parse state, schema state, record count and data age stay
independently visible on every card, so a "200 but wrong" source cannot look healthy.

## Freshness thresholds

`src/config/freshness.ts`, in seconds. **Conservative placeholders, not official guarantees.**

| Monitor | warningAfter | staleAfter |
| --- | --- | --- |
| metno | 3600 | 7200 |
| noaaKp | 10800 | 21600 |
| solarWind | 900 | 1800 |
| ovation | 7200 | 14400 |
| irca | 3600 | 10800 |
| ecmwf | 32400 | 54000 |
| imo | 3600 | 10800 |

TODO: confirm each production source's documented update cadence before enabling its monitor.
TODO: `warningAfter` is currently unused — decide whether a warning band belongs in the status model.

## Network diagnostics

`DEFAULT_REQUEST_TIMEOUT_MS` is 12 s in `src/config/network.ts`, overridable per request. The core
accepts `RequestInit`, forwards caller cancellation into its internal `AbortController`, and always
cleans up its timer and listener. Failures return a discriminated result: `NETWORK_ERROR`, `TIMEOUT`,
`HTTP_ERROR`, `PARSE_ERROR`. Diagnostics say whether an HTTP response arrived and keep status and
content type on post-response body-read failures. Response bodies are never retained.
Safe URLs redact `token`, `key`, `apikey` and `access_token` case-insensitively and strip credentials
and fragments.

## Time handling

Internal timestamps are ISO 8601. Freshness is judged from the data timestamp, never browser-local time.
Formatting always names an explicit time zone (`src/lib/time.ts`), which also keeps server render and
client hydration identical. Cards show Iceland + UTC; the header adds Taipei.

Hydration detail: the page server-renders from `MOCK_BASELINE_CHECKED_AT`, then the client re-seeds
from the real clock on mount. Do not replace this with a bare `new Date()` in render.

## Known issues / open questions

- MET Norway production requires a compliant User-Agent with contact details. Not configured, and no
  private email may be hardcoded. Must be resolved before the MET monitor is wired.
- Old NOAA solar wind endpoints are known to be dead. Use only endpoints confirmed by current
  production documentation.
- The git working copy was created under a different Windows account, so `git` reports
  "dubious ownership" for the current user until the directory is added to `safe.directory`.

## Tests

47 fully offline tests (`npm test`), no network access:
health evaluator, mock monitor cases, time and session-event helpers, ECMWF / IRCA / MET / NOAA
validation helpers, and 13 network-diagnostics cases. Rerun the whole suite after any integration.

## Next step

Do not proceed automatically. Step 6 wires exactly one explicitly approved production monitor
(order: ECMWF → IRCA → NOAA Kp → NOAA Solar Wind → NOAA OVATION → MET Norway → IMO), with a normal
case and an error case tested, and this file updated, before the next one is started.
