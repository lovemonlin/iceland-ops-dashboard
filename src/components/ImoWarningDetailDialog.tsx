"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ImoWarningMap } from "@/components/ImoWarningMap";
import {
  resolveImoWarningDialog,
  ringsFromWarning,
  type ImoWarningMapModel,
} from "@/lib/imoWarningMap";
import {
  formatIcelandDayClock,
  formatIcelandStamp,
  IMO_PHASE_CODE,
  IMO_PHASE_LABEL,
  IMO_RANK_CODE,
  imoLevelLabel,
  imoWarningLifecycleSteps,
  type ImoWarningFeed,
  type ImoWarningPhase,
  type ImoWarningRank,
  type PresentedImoWarning,
} from "@/lib/imoWarningPresentation";
import {
  IMO_ZH_UNTRANSLATED,
  translateImoArea,
  translateImoDescription,
  translateImoEvent,
  translateImoHeadline,
  translateImoInstruction,
} from "@/lib/imoWarningZhTw";
import {
  clampImoDialogPlace,
  clampImoDialogSize,
  IMO_DIALOG_COMPACT,
} from "@/lib/imoWarningDialogLayout";
import { isWindRelatedImoWarning, splitImoWindSpeeds } from "@/lib/imoWindSpeed";
import { formatDateTime } from "@/lib/time";

function utcStamp(iso?: string) {
  return iso && !Number.isNaN(Date.parse(iso)) ? formatDateTime(iso, "UTC") : undefined;
}

function SeverityBadge({ rank }: { rank: ImoWarningRank }) {
  return (
    <span className={`imo-warning-dialog-badge is-severity is-${rank}`}>
      <span aria-hidden="true" className="imo-warning-dialog-dot" />
      <span>
        <strong>{IMO_RANK_CODE[rank]}</strong>
        <small>{imoLevelLabel(rank).replace(/^[^\s]+\s/, "")}</small>
      </span>
    </span>
  );
}

function PhaseBadge({ phase }: { phase: ImoWarningPhase }) {
  return (
    <span className={`imo-warning-dialog-badge is-phase is-${phase}`}>
      <strong>{IMO_PHASE_CODE[phase]}</strong>
      <small>{IMO_PHASE_LABEL[phase]}</small>
    </span>
  );
}

function TelemetryTile({
  code,
  zh,
  children,
  emphasis,
}: {
  code: string;
  zh: string;
  children: ReactNode;
  emphasis?: "high" | "low";
}) {
  return (
    <div className={`imo-warning-dialog-tile${emphasis === "high" ? " is-emphasis" : ""}${emphasis === "low" ? " is-quiet" : ""}`}>
      <p className="imo-warning-dialog-kicker">
        {code}
        <span>{zh}</span>
      </p>
      {children}
    </div>
  );
}

function TimeTile({
  code,
  zh,
  iso,
  emphasis,
}: {
  code: string;
  zh: string;
  iso?: string;
  emphasis?: "high" | "low";
}) {
  const parts = formatIcelandDayClock(iso);
  const utc = utcStamp(iso);
  return (
    <TelemetryTile code={code} zh={zh} emphasis={emphasis}>
      <p className="imo-warning-dialog-time-day">{parts?.day ?? "—"}</p>
      <p className="imo-warning-dialog-time-clock">{parts?.clock ?? "—"}</p>
      <p className="imo-warning-dialog-iceland">Iceland</p>
      {utc && <p className="imo-warning-dialog-utc">UTC {utc}</p>}
    </TelemetryTile>
  );
}

