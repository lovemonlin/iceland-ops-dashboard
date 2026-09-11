# Project Memory

No credential, API key, token, PAT or secret may ever be written in this file.

## 這份文件怎麼讀

本檔混合了三種壽命不同的內容，分不清它們是過去出錯的主因：

| 區段 | 性質 | 維護方式 |
| --- | --- | --- |
| 現況速覽 | 描述「現在」 | 每次改動都必須重寫 |
| 不可違反的約束 | 極少變動 | 要改必須先取得使用者同意 |
| 決策紀錄、歷史紀錄 | 描述「當時」 | append-only，只增不改，一律標日期 |

**凡是程式碼已經表達的事實，這裡只放指標，不放副本。** monitor 清單、freshness 門檻、
測試數量、目前 HEAD 都曾經因為被複製進文件而過期。本檔與程式碼衝突時以程式碼為準，
並順手修正本檔。

## 現況速覽（最後校對 2026-09-11）

### 每個事實的唯一真相在哪裡

| 想知道 | 去看 |
| --- | --- |
| monitor 清單與 id | `MONITOR_IDS`（`src/config/monitors.ts`） |
| 極光評分公式 | `src/lib/auroraVisibility.ts`，全專案唯一一份 |
| 各來源 freshness 政策 | `src/config/sources.ts`、`ecmwf.ts`、`irca.ts` |
| snapshot 結構與 merge 契約 | `src/snapshot/types.ts` |
| 測試數量與範圍 | `npm.cmd test` 的實際輸出 |
| 目前 HEAD | `git log`。本檔不把 commit hash 當成現況記錄 |

### 執行拓撲：兩台機器

```text
本機（開發）                  GitHub main                執行電腦（收集）
debug / 改功能  ──push──▶                  ◀──pull --ff-only──  每小時 :07
                                                            npm run snapshot
                            ◀────────push──  只 commit 一個檔案
                            │
                            └──▶ Pages 重新部署（npm ci → npm test → build）
```

- **開發機（這台）**只負責改程式、測試、把程式 commit／push 到 GitHub。本機曾註冊過三個
  Windows 排程工作，已於 2026-09-11 **解除註冊**，不要再 `Register-ScheduledTask`。
  `logs/hourly-snapshot.log` 最後一筆是 2026-09-06 02:07 +08:00，只是歷史殘渣。
- **永遠不要在開發機執行 `npm run snapshot`。** 沒有例外。那條指令會改寫
  `public/data/latest-health.json`。收集與把 snapshot **push 回 GitHub** 只屬於執行機。
  開發機上的 snapshot 過期時，用 `git pull --ff-only` 取回執行機已發布的那份，不要自己重收。
- **執行電腦**是唯一的 production 時鐘，每小時 :07 執行 `scripts/hourly-snapshot.ps1`，
  並 push 那一個 snapshot 檔。
- push 到 `main` 有兩個消費者。GitHub Pages 立即重建，而且 `npm test` 不過就不會部署；
  執行電腦則在下一次 :07 pull 之後直接採用新程式碼，**沒有任何測試把關**。推送前的本機
  驗證是執行電腦唯一的防線。
- 動到 dependency 的 push 會在執行電腦上自行安裝：每小時的 pull 若移動了 `package.json` 或
  `package-lock.json`，runner 會先跑 `npm ci` 才收集；否則不跑，所以 npm registry 不會出現在
  每一次收集的路徑上。安裝失敗會中止該次收集、保留前一份 snapshot，並在下一次重試。

### 目前狀態

- 十個 monitor 全部讀真實 production 資料。**runtime 沒有任何 mock 路徑**：
  `src/monitors/mockMonitors.ts` 與 `src/config/freshness.ts` 已經刪除，不是停用。
- Snapshot schema v2，`trigger` 記為 `windows`。
- 48 小時極光預測與極光快報 v1 都已完成並在線上。
- IP timezone Worker **已在正式站運作**（不是未部署）。GitHub repository variable
  `IP_TIMEZONE_ENDPOINT` 指向 `https://iceland-ops-dashboard-timezone.iceland-ops.workers.dev`。
  2026-09-11 在正式站核對：雲層預報與極光預測都顯示「當地時間」，不是「裝置時間」；
  Worker 回傳 `Asia/Taipei`，與冰島時間差 8 小時。
- Android parity 測試本機讀 `../iceland-aurora`；CI 要可選的 `ANDROID_REPO_TOKEN` 才能
  讀取 private 的 `lovemonlin/iceland-aurora`。沒有這個 secret 時測試 skip，Pages 仍會發布。

## 不可違反的約束

1. Browser 只能讀 snapshot，不得直接呼叫 NOAA、MET Norway、OVATION、Solar Wind。唯一核准的
   例外是 IP timezone Cloudflare Worker。
2. 極光評分公式只有 `src/lib/auroraVisibility.ts` 一份。任何極光 UI 都從
   `buildAuroraForecast48()` 或 `assessAuroraVisibility()` 產出的 assessment 顯示，不得自行計算。
3. 未來時段不得採用 current Bz 或 current OVATION。Bt / Bz / 太陽風在快報中只能標示為
   目前即時太空天氣。
