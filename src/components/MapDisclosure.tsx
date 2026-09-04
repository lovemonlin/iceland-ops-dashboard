"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A collapsed map, opened on demand.
 *
 * This is an ops dashboard: the summary at the top must stay cheap, so nothing inside is mounted
 * until someone asks for it. Once opened it stays mounted and is only hidden on collapse, so a
 * loaded map keeps its data and its camera rather than downloading everything again.
 *
 * Built from a button rather than `<details>` so the expanded state is explicit to assistive
 * technology and the child can be kept alive independently of whether it is visible.
 */
export function MapDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelId = useId();

  return (
    <div className="map-disclosure">
      <button
        type="button"
        className="map-disclosure-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
          setMounted(true);
        }}
      >
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> {label}
      </button>
      <div id={panelId} className="map-disclosure-panel" hidden={!open}>
        {mounted ? children : null}
      </div>
    </div>
  );
}
