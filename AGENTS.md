# Iceland Ops Dashboard agent notes

- This repository is independent and read-only in phase one.
- Do not modify Iceland Aurora Android, iOS, or Cloud repositories from this project.
- Do not add production fetches, credentials, write actions, or deployment automation until explicitly approved for the relevant next step.
- Keep monitor outcomes in the shared Health Model; HTTP 200 alone is never healthy.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