4. HTTP 200 永遠不等於健康。
5. 本 repo 不得寫入 `iceland-aurora`、`iceland-aurora-ios`、`iceland-aurora-cloud`。
6. 排程收集只允許改動 `public/data/latest-health.json` 這一個檔案。
7. **開發機永遠不得執行 `npm run snapshot`。** 收集與 snapshot 的 push 只由執行機做。開發機
   只 push 程式；snapshot 過期就 `git pull --ff-only`，不要自己重收。
8. 未經使用者明確要求，不得 `git reset`、`git restore`、force push，不得修改 production
   scheduler 或 snapshot schema，不得自行 commit 或 push。
9. 不得修改 repo 的 NTFS ownership 或 ACL。

# 決策紀錄（append-only，新的在上）

## 2026-09-11：正式站 Worker 已是當地時間；Android parity 準備進 CI

在正式站核對 Cloudflare IP timezone Worker：已部署、Pages 已注入 endpoint，UI 顯示
「當地時間」而非「裝置時間」。MET `Expires` 與 ECMWF 期限仍不動（優化，不是 bug）。

Android 顏色／地點／樣式對齊被視為重心。parity 測試改由 `ANDROID_REPO` 指向 checkout；
Pages workflow 可選讀取 `secrets.ANDROID_REPO_TOKEN` 做 read-only checkout。沒有 token
時測試 skip、部署不失敗。snapshot doorbell 不加這個 secret。

## 2026-09-11：天氣取值共用 `hourAt`，預設最多 59 分鐘

48 小時預測與天氣地圖沿用 Android `SiteForecast.at` 的 nearest-hour，但加上 59 分鐘上限：
整點對整點時，差不到一小時仍對得上；超出 MET 覆蓋滿一小時後，不再沿用最後一筆雲況去評後面
的小時。缺天氣時 `assessAuroraVisibility` 仍走原有預設遮蔽 50%。

極光快報的 18:00–02:00 是構造出來的整點，改呼叫同一個 `hourAt(..., 0)`，維持精確對時，
不再自寫 `weatherAt`。缺該整點就顯示「—」，不向鄰居借，與 forecast codec 契約一致。

## 2026-09-11：開發機永遠不跑 `npm run snapshot`

使用者確認這台 checkout 是開發機，不是 production 時鐘。原則沒有例外：

- 開發機：改程式、測試、push **程式**到 GitHub。
- 執行機：每小時 pull 後跑 `npm run snapshot`，並且是**唯一**把
  `public/data/latest-health.json` push 回 GitHub 的機器。
- 開發機上的 snapshot 以 GitHub 上執行機已發布的那份為準。過期就 pull，不要重收。
- 本機那三個 Windows 排程工作已解除註冊，不得再註冊。

寫進 `AGENTS.md` 與本檔「不可違反的約束」，避免下一個 agent 為了 debug 或「更新畫面」
而在這台跑收集。

## 2026-09-11：hourly runner 在 pull 帶進 dependency 變更時自行安裝

**問題。** 兩台機器的架構下，執行電腦每小時 `git pull --ff-only` 後直接跑 `npm run snapshot`，
中間沒有任何安裝步驟。只要開發機推了一個動到 `package.json` / `package-lock.json` 的 commit，
執行電腦就會拿新程式碼配舊的 `node_modules`，此後每小時都失敗，直到有人登入那台手動安裝。
失敗本身是安全的（保留前一份 snapshot），但它只會以 SCHEDULED UPDATE OVERDUE 的形式浮現，
很難反推真正原因。

**為什麼不無條件每小時 `npm ci`。** 那會把 npm registry 放進每一次收集的關鍵路徑，等於用一個
每小時的新失敗點去換一個罕見的失敗點，常見情況反而更糟。

**做法。** 記住 pull 前的 HEAD，pull 後用 `git diff --name-only` 檢查這個區間是否動到那兩個
檔案；有才安裝。安裝用 `npm ci --no-audit --no-fund`——這是無人值守的工作，audit 是另一次可以
獨立失敗的網路呼叫，而且它的輸出對安裝結果沒有任何意義。

**為什麼需要 marker。** 上述判斷問的是「這次 pull 帶進了什麼」，不是「這台機器現在是什麼狀態」。
少了 marker，一次失敗的安裝（例如 registry 暫時性故障）要等到下一個碰巧動到 dependency 的
commit 才會再試。所以安裝前先寫 `.runtime/install-required`，成功才刪除；它存在就代表要重試。

**其他。** 同一輪順手修掉腳本裡一句過期註解——它說 GitHub 備援排程「still enabled as a backup」，
但那個 cron 在 2026-09-04 就移除了。45 分鐘的跳過門檻保留，理由改成正確的那個：手動執行與
補跑。對應的測試名稱也從「the two schedulers」改為「two collections」。

**測試。** `scripts/test-hourly-snapshot.ps1` 新增三個案例（帶進 dependency 變更會安裝、
一般 pull 不安裝、失敗過的安裝會重試），並在 harness 產生的 `.gitignore` 補上 `node_modules/`，
否則安裝產生的目錄會誤觸「只有 snapshot 可以變動」的守則。`tests/hourly-runner.test.ts`
新增對應斷言。

