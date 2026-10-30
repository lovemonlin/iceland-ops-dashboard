"use client";

import dynamic from "next/dynamic";
import { AuroraDataStatus } from "@/components/AuroraDataStatus";
import { AuroraGauges } from "@/components/AuroraGauges";
import { auroraSourceAt } from "@/lib/auroraData";
import { formatNumber, formatSigned, formatSourceStatus } from "@/lib/display";
import type { DashboardSnapshot } from "@/snapshot/types";

const AuroraOvalMap = dynamic(() => import("@/components/AuroraOvalMap").then((module) => module.AuroraOvalMap), {
  ssr: false, loading: () => <p className="muted-line">正在載入極光地圖…</p>,
});
const AuroraForecast = dynamic(() => import("@/components/AuroraForecast").then((module) => module.AuroraForecast), {
  ssr: false, loading: () => <p className="muted-line">正在載入綜合條件預測…</p>,
});

export function AuroraViewer({ snapshot, now }: { snapshot: DashboardSnapshot; now: Date }) {
  const feeds = ["noaaKp", "solarWind", "noaaHemiPower", "noaaKpForecast"].map((id) => auroraSourceAt(snapshot.sources[id], now));
  const current = (index: number) => feeds[index] && ["ok", "info"].includes(feeds[index]!.status) ? feeds[index]!.data ?? {} : {};
  const kp = current(0), wind = current(1), power = current(2);
  return (
    <div className="aurora-viewer">
      <div className="aurora-viewer-grid">
        <section className="aurora-viewer-map">
          <h2>冰島全境 OVATION 機率地圖</h2>
          <p className="muted-line">選擇區域或地點，或點選地圖查詢原始格點。未著色表示低於 1%，不代表保證看不到極光。</p>
          <AuroraOvalMap ovation={snapshot.sources.ovation?.data ?? {}} snapshot={snapshot} now={now} standalone />
        </section>
        <aside className="aurora-conditions">
          <section>
            <h2>NOAA 資料與更新狀態</h2>
            <AuroraDataStatus source={snapshot.sources.ovation} now={now} generatedAt={snapshot.generatedAt} />
          </section>
          <section>
            <h2>目前太空天氣條件</h2>
            <AuroraGauges kpData={kp} windData={wind} hemiData={power} />
            <dl className="aurora-data-times">
              {[["Kp 指數", formatNumber(kp.kp)], ["太陽風速", formatNumber(wind.speedKms, "km/s")],
                ["Bt", formatNumber(wind.btNt, "nT")], ["Bz", formatSigned(wind.bzNt, "nT")],
                ["北半球功率", formatNumber(power.northGw, "GW")]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <ul className="aurora-feed-status">
              {feeds.map((feed, index) => <li key={index}>{feed?.name ?? "尚無來源"}：{feed ? formatSourceStatus(feed).label : "尚無資料"}</li>)}
            </ul>
            <p className="muted-line">過期或無效來源不顯示為即時值；各來源使用自身的觀測時間與有效期。</p>
          </section>
        </aside>
      </div>
      <section className="aurora-model-explanation">
        <h2>如何解讀地圖</h2>
        <p>機率值來自 NOAA OVATION 約 1° 格網，為依極光強度推估的模型機率，未計入當地雲量、黑夜、月光與光害。冰島中心讀值只代表 64.96°N、18.97°W 的最近格點。</p>
        <p>模型極光帶可能主要位於冰島以北。此時仍照原始資料顯示，不擴大或移動色帶；低機率也不等同於完全沒有觀賞機會。</p>
      </section>
      <details className="aurora-viewer-forecast">
        <summary>未來 48 小時綜合條件預測</summary>
        <p className="muted-line">沿用 Dashboard 既有評估；未來時段使用有效 Kp 預報，不延用目前 OVATION 或 Bz。Kp 預報無效時暫停顯示預測。</p>
        <AuroraForecast snapshot={snapshot} baseTime={now} />
      </details>
      <section className="aurora-advanced">
        <h2>進階太陽風與地磁分析</h2>
        <p className="muted-line">預留區塊。尚未提供歷史趨勢、耦合函數或進階地磁指數；目前只顯示已驗證的 NOAA 指標。</p>
      </section>
    </div>
  );
}
