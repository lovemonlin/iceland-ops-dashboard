"use client";

import { useEffect, useMemo, useState } from "react";
import { AuroraBriefingDialog } from "@/components/AuroraBriefingDialog";
import { AuroraScoreExplanationDialog } from "@/components/AuroraScoreExplanationDialog";
import {
  auroraForecastSites,
  defaultAuroraForecastSite,
  LIGHT_POLLUTION_LABEL,
  LIMITING_FACTOR_LABEL,
  skyLightLabel,
} from "@/lib/auroraForecastPresentation";
import { buildAuroraForecast48 } from "@/lib/auroraVisibility";
import { formatCloudForecastTimes, formatIcelandDateTime } from "@/lib/cloudForecast";
import { deviceTimeZone, getIpTimeZone, type LocalTimeZone } from "@/lib/ipTimezone";
import type { DashboardSnapshot } from "@/snapshot/types";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const number = (value: number, digits = 1) => value.toFixed(digits);

export function AuroraForecast({ snapshot, baseTime }: { snapshot: DashboardSnapshot; baseTime: Date }) {
  const sites = useMemo(() => auroraForecastSites(snapshot), [snapshot]);
  const defaultSite = defaultAuroraForecastSite(sites);
  const [siteId, setSiteId] = useState("reykjavik");
  const [selectedHour, setSelectedHour] = useState(0);
  const [scoreExplanationOpen, setScoreExplanationOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [localTimeZone, setLocalTimeZone] = useState<LocalTimeZone>(deviceTimeZone);
  const site = sites.find((candidate) => candidate.id === siteId) ?? defaultSite;

  useEffect(() => {
    let disposed = false;
    void getIpTimeZone().then((value) => {
      if (!disposed) setLocalTimeZone(value);
    });
    return () => {
      disposed = true;
    };
  }, []);

  const forecast = useMemo(() => {
    if (!site) return [];
    try {
      return buildAuroraForecast48(snapshot, site, baseTime);
    } catch {
      return [];
    }
  }, [baseTime, site, snapshot]);

  if (!site || forecast.length !== 48) {
    return <p className="aurora-forecast-unavailable">目前無法建立 48 小時極光預測，請等待下一份完整 snapshot。</p>;
  }

  const selected = forecast[selectedHour] ?? forecast[0];
  const selectedTimes = formatCloudForecastTimes(selected.time, localTimeZone.timeZone);
  const localTimeLabel = localTimeZone.source === "ip" ? "當地時間" : "裝置時間";

  return (
    <div className="aurora-forecast">
      <div className="aurora-forecast-head">
        <label htmlFor="aurora-forecast-site">冰島觀測地點</label>
        <select id="aurora-forecast-site" value={site.id} onChange={(event) => setSiteId(event.target.value)}>
          {sites.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.nameZh}（{candidate.name}）
            </option>
          ))}
        </select>
      </div>

      <div className="aurora-forecast-guide">
        <p className="aurora-forecast-hint">
          未來 48 小時逐時預測（時間軸為冰島時間）；可橫向捲動並點選任一小時查看細節。
        </p>
        <div className="aurora-forecast-actions">
          <button
            type="button"
            className="aurora-score-explain-button"
            aria-haspopup="dialog"
            aria-expanded={scoreExplanationOpen}
            onClick={() => setScoreExplanationOpen(true)}
          >
            ⓘ 分數怎麼算？
          </button>
          <button
            type="button"
            className="aurora-briefing-button"
            aria-haspopup="dialog"
            aria-expanded={briefingOpen}
            onClick={() => setBriefingOpen(true)}
          >
            🌌 極光快報
          </button>
        </div>
      </div>

      {scoreExplanationOpen && (
        <AuroraScoreExplanationDialog onClose={() => setScoreExplanationOpen(false)} />
      )}
      {briefingOpen && (
        <AuroraBriefingDialog
          snapshot={snapshot}
          now={baseTime}
          onClose={() => setBriefingOpen(false)}
        />
      )}

      <div className="aurora-forecast-timeline" aria-label="未來 48 小時極光預測">
        {forecast.map((assessment, index) => {
          const sky = skyLightLabel(assessment);
          return (
            <button
              key={assessment.time}
              type="button"
              className={index === selectedHour ? "selected" : undefined}
              aria-pressed={index === selectedHour}
              aria-label={`${formatIcelandDateTime(assessment.time)}，${assessment.score} 分，${assessment.levelLabel}，${sky}`}
              onClick={() => setSelectedHour(index)}
              onFocus={() => setSelectedHour(index)}
              onMouseEnter={() => setSelectedHour(index)}
            >
              <time dateTime={assessment.time}>{formatIcelandDateTime(assessment.time)}</time>
              <span className="aurora-forecast-bar-track" aria-hidden="true">
                <span
                  className="aurora-forecast-bar"
                  style={{ height: `${assessment.score}%`, backgroundColor: assessment.color }}
                />
              </span>
              <strong style={{ color: assessment.color }}>{assessment.score}</strong>
              <span className="aurora-forecast-level">{assessment.levelLabel}</span>
              <span className={`aurora-forecast-sky ${assessment.darknessFactor < 1 ? "bright" : ""}`}>{sky}</span>
            </button>
          );
        })}
      </div>

      <div className="aurora-forecast-legend" aria-label="極光預測等級">
        {[
          ["#64748B", "看不到"],
          ["#FB923C", "不佳"],
          ["#FDE047", "普通"],
          ["#86EFAC", "良好"],
          ["#4ADE80", "極佳"],
        ].map(([color, label]) => (
          <span key={label}><i style={{ backgroundColor: color }} aria-hidden="true" />{label}</span>
        ))}
      </div>

      <section className="aurora-forecast-detail" aria-live="polite">
        <div className="aurora-forecast-detail-head">
          <div>
            <span>第 {selectedHour} 小時 · {site.nameZh}</span>
            <strong style={{ color: selected.color }}>{selected.score} 分 · {selected.levelLabel}</strong>
          </div>
          <span className={`aurora-forecast-sky ${selected.darknessFactor < 1 ? "bright" : ""}`}>
            {skyLightLabel(selected)} · 太陽高度 {number(selected.sunElevation)}°
          </span>
        </div>

        <div className="cloud-forecast-times aurora-forecast-times">
          <time className="cloud-forecast-time aurora-forecast-time-local" dateTime={selected.time}>
            {localTimeLabel} <strong>{selectedTimes.local ?? "—"}</strong>
          </time>
          <time className="cloud-forecast-time aurora-forecast-time-iceland" dateTime={selected.time}>
            冰島時間 <strong>{selectedTimes.iceland ?? "—"}</strong>
          </time>
        </div>

        <dl className="aurora-forecast-metrics">
          <div><dt>Kp</dt><dd>{number(selected.kp, 2)}</dd></div>
          <div><dt>極光強度</dt><dd>{number(selected.auroraStrength)} / 100</dd></div>
          <div><dt>雲層影響</dt><dd>遮蔽 {number(selected.effectiveObstruction)}% · 因子 {percent(selected.cloudFactor)}</dd></div>
          <div><dt>黑暗因子</dt><dd>{percent(selected.darknessFactor)}</dd></div>
          <div><dt>月光干擾</dt><dd>{percent(selected.moonInterference)} · 因子 {percent(selected.moonFactor)}</dd></div>
          <div><dt>地點條件</dt><dd>{LIGHT_POLLUTION_LABEL[site.lightPollution]} · 因子 {percent(selected.siteFactor)}</dd></div>
          <div><dt>主要限制</dt><dd>{LIMITING_FACTOR_LABEL[selected.limitingFactor]}</dd></div>
        </dl>
      </section>
    </div>
  );
}
