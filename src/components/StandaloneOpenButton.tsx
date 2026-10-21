"use client";

import type { MouseEvent } from "react";
import { getPublicPagePath } from "@/lib/publicPath";

type ViewerKind = "weather" | "cloud" | "roads";

export function StandaloneOpenButton({
  kind,
  query,
}: {
  kind: ViewerKind;
  query: URLSearchParams;
}) {
  const href = `${getPublicPagePath(`/${kind}/`)}?${query.toString()}`;
  const name = `iceland-${kind === "roads" ? "road" : kind}-viewer`;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    const viewer = window.open(href, name, "popup=yes,resizable=yes,scrollbars=yes,width=1400,height=900");
    if (viewer) {
      event.preventDefault();
      viewer.focus();
    }
    // If blocked, let the anchor's normal target="_blank" navigation try a new tab.
  };

  return (
    <a className="standalone-open" href={href} target="_blank" rel="noopener noreferrer" onClick={open}>
      ⛶ 獨立檢視
    </a>
  );
}
