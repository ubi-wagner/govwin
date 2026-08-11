/**
 * Region proposer — the "machine draws the boxes" half of the box-ingestion loop (BOX-2).
 *
 * A VISION model, shown a rendered frame (screen grab / uploaded image / PDF page), would return
 * bounding boxes for the figures & tables worth grabbing. This sandbox's LLM is `sk-noop` (no
 * vision), so `proposeDemoRegions` is the deterministic STAND-IN: it seeds plausible figure/table
 * regions from the frame geometry. It returns the SAME shape a vision detector would, so the
 * `/atoms/propose-regions` route swaps real detection in without touching the client.
 *
 * ADVISORY by contract: proposals only PRE-POPULATE the box tool — the human reviews, edits, or
 * deletes every box, and nothing becomes an atom until they hit Atomize. The machine never writes.
 */
export interface ProposedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  kind: string; // figure | table | … — lands as a `kind` tag suggestion the human can confirm
}

/**
 * Deterministic demo proposal: plausible figure (upper) + table (lower) regions scaled to the
 * frame, clamped to bounds. Pure + unit-testable; no LLM, no I/O.
 */
export function proposeDemoRegions(width: number, height: number): ProposedRegion[] {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const px = (fx: number) => Math.round(w * fx);
  const py = (fy: number) => Math.round(h * fy);
  const raw: ProposedRegion[] = [
    { x: px(0.10), y: py(0.12), w: px(0.52), h: py(0.30), title: 'Suggested figure', kind: 'figure' },
    { x: px(0.10), y: py(0.55), w: px(0.80), h: py(0.32), title: 'Suggested table', kind: 'table' },
  ];
  // Clamp every box inside the frame (never propose a region that runs off the edge), drop slivers.
  return raw
    .map((r) => ({ ...r, w: Math.min(r.w, w - r.x), h: Math.min(r.h, h - r.y) }))
    .filter((r) => r.w > 8 && r.h > 8);
}
