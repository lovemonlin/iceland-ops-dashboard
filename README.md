# Iceland Ops Dashboard

Read-only monitoring dashboard for data sources used by Iceland travel tooling. This is not a traveller-facing app.

## Repository boundary

This independent repository must not directly modify Android, iOS, or Cloud production repositories. Phase one uses no production endpoint, fetch, or network diagnostic.

## Current monitors

Mock data represents MET Norway Weather, NOAA Kp, NOAA Solar Wind, NOAA OVATION, IRCA Roads, ECMWF Cloud Forecast, and IMO Warnings.

## Statuses

- `OK`: network, parsing, schema, required data, and freshness are healthy.
- `INFO`: healthy state worth noting, such as zero active IMO warnings.
- `STALE`: readable data is older than its configured threshold.
- `DEGRADED`: partial monitor failure.
- `ERROR`: network, HTTP, parse, schema, empty-data, or timestamp failure.

## Run

```powershell
npm install
npm run dev
```

## Checks

```powershell
npm run lint
npm test
npm run build
```

## Freshness and safety

Conservative placeholder thresholds are centralised in `src/config/freshness.ts`; confirm against each production source's documented cadence before Step 5+. No credentials, production write operation, repair action, or deployment automation is implemented.
