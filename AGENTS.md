# Iceland Ops Dashboard agent notes

- This repository is independent and read-only in phase one.
- Do not modify Iceland Aurora Android, iOS, or Cloud repositories from this project.
- Do not add production fetches, credentials, write actions, or deployment automation until explicitly approved for the relevant next step.
- Keep monitor outcomes in the shared Health Model; HTTP 200 alone is never healthy.

## Two machines (permanent)

Canonical names from 2026-09-11. Do not say "execution machine" or 「執行機」 anymore.

| Name | Which computer | Role |
| --- | --- | --- |
| **開發電腦** | this checkout | edit, test, commit, push **code**. Never the production clock. |
| **推播電腦** | the other computer | hourly at :07: pull `main`, `npm run snapshot`, push only `public/data/latest-health.json`. |

- **Never run `npm run snapshot` on the 開發電腦.** Not for debug, not for "just once", not to refresh the dashboard. That command rewrites `public/data/latest-health.json`, which only the 推播電腦 may collect and push.
- **Do not re-register** Windows scheduled tasks on the 開發電腦. Collection belongs on the 推播電腦 only.
- If a snapshot on the 開發電腦 looks stale, `git pull --ff-only`. Do not regenerate it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