**生效時機。** Task Scheduler 是從磁碟啟動腳本，而 pull 發生在腳本內部，所以推送後的第一次
:07 拉到新腳本但執行的仍是舊的，**要到第二次才真正生效**。

## 2026-09-10：極光快報 v1（`540e4fb`）

在 48 小時預測之上加了一個「🌌 極光快報」Dialog，回答「今晚到底要不要出門」。

- 觀測窗**固定**以 `Atlantic/Reykjavik` 的當地今天計算，18:00 到次日 02:00，共 9 個整點。
  起算日只取冰島日期，與瀏覽器所在時區無關。冰島全年 UTC+0 沒有日光節約時間，所以
  `getIcelandTonightWindow()` 直接用 `Date.UTC(y, m, d, 18)`——這是刻意的，不要「修正」
  成一般的本地時間換算，測試已釘住跨月與跨年邊界。
- 每個整點對 snapshot 裡全部 32 個地點各評一次，取最高分者為該小時最佳。
- Kp 來自 `noaaKpForecast`，經 `kpAt()` 取用；找不到涵蓋區間時 fallback 到目前即時 Kp。
- **未來值不吃即時太空天氣**：`buildAuroraBriefing()` 呼叫 `assessAuroraVisibility()` 時只傳
  `time`、`site`、`weather`、`kp`，完全不傳 `ovationProbability` 或 `bzGsm`。目前的
  Kp / Bt / Bz / 太陽風 / OVATION 只存在 `briefing.current`，UI 與複製摘要都明寫那是即時值。
- 雲層熱圖按七個區域平均 `effectiveObstruction()`；某小時該區沒有任何站點資料時保持
  `undefined` 並顯示「—」，不以鄰近值填補。
- 逐時「最佳地點」在分數低於 5 或該時段為白晝時隱藏，避免推薦一個看不到極光的地點。
- 提供純文字摘要複製，結尾固定附註 Bt / Bz / 太陽風為即時值。

主要檔案：`src/lib/auroraBriefing.ts`（領域邏輯）、`src/components/AuroraBriefingDialog.tsx`
（UI）、`src/components/AuroraForecast.tsx`（入口按鈕）、`src/lib/auroraForecastPresentation.ts`
（標籤與地點）、`src/app/globals.css`（`.aurora-briefing-*`）。

**測試把架構釘死成字串比對，改這些檔案前先看測試**（`tests/aurora-briefing.test.ts`、
`tests/aurora-briefing-ui.test.ts`）：

- `auroraBriefing.ts` 全檔不得出現 `ovationProbability` 或 `bzGsm`，連註解都不行。
- `auroraBriefing.ts` 與 Dialog 都不得出現 `fetch(`、`XMLHttpRequest`、`WebSocket`、
  `EventSource` 或任何 `http(s)://`。
- `auroraBriefing.ts` 不得出現寫死的地點清單；地點一律來自 `auroraForecastSites(snapshot)`。
- `AuroraForecast.tsx` 必須逐字保留 `buildAuroraForecast48(snapshot, site, baseTime)`。
- `globals.css` 必須含 `1180px`、`92dvh`、`repeat(10`。
- 有一條測試會讀真實的 `public/data/latest-health.json` 並斷言站點數為 32。這代表執行電腦
  每小時更新的檔案是測試輸入之一；看到它失敗先確認 snapshot，不要改測試。

## 2026-09-10：雙時區與未來 48 小時極光預測

這一輪已完成並推送到 `main`。功能 commit 依序為：

| Commit | 內容 |
| --- | --- |
| `4644c81` | 雲層預報加入 IP 當地時間／裝置 fallback 與固定冰島時間；加入 Cloudflare Worker 原始碼及設定 |
| `897e95a` | Snapshot schema v2、`noaaKpForecast`、32 個地點光害分類，以及 Android AuroraVisibility 48 小時計算移植 |
| `f5c6688` | `noaaKpForecast` 納入極光卡片的四來源 health、最舊資料時間與技術來源清單 |
| `2d2d9df` | 新增「極光預測」第三模式、32 地點選擇、48 小時時間軸與逐時詳細資料 |
| `64e0779` | 新增「ⓘ 分數怎麼算？」accessible Dialog 與完整計算說明 |

### 最終使用者可看到的結果

- 雲層預報的選取時間與「目前預報時間」都顯示兩個時區：
  - IP timezone 成功時顯示「當地時間」，顏色 `#59A9FF`。
  - IP 查詢失敗時沿用同一位置顯示「裝置時間」，取瀏覽器／作業系統 timezone。
  - 「冰島時間」固定使用 IANA `Atlantic/Reykjavik`，顏色 `#FF9F43`。
  - ECMWF「模式時次 ...Z」仍維持 UTC / Zulu，沒有變更。
- 極光卡片有三個模式，順序是「儀表板」、「極光機率位置圖」、「極光預測」；預設仍是「儀表板」。
- 「極光預測」直接使用 snapshot 裡 32 個 MET site，預設 Reykjavík；下拉選單以中文名稱為主並附英文名稱。
- 每個地點顯示從目前時間開始的 0～47 小時，共 48 筆逐時 assessment。時間軸可橫向捲動，
  每小時直條高度是 score、顏色是 level，時間軸標示的是冰島時間。
