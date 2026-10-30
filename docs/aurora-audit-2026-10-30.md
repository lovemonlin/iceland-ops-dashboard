# 極光模組稽核與修正（2026-10-30）

## 唯讀稽核結論

### 資料與地圖路徑

既有唯一收集路徑為 Cloudflare Worker → `workflow_dispatch` →
`update-dashboard-snapshot.yml` → `checkOvation` → snapshot merge →
`public/data/latest-health.json` → Pages。前端只用 `usePublishedSnapshot`
每五分鐘讀取已發布 JSON，使用 `cache: no-store` 和 cache-busting URL。
NOAA 回應由同一次請求產生摘要與北緯 45–85° 的緊湊格網，沒有第二套 NOAA 收集器。
正式收集每 60 分鐘一次；OVATION 圖原本「每 10 分鐘更新」的文案不符實際，已移除。

原始資料為 `[0..359°E, -90..90°N, probability]`。轉換只將經度正規化為
`-180..179`、緯度外層／經度內層存入一維陣列。城市查詢各自取最近整數格點，
色帶另以雙線性插值及三角形裁切繪製 1/10/30/50% 門檻。MapLibre 使用原有
Mercator 地圖；沒有把 NOAA 官方極區圖片貼到 Mercator 底圖上，也沒有將地理座標
誤當地磁座標。本次沒有改動色帶門檻、插值算法或模型座標。

根因是 MapLibre `beforeId` 的順序：色帶原本插在不透明的冰島 fill **前面**，
之後的陸地填色遮住島上的模型；每次改用前一 band 當 anchor，也讓高機率 band
位於低機率 band 下。現在固定插在詳細海岸線前、陸地 fill 後，依低至高順序疊放。
更新為缺漏／無效格網時，也會清除先前色帶，避免殘留。

### 與同時間 NOAA 資料核對

稽核於 2026-10-30 00:42 UTC 左右讀取官方 JSON：觀測 `00:28 UTC`、預報
`01:53 UTC`，共 65,160 格。北半球儲存範圍的 14,760 格逐一比較原始值與
encode/decode 後值，**零差異**。已核對以下官方同批圖像的圖上時間：

[NOAA 00:35 模型圖：觀測 00:28、預報 01:53 UTC](https://services.swpc.noaa.gov/images/animations/ovation/north/aurora_N_2026-10-30_0035.jpg)

| 地點 | 最近 NOAA 格點（經度、緯度） | 同批官方 JSON | 當時正式 Snapshot |
| --- | --- | ---: | ---: |
| Reykjavík | 338°E、64°N | 8% | 10% |
| Akureyri | 342°E、66°N | 10% | 12% |
| Vík | 341°E、63°N | 6% | 7% |
| Höfn | 345°E、64°N | 7% | 8% |
| 冰島中心 | 341°E、65°N | 9% | 11% |

右欄 Snapshot 的觀測為 10/29 23:49、預報為 10/30 01:15 UTC，與新的官方批次
不同時間，不能把兩欄差異當成轉換錯誤。同批原始抽樣已保存於測試 fixture。

11% 是 `64.96°N, 18.97°W` 四捨五入後的**中心單一格點**，不是四城平均、
不是全島平均，也沒有乘上雲量或黑夜因子。另一個舊「冰島峰值」只篩 63–67°N
卻包含全球經度，現改為 63–67°N、25–13°W 的冰島及近海包圍框，介面明示含近海。

[NOAA 官方產品說明](https://www.spaceweather.gov/products/aurora-30-minute-forecast)
將此產品描述為約 30–90 分鐘的短期模型；模型強度可用來推估機率，實際觀賞仍受
日照等條件影響。官方同時間圖與原始取樣均顯示冰島處於低機率區。
介面忠實呈現；包圍框全低於 1% 時另有明確未達著色門檻提示。

### 過舊原因與時間語意

當時正式站 OVATION 為正常。極光卡的「來源資料過舊」來自同卡的 Kp Forecast：
錯把末筆三小時預報的起點視為終點；在 `00:00:27.480` 檢查時得到略小於 48h，
訊息四捨五入又顯示成 48.0h。現在以末筆起點加三小時作終點，維持原本至少
48 小時政策。未放寬任何來源 freshness 門檻。

GitHub 最近六次 hourly collector 當時均成功；Pages Snapshot 為 `10/30 00:00:27 UTC`。
本機起初停在 `10/21 01:00 UTC`，已用 `git pull --ff-only` 同步；沒有本機重新收集。
未發現需修改發布器或新增快取機制的證據。

新版 OVATION 儲存 `observationTime`、`forecastTime`、`fetchedAt` 為 UTC ISO；
`lastAttemptAt` 保持最後檢查時間。舊 Snapshot 缺 fetchedAt 時僅顯示最後成功批次
時間，並明示「舊版記錄」。請求完成時間不再與預報有效時間或檢查開始時間混淆。

前端每分鐘依現在時間更新時效判定，即使 Snapshot 重讀失敗或暫停也不停止時鐘。
過期格網保留並標為歷史資料；無效格網不繪製。過期／失敗來源不進入目前 OVATION、
Bz 或 Kp 評分；無有效 Kp 預報時，48h 預測停止顯示。最後成功資料仍由既有
merge 容錯保存，原始 monitor 狀態不被改寫。

## 修改範圍

- 資料與驗證：`src/monitors/noaa/monitor.ts`、`src/lib/ovationGrid.ts`、
  `src/lib/auroraData.ts`。驗證全格網、座標、機率、重複／缺格與不合理時間。
- 共用評估：`src/lib/auroraVisibility.ts`、`auroraBriefing.ts`，僅加入有效性 gate，
  不變更既有 V1/V2 公式或加入進階指數。
- 地圖：`src/lib/auroraOval.ts`、`src/components/AuroraOvalMap.tsx`；同一地圖元件
  提供區域、32 地點、任意座標查詢、縮放、冰島／北半球檢視。
- 入口：`src/app/aurora/page.tsx`、`AuroraViewer.tsx`、`AuroraDataStatus.tsx`，
  重用 Standalone Viewer／snapshot reload；Dashboard 原摘要保留並加入獨立入口。
- 狀態：獨立頁標頭合併五個極光來源，OVATION 本身另列更新狀態；全部時間明示 UTC。
- 樣式：極光專用樣式；獨立頁資訊卡排列限定於 `.standalone-aurora`。

## 驗證紀錄

- 已暫存的獨立提交版本：572 項完整測試通過，零失敗、零跳過；TypeScript、ESLint、
  含 `/iceland-ops-dashboard` base path 的 Next static export 均通過。
- 原始紅燈重現：既有 anchor 位於不透明 fill 前；Kp 在整點後 27 秒誤判。
- 新增：四城官方抽樣、經度正規化、完整／無效格網、UTC／過期、舊值隔離、
  圖層實際插入順序／更新／清除、路由及 Pages base path。
- Chrome 實機：Dashboard 入口可開獨立視窗；四城值與 Snapshot 一致；任意點查詢、
  區域、放大／縮小、全境重設、北半球切換、過期 Kp 提示、返回 Dashboard。
- 1440×900 與 390×844 版面已檢視，手機 DOM 無水平溢出；天氣與道路入口可開啟，
  道路原有即時資料仍正常載入。未修改其他 Iceland Aurora repositories、scheduler、
  secrets 或 production workflows。
