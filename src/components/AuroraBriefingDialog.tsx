"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AuroraBriefingMap } from "@/components/AuroraBriefingMap";
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

const SCORE_LEGEND = [
  ["#64748B", "看不到"],
  ["#FB923C", "不佳"],
  ["#FDE047", "普通"],
  ["#86EFAC", "良好"],
  ["#4ADE80", "極佳"],
] as const;

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
  const dragRef = useRef<
    | { type: "resize"; pointerId: number; startY: number; startHeight: number }
    | { type: "move"; pointerId: number; startX: number; startY: number; startLeft: number; startTop: number }
    | null
  >(null);
  const dismissPointer = useRef<{ x: number; y: number } | null>(null);
  const skipBackdropClose = useRef(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [hourOverride, setHourOverride] = useState<number | null>(null);
  const [dialogHeight, setDialogHeight] = useState<number>();
  const [dialogPlace, setDialogPlace] = useState<{ left: number; top: number }>();
  const briefing = useMemo(() => buildAuroraBriefing(snapshot, now), [snapshot, now]);
  const bestHourIndex = useMemo(() => {
    if (!briefing) return 0;
    const index = briefing.hours.findIndex((hour) => hour.best === briefing.best);
    return index < 0 ? 0 : index;
  }, [briefing]);
  const hourIndex = hourOverride ?? bestHourIndex;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const compact = () => window.matchMedia("(max-width: 720px)").matches;
    const clampHeight = (height: number) => {
      const minHeight = 280;
      const maxHeight = Math.round(window.innerHeight * 0.96);
      return Math.min(maxHeight, Math.max(minHeight, Math.round(height)));
    };
    const applyHeight = (height: number) => {
      const dialog = dialogRef.current;
      const next = clampHeight(height);
      dialog?.style.setProperty("height", `${next}px`, "important");
      dialog?.style.setProperty("max-height", `${Math.round(window.innerHeight * 0.96)}px`, "important");
      setDialogHeight(next);
    };
    const applyPlace = (left: number, top: number, width: number) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const nextLeft = Math.min(window.innerWidth - 80, Math.max(80 - width, Math.round(left)));
      const nextTop = Math.min(window.innerHeight - 48, Math.max(0, Math.round(top)));
      dialog.style.position = "fixed";
      dialog.style.margin = "0";
      dialog.style.left = `${nextLeft}px`;
      dialog.style.top = `${nextTop}px`;
      setDialogPlace({ left: nextLeft, top: nextTop });
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const dialog = dialogRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !dialog || compact()) return;
      if (drag.type === "resize") {
        applyHeight(drag.startHeight + event.clientY - drag.startY);
        return;
      }
      const box = dialog.getBoundingClientRect();
      applyPlace(
        drag.startLeft + event.clientX - drag.startX,
        drag.startTop + event.clientY - drag.startY,
        box.width,
      );
    };
    const end = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      skipBackdropClose.current = true;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  const pinDialog = (dialog: HTMLDialogElement, box: DOMRect) => {
    dialog.style.position = "fixed";
    dialog.style.margin = "0";
    dialog.style.left = `${box.left}px`;
    dialog.style.top = `${box.top}px`;
    setDialogPlace({ left: box.left, top: box.top });
  };

  const beginMove = (event: React.PointerEvent<HTMLElement>) => {
    if (window.matchMedia("(max-width: 720px)").matches) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as Element).closest("button, a, input")) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const box = dialog.getBoundingClientRect();
    pinDialog(dialog, box);
    dragRef.current = {
      type: "move",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: box.left,
      startTop: box.top,
    };
    skipBackdropClose.current = true;
    dismissPointer.current = null;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const box = dialog.getBoundingClientRect();
    pinDialog(dialog, box);
    dragRef.current = { type: "resize", pointerId: event.pointerId, startY: event.clientY, startHeight: box.height };
    skipBackdropClose.current = true;
    dismissPointer.current = null;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
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
  const hourCell = (index: number) => (index === hourIndex ? "is-hour-selected" : undefined);

  return (
    <dialog
      ref={dialogRef}
      className="aurora-briefing-dialog"
      style={{
        ...(dialogHeight === undefined ? {} : { height: dialogHeight, maxHeight: "96dvh" }),
        ...(dialogPlace
          ? { position: "fixed", margin: 0, left: dialogPlace.left, top: dialogPlace.top }
          : {}),
      }}
      aria-labelledby="aurora-briefing-title"
      aria-describedby="aurora-briefing-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          dismissPointer.current = { x: event.clientX, y: event.clientY };
        } else {
          dismissPointer.current = null;
        }
      }}
      onClick={(event) => {
        const start = dismissPointer.current;
        dismissPointer.current = null;
        if (skipBackdropClose.current) {
          skipBackdropClose.current = false;
          return;
        }
        if (!start || event.target !== event.currentTarget) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
        close();
      }}
    >
      <header className="aurora-briefing-head" onPointerDown={beginMove}>
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

        <section className="aurora-briefing-map-panel">
          <h3>今晚各區極光分數</h3>
          <p>
            {formatBriefingHourLabel(briefing.hours[hourIndex]?.hour ?? "—")}
            {" "}示意分區平均分數；西南部含首都圈。拉動時段可對照下方表格。
          </p>
          <AuroraBriefingMap
            regions={briefing.mapRegions}
            hourIndex={hourIndex}
            hourLabel={formatBriefingHourLabel(briefing.hours[hourIndex]?.hour ?? "—")}
          />
          <label className="aurora-briefing-slider">
            <span className="aurora-briefing-slider-label">觀測時段</span>
            <input
              type="range"
              min={0}
              max={briefing.hours.length - 1}
              step={1}
              value={hourIndex}
              aria-valuetext={formatBriefingHourLabel(briefing.hours[hourIndex]?.hour ?? "—")}
              onChange={(event) => setHourOverride(Number(event.target.value))}
            />
            <span className="aurora-briefing-slider-hours">
              {briefing.hours.map((hour, index) => (
                <button
                  key={hour.time}
                  type="button"
                  className={index === hourIndex ? "is-hour-selected" : undefined}
                  onClick={() => setHourOverride(index)}
                >
                  {hour.hour}
                </button>
              ))}
            </span>
          </label>
          <p className="aurora-briefing-map-legend">
            {SCORE_LEGEND.map(([color, label]) => (
              <span key={label}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
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
                {briefing.hours.map((hour, index) => (
                  <strong role="columnheader" key={hour.time} className={hourCell(index)}>
                    {hour.hour}
                  </strong>
                ))}
              </div>
              <div role="row" className="aurora-briefing-row">
                <span role="rowheader">Kp</span>
                {briefing.hours.map((hour, index) => (
                  <span role="cell" key={hour.time} className={hourCell(index)}>
                    {hour.kp.toFixed(0)}
                  </span>
                ))}
              </div>
              <div role="row" className="aurora-briefing-row">
                <span role="rowheader">最佳分數</span>
                {briefing.hours.map((hour, index) => (
                  <strong
                    role="cell"
                    key={hour.time}
                    className={hourCell(index)}
                    style={{ color: hour.best.color }}
                  >
                    {hour.best.score}
                  </strong>
                ))}
              </div>
              <div role="row" className="aurora-briefing-row aurora-briefing-sky">
                <span role="rowheader">天色</span>
                {briefing.hours.map((hour, index) => (
                  <span role="cell" key={hour.time} className={hourCell(index)}>
                    {skyLightLabel(hour.best)}
                  </span>
                ))}
              </div>
              <div
                role="row"
                className="aurora-briefing-row aurora-briefing-sites"
              >
                <span role="rowheader">最佳地點</span>
                {briefing.hours.map((hour, index) => {
                  const siteLabel = briefingBestSiteLabel(hour.best);
                  return (
                    <span
                      role="cell"
                      key={hour.time}
                      className={hourCell(index)}
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
            {briefing.hours.map((hour, index) => {
              const siteLabel = briefingBestSiteLabel(hour.best);
              const bestHourCard = hour.best === briefing.best;
              return (
                <li
                  key={hour.time}
                  className={[
                    "aurora-briefing-hour-card",
                    bestHourCard ? "is-best" : "",
                    index === hourIndex ? "is-hour-selected" : "",
                  ].filter(Boolean).join(" ")}
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
                {briefing.hours.map((hour, index) => (
                  <strong role="columnheader" key={hour.time} className={hourCell(index)}>
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
                      className={index === hourIndex ? "aurora-briefing-cloud is-hour-selected" : "aurora-briefing-cloud"}
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
                      className={index === hourIndex ? "aurora-briefing-cloud is-hour-selected" : "aurora-briefing-cloud"}
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
      <button
        type="button"
        className="aurora-briefing-resize"
        aria-label="拖曳以調整快報視窗高度"
        onPointerDown={beginResize}
        onClick={(event) => event.stopPropagation()}
      />

    </dialog>
  );
}