- 點擊、hover 或 keyboard focus 某小時會顯示雙時區、score、level、Kp、aurora strength、
  effective obstruction、darkness、moon、site factor、光害與繁中 limiting factor。
- 白晝／不夠暗／黑夜直接讀每小時 assessment 的 `sunElevation` 與 `darknessFactor`；第二晚也逐時計算，
  沒有使用 Android 舊的 24 小時 `DarknessWindow`。
- 「ⓘ 分數怎麼算？」以原生 `<dialog>.showModal()` 開啟。Dialog 支援 Escape、背景點擊、
  右上與底部關閉鈕，開啟後聚焦關閉鈕，長內容在 Dialog 內捲動，手機版最高 `92dvh`。
- Dialog 明確說明分數是「極光可見條件綜合評分」，不是看到極光的機率百分比；內容包括五因子公式、
  Bz 加成、Kp 換算、三層雲 transmission、太陽高度、月光、地磁位置、光害係數、level 門檻及計算示例。

### 資料與計算架構

仍維持：

```text
production source → scheduled snapshot → Dashboard browser
```

- Browser 不直接連 NOAA、MET Norway、OVATION 或 Solar Wind；極光預測只讀既有 snapshot。
- 唯一允許的 browser 外部 request 是既有 IP timezone Cloudflare Worker。
- Worker 只回傳 `request.cf.timezone` 的 `{ "timezone": ... }`，不回傳 IP、城市或座標，
  使用 `Cache-Control: no-store`，正式 CORS 只允許 `https://lovemonlin.github.io`。
- Worker URL 集中由 `NEXT_PUBLIC_IP_TIMEZONE_ENDPOINT` 設定，不硬寫在元件中；sessionStorage、shared promise、
  timeout、IANA timezone 驗證與 device fallback 都在 `src/lib/ipTimezone.ts`。
- 本輪只加入 Worker 原始碼與設定，沒有實際部署 Cloudflare Worker。若正式 Pages 沒有設定 endpoint，
  UI 會安全 fallback 成「裝置時間」。

### Snapshot 與 AuroraVisibility

- Snapshot schema 是 v2，新增獨立 source `noaaKpForecast`，資料來自 NOAA 3-day planetary K-index forecast。
- Forecast point 保存 `time`、`kp`、`status`（observed / estimated / predicted / unknown）與 `noaaScale`；
  不自行推導未來 Kp。
- Snapshot merge contract 未變：最新收集結果更新 status/error/lastAttemptAt；失敗時保留最後成功的
  data/dataTime/lastSuccessAt。
- MET snapshot 的 32 個 site 都帶 Android 正式定義的 `DARK` / `MODERATE` / `BRIGHT` light pollution。
- 48 小時純函式入口是：

```ts
buildAuroraForecast48(snapshot, site, baseTime)
```

- 第 0 小時使用目前 OVATION，並只在這一小時套用目前 Bz 南向加成。
- 第 1～47 小時使用 NOAA Kp Forecast；找不到涵蓋 interval 時依 Android 行為 fallback 到目前即時 Kp。
- 不外推未來 Bz、Bt、solar wind 或 OVATION。
- Score 公式保持 Android 移植版本：

```text
極光強度 × 雲層因子 × 黑暗因子 × 月光因子 × 地點因子
```

- 雲層使用低／中／高雲 transmission 權重 1.0 / 0.7 / 0.35；黑暗使用逐時太陽高度；
  月光使用月相、是否在地平線上及月亮高度；地點使用修正地磁緯度及 light pollution。
- `src/lib/auroraVisibility.ts` 是唯一評分核心。UI 沒有複製或修改評分公式；Dialog 的 level 名稱與顏色
  直接呼叫既有 `levelOf()`。
- 最終 level：0～4 看不到 `#64748B`、5～19 不佳 `#FB923C`、20～39 普通 `#FDE047`、
  40～64 良好 `#86EFAC`、65～100 極佳 `#4ADE80`。

### 本輪關鍵檔案

- 時區：`cloudflare/timezone-worker/src/index.ts`、`cloudflare/timezone-worker/wrangler.toml`、
  `src/config/ipTimezone.ts`、`src/lib/ipTimezone.ts`、`src/components/CloudForecastMap.tsx`。
- Snapshot / collector：`src/snapshot/types.ts`、`src/config/snapshot.ts`、`src/config/sources.ts`、
  `src/config/monitors.ts`、`src/monitors/noaa/monitor.ts`、`src/monitors/metno/monitor.ts`。
- 計算核心：`src/lib/auroraVisibility.ts`。
- 48 小時 UI：`src/components/AuroraModes.tsx`、`src/components/AuroraForecast.tsx`、
  `src/lib/auroraForecastPresentation.ts`、`src/components/SourceSections.tsx`、`src/components/Dashboard.tsx`。
- 分數說明：`src/components/AuroraScoreExplanationDialog.tsx`、`src/app/globals.css`。
- 主要測試：`tests/ip-timezone.test.ts`、`tests/aurora-visibility.test.ts`、
  `tests/aurora-forecast-ui.test.ts`、`tests/aurora-score-dialog.test.ts`、`tests/deployment.test.ts`。

### 最終驗證

