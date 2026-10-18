# Iceland Ops Dashboard agent notes

- This repository is independent. Its monitors and collector read upstream production sources without modifying them.
- Do not modify Iceland Aurora Android, iOS, or Cloud repositories from this project.
- Do not add production fetches, credentials, write actions, or deployment automation beyond the approved snapshot and Pages workflows without explicit approval.
- Keep monitor outcomes in the shared Health Model; HTTP 200 alone is never healthy.

## 正式工作與 production 架構

`C:\dev\iceland-ops-dashboard` 是唯一正式本機 working copy，`GitHub main` 是 source of truth。
Windows 本機是 development environment，不是 production clock：一般開發可 edit、test、commit、push
程式碼；若 snapshot 看起來過期，執行 `git pull --ff-only`，不要自行重新收集。

```text
Windows 11 local working copy
        ↓
git commit / push
        ↓
GitHub main

Cloudflare Worker
        ↓
workflow_dispatch
        ↓
GitHub Actions
        ↓
npm run snapshot
        ↓
public/data/latest-health.json
        ↓
GitHub Pages
```

- **一般本機開發不得執行 `npm run snapshot`。** 它會改寫 `public/data/latest-health.json`；正式收集由
  外部 Cloudflare Worker 觸發的 GitHub Actions 執行。
- 本 repo 沒有內建 production cron；Windows Task Scheduler 不是正式 hourly collection path。
- 不得寫入 secrets 或 credentials。

## Ship code immediately

禎禎：功能改完（含該做的驗證）後**立刻 `commit` 並 `push`**，不必再問。有錯再從頭修。不要停在「還沒 commit」。不要跑 `npm run snapshot`。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
