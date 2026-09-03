# Iceland Ops Dashboard — Cursor 開發規範

> 專案名稱：`iceland-ops-dashboard`  
> 專案用途：冰島旅行神器的開發者資料監控中心  
> 專案性質：**獨立、唯讀、非旅客端產品**

---

## 1. 專案目標

建立一個獨立的 Web Dashboard，讓維護者可以快速知道冰島旅行神器所依賴的主要資料來源目前是否正常。

Dashboard 必須讓人能在短時間內回答：

1. 天氣資料現在正常嗎？
2. 道路資料現在正常嗎？
3. 極光資料現在正常嗎？
4. ECMWF 雲層預報是否有正常更新？
5. IMO 警報資料是否正常？
6. 有沒有資料已經過期？
7. 有沒有 HTTP / Network 失敗？
8. 有沒有 JSON / XML parse error？
9. 有沒有 schema 改變或必要欄位遺失？
10. 最後成功更新是什麼時候？
11. 現在哪一個來源最需要處理？

這個專案的核心不是單純顯示資料，而是：

**Observe / Validate / Diagnose / Display**

---

## 2. 最重要的安全邊界

這是一個全新的獨立專案。

### 既有 production repositories

以下 repository 只能當作外部系統或參考來源：

- `lovemonlin/iceland-aurora`
- `lovemonlin/iceland-aurora-ios`
- `lovemonlin/iceland-aurora-cloud`

### 嚴格禁止

本專案第一階段禁止：

- 修改 Android App
- 修改 iOS App
- 修改 `iceland-aurora-cloud`
- 對上述 repo commit
- 對上述 repo push
- 修改 Notion
- 寫入 GitHub Pages production 資料
- 修改 GitHub Actions
- 重新發布 ECMWF
- 重新發布 IRCA
- 自動修復 production 資料
- 建立任何會改變正式資料的操作按鈕

本 Dashboard 第一階段必須是：

# READ ONLY MONITOR

只能讀取公開 API、公開 GitHub Pages 資料，以及其他被明確允許的唯讀來源。

若未來某功能需要 production write access，先停止實作並在 `PROJECT_MEMORY.md` 記錄，不得自行加入。

---

## 3. 既有系統架構背景

目前冰島旅行神器主要由三個部分組成。

### Android

Repository：

`lovemonlin/iceland-aurora`

正式 package：

`com.iceland.travel`

---

### iOS

Repository：

`lovemonlin/iceland-aurora-ios`

iOS 原始碼必須保持獨立，不得與 Android 程式碼混在同一 repository。

---

### 共用 Cloud Data

Repository：

`lovemonlin/iceland-aurora-cloud`

主要提供：

- ECMWF 預處理資料
- IRCA 道路資料
- 景點 manifest / index / detail
- 景點照片
- Chrome Extension 公開資料
- GitHub Pages 靜態資料

---

## 4. 即時資料與 Cloud 資料的既有原則

既有架構目前採用：

### App 直接讀取的即時來源

- MET Norway
- NOAA SWPC
- EUMETSAT
- IMO

### 經 `iceland-aurora-cloud` 預處理 / 發布

- ECMWF
- IRCA 道路資料
- 景點資料
- Chrome 公開資料

不要自行改變這個架構。

Dashboard 應監控現有 production data flow，而不是重新設計另一套資料來源。

若現有文件已記錄 production endpoint / schema / freshness 邏輯，優先沿用。

---

## 5. 技術架構

建立新的 Web Dashboard。

建議：

- Next.js
- TypeScript
- App Router
- React
- ESLint
- 第一版不需要 database
- 第一版不需要登入
- 第一版不需要 Redis
- 第一版不需要 PostgreSQL
- 第一版不需要 Kubernetes
- 第一版不需要 Prometheus / Grafana
- 第一版盡量減少 dependency

建議專案路徑：

`C:\dev\iceland-ops-dashboard`

---

## 6. 建議目錄

```text
iceland-ops-dashboard/
│
├─ src/
│  ├─ app/
│  ├─ components/
│  ├─ monitors/
│  ├─ health/
│  ├─ config/
│  └─ lib/
│
├─ tests/
│
├─ docs/
│  └─ reference/
│
├─ README.md
├─ PROJECT_MEMORY.md
└─ AGENTS.md
```