在 commit `64e0779` 推送前的最終結果：

- `npm.cmd test`：402 / 402 通過。
- `npm.cmd run lint`：通過。
- `npx.cmd tsc --noEmit`：通過。
- `npm.cmd run build`：通過，Next.js static export 成功。
- `git diff --check`：通過。
- 沒有新增 dependency，沒有修改 Android App、snapshot scheduler 或 upstream API 架構。

### 這一輪留下的待辦

若要讓正式環境顯示 IP 當地時間，下一個外部操作是部署 `cloudflare/timezone-worker`，並把 Worker
URL 設為 GitHub repository variable `IP_TIMEZONE_ENDPOINT`。這一輪只加入原始碼與設定，沒有實際
部署；未設定時 UI 會安全 fallback 成「裝置時間」。

原本列在這裡的「不要另寫評分公式」「browser 不得直連上游」已移到開頭的「不可違反的約束」，
避免同一條規則存在兩份可能漂移的副本。

# 歷史紀錄（append-only，描述當時，不再更新）

## Status (2026-09-03)

當時 dashboard 剛改用 **scheduled snapshot 架構**（step 9）並發布到 GitHub Pages（step 10）；
其中五個來源仍是 mock，接上真實 production 資料是 step 11 的工作。

> 那項工作已在 2026-09-04 完成，mock 路徑整個刪除。現況請看開頭的「現況速覽」。

## Completed

- Independent Next.js 16 + TypeScript + App Router + ESLint project, own git repository.
- `MonitorHealth` / `MonitorErrorType` health and error models.
- `evaluateHealth` decides OK / INFO / STALE / DEGRADED / ERROR from one ordered rule set;
  every monitor, mock or live, goes through it.
- Dark, dense, responsive single-page dashboard reading a scheduled snapshot, with a 5-minute
  snapshot reload, an overdue-scheduler banner, active incidents and a session change log.
- Scheduled snapshot pipeline: `npm run snapshot` collects, merges and atomically writes
  `public/data/latest-health.json`; a failed collection preserves the last good data.
- Server-only fetch wrapper plus an injectable, offline-testable diagnostics core.
- ECMWF cloud-forecast monitor reading live production data, read-only.
- IRCA road-data monitor reading live production data, read-only.
- GitHub Actions pipeline monitors for both publishers, anonymous and read-only.
- Incident correlation: a source and its pipeline are merged into one incident.

## Monitors

monitor 清單的唯一真相是 `src/config/monitors.ts` 的 `MONITOR_IDS`，README 另有一份附來源說明的
完整表格。這裡刻意不再放第三份副本——原本那份表格漏掉了 `noaaKpForecast`，正是複製造成的漂移。

`LIVE_MONITOR_IDS` 目前等於 `MONITOR_IDS`：每一個 monitor 都已接上真實 production 資料，
各自的 freshness 政策放在 `src/config/` 底下對應的檔案。

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

## Hourly update automation (2026-09-04)

> **這一節描述的 GitHub 排程已經不存在。** 該 cron 在 2026-09-04 稍後就從
> `.github/workflows/update-dashboard-snapshot.yml` 移除了（理由見下方「The remaining GitHub
> triggers」與 README）。現在的 production 時鐘是執行電腦上的 Windows Task Scheduler，
> 見開頭的「現況速覽」。以下保留當時的決策脈絡。

當時的設計是 **GitHub Actions 每小時排程**，`cron: "0 * * * *"`（UTC），
即每小時整點，換算台北時間是 08:00、09:00、10:00……

```
GitHub schedule (hourly)  →  Update Dashboard Snapshot  →  npm run snapshot
                          →  commits public/data/latest-health.json  →  calls the Pages deploy
```

`automation/hourly-trigger.txt` is **kept** as a manual, external and emergency trigger: writing to
it starts the same collection. Anything using it must write nothing but a timestamp, and must never
touch source code, `package.json`, workflows, configuration or the snapshot itself.

### Why this replaced the AI scheduler (2026-09-04 decision)

The ChatGPT GitHub integration has read access only in this environment, so it cannot reliably write
the trigger file. A GitHub schedule needs no credential and no machine of the user's to be switched on.

**Known trade-off, accepted deliberately:** GitHub documents scheduled events as best-effort, and
step 8.1 measured this account's other repository delivering a three-hourly cron every 134-401
minutes. An hourly cron may therefore slip. That is precisely what the SCHEDULED UPDATE OVERDUE
banner exists to show, so the 60-minute target and 90-minute threshold stay as they are. GitHub also
disables scheduled workflows in public repositories after 60 days without repository activity — a
snapshot commit every hour counts as activity, so this should not arise while the schedule works.

### Trigger provenance

The snapshot carries an optional `trigger` field (`schedule`, `workflow_dispatch`, `push`, or
`local` for `npm run snapshot` on a workstation), set from `github.event_name` via the
`SNAPSHOT_TRIGGER` environment variable. The header shows it. No other schema change was needed.

### Workflows

