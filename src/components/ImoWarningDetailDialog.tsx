"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImoWarningMap } from "@/components/ImoWarningMap";
import {
  resolveImoWarningDialog,
  ringsFromWarning,
  summarizeWarningRegion,
  type ImoWarningMapModel,
} from "@/lib/imoWarningMap";
import {
  formatIcelandStamp,
  IMO_PHASE_LABEL,
  imoLevelLabel,
  type ImoWarningFeed,
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
import { formatDateTime } from "@/lib/time";

function TimeRow({ label, iso }: { label: string; iso?: string }) {
  const utc = iso && !Number.isNaN(Date.parse(iso)) ? formatDateTime(iso, "UTC") : undefined;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{formatIcelandStamp(iso)}</strong>
        {utc && <small>UTC {utc}</small>}
      </dd>
    </div>
  );
}

function LanguageBlock({
  title,
  lines,
}: {
  title: string;
  lines: { label: string; value?: string; note?: boolean }[];
}) {
  const present = lines.filter((line) => line.value);
  if (present.length === 0) return null;
  return (
    <section className="imo-warning-dialog-language">
      <h4>{title}</h4>
      {present.map((line) => (
        <div key={line.label}>
          <p className="imo-warning-dialog-kicker">{line.label}</p>
          <p>{line.value}</p>
          {line.note && <p className="imo-warning-zh-note">{IMO_ZH_UNTRANSLATED}</p>}
        </div>
      ))}
    </section>
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
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

  if (!resolved) return null;
  const current = resolveImoWarningDialog(feed, { regionId: resolved.region.id, warningId }) ?? resolved;
  const { region, tabs, active } = current;
  const summary = summarizeWarningRegion(region);
  const area = translateImoArea(region.name);
  const event = translateImoEvent(active.warning.eventEn ?? active.warning.eventIs);
  const headline = translateImoHeadline(active.warning.headlineEn);
  const description = translateImoDescription(active.warning.descriptionEn);
  const instruction = translateImoInstruction(active.warning.instructionEn);
  const hasPolygon = ringsFromWarning(active.warning).length > 0;
  const panelId = `${tabBase}-panel`;

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  const moveTab = (delta: number) => {
    const index = tabs.findIndex((card) => card.warning.identifier === active.warning.identifier);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) setWarningId(next.warning.identifier);
  };

  return (
    <dialog
      ref={dialogRef}
      className="imo-warning-dialog"
      aria-labelledby="imo-warning-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <header className="imo-warning-dialog-header">
        <div>
          <h2 id="imo-warning-dialog-title">{area.text || region.name}</h2>
          <p>{summary.countLine}</p>
          {stale && <p className="imo-warnings-stale">⚠ 警報資料目前無法更新</p>}
        </div>
        <button ref={closeRef} type="button" onClick={close} aria-label="關閉">
          ×
        </button>
      </header>

      <div className="imo-warning-dialog-body">
        <div className="imo-warning-dialog-map">
          {map.status === "ready" ? (
            <ImoWarningMap model={map} mode="detail" selectedId={region.id} activeWarningId={active.warning.identifier} />
          ) : null}
          {!hasPolygon && <p className="imo-warnings-lead">此警報沒有可用的區域圖形資料</p>}
        </div>

        <div className="imo-warning-dialog-detail">
          <div className="imo-warning-dialog-tabs" role="tablist" aria-label="此區天氣警報" onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              moveTab(1);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              moveTab(-1);
            }
          }}>
            {tabs.map((card) => {
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
                  className={selected ? "is-active" : undefined}
                  onClick={() => setWarningId(card.warning.identifier)}
                >
                  <span aria-hidden="true">{card.icon}</span> {label.text}
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
            <section className="imo-warning-dialog-facts">
              <h3>快速資訊</h3>
              <dl>
                <div>
                  <dt>警報等級</dt>
                  <dd>{imoLevelLabel(active.rank)}</dd>
                </div>
                <div>
                  <dt>狀態</dt>
                  <dd>{IMO_PHASE_LABEL[active.phase]}</dd>
                </div>
                <div>
                  <dt>區域</dt>
                  <dd>{area.text || region.name}</dd>
                </div>
                <div>
                  <dt>事件</dt>
                  <dd>
                    {event.text}
                    {!event.translated && event.text && <span className="imo-warning-zh-note"> {IMO_ZH_UNTRANSLATED}</span>}
                  </dd>
                </div>
                <TimeRow label="發布時間" iso={active.warning.sent} />
                <TimeRow label="開始生效" iso={active.warning.onset} />
                <TimeRow label="警報結束" iso={active.warning.expires} />
              </dl>
              <p className="imo-warning-dialog-tz">主要時間為冰島時間（Atlantic/Reykjavik）</p>
            </section>

            <LanguageBlock
              title="繁體中文"
              lines={[
                { label: "標題", value: headline.text, note: Boolean(active.warning.headlineEn && !headline.translated) },
                { label: "說明", value: description.text, note: Boolean(active.warning.descriptionEn && !description.translated) },
                { label: "安全建議", value: instruction.text, note: Boolean(active.warning.instructionEn && !instruction.translated) },
              ]}
            />
            <LanguageBlock
              title="English / IMO"
              lines={[
                { label: "Event", value: active.warning.eventEn },
                { label: "Headline", value: active.warning.headlineEn },
                { label: "Description", value: active.warning.descriptionEn },
                { label: "Instruction", value: active.warning.instructionEn },
              ]}
            />
            <LanguageBlock
              title="Íslenska / IMO"
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