---

## 7. Reference 文件規則

若 `docs/reference/` 中存在既有 Iceland Aurora 文件，例如：

- Android 專案 README
- Iceland Aurora 交接開發紀錄
- Android 協作規則
- 舊 PROJECT_MEMORY

這些全部都只是：

**REFERENCE ONLY**

尤其 Android 專案中的：

- Gradle
- APK
- emulator
- `com.iceland.travel.debug`
- Android Studio
- Kotlin
- Android build / install 規則

不得套用到 `iceland-ops-dashboard`。

新 Dashboard 必須有自己的：

- `README.md`
- `PROJECT_MEMORY.md`
- `AGENTS.md`

---

# 8. Dashboard 健康狀態模型

所有資料來源都必須轉換成統一 Health Model。

建議：

```ts
type HealthStatus =
  | "ok"
  | "info"
  | "stale"
  | "degraded"
  | "error";

interface MonitorHealth {
  id: string;
  name: string;

  status: HealthStatus;

  checkedAt: string;

  dataTime?: string;
  lastSuccess?: string;

  ageSeconds?: number;
  latencyMs?: number;

  httpStatus?: number;

  networkOk: boolean;
  parseOk: boolean;
  schemaOk?: boolean;
  fresh?: boolean;

  recordCount?: number;

  errorType?: MonitorErrorType;
  errorMessage?: string;

  details?: Record<string, unknown>;
}
```

實際欄位可以合理調整，但至少要保留：

- status
- checkedAt
- dataTime
- lastSuccess
- age
- latency
- HTTP status
- network state
- parse state
- schema state
- freshness
- record count
- error type
- error message

---

# 9. Status 分級

## OK

綠色。

代表：

- network 正常
- HTTP 正常
- parse 正常
- schema 正常
- 必要資料存在
- freshness 正常

---

## INFO

藍色。

代表正常但值得告知的狀態。

例如：

- IMO 目前 0 個 active warning
- ECMWF 已切換到新 model run

INFO 不是故障。

---

## STALE

黃色。

代表：

資料仍然可以讀取，但資料已經太舊。

例如：

- HTTP 200
- JSON 正常
- manifest 正常
- 但資料最後更新時間超過合理 threshold

---

## DEGRADED

橘色。

代表部分功能正常、部分異常。

例如：

MET Norway：

- 32 個地點
- 29 成功
- 3 失敗

不得整體顯示 OK。

---

## ERROR

紅色。

例如：

- DNS error
- timeout
- HTTP 403
- HTTP 404
- HTTP 500
- JSON parse error
- XML parse error
- schema mismatch
- required field missing
- empty dataset
- invalid timestamp
- 完全無法取得資料

---

# 10. 錯誤分類

建立統一 error types。

例如：

```ts
type MonitorErrorType =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "PARSE_ERROR"
  | "SCHEMA_ERROR"
  | "EMPTY_DATA"
  | "STALE_DATA"
  | "INVALID_TIMESTAMP"
  | "UNKNOWN";
```

UI 不需要顯示完整 stack trace。

但開發環境 console 應保留 technical details。

---

# 11. 重要原則：HTTP 200 不等於正常

禁止使用：

`HTTP 200 = OK`

作為健康判斷。

例如：

### IRCA

HTTP 200，但道路資料為 0 筆：

→ `ERROR / EMPTY_DATA`

---

### ECMWF

manifest HTTP 200，但 model run 過舊：

→ `STALE`

---

### NOAA

HTTP 200，但 JSON schema 改變：

→ `ERROR / SCHEMA_ERROR`

---

### IMO

HTTP 200 且 active warnings = 0：

→ `OK` 或 `INFO`

不是 ERROR。

---

# 12. Network Diagnostics

建立共用 fetch wrapper。

建議：

`src/lib/fetchWithDiagnostics.ts`

至少記錄：

- startedAt
- finishedAt
- latencyMs
- HTTP status
- timeout
- content type
- network error
- parse error

所有 monitors 必須安全並行。