| File | Trigger | Permissions |
| --- | --- | --- |
| `.github/workflows/update-dashboard-snapshot.yml` | hourly `schedule`, push to `automation/hourly-trigger.txt`, `workflow_dispatch` | `contents: write` on the collecting job; `contents: read` + `pages: write` + `id-token: write` on the deploy call |
| `.github/workflows/deploy-pages.yml` | push to `main` (ignoring the trigger file), `workflow_dispatch`, `workflow_call` | `contents: read`, `pages: write`, `id-token: write` |

Built-in `GITHUB_TOKEN` only. No PAT, no secret, nothing stored.

### Why the deploy is called explicitly

A push made with `GITHUB_TOKEN` deliberately does not start another workflow run. The snapshot commit
would therefore land in the repository and never deploy. Rather than reach for a PAT, the Pages
workflow gained `workflow_call` and the collecting workflow invokes it directly. Both jobs check out
`github.event.repository.default_branch` rather than the triggering SHA, so the deploy builds the
snapshot that was just committed instead of the state before it.

### Recursion prevention

Three independent layers, the first of which is structural:

1. The workflow is triggered by `automation/hourly-trigger.txt` and writes
   `public/data/latest-health.json`. Different paths, so its own commit cannot re-trigger it.
2. A guard step lists the working tree and fails the run if anything other than the snapshot changed.
   `git add` names exactly one path; a blanket `git add .` is never used.
3. GitHub does not start workflows from `GITHUB_TOKEN` pushes anyway.

Adding the schedule does not weaken any of this: a scheduled run writes the same single file and
is not triggered by any file at all.

Verified in production: a trigger push produced exactly one workflow run, and the bot's snapshot
commit produced none.

### Verified end to end (2026-09-04 02:14 UTC)

Trigger commit `114e9b3` changed only the trigger file. One run started; it collected all nine
monitors, validated the result ("Snapshot valid: 9 entries"), confirmed "Changed files:
public/data/latest-health.json", committed `2920334 Update production snapshot`, and deployed.
The public snapshot advanced from `2026-09-04T02:05:59Z` to `2026-09-04T02:18:33Z`. No further run
was created.

### A test that broke the build, and why

The first end-to-end attempt failed the deploy: a test asserted the trigger file's *initial* wording,
which the scheduler is supposed to overwrite every hour. It was asserting exactly the thing the
design requires to change. The test now checks that the file stays small and never carries collected
data, and says nothing about its wording.

## All sources productionized (2026-09-04)

Every monitor now reads a real production endpoint. **The mock data path was deleted**, not disabled:
`src/monitors/mockMonitors.ts` and `src/config/freshness.ts` are gone, `runAllMonitors()` imports
nothing mock-shaped, and a test asserts the runtime carries no mock reference and that every
published snapshot entry declares `provenance.mode === "production"`.

### Canonical endpoints, read out of the Android app

All of these were taken from `C:\dev\iceland-aurora` (read-only) so the dashboard watches exactly
what the app uses, not a convenient substitute. They live in `src/config/sources.ts`.

| Source | Endpoint |
| --- | --- |
| MET Norway | `https://api.met.no/weatherapi/locationforecast/2.0/complete` |
| NOAA Kp | `https://services.swpc.noaa.gov/json/planetary_k_index_1m.json` |
| Solar wind (field) | `https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json` |
| Solar wind (speed) | `https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json` |
| OVATION | `https://services.swpc.noaa.gov/json/ovation_aurora_latest.json` |
| IMO warnings | `https://api.vedur.is/cap/capbroker/active/detailed/all` (header `x-vi-api-version: 2026-04-14`) |

The app's 32 curated aurora sites were extracted verbatim from `IcelandAuroraSites.kt` — same ids,
same coordinates. MET Norway forbids bulk point-fetching to build grids; a fixed curated list is what
the app was designed around, so this stays in step with it. Requests are made six at a time.

The app's own warning stands: the widely-copied `/products/solar-wind/mag-1-day.json` style paths now
404. They must never come back; a test asserts their absence.

### MET Norway User-Agent

MET's terms require a User-Agent that identifies the caller and offers a way to reach them. The app
builds one from `BuildConfig.CONTACT_EMAIL`. **That private email is deliberately not copied here** —
this repository is public. The default identifies the project by its public repository URL, and
`METNO_USER_AGENT` overrides it if a contact address is ever preferred.

### MET Norway freshness recalibrated (2026-09-04)

`meta.updated_at` is the model **issue** time, not when the response was refreshed. Measured at
04:30 UTC it ran 183-184 minutes behind on Reykjavik, Akureyri, Vik and Isafjordur simultaneously,
while `Last-Modified` was 15 minutes old and the first timeseries entry was the current hour. The
3-hour threshold set in step 11 therefore reported STALE on perfectly current data. Raised to
8 hours, with a regression test pinning that a ~3-hour lag stays OK.

TODO: MET's `Expires` header (~30 min) is the authoritative "ask again" signal and would be a
sharper freshness check than ageing `updated_at`.

### Two real bugs the production run exposed

1. **IMO answers `204 No Content`** when nothing is active. Reading the body as JSON reported
   PARSE_ERROR for what is a perfectly healthy "no warnings". It is now read as text and parsed the
   way the app does, treating an empty body, `""` and `[]` alike as zero warnings.
2. **MET Norway aggregate carried no HTTP status**, so the shared evaluator saw `undefined` and
   reported HTTP_ERROR even when every location answered. It now carries the status of a location
   that actually replied.

