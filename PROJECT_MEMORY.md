# Project Memory

## Completed (2026-09-03)

- Independent Next.js, TypeScript, App Router, and ESLint project initialised.
- Health and error models, seven mock monitor categories, and a responsive dark dashboard are complete.
- Mock data deliberately demonstrates `ok`, `info`, `stale`, `degraded`, and `error`.

## Monitor list

MET Norway Weather; NOAA Kp; NOAA Solar Wind; NOAA OVATION; IRCA Roads; ECMWF Cloud Forecast; IMO Warnings.

## Safety boundary

Phase one is read-only and contains no production endpoint, fetch wrapper, production API request, credential, production write action, or automatic repair.

## Freshness

Thresholds in `src/config/freshness.ts` are conservative placeholders, not official source guarantees. TODO: confirm each production source's documented update cadence before enabling a monitor.

## Schema notes

Mock validation intentionally treats HTTP 200 as insufficient: required fields, parse state, schema state, record count, and data age remain independently visible.

## Next step

Do not proceed automatically. Step 5 is to design shared network diagnostics, then integrate one approved production monitor at a time with normal and error-case checks.
