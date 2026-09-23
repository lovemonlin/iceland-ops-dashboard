export const IMO_DIALOG_COMPACT = "(max-width: 719px)";
export const IMO_DIALOG_MIN_WIDTH = 760;
export const IMO_DIALOG_MIN_HEIGHT = 520;

export function clampImoDialogSize(
  width: number,
  height: number,
  viewport: { width: number; height: number },
) {
  const maxWidth = Math.round(viewport.width * 0.96);
  const maxHeight = Math.round(viewport.height * 0.94);
  const minWidth = Math.min(IMO_DIALOG_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(IMO_DIALOG_MIN_HEIGHT, maxHeight);
  return {
    width: Math.min(maxWidth, Math.max(minWidth, Math.round(width))),
    height: Math.min(maxHeight, Math.max(minHeight, Math.round(height))),
  };
}

/** Keep the header and close control on-screen, matching the briefing dialog. */
export function clampImoDialogPlace(
  left: number,
  top: number,
  width: number,
  viewport: { width: number; height: number },
) {
  return {
    left: Math.min(viewport.width - 80, Math.max(80 - width, Math.round(left))),
    top: Math.min(viewport.height - 48, Math.max(0, Math.round(top))),
  };
}
