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

Phase one covers seven sources. All of them are currently **mock data** — no production endpoint is wired up.

| Section | Monitor | id |
| --- | --- | --- |
| Weather | MET Norway Weather | `metno` |
| Roads | IRCA Roads | `irca` |
| Aurora | NOAA Kp | `noaaKp` |
| Aurora | NOAA Solar Wind | `solarWind` |
| Aurora | NOAA OVATION | `ovation` |
| Forecast / Warnings | ECMWF Cloud Forecast | `ecmwf` |
| Forecast / Warnings | IMO Warnings | `imo` |

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

The dashboard renders a deterministic mock snapshot on the server, then switches to the real clock
after mount and re-checks every 60 seconds. `Refresh now` and `Pause auto refresh` are in the header.

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
  config/       freshness thresholds, request timeout
  health/       MonitorHealth model, MonitorErrorType, evaluateHealth, getSystemStatus
  lib/          fetch diagnostics, session event log, time-zone formatting
  monitors/     mock monitors, per-source validation helpers
tests/          offline Node test-runner suites
```

Every monitor status — mock or, later, production — is produced by `evaluateHealth`, so one set of
rules decides OK / INFO / STALE / DEGRADED / ERROR for every source.

## Time handling

All internal timestamps are ISO 8601. Freshness is judged from the data's own timestamp, never the
browser time zone. Every rendered time is formatted against an explicit zone: cards show Iceland time
and UTC side by side, and the header adds Taipei.

## Freshness and safety

Thresholds live in `src/config/freshness.ts` and are **conservative placeholders, not official source
guarantees**. `TODO: confirm each production source's documented update cadence before enabling a live monitor.`
`warningAfter` is reserved for a future warning band; only `staleAfter` affects status today.

## Network diagnostics

`src/lib/fetchWithDiagnosticsCore.ts` is an offline-testable core with an injectable fetch. It accepts a
`RequestInit`, owns its abort signal, forwards caller cancellation, and returns typed failures
(`NETWORK_ERROR`, `TIMEOUT`, `HTTP_ERROR`, `PARSE_ERROR`) with redacted URLs and no response bodies.
`src/lib/fetchWithDiagnostics.ts` is the server-only wrapper. **No production URL is wired to either.**