建議使用：

`Promise.allSettled`

單一來源失敗不得讓整頁無法 render。

禁止：

```ts
try {
  ...
} catch {
  return null;
}
```

然後 UI 顯示：

`No data`

每個失敗都必須回傳具體 MonitorHealth。

---

# 13. 第一階段 Monitor 清單

第一版只做以下 7 類。

不要先擴充更多。

1. MET Norway Weather
2. NOAA Kp
3. NOAA Solar Wind
4. NOAA OVATION
5. IRCA Roads
6. ECMWF Cloud Forecast
7. IMO Warnings

---

# 14. MET Norway Weather Monitor

目前冰島旅行神器使用 MET Norway 作為天氣資料來源。

第一版可以先使用少量代表地點，但架構要允許未來擴充到現有 32 個地點。

至少監控：

- request 是否成功
- HTTP status
- JSON parse
- timestamp
- temperature
- wind
- low cloud
- medium cloud
- high cloud
- latency
- freshness

若部分地點失敗：

`DEGRADED`

全部失敗：

`ERROR`

注意：

MET Norway production 使用有合規要求的 User-Agent。

不要使用會破壞 production API policy 的 request。

若 production User-Agent / contact requirement 尚未在新專案安全確認，不要擅自 hardcode 私人 email 或機密資訊。

---

# 15. NOAA Kp Monitor

監控 NOAA SWPC Kp。

至少顯示：

- current / estimated Kp
- data timestamp
- latency
- freshness
- parse state

必須確認：

- Kp 欄位存在
- 值為 numeric
- timestamp 存在
- timestamp 可解析

不得只確認 HTTP 200。

---

# 16. NOAA Solar Wind Monitor

至少監控：

- solar wind speed
- Bt
- Bz
- timestamp
- latency

既有系統已知：

不要重新使用已失效的舊 NOAA solar wind endpoints。

優先以現有 production 文件記錄的 endpoint 為準。

如果 schema 改變：

顯示：

`SCHEMA_ERROR`

不要只顯示 `--`。

---

# 17. NOAA OVATION Monitor

至少檢查：

- endpoint
- HTTP
- JSON parse
- forecast / coordinate data 是否存在
- record count
- timestamp
- freshness

若資料結構改變：

`ERROR`

---

# 18. IRCA Roads Monitor

IRCA 是重要監控來源。

既有 cloud pipeline 可能在上游失敗時保留上一版公開資料。

因此 Dashboard 必須同時監控：

1. 公開資料是否可讀
2. 資料是否新鮮
3. record count 是否合理
4. 是否為空資料

至少顯示：

- Roads count
- Events count
- Stations count
- data timestamp
- data age

數量不可 hardcode 成固定值。

可以設定合理 lower bound 或 anomaly 判斷。

若正常道路資料突然為 0：

`ERROR / EMPTY_DATA`

---

# 19. ECMWF Cloud Forecast Monitor

ECMWF 目前由 `iceland-aurora-cloud` 預處理後發布。

現有架構大致為：

- 0–48 小時
- 每 3 小時一格
- 通常 17 個 frames

Dashboard 至少檢查：

- manifest HTTP
- JSON parse
- model run time
- generated / run time
- frame count
- frame sequence
- frame URL
- 第一張 frame 是否可取得
- 最後一張 frame 是否可取得
- newest valid time
- freshness

注意：

不要只寫：

`frameCount === 17`

就判斷正常。

若 manifest 可讀，但 run 過舊：

`STALE`

若 manifest 正常，但部分圖片 404：

`DEGRADED`

若大部分 / 全部 frame 不可用：

`ERROR`

---

# 20. IMO Warning Monitor

監控冰島氣象警報。

需正確區分：

### API 正常，0 個 active warning

→ `OK` 或 `INFO`

### API / schema / parse 異常

→ `ERROR`

不得把：

`0 warnings`

誤判為沒有資料。

---

# 21. Freshness 設計

不要把 freshness threshold 散落在 component。

建立：

`src/config/freshness.ts`

例如：

```ts
{
  metno: ...,
  noaaKp: ...,
  solarWind: ...,
  ovation: ...,
  irca: ...,
  ecmwf: ...,
  imo: ...
}
```