### Authenticity

The snapshot file was **deleted and recollected from scratch** so that no value collected during the
mock era could survive through the merge's failure-preservation rule. Everything now in
`public/data/latest-health.json` was fetched from a real endpoint.

## Deployment decision (2026-09-03): published on GitHub Pages

The dashboard has its own repository and public URL:

- Repository: `https://github.com/lovemonlin/iceland-ops-dashboard` (public, default branch `main`)
- Site: `https://lovemonlin.github.io/iceland-ops-dashboard/`
- Snapshot: `https://lovemonlin.github.io/iceland-ops-dashboard/data/latest-health.json`

This is the **only** repository this project may write to. `iceland-aurora`, `iceland-aurora-ios`
and `iceland-aurora-cloud` stay strictly read-only.

Because the dashboard no longer collects on page load, it is a Next.js static export
(`output: "export"`) with `trailingSlash: true`, deployed by `.github/workflows/deploy-pages.yml`
on **push to main only** — never on a schedule, so the unreliable scheduled-trigger behaviour found
in step 8.1 does not apply to it. Workflow permissions are the Pages minimum
(`contents: read`, `pages: write`, `id-token: write`); no token or secret is used.

GitHub Pages serves project sites from `/<repository>/`, so the Pages build sets
`NEXT_PUBLIC_BASE_PATH=/iceland-ops-dashboard` and every URL is produced by
`getPublicAssetPath()` / `getSnapshotUrl()` in `src/lib/publicPath.ts`. Local development leaves the
variable unset and serves from `/`. `public/.nojekyll` keeps Pages from discarding `_next/`.
Only the snapshot request is cache-busted (`?t=<timestamp>`); the rest of the site stays cacheable.

### The one file the hourly collection may change

`public/data/latest-health.json`, and nothing else. Committing and pushing it to `main` triggers the
Pages rebuild, which is the entire publish path. The scheduled collection must never modify source
code, `package.json`, the workflow, configuration or documentation.

## Architecture decision (2026-09-03): scheduled snapshot, not live-on-page

The dashboard architecture was changed from live-on-page monitoring to scheduled snapshot
monitoring, at the user's direction.

User requirement:

- AI collects production data once per hour.
- Dashboard remains available at any time.
- Opening the dashboard must not be required to trigger updates.
- Dashboard shows the latest successful data plus the latest update status.
- Failed collection attempts must preserve the last successful data.

What this changed in practice:

- `/api/health`, which ran every monitor on request, was **deleted**. The page now reads
  `public/data/latest-health.json` from disk and performs no network request at all.
- `npm run snapshot` (`scripts/snapshot.ts`) is the only entry point that contacts production.
- The browser reload button re-reads the snapshot file; it no longer re-checks production.
- All existing monitors were kept unchanged in behaviour and became the snapshot's data sources.
- `MonitorHealth` gained an explicit `data` payload. Its presence *is* the definition of "this
  collection succeeded", which is what lets a failed attempt keep the previous values.

### Snapshot contract

`status`, `errorType`, `errorMessage` and `diagnostics` describe the **latest attempt**.
`data`, `dataTime` and `lastSuccessAt` describe the **last attempt that actually collected**.
A failed attempt updates the former and preserves the latter. A source that has never succeeded
simply has no `data`. A successful attempt clears any error the previous one left behind.

Pipelines are stored under `pipelines`, sources under `sources`; a source the round did not report
is carried forward untouched rather than dropped.

The writer is atomic (temp file then rename, temp removed on failure), so a crash mid-write leaves
the previous good snapshot rather than an unparseable file. The reader refuses to overwrite a
snapshot it cannot parse, so a human sees the problem before history is lost.

### Three freshness clocks, deliberately separate

1. **Snapshot freshness** — when the scheduler last ran (`generatedAt`). Over 90 minutes shows a
   top-level SCHEDULED UPDATE OVERDUE banner. This is the scheduler's problem, not a source's.
2. **Source freshness** — the data's own timestamp (IRCA `generated_at`, ECMWF model run).
3. **Collection freshness** — when we last successfully fetched that source (`lastSuccessAt`).

### Not done on purpose（2026-09-03 當時）

當時沒有 database、沒有 history 目錄，只有 `latest-health.json`，也還沒有 GitHub 寫入路徑。
NOAA、MET Norway、IMO 當時仍是 mock，隔天（2026-09-04）全部產品化。EUMETSAT 至今仍未納入監控。

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

## Freshness thresholds（`src/config/freshness.ts` 已刪除）

這個檔案在 2026-09-04 全面產品化時，連同 mock 路徑一起刪除了。每個來源現在各自持有 freshness
政策：`src/config/sources.ts`（MET Norway、NOAA Kp、solar wind、OVATION）、`src/config/ecmwf.ts`
（model-cycle 發布時程，不是年齡門檻）、`src/config/irca.ts`（45 分 STALE / 120 分 ERROR）。
IMO 沒有年齡政策——broker 列出的是「現在有效」的警報，沒有可比對的時間。

當時一併移除了未使用的 `warningAfter` placeholder：沒有程式讀它，狀態模型也沒有 warning 級別。
不要在沒有對應狀態的情況下加回來。

