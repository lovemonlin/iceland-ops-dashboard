import {
  IMO_WIND_IMPACT_IMAGE,
  IMO_WIND_IMPACT_IMAGES_READY,
  IMO_WIND_IMPACT_LEVELS,
  formatImoWindGust,
  formatImoWindSpan,
  presentImoWindImpact,
  type ImoWindImpactLevel,
  type ImoWindImpactView,
} from "@/lib/imoWindImpact";
import { translateImoDescription } from "@/lib/imoWarningZhTw";
import type { PresentedImoWarning } from "@/lib/imoWarningPresentation";

function WindPersonFigure({ level, alt }: { level: ImoWindImpactLevel; alt: string }) {
  const src = IMO_WIND_IMPACT_IMAGE[level.id];
  return (
    <div
      className={`imo-wind-impact-art is-${level.id}`}
      data-illustration={level.illustrationKey}
      data-asset={src}
    >
      {IMO_WIND_IMPACT_IMAGES_READY ? (
        // Local static assets in public/; the project has no next/image usage.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} width={320} height={240} />
      ) : (
        <svg viewBox="0 0 160 120" role="img" aria-label={alt}>
          <title>{alt}</title>
          <g className="imo-wind-impact-lines" aria-hidden="true">
            <path d="M8 28h52" />
            <path d="M18 44h58" />
            <path d="M6 60h48" />
            <path d="M22 76h50" />
          </g>
          <g className="imo-wind-impact-person" aria-hidden="true">
            <circle cx="96" cy="28" r="10" />
            <path d="M96 40v28" />
            <path d="M96 48 L78 62" />
            <path d="M96 48 L118 58" />
            <path d="M96 68 L82 98" />
            <path d="M96 68 L112 98" />
          </g>
        </svg>
      )}
    </div>
  );
}

function Scale({ view }: { view: ImoWindImpactView }) {
  const activeIds = new Set(view.active.map((level) => level.id));
  const lastOn = activeIds.has("storm_like");
  return (
    <ol className="imo-wind-impact-scale" aria-label="風速體感等級帶">
      {IMO_WIND_IMPACT_LEVELS.map((level) => {
        const on = activeIds.has(level.id);
        return (
          <li
            key={level.id}
            className={on ? "is-active" : undefined}
            aria-current={on ? "true" : undefined}
          >
            <span className="imo-wind-impact-scale-band">{level.bandLabel}</span>
            {on && <span className="imo-wind-impact-scale-mark">●</span>}
            {level.id === "storm_like" && lastOn && view.sustained.max >= 25 && (
              <span className="imo-wind-impact-scale-extra">25+ included</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ImpactList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="imo-wind-impact-card">
      <p className="imo-warning-dialog-kicker">{title}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function ImoWindImpactPanel({ warning }: { warning: PresentedImoWarning["warning"] }) {
  const view = presentImoWindImpact({
    eventEn: warning.eventEn,
    headlineEn: warning.headlineEn,
    descriptionEn: warning.descriptionEn,
    descriptionIs: warning.descriptionIs,
    descriptionZh: translateImoDescription(warning.descriptionEn).text,
  });
  if (!view) return null;
  const peak = view.to;
  return (
    <section className="imo-wind-impact" aria-labelledby="imo-wind-impact-title">
      <header className="imo-wind-impact-head">
        <div>
          <p className="imo-warning-dialog-kicker">
            WIND IMPACT
            <span>風速體感</span>
          </p>
          <h3 id="imo-wind-impact-title">風速體感</h3>
        </div>
        <p className="imo-wind-impact-ref">
          TRAVEL REFERENCE
          <span>旅遊情境參考</span>
        </p>
      </header>

      <div className="imo-wind-impact-hero">
        <WindPersonFigure level={peak} alt={peak.altZh} />
        <div className="imo-wind-impact-stats">
          <p className="imo-warning-dialog-kicker">平均風速</p>
          <p className="imo-wind-impact-mean">{formatImoWindSpan(view.sustained)}</p>
          {view.gust && (
            <p className="imo-wind-impact-gust">
              <span className="imo-wind-impact-gust-badge">GUST</span>
              <span className="imo-wind-speed">{formatImoWindGust(view.gust)}</span>
              <span className="imo-wind-impact-gust-note">局部陣風</span>
            </p>
          )}
          <p className="imo-warning-dialog-kicker">體感</p>
          <p className="imo-wind-impact-feel">{view.feelLabelZh}</p>
          <p className="imo-wind-impact-lead">{peak.shortDescriptionZh}</p>
        </div>
      </div>

      {view.gust && (
        <p className="imo-wind-impact-gust-hint">陣風可能明顯高於平均風速，短時間體感會更強。</p>
      )}

      <Scale view={view} />

      <div className="imo-wind-impact-grid">
        <ImpactList title="人體感受" items={peak.personImpactZh} />
        <ImpactList title="戶外環境影響" items={peak.environmentImpactZh} />
        <ImpactList title="自駕感受" items={peak.drivingImpactZh} />
        <ImpactList title="行動提醒" items={peak.activityAdviceZh} />
      </div>

      <p className="imo-wind-impact-photo">
        <span className="imo-warning-dialog-kicker">PHOTO / 拍攝</span>
        {peak.photoAdviceZh.join(" ")}
      </p>

      <p className="imo-wind-impact-disclaimer">
        風速體感為旅遊與戶外活動的實務參考，實際影響會因地形、風向、陣風、降雨／降雪、路況與車型而異。IMO
        官方警報等級仍以本警報的 Yellow / Orange / Red 為準。體感分級為旅遊情境參考，不是 IMO
        官方警報顏色判定規則。
      </p>
    </section>
  );
}