function LifecycleStrip({
  phase,
  sent,
  onset,
  expires,
}: {
  phase: ImoWarningPhase;
  sent?: string;
  onset?: string;
  expires?: string;
}) {
  const keys = imoWarningLifecycleSteps(phase);
  if (!keys) {
    return (
      <section className="imo-warning-dialog-lifecycle">
        <p className="imo-warning-dialog-kicker">ALERT LIFECYCLE</p>
        <p className="imo-warning-dialog-lifecycle-empty">時間資料不足</p>
      </section>
    );
  }
  const stamp = {
    published: formatIcelandStamp(sent),
    now: "NOW",
    start: formatIcelandStamp(onset),
    end: formatIcelandStamp(expires),
  };
  const label = { published: "PUBLISHED", now: "NOW", start: "START", end: "END" };
  return (
    <section className="imo-warning-dialog-lifecycle" aria-label="警報生命週期">
      <p className="imo-warning-dialog-kicker">ALERT LIFECYCLE</p>
      <ol className={`imo-warning-dialog-lifecycle-track is-${phase}`}>
        {keys.map((key) => (
          <li key={key} className={`imo-warning-dialog-lifecycle-node is-${key}`}>
            <span className="imo-warning-dialog-lifecycle-mark" aria-hidden="true" />
            <strong>{label[key]}</strong>
            <small>{stamp[key]}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ImoWindSpeedText({ text, enabled }: { text: string; enabled: boolean }) {
  if (!enabled) return text;
  return (
    <>
      {splitImoWindSpeeds(text).map((part, index) =>
        part.speed ? (
          <span key={index} className="imo-wind-speed">
            {part.value}
          </span>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </>
  );
}

function OriginalBlock({
  title,
  lines,
  highlightWind,
}: {
  title: string;
  lines: { label: string; value?: string }[];
  highlightWind: boolean;
}) {
  const present = lines.filter((line) => line.value);
  if (present.length === 0) return null;
  return (
    <details className="imo-warning-dialog-original">
      <summary>{title}</summary>
      {present.map((line) => (
        <div key={line.label}>
          <p className="imo-warning-dialog-kicker">{line.label}</p>
          <p>
            <ImoWindSpeedText text={line.value ?? ""} enabled={highlightWind} />
          </p>
        </div>
      ))}
    </details>
  );
}

export function ImoWarningDetailDialog({
  feed,
  map,
  open,
  stale,
  onClose,
}: {
  feed: ImoWarningFeed;
  map: ImoWarningMapModel;
  open: { regionId?: string; warningId?: string };
  stale: boolean;
  onClose: () => void;
}) {
  const resolved = resolveImoWarningDialog(feed, open);
  const [warningId, setWarningId] = useState(resolved?.active.warning.identifier ?? open.warningId ?? "");
  const [dialogSize, setDialogSize] = useState<{ width: number; height: number }>();
  const [dialogPlace, setDialogPlace] = useState<{ left: number; top: number }>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<
    | { type: "resize"; pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number }
    | { type: "move"; pointerId: number; startX: number; startY: number; startLeft: number; startTop: number }
    | null
  >(null);
  const dismissPointer = useRef<{ x: number; y: number } | null>(null);
  const skipBackdropClose = useRef(false);
  const tabBase = useId();

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      restoreRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const compact = () => window.matchMedia(IMO_DIALOG_COMPACT).matches;
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const applySize = (width: number, height: number) => {
      const dialog = dialogRef.current;
      const next = clampImoDialogSize(width, height, viewport());
      dialog?.style.setProperty("width", `${next.width}px`, "important");
      dialog?.style.setProperty("height", `${next.height}px`, "important");
      dialog?.style.setProperty("max-width", "96vw", "important");
      dialog?.style.setProperty("max-height", "94dvh", "important");
      setDialogSize(next);
      return next;
    };
    const applyPlace = (left: number, top: number, width: number) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const next = clampImoDialogPlace(left, top, width, viewport());
      dialog.style.position = "fixed";
      dialog.style.margin = "0";
      dialog.style.left = `${next.left}px`;
      dialog.style.top = `${next.top}px`;
      setDialogPlace(next);
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const dialog = dialogRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !dialog || compact()) return;
      if (drag.type === "resize") {
        const next = applySize(
          drag.startWidth + event.clientX - drag.startX,
          drag.startHeight + event.clientY - drag.startY,
        );
        applyPlace(dialog.getBoundingClientRect().left, dialog.getBoundingClientRect().top, next.width);
        return;
      }
      const box = dialog.getBoundingClientRect();
      applyPlace(drag.startLeft + event.clientX - drag.startX, drag.startTop + event.clientY - drag.startY, box.width);
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

  if (!resolved) return null;
  const current = resolveImoWarningDialog(feed, { regionId: resolved.region.id, warningId }) ?? resolved;
  const { region, tabs, active } = current;
  const area = translateImoArea(region.name);
  const event = translateImoEvent(active.warning.eventEn ?? active.warning.eventIs);
  const headline = translateImoHeadline(active.warning.headlineEn);
  const description = translateImoDescription(active.warning.descriptionEn);
  const instruction = translateImoInstruction(active.warning.instructionEn);
  const hasPolygon = ringsFromWarning(active.warning).length > 0;
  const panelId = `${tabBase}-panel`;
  const areaId = active.warning.areaId;
  const highlightWind = isWindRelatedImoWarning(active.warning.eventEn, active.warning.headlineEn);

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

  const beginMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia(IMO_DIALOG_COMPACT).matches) return;
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

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.matchMedia(IMO_DIALOG_COMPACT).matches) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const box = dialog.getBoundingClientRect();
    pinDialog(dialog, box);
    dragRef.current = {
      type: "resize",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: box.width,
      startHeight: box.height,
    };
    skipBackdropClose.current = true;
    dismissPointer.current = null;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveTab = (delta: number) => {
    const index = tabs.findIndex((card) => card.warning.identifier === active.warning.identifier);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) setWarningId(next.warning.identifier);
  };

  return (
    <dialog
      ref={dialogRef}
      className={`imo-warning-dialog is-${active.rank}`}
      style={{
        ...(dialogSize === undefined ? {} : { width: dialogSize.width, height: dialogSize.height, maxWidth: "96vw", maxHeight: "94dvh" }),
        ...(dialogPlace ? { position: "fixed", margin: 0, left: dialogPlace.left, top: dialogPlace.top } : {}),
      }}
      aria-labelledby="imo-warning-dialog-title"
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
      <header className="imo-warning-dialog-header" onPointerDown={beginMove}>
        <div className="imo-warning-dialog-header-copy">
          <p className="imo-warning-dialog-kicker">WEATHER ALERT / IMO</p>
          <h2 id="imo-warning-dialog-title">{event.text || "天氣警報"}</h2>
          <p className="imo-warning-dialog-region">
            {area.text || region.name}
            {region.name && <span> · {region.name}</span>}
          </p>
          {stale && <p className="imo-warnings-stale">⚠ 警報資料目前無法更新</p>}
        </div>
        <div className="imo-warning-dialog-header-status">
          <SeverityBadge rank={active.rank} />
          <PhaseBadge phase={active.phase} />
          <button ref={closeRef} type="button" onClick={close} aria-label="關閉">
            ×
          </button>
        </div>
      </header>

      <div className="imo-warning-dialog-body">
        <div className="imo-warning-dialog-map">
          <p className="imo-warning-dialog-kicker">
            AFFECTED AREA
            <span>影響區域</span>
          </p>
          {map.status === "ready" ? (
            <ImoWarningMap model={map} mode="detail" selectedId={region.id} activeWarningId={active.warning.identifier} />
          ) : null}
          {!hasPolygon && <p className="imo-warnings-lead">此警報沒有可用的區域圖形資料</p>}
          <dl className="imo-warning-dialog-map-meta">
            <div>
              <dt>REGION</dt>
              <dd>{area.text || region.name}</dd>
            </div>
            {areaId !== undefined && areaId !== "" && (
              <div>
                <dt>AREA ID</dt>
                <dd>{areaId}</dd>
              </div>
            )}
            <div>
              <dt>WARNINGS</dt>
              <dd>{tabs.length}</dd>
            </div>
          </dl>
        </div>

        <div className="imo-warning-dialog-detail">
          <div
            className="imo-warning-dialog-tabs"
            role="tablist"
            aria-label="此區天氣警報"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                moveTab(1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveTab(-1);
              }
            }}
          >
            {tabs.map((card, index) => {
              const selected = card.warning.identifier === active.warning.identifier;
              const label = translateImoEvent(card.warning.eventEn ?? card.warning.eventIs);
              return (
                <button
                  key={card.warning.identifier}
                  type="button"
                  role="tab"
                  id={`${tabBase}-${card.warning.identifier}`}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  className={`imo-warning-dialog-tab is-${card.rank}${selected ? " is-active" : ""}`}
                  onClick={() => setWarningId(card.warning.identifier)}
                >
                  <span className="imo-warning-dialog-tab-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="imo-warning-dialog-tab-event">
                    <span aria-hidden="true">{card.icon}</span> {label.text}
                  </span>
                  <span className="imo-warning-dialog-tab-rank">{IMO_RANK_CODE[card.rank]}</span>
                </button>
              );
            })}
          </div>

          <div
            className="imo-warning-dialog-pane"
            role="tabpanel"
            id={panelId}
            aria-labelledby={`${tabBase}-${active.warning.identifier}`}
          >
            <section className="imo-warning-dialog-incident">
              <p className="imo-warning-dialog-kicker">INCIDENT SUMMARY</p>
              {headline.text && <p className="imo-warning-dialog-headline"><ImoWindSpeedText text={headline.text} enabled={highlightWind} /></p>}
              {active.warning.headlineEn && !headline.translated && <p className="imo-warning-zh-note">{IMO_ZH_UNTRANSLATED}</p>}
              <dl className="imo-warning-dialog-incident-meta">
                <div>
                  <dt>中文事件</dt>
                  <dd>
                    {event.text}
                    {!event.translated && event.text && <span className="imo-warning-zh-note"> {IMO_ZH_UNTRANSLATED}</span>}
                  </dd>
                </div>
                <div>
                  <dt>區域</dt>
                  <dd>{area.text || region.name}</dd>
                </div>
                <div>
                  <dt>時間窗</dt>
                  <dd className="imo-warning-dialog-window">{active.windowLabel}</dd>
                </div>
              </dl>
            </section>

            <section className="imo-warning-dialog-telemetry" aria-label="警報資料">
              <TelemetryTile code="SEVERITY" zh="警報等級">
                <p className="imo-warning-dialog-tile-value">{IMO_RANK_CODE[active.rank]}</p>
                <p>{imoLevelLabel(active.rank)}</p>
              </TelemetryTile>
              <TelemetryTile code="STATUS" zh="狀態">
                <p className="imo-warning-dialog-tile-value">{IMO_PHASE_CODE[active.phase]}</p>
                <p>{IMO_PHASE_LABEL[active.phase]}</p>
              </TelemetryTile>
              <TelemetryTile code="REGION" zh="區域">
                <p className="imo-warning-dialog-tile-value">{area.text || region.name}</p>
              </TelemetryTile>
              <TimeTile code="PUBLISHED" zh="發布時間" iso={active.warning.sent} emphasis="low" />
              <TimeTile code="START" zh="開始生效" iso={active.warning.onset} emphasis="high" />
              <TimeTile code="END" zh="警報結束" iso={active.warning.expires} emphasis="high" />
            </section>
            <p className="imo-warning-dialog-tz">ICELAND TIME · Atlantic/Reykjavik</p>

            <LifecycleStrip
              phase={active.phase}
              sent={active.warning.sent}
              onset={active.warning.onset}
              expires={active.warning.expires}
            />

            <section className="imo-warning-dialog-zh">
              <p className="imo-warning-dialog-kicker">繁體中文</p>
              {headline.text && (
                <div>
                  <p className="imo-warning-dialog-kicker">SUMMARY</p>
                  <p className="imo-warning-dialog-headline">
                    <ImoWindSpeedText text={headline.text} enabled={highlightWind} />
                  </p>
                </div>
              )}
              {description.text && (
                <div>
                  <p className="imo-warning-dialog-kicker">DESCRIPTION</p>
                  <p className="imo-warning-dialog-bodycopy">
                    <ImoWindSpeedText text={description.text} enabled={highlightWind} />
                  </p>
                  {active.warning.descriptionEn && !description.translated && (
                    <p className="imo-warning-zh-note">{IMO_ZH_UNTRANSLATED}</p>
                  )}
                </div>
              )}
              {instruction.text && (
                <div className={`imo-warning-dialog-safety is-${active.rank}`}>
                  <p className="imo-warning-dialog-kicker">SAFETY / ACTION</p>
                  <p>
                    <ImoWindSpeedText text={instruction.text} enabled={highlightWind} />
                  </p>
                  {active.warning.instructionEn && !instruction.translated && (
                    <p className="imo-warning-zh-note">{IMO_ZH_UNTRANSLATED}</p>
                  )}
                </div>
              )}
            </section>

            <OriginalBlock
              title="IMO ENGLISH ORIGINAL"
              highlightWind={highlightWind}
              lines={[
                { label: "Event", value: active.warning.eventEn },
                { label: "Headline", value: active.warning.headlineEn },
                { label: "Description", value: active.warning.descriptionEn },
                { label: "Instruction", value: active.warning.instructionEn },
              ]}
            />
            <OriginalBlock
              title="IMO ÍSLENSKA ORIGINAL"
              highlightWind={highlightWind}
              lines={[
                { label: "Atburður", value: active.warning.eventIs },
                { label: "Fyrirsögn", value: active.warning.headlineIs },
                { label: "Lýsing", value: active.warning.descriptionIs },
                { label: "Leiðbeiningar", value: active.warning.instructionIs },
              ]}
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        className="imo-warning-dialog-resize"
        aria-label="拖曳以調整警報視窗大小"
        onPointerDown={beginResize}
        onClick={(event) => event.stopPropagation()}
      />
    </dialog>
  );
}

export function ImoWarningCard({
  card,
  onOpen,
}: {
  card: PresentedImoWarning;
  onOpen: () => void;
}) {
  const area = translateImoArea(card.areaLabel);
  const event = translateImoEvent(card.warning.eventEn ?? card.warning.eventIs);
  const headline = translateImoHeadline(card.warning.headlineEn);
  return (
    <article id={`imo-warning-${card.warning.identifier}`} className={`imo-warning-card warning-${card.rank}`}>
      <header className="imo-warning-card-head">
        <strong>{imoLevelLabel(card.rank)}</strong>
        <span>{area.text || card.areaLabel}</span>
      </header>
      <p className="imo-warning-event">
        <span aria-hidden="true">{card.icon}</span> {event.translated ? event.text : `🌐 ${event.text || "事件未提供"}`}
      </p>
      <p className="imo-warning-phase">{IMO_PHASE_LABEL[card.phase]}</p>
      <p className="imo-warning-time">
        <span>冰島時間</span>
        {card.windowLabel}
      </p>
      {headline.text && <p className="imo-warning-headline">{headline.text}</p>}
      <button type="button" className="imo-warning-open" onClick={onOpen}>
        查看詳情 →
      </button>
    </article>
  );
}