每個 monitor 定義：

- warningAfter
- staleAfter

如果目前文件沒有足夠證據支持精確 threshold：

可以先使用合理保守值。

但必須：

- 在 README 標示
- 在 PROJECT_MEMORY 標示
- 加上 TODO

例如：

`TODO: confirm production freshness threshold`

不得假裝已經知道官方精確更新週期。

---

# 22. 時間處理

系統會同時涉及：

- UTC
- Iceland time
- Taiwan time

所有內部時間：

優先使用 ISO 8601。

freshness 判斷：

以真正資料 timestamp 為基準。

不要拿瀏覽器 local timezone 當 freshness 判斷基準。

UI 至少清楚顯示：

- Iceland local time
- UTC

必要時可附 Taiwan time。

---

# 23. 首頁 UI

建立單頁 Dashboard。

Desktop 優先。

必須 responsive。

手機仍可閱讀。

---

## Header

顯示：

```text
ICELAND OPS DASHBOARD

Last check:
2026-09-03 08:52:13

Auto refresh:
ON

[ Refresh now ]
```

第一版建議：

每 60 秒檢查一次。

不要使用 5 秒 / 10 秒高頻 polling。

---

# 24. System Summary

首頁頂部：

```text
SYSTEM HEALTH

🟢 5 OK
🔵 1 INFO
🟡 1 STALE
🟠 0 DEGRADED
🔴 1 ERROR
```

整體狀態規則：

- 有 ERROR → ERROR
- 無 ERROR，有 DEGRADED → DEGRADED
- 無以上，有 STALE → STALE
- 否則 → OK

INFO 不應把整體變成故障。

---

# 25. 主要區塊

首頁至少分成：

## WEATHER

- MET Norway

## ROADS

- IRCA

## AURORA

- NOAA Kp
- NOAA Solar Wind
- NOAA OVATION

## FORECAST / WARNINGS

- ECMWF
- IMO

---

# 26. Status Card

所有 monitor 使用一致 Status Card。

正常例：

```text
MET Norway

🟢 OK

Last data:
08:00 Iceland

Checked:
08:52:11

Latency:
432 ms
```

錯誤例：

```text
IRCA

🔴 ERROR

EMPTY_DATA

Road dataset returned zero records.

Last successful data:
07:31

Checked:
08:52
```

不要只顯示：

`Something went wrong`

錯誤訊息必須有診斷價值。

---

# 27. Active Incidents

首頁建立：

`ACTIVE INCIDENTS`

只顯示：

- stale
- degraded
- error

例如：

```text
🔴 IRCA
EMPTY_DATA

Public endpoint is reachable,
but road dataset contains zero records.

Checked:
08:31
```

或：

```text
🟡 ECMWF
STALE_DATA

Manifest is reachable,
but model run is older than expected.

Latest run:
2026-09-02 18Z
```

---

# 28. Recent Events

第一版不需要 database。

可以先保存瀏覽器 session 期間的 events。

例如：

```text
08:52 MET      OK
08:51 NOAA     OK
08:49 ECMWF    OK
08:31 IRCA     ERROR
```

不要先建立大型 logging 系統。

---

# 29. 第一階段不做

第一階段禁止擴張成大型平台。

不要做：

- Login
- PostgreSQL
- Redis
- Prometheus
- Grafana
- Kubernetes
- Telegram bot
- LINE notification
- Email notification
- Push notification
- GitHub Action rerun button
- production repair button
- automatic retry production action
- Notion write
- production deployment automation
- Google Play 操作
- App Store Connect 操作

先把：

**資料健康監控**

做好。

---

# 30. 未來第二階段預留

架構可以預留：

- EUMETSAT
- GitHub Actions workflow health
- GitHub Pages
- App places database health
- Chrome places database health
- Notion publication health
- Frankfurter exchange rate
- Google Play release health
- notification
- incident history
- manual retry

但第一階段不要實作。

---

# 31. UI 風格

這是工程監控工具。

希望：

- 深色介面
- 資訊密度高
- 清楚
- 不花俏
- Desktop dashboard 感
- 手機仍可閱讀
- 診斷資訊優先

