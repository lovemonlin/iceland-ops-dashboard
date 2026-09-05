"use client";

import { useEffect, useRef } from "react";
import {
  DIALOG_HOURS_SHOWN,
  effectiveObstruction,
  formatForecastHour,
  nextHours,
  obstructionColorFor,
  weatherSymbolFor,
  WIND_ARROW_PATHS,
  type WeatherHour,
} from "@/lib/weatherMap";

/**
 * One site's hour-by-hour forecast — the port of `ui/home/SiteForecastDialog.kt`.
 *
 * Opened from a list row and from a map point, and it is the same component for both: the app
 * routes both through one `onSelectSite`, and two implementations would drift.
 *
 * No request is made to open it. The whole series was already stored in the snapshot when the
 * overview was collected, exactly as the app's dialog reads what `WeatherOverviewViewModel` had
 * already fetched.
 *
 * `HOURS_SHOWN` is 24, and deliberately not the timeline's 48: the dialog and the overview
 * timeline are two separate behaviours in the app.
 */

export interface ForecastSite {
  id: string;
  nameZh: string;
  nameIs: string;
  name: string;
  hours?: WeatherHour[];
}

function WindArrow({ speed, fromDirection }: { speed?: number; fromDirection?: number }) {
  return (
    <span className="wind-arrow">
      {fromDirection !== undefined && (
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          style={{ transform: `rotate(${fromDirection + 180}deg)` }}
        >
          {WIND_ARROW_PATHS.map((path) => (
            <path key={path} d={path} />
          ))}
        </svg>
      )}
      <span>{speed === undefined ? "—" : Math.round(speed)}</span>
    </span>
  );
}

export function SiteForecastDialog({
  site,
  from,
  onClose,
}: {
  site: ForecastSite;
  /** The moment the list starts from — the timeline's currently selected hour. */
  from: Date;
  onClose: () => void;
}) {
  const hours = nextHours(site.hours, from, DIALOG_HOURS_SHOWN);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes it, and focus starts on the close control so the keyboard is not trapped.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="forecast-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="forecast-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${site.nameZh || site.name} 逐時預報`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="forecast-dialog-head">
          <div>
            <strong>{site.nameZh || site.name}</strong>
            <span>{site.nameIs}</span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        {hours.length === 0 ? (
          <p className="muted-line">沒有這個地點的預報資料。</p>
        ) : (
          <>
            <p className="forecast-dialog-title">未來 24 小時</p>
            <div className="forecast-rows" role="table">
              <div className="forecast-row forecast-row-head" role="row">
                <span role="columnheader">時間</span>
                <span aria-hidden="true" />
                <span role="columnheader">氣溫</span>
                <span role="columnheader">風速</span>
                <span role="columnheader">雲量</span>
              </div>
              {hours.map((hour, index) => {
                const symbol = weatherSymbolFor(hour.symbolCode);
                const obstruction = effectiveObstruction(hour);
                // The app highlights the first row: it is the hour you are looking at.
                const isFirst = index === 0;
                return (
                  <div
                    key={hour.time}
                    role="row"
                    className={`forecast-row${isFirst ? " current" : ""}`}
                  >
                    <span role="cell">{formatForecastHour(hour.time)}</span>
                    <span role="cell" className="forecast-symbol">
                      <svg width={18} height={18} viewBox="0 0 24 24" fill={symbol.tint} aria-label={symbol.label}>
                        {symbol.paths.map((path) => (
                          <path key={path} d={path} />
                        ))}
                      </svg>
                    </span>
                    <span role="cell">{hour.temperatureC === undefined ? "—" : `${Math.round(hour.temperatureC)}°`}</span>
                    <span role="cell">
                      <WindArrow speed={hour.windMps} fromDirection={hour.windFromDirection} />
                    </span>
                    <span role="cell" style={{ color: obstructionColorFor(obstruction) }}>
                      {Math.trunc(obstruction)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="muted-line">時間為冰島當地時間。資料來自這份快照，開啟不會再向來源抓取。</p>
      </div>
    </div>
  );
}
