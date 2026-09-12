"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BRIEFING_CLOUD_REGION_LABEL,
  briefingCloudRegion,
  briefingSummary,
  buildAuroraBriefing,
  formatBriefingDate,
  formatBriefingHourLabel,
} from "@/lib/auroraBriefing";
import {
  briefingBestSiteLabel,
  skyLightLabel,
} from "@/lib/auroraForecastPresentation";
import { bzStatus, btStatus, speedStatus } from "@/lib/auroraGauge";
import { obstructionColorFor } from "@/lib/weatherMap";
import type { DashboardSnapshot } from "@/snapshot/types";

const value = (number: number | undefined, suffix = "") =>
  number === undefined ? "—" : `${number.toFixed(1)}${suffix}`;

const cloudStyle = (obstruction: number | undefined) =>
  obstruction === undefined
    ? undefined
    : {
        backgroundColor: obstructionColorFor(obstruction),
        color: obstruction > 70 ? "#F8FAFC" : "#08111f",
      };

export function AuroraBriefingDialog({
  snapshot,
  now,
  onClose,
}: {
  snapshot: DashboardSnapshot;
  now: Date;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const briefing = useMemo(() => buildAuroraBriefing(snapshot, now), [snapshot, now]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };
  const copy = async () => {
    if (!briefing) return;
    try {
      await navigator.clipboard.writeText(briefingSummary(briefing));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  if (!briefing) return null;
  const start = briefing.window.hours[0];
  const end = briefing.window.hours[8];
  const bestHour =
    briefing.hours.find((hour) => hour.best === briefing.best)?.hour ?? "—";

  return (
    <dialog
      ref={dialogRef}
      className="aurora-briefing-dialog"
      aria-labelledby="aurora-briefing-title"
      aria-describedby="aurora-briefing-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <header className="aurora-briefing-head">
        <div>
          <h2 id="aurora-briefing-title">🌌 冰島極光快報</h2>
          <p id="aurora-briefing-description">
            {formatBriefingDate(start, true)} {briefing.hours[0].hour}:00 →{" "}
            {formatBriefingDate(end)} {briefing.hours[8].hour}:00
            <br />
            冰島時間
          </p>
        </div>
        <div className="aurora-briefing-head-actions">
          <span aria-live="polite">
            {copyState === "copied"
              ? "已複製摘要"
              : copyState === "failed"
                ? "無法複製，請手動選取文字。"
                : ""}
          </span>
          <button type="button" onClick={() => void copy()}>
            複製文字摘要
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="關閉極光快報"
          >
            ×
          </button>
        </div>
      </header>

      <div className="aurora-briefing-body">
        <p className="aurora-briefing-note">
          今晚觀測時段固定以冰島當地 18:00～隔日 02:00 計算。
        </p>

        <section className="aurora-briefing-judgement" aria-label="今晚判讀摘要">
          <h3>今晚判讀摘要</h3>
          <p>{briefing.judgement}</p>
        </section>

        <section className="aurora-briefing-best" aria-label="今晚最佳可觀測條件">
          <span>今晚最佳可觀測條件</span>
          <strong style={{ color: briefing.best.color }}>
            {briefing.best.levelLabel}
          </strong>
          <dl>
            <div>
              <dt>最高預測分數</dt>
              <dd style={{ color: briefing.best.color }}>{briefing.best.score}</dd>
            </div>
            <div>
              <dt>最佳時間</dt>
            <dd>{formatBriefingHourLabel(bestHour)}</dd>
            </div>
            <div>
              <dt>最佳地點</dt>
              <dd>{briefing.best.site.nameZh}</dd>
            </div>
            <div>
              <dt>最佳極光區域</dt>
              <dd>{BRIEFING_CLOUD_REGION_LABEL[briefingCloudRegion(briefing.best.site)]}</dd>
            </div>
            <div>
              <dt>預測最高 Kp</dt>
              <dd>{briefing.highestKp.toFixed(0)}</dd>
            </div>
          </dl>
          <p>
            雲況相對較佳區域：
            {briefing.bestCloudRegions.length
              ? briefing.bestCloudRegions
                  .map((region) => `${region.label} ${Math.round(region.average!)}%`)
                  .join("、")
              : "資料不足"}
          </p>
        </section>

        <section>
          <h3>今晚 18～02 時間軸</h3>
          <div className="aurora-briefing-wide">
            <div
              className="aurora-briefing-table"
              role="table"
              aria-label="今晚極光預測時間軸"
            >
              <div role="row" className="aurora-briefing-row">
                <span role="columnheader">時間</span>
                {briefing.hours.map((hour) => (
                  <strong role="columnheader" key={hour.time}>
                    {hour.hour}
                  </strong>
                ))}
              </div>
              <div role="row" className="aurora-briefing-row">
                <span role="rowheader">Kp</span>
                {briefing.hours.map((hour) => (
                  <span role="cell" key={hour.time}>
                    {hour.kp.toFixed(0)}
                  </span>
                ))}
              </div>
              <div role="row" className="aurora-briefing-row">
                <span role="rowheader">最佳分數</span>
                {briefing.hours.map((hour) => (
                  <strong
                    role="cell"
                    key={hour.time}
                    style={{ color: hour.best.color }}
                  >
                    {hour.best.score}
                  </strong>
                ))}
              </div>
              <div role="row" className="aurora-briefing-row aurora-briefing-sky">
                <span role="rowheader">天色</span>
                {briefing.hours.map((hour) => (
                  <span role="cell" key={hour.time}>
                    {skyLightLabel(hour.best)}
                  </span>
                ))}
              </div>
              <div
                role="row"
                className="aurora-briefing-row aurora-briefing-sites"
              >
                <span role="rowheader">最佳地點</span>
                {briefing.hours.map((hour) => {
                  const siteLabel = briefingBestSiteLabel(hour.best);
                  return (
                    <span
                      role="cell"
                      key={hour.time}
                      aria-label={siteLabel
                        ? undefined
                        : "此時段沒有有效極光觀測地點"}
                    >
                      {siteLabel ?? "—"}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <ol className="aurora-briefing-narrow aurora-briefing-hours">
            {briefing.hours.map((hour) => {
              const siteLabel = briefingBestSiteLabel(hour.best);
              const bestHourCard = hour.best === briefing.best;
              return (
                <li
                  key={hour.time}
                  className={bestHourCard ? "aurora-briefing-hour-card is-best" : "aurora-briefing-hour-card"}
                >
                  <div className="aurora-briefing-hour-card-top">
                    <strong>{formatBriefingHourLabel(hour.hour)}</strong>
                    <b style={{ color: hour.best.color }}>{hour.best.score}</b>
                  </div>
                  <dl>
                    <div>
                      <dt>Kp</dt>
                      <dd>{hour.kp.toFixed(0)}</dd>
                    </div>
                    <div>
                      <dt>天色</dt>
                      <dd>{skyLightLabel(hour.best)}</dd>
                    </div>
                    <div>
                      <dt>最佳地點</dt>
                      <dd aria-label={siteLabel ? undefined : "此時段沒有有效極光觀測地點"}>
                        {siteLabel ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ol>
        </section>

        <section>
          <h3>今晚雲層分布</h3>
          <div className="aurora-briefing-wide">
            <div
              className="aurora-briefing-table aurora-briefing-heatmap"
              role="table"
              aria-label="今晚各區平均有效雲層遮蔽率"
            >
              <div role="row" className="aurora-briefing-row">
                <span role="columnheader">區域</span>
                {briefing.hours.map((hour) => (
                  <strong role="columnheader" key={hour.time}>
                    {hour.hour}
                  </strong>
                ))}
                <strong role="columnheader">今晚平均</strong>
              </div>
              {briefing.regions.map((region) => (
                <div role="row" className="aurora-briefing-row" key={region.region}>
                  <span role="rowheader">{region.label}</span>
                  {region.obstructions.map((obstruction, index) => (
                    <span
                      role="cell"
                      key={`${region.region}-${briefing.hours[index].time}`}
                      className="aurora-briefing-cloud"
                      style={cloudStyle(obstruction)}
                    >
                      {obstruction === undefined ? "—" : `${Math.round(obstruction)}%`}
                    </span>
                  ))}
                  <span
                    role="cell"
                    className="aurora-briefing-cloud aurora-briefing-average"
                    style={cloudStyle(region.average)}
                  >
                    {region.average === undefined ? "—" : `${Math.round(region.average)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <ul className="aurora-briefing-narrow aurora-briefing-regions">
            {briefing.regions.map((region) => (
              <li key={region.region} className="aurora-briefing-region-card">
                <div className="aurora-briefing-region-head">
                  <span>{region.label}</span>
                  <strong style={cloudStyle(region.average)}>
                    {region.average === undefined ? "—" : `${Math.round(region.average)}%`}
                    <small>今晚平均</small>
                  </strong>
                </div>
                <div className="aurora-briefing-region-hours" aria-label={`${region.label} 各小時雲層`}>
                  {region.obstructions.map((obstruction, index) => (
                    <span
                      key={`${region.region}-${briefing.hours[index].time}`}
                      className="aurora-briefing-cloud"
                      style={cloudStyle(obstruction)}
                    >
                      <em>{briefing.hours[index].hour}</em>
                      {obstruction === undefined ? "—" : `${Math.round(obstruction)}%`}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="aurora-briefing-space">
          <h3>目前太空天氣</h3>
          <p>以下為目前即時太空天氣，不代表今晚 18:00～02:00 的預測值。</p>
          <dl>
            <div>
              <dt>目前 Kp</dt>
              <dd>{value(briefing.current.kp)}</dd>
            </div>
            <div>
              <dt>Bt</dt>
              <dd>{value(briefing.current.bt, " nT")} <small>{btStatus(briefing.current.bt)}</small></dd>
            </div>
            <div>
              <dt>Bz</dt>
              <dd>{value(briefing.current.bz, " nT")} <small>{bzStatus(briefing.current.bz)}</small></dd>
            </div>
            <div>
              <dt>太陽風</dt>
              <dd>
                {briefing.current.speed === undefined
                  ? "—"
                  : `${Math.trunc(briefing.current.speed)} km/s`} <small>{speedStatus(briefing.current.speed)}</small>
              </dd>
            </div>
            <div>
              <dt>OVATION</dt>
              <dd>{value(briefing.current.ovation, "%")}</dd>
            </div>
          </dl>
        </section>
      </div>

    </dialog>
  );
}