語意顏色：

- Green = OK
- Blue = INFO
- Yellow = STALE
- Orange = DEGRADED
- Red = ERROR

---

# 32. 測試要求

至少建立以下測試。

## Health evaluator

- fresh → OK
- old → STALE
- network failure → ERROR
- partial failure → DEGRADED
- zero records → ERROR
- parse error → ERROR

## ECMWF

- valid manifest
- stale manifest
- malformed manifest
- missing frame
- empty frames

## IRCA

- valid non-empty dataset
- zero records
- invalid published data

## MET

- all locations success
- partial locations failure
- all locations failure

## NOAA

- valid numeric data
- schema changed
- timestamp missing

---

# 33. README.md

README 必須說明：

## Purpose

這是 Iceland Ops Dashboard。

不是旅客 App。

## Repository Boundary

這是一個完全獨立的 monitoring repository。

不得直接修改：

- Android
- iOS
- Cloud production repositories

## Data Sources

列出目前 monitors。

## Status Meaning

解釋：

- OK
- INFO
- STALE
- DEGRADED
- ERROR

## Run

本機啟動方式。

## Tests

測試方式。

## Safety

第一階段：

READ ONLY

---

# 34. PROJECT_MEMORY.md

建立：

`PROJECT_MEMORY.md`

持續記錄：

- 已完成功能
- Monitor 清單
- production endpoint
- schema 注意事項
- freshness threshold
- 已知問題
- 尚未確認的官方更新頻率
- 下一步
- 技術決策

禁止寫入：

- API key
- password
- GitHub PAT
- private token
- Notion secret
- credential

---

# 35. 開發順序

必須照以下順序。

## Step 1

初始化全新 Next.js + TypeScript 專案。

確認：

這是一個獨立 Git repository。

---

## Step 2

建立 Health Model。

此階段先不要連 production API。

---

## Step 3

建立 Mock Monitor。

至少製造：

- OK
- INFO
- STALE
- DEGRADED
- ERROR

五種 mock 狀態。

---

## Step 4

完成 Dashboard Layout。

包括：

- Header
- System Summary
- Weather
- Roads
- Aurora
- Forecast / Warnings
- Active Incidents
- Recent Events

---

## Step 5

建立共用 Network Diagnostics。

---

## Step 6

依序接 production monitor：

1. ECMWF
2. IRCA
3. NOAA Kp
4. NOAA Solar Wind
5. NOAA OVATION
6. MET Norway
7. IMO

一次只接一個。

每完成一個：

1. 實作
2. 測試正常狀態
3. 測試錯誤狀態
4. 更新 PROJECT_MEMORY
5. 再做下一個

---

# 36. 第一階段驗收條件

第一版完成時，維護者必須能在約 10 秒內回答：

- 天氣是否正常？
- 道路是否正常？
- 極光資料是否正常？
- ECMWF 是否正常更新？
- IMO 警報 API 是否正常？
- 是否有 stale data？
- 是否有 HTTP error？
- 是否有 parse / schema error？
- 每個來源最後成功時間？
- 現在最需要處理哪個 source？

如果 Dashboard 只能顯示漂亮數字，卻無法快速診斷問題：

**第一階段尚未完成。**

---

# 37. Cursor 第一個任務

請現在只完成：

1. 初始化 `iceland-ops-dashboard`
2. 建立目錄架構
3. 建立 Health Model
4. 建立 Error Model
5. 建立 Mock Monitors
6. 完成第一版 Dashboard Mock UI
7. 建立基礎 tests
8. 建立 README.md
9. 建立 PROJECT_MEMORY.md

完成以上項目後停止。

暫時不要連任何 production API。

---

# 38. 第一個工作回報格式

完成上述初始化後回報：

1. 建立了哪些檔案
2. 最終目錄架構
3. 使用了哪些 dependency
4. Health Model 最終設計
5. Error Model 最終設計
6. Mock UI 支援哪些狀態
7. 測試結果
8. 有哪些 TODO
9. 是否有任何架構問題需要使用者決定

不要自行繼續第二階段。

不要修改任何既有 Iceland production repository。