這些全部是 dashboard 的營運選擇，不是上游的保證。

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

`/` is `force-dynamic` so each request re-reads the snapshot file and a freshly written snapshot
appears immediately. There is no API route. The client re-reads `/data/latest-health.json` every
5 minutes and on demand; if that read fails, the last snapshot stays on screen with a banner
rather than blanking the page. Measured page load after the change: ~50 ms, against seconds when
the page collected live.

## Time handling

Internal timestamps are ISO 8601. Freshness is judged from the data timestamp, never browser-local
time. Formatting always names an explicit time zone (`src/lib/time.ts`). Cards show Iceland + UTC;
the header adds Taipei.

## Known issues / open questions

- Old NOAA solar wind endpoints (`/products/solar-wind/...`) are dead and must never be used; the
  monitors use the summary products the app uses, and a test guards against a regression.
- If ECMWF is STALE, the dashboard says the cloud pipeline is behind — it cannot say *why*.
  Distinguishing "workflow failed" from "ECMWF Open Data was late" needs the GitHub Actions monitor,
  which is deliberately out of scope for this step.
- Step 8 narrowed this considerably: the pipeline monitor now separates "the workflow failed",
  "the workflow never ran", "the workflow succeeded but the output did not advance" and "GitHub
  could not be checked". What it still cannot do is name the cause *inside* a failed step — an
  IRCA HTTP 503, an empty measurement table, a rejected git push all look the same. That needs a
  Failed Run Log Inspector, deliberately out of scope for this step.
- **已解決（記錄以免重演）**：本機 working copy 一度被工具把 `.git` 的 NTFS owner 改成
  `CodexSandboxOffline`，導致 git 拒絕操作。owner 已修回正常 Windows 使用者。
  **不要修改本 repo 的 NTFS ownership 或 ACL。** 若再遇到 git 抱怨 dubious ownership，
  先確認 owner，必要時才用 `git config --global --add safe.directory C:/dev/iceland-ops-dashboard`
  （只加這一個路徑）。

## Tests

`npm.cmd test` 全離線，不連任何網路。**測試數量以實際輸出為準，本檔不記錄數字**：
`aurora-gauge`、`road-map`、`aurora-oval`、`cloud-forecast` 這幾個測試檔會用 `existsSync`
檢查 `../iceland-aurora` 是否存在，缺席時整批跳過，所以不同機器的總數本來就不一樣。

以下是涵蓋範圍（隨功能增加，非窮舉）：

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
- Snapshot merge and storage: 16 cases — success replaces data, success moves `lastSuccessAt`,
  failure preserves data and `lastSuccessAt` while updating `lastAttemptAt` and the error, a
  never-successful source has no data, recovery clears the old error, a mixed round produces the
  right overall status and summary, valid re-readable JSON, no temp file left behind, and a failed
  write leaving the previous snapshot intact
- Dashboard data path: 9 cases — the homepage reads the snapshot, no page or component references
  a monitor or a fetcher, no API route exists, snapshot age and the overdue threshold, a failed
  collection still exposing the last successful data, and the reload path pointing at the snapshot
  file rather than an endpoint
- Deployment: 11 cases — static export configured, the Pages base path applied to assets and to
  the snapshot URL, local development still served from `/`, cache-busting confined to the
  snapshot, no browser-loaded file referencing a monitor or a production host, the export
  shipping the snapshot and `.nojekyll`, the workflow triggering on push with least-privilege
  permissions and no schedule, no credential, and no external host or scheduler introduced
- Production sources: 21 cases across MET Norway, NOAA Kp, solar wind, OVATION and IMO — success,
  network error, HTTP error, parse error, schema error, empty response, invalid timestamp, stale
  data, partial outage, last-good-data preserved after a failure, the compliant User-Agent and
  four-decimal coordinates, the IMO API-version header, plus a guard that the runtime holds no
  mock reference and every published entry declares production provenance
- Automation: 15 cases — the hourly cron is exactly `0 * * * *` and there is only one of them, all
  three triggers survive and share a single collecting job, the Pages workflow is never scheduled,
  the trigger source is recorded, an unchanged snapshot ends the run cleanly, the trigger file
  carries no data, least-privilege permissions with no credential, recursion impossible by path
  and by guard, the Pages deploy ignoring the trigger commit while still publishing the snapshot
  commit, both jobs building the branch tip, the refusal to publish non-production data, the
  60/90 minute overdue policy, and the banner no longer claiming any mock source
- time and session-event helpers, network diagnostics

No test depends on the wall clock, and no test reaches production or the GitHub API.

## Next step

Do not proceed automatically.

The pipeline is complete, scheduled and verified end to end. Nothing needs to be started or kept
running: the hourly GitHub schedule collects, commits and publishes on its own.

What is worth watching next is whether GitHub actually delivers the hourly schedule. The
dashboard measures this itself — if the SCHEDULED UPDATE OVERDUE banner appears regularly, the
schedule is slipping and an external trigger writing `automation/hourly-trigger.txt` becomes the
fallback worth wiring up.

Writing to `iceland-aurora`, `iceland-aurora-ios` or `iceland-aurora-cloud` remains forbidden.

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
