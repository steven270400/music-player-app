export const DISC_PERIOD_MS = 8000;
export const TITLE_DWELL_MS = 1200;
export const TITLE_GAP = 40;

export function marqueeMetrics(textWidth: number, viewportWidth: number) {
  const overflow = viewportWidth > 0 && textWidth > viewportWidth + 1;
  const distance = textWidth + TITLE_GAP;
  const duration = TITLE_DWELL_MS + distance / 30 * 1000;
  return { overflow, distance, duration, dwellFraction: TITLE_DWELL_MS / duration };
}

/** Measured safe-area space left after the header and controls, in dp. */
export function artworkRegion(available: number, queueOpen: boolean) {
  const free = Math.max(0, available);
  return queueOpen ? Math.min(96, Math.max(0, free - 120)) : free;
}

export function queueGeometry(height: number, controls: number, width: number) {
  const closed = Math.max(0, height - controls);
  const open = artworkRegion(closed, true);
  const size = Math.max(0, Math.min(296, width - 48));
  return { closed, open, travel: closed - open, queueHeight: Math.max(0, height - open - controls),
    closedScale: Math.min(1, closed / (size + 24)) * size / 296,
    openScale: Math.min(1, open / (size + 24)) * size / 296 };
}

export const queueDuration = (from: number, to: number) => 220 * Math.min(1, Math.abs(to - from));
