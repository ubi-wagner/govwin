/**
 * Proposal figures — the pictures a technical volume needs, generated from its own data.
 *
 * WHY THIS EXISTS. A drafted volume was arriving as headings, paragraphs and bullets: correct,
 * compliant, and a wall of text. Measured against the hand-built reference volume for the same
 * solicitation — 44 images across 5 of its 10 pages — the generated one had none. An evaluator
 * skimming a technical volume navigates by figure first and prose second, so "no figures" is not
 * a cosmetic gap; it is the difference between a document that gets read and one that gets scored.
 *
 * The capability already half-existed: `lib/export/image-raster.ts` knows how to turn an inline
 * SVG `data:` URI into a PNG for docx/pptx, and its own docstring describes "architecture
 * diagrams, charts, headshot/facility placeholders" as the expected input. But the only code that
 * ever PRODUCED those lived inside a one-off generator script, so exactly one proposal ever had
 * them. This is that vocabulary promoted to product code.
 *
 * WHAT THESE ARE — and are not. Every figure is drawn from values the caller passes in: real
 * milestones, real cost lines, real work-share percentages, the real system's own named parts.
 * Nothing here invents a fact. A figure whose data is absent is not emitted — a diagram of
 * nothing is worse than no diagram. The house style is deliberately restrained (flat fills, one
 * accent ramp, no gradients or shadows) because a government proposal is read on a monochrome
 * office printer as often as on a screen.
 *
 * SVG rather than raster, because it survives every path: the PDF exporter renders it natively in
 * HTML, docx/pptx rasterize it through sharp at whatever size they need, and it costs a few
 * hundred bytes instead of a few hundred kilobytes.
 */
import type { CanvasNode } from '@/lib/types/canvas-document';
import { furnitureNode } from '@/lib/proposal/document-furniture';

// ── House palette ────────────────────────────────────────────────────────────
// One cool ramp plus a warm accent for the "this is the delta" element. Every value is a flat
// fill: no gradients, no drop shadows, nothing that turns to mud on a 300dpi mono laser.
const IN = '#0F2942';   // ink — headings inside figures
const P1 = '#14506B';   // primary, darkest
const P2 = '#1C6E8C';
const P3 = '#2E93A8';
const P4 = '#7FBFC9';   // lightest fill
const BG = '#F2F7F8';   // figure ground
const RL = '#C9D8DC';   // rules/strokes
const AC = '#B5651D';   // accent — reserved for the one thing that matters most
const WH = '#FFFFFF';

const FONT = 'Helvetica, Arial, sans-serif';

/** XML-escape text going into an SVG label. Unescaped `&` alone corrupts the whole document. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Truncate a label to fit its box, with an ellipsis rather than an overflow. */
function clip(s: string, max: number): string {
  const t = String(s ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Break a label into at most `lines` word-wrapped rows of ~`per` characters. */
function wrap(s: string, per: number, lines: number): string[] {
  const words = String(s ?? '').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length <= per) { cur += ` ${w}`; continue; }
    out.push(cur); cur = w;
    if (out.length === lines - 1) break;
  }
  if (cur && out.length < lines) out.push(cur);
  // Anything that still does not fit gets ellipsised on the LAST line only.
  const rest = words.slice(out.join(' ').split(/\s+/).length);
  if (rest.length && out.length) out[out.length - 1] = clip(`${out[out.length - 1]} ${rest.join(' ')}`, per);
  return out.length ? out : [clip(String(s ?? ''), per)];
}

/** Wrap an SVG string as an `image` node carrying a base64 `data:` URI. */
function svgNode(svg: string, alt: string, width: number, height: number): CanvasNode {
  const b64 = Buffer.from(svg.replace(/\s+/g, ' ').trim(), 'utf8').toString('base64');
  return furnitureNode('image', {
    storage_key: `data:image/svg+xml;base64,${b64}`,
    alt_text: alt,
    width,
    height,
  }, { alignment: 'center', space_before: 8, space_after: 4 });
}

/** A figure plus its caption, as the two nodes they are. `numberFigures` renumbers them later. */
function figure(svg: string, alt: string, w: number, h: number, caption: string): CanvasNode[] {
  return [
    svgNode(svg, alt, w, h),
    furnitureNode('caption', { prefix: 'Figure', number: 1, text: caption }),
  ];
}

const frame = (w: number, h: number, title: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
     <rect width="${w}" height="${h}" fill="${BG}"/>
     <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="${RL}"/>
     ${title ? `<text x="14" y="22" font-family="${FONT}" font-size="12" font-weight="bold" fill="${IN}">${esc(title)}</text>` : ''}
     ${body}
   </svg>`;

// ─────────────────────────────────────────────────────────────────────────────
// Block diagram — the system, drawn from its own named stages
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowStage {
  /** Box label — the stage's real name. */
  name: string;
  /** Optional second line: what it produces or the technology behind it. */
  detail?: string;
}

/**
 * A left-to-right block diagram of the approach — inputs → processing stages → outputs.
 *
 * This is the figure a technical volume opens with, and the one an evaluator looks at before
 * reading a word. Stages are the offeror's own pipeline steps, so the picture is a restatement of
 * the text rather than decoration. The final stage takes the accent: the thing being delivered.
 */
export function architectureFigure(stages: FlowStage[], title = 'System architecture'): CanvasNode[] {
  const s = stages.filter((x) => x?.name?.trim()).slice(0, 5);
  if (s.length < 2) return [];   // one box is not a diagram

  const W = 468, H = 168;
  const boxW = Math.floor((W - 40 - (s.length - 1) * 22) / s.length);
  const boxH = 66, y = 62;
  const fills = [P1, P2, P3, P2, P1];

  const parts = s.map((st, i) => {
    const x = 20 + i * (boxW + 22);
    const fill = i === s.length - 1 ? AC : fills[i % fills.length];
    const arrow = i < s.length - 1
      ? `<line x1="${x + boxW}" y1="${y + boxH / 2}" x2="${x + boxW + 20}" y2="${y + boxH / 2}" stroke="${IN}" stroke-width="1.5"/>
         <polygon points="${x + boxW + 20},${y + boxH / 2} ${x + boxW + 14},${y + boxH / 2 - 4} ${x + boxW + 14},${y + boxH / 2 + 4}" fill="${IN}"/>`
      : '';
    // Wrap rather than truncate. Clipping produced "production un…" and "optics + firm…", which
    // reads as a rendering failure — a diagram whose own labels are cut off undermines the
    // document it is meant to strengthen. Two short lines at 8pt fit where one clipped line did.
    const label = wrap(st.name, Math.max(9, Math.floor(boxW / 5.6)), 2);
    const detail = st.detail ? wrap(st.detail, Math.max(11, Math.floor(boxW / 4.4)), 2) : [];
    const labelTop = y + (detail.length ? 24 : 34) - (label.length - 1) * 5;
    const labelSvg = label.map((ln, li) =>
      `<text x="${x + boxW / 2}" y="${labelTop + li * 12}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="bold" fill="${WH}">${esc(ln)}</text>`).join('');
    const detailTop = y + boxH - 10 - (detail.length - 1) * 10;
    const detailSvg = detail.map((ln, li) =>
      `<text x="${x + boxW / 2}" y="${detailTop + li * 10}" text-anchor="middle" font-family="${FONT}" font-size="8" fill="${WH}" opacity="0.88">${esc(ln)}</text>`).join('');
    return `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="3" fill="${fill}"/>
            ${labelSvg}${detailSvg}
            <text x="${x + boxW / 2}" y="${y + boxH + 15}" text-anchor="middle" font-family="${FONT}" font-size="8" fill="${IN}" opacity="0.7">${i + 1}</text>
            ${arrow}`;
  }).join('');

  return figure(
    frame(W, H, title, parts),
    `${title}: ${s.map((x) => x.name).join(' → ')}`,
    W, H,
    `${title} — ${s.map((x) => x.name).join(' → ')}.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule — a real gantt from real months
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleTask {
  name: string;
  startMonth: number;
  endMonth: number;
  /** Draw a milestone diamond at the task's end. */
  milestone?: boolean;
}

/**
 * A gantt of the period of performance, with a month grid and milestone markers.
 *
 * Drawn rather than tabulated because the question an evaluator asks of a schedule — "does the
 * work actually fit the period, and what depends on what" — is a shape question. Tasks whose
 * months are missing or inverted are dropped rather than drawn backwards.
 */
export function scheduleFigure(tasks: ScheduleTask[], months: number, title = 'Period of performance'): CanvasNode[] {
  const t = tasks
    .filter((x) => x?.name?.trim() && Number.isFinite(x.startMonth) && Number.isFinite(x.endMonth) && x.endMonth > x.startMonth)
    .slice(0, 8);
  if (t.length === 0 || !(months > 0)) return [];

  const W = 468;
  const rowH = 22, top = 48, labelW = 152;
  const H = top + t.length * rowH + 30;
  const plotW = W - labelW - 26;
  const x0 = labelW + 12;
  const scale = (m: number) => x0 + (Math.max(0, Math.min(months, m)) / months) * plotW;

  const grid = Array.from({ length: months + 1 }, (_, m) => {
    const x = scale(m);
    const label = m % Math.max(1, Math.round(months / 6)) === 0 || m === months;
    return `<line x1="${x}" y1="${top - 8}" x2="${x}" y2="${H - 22}" stroke="${RL}" stroke-width="${m === 0 || m === months ? 1 : 0.5}"/>
            ${label ? `<text x="${x}" y="${H - 8}" text-anchor="middle" font-family="${FONT}" font-size="8" fill="${IN}" opacity="0.75">M${m}</text>` : ''}`;
  }).join('');

  const bars = t.map((task, i) => {
    const y = top + i * rowH;
    const bx = scale(task.startMonth), bw = Math.max(4, scale(task.endMonth) - bx);
    const fill = [P1, P2, P3, P4][i % 4];
    return `<text x="14" y="${y + 12}" font-family="${FONT}" font-size="9" fill="${IN}">${esc(clip(task.name, 30))}</text>
            <rect x="${bx}" y="${y + 3}" width="${bw}" height="12" rx="2" fill="${fill}"/>
            ${task.milestone ? `<polygon points="${scale(task.endMonth)},${y + 3} ${scale(task.endMonth) + 6},${y + 9} ${scale(task.endMonth)},${y + 15} ${scale(task.endMonth) - 6},${y + 9}" fill="${AC}"/>` : ''}`;
  }).join('');

  return figure(
    frame(W, H, title, `${grid}${bars}`),
    `${title}: ${t.length} tasks across ${months} months`,
    W, H,
    `${title} — ${t.length} tasks across a ${months}-month period; diamonds mark deliverable milestones.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost — the build-up as a stacked bar an evaluator can read at a glance
// ─────────────────────────────────────────────────────────────────────────────

export interface CostBand { label: string; amount: number }

/**
 * The cost build-up as a proportional stacked bar with a labelled legend.
 *
 * The same numbers the Cost Volume's Summary table prints. A bar rather than a pie because the
 * question is "how much of this is labour" — a part-to-whole comparison against one dominant
 * band, which a pie answers badly. Bands at or below zero are dropped, not drawn as slivers.
 */
export function costBuildupFigure(bands: CostBand[], title = 'Cost build-up'): CanvasNode[] {
  const b = bands.filter((x) => x?.label && Number.isFinite(x.amount) && x.amount > 0)
    .sort((x, y) => y.amount - x.amount);
  const total = b.reduce((s, x) => s + x.amount, 0);
  if (b.length < 2 || total <= 0) return [];

  // Horizontal bars, sorted descending — NOT a stacked bar. A cost build-up routinely has one
  // dominant band and three under ten percent, and in a stack those render as unlabelled slivers:
  // rendered, the 3% Materials band read as a GAP in the bar rather than a cost line. Separate
  // bars give every line a readable label and let the eye compare lengths from a common baseline,
  // which is the comparison a cost evaluator is actually making.
  const W = 468;
  const rowH = 21, top = 44, labelW = 132, valueW = 74;
  const H = top + b.length * rowH + 16;
  const plotW = W - labelW - valueW - 28;
  const x0 = labelW + 14;
  const max = b[0].amount;
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

  const rows = b.map((band, i) => {
    const y = top + i * rowH;
    const w = Math.max(2, (band.amount / max) * plotW);
    const fill = [P1, P2, P3, P2, P3, P4][i % 6];
    const pct = (band.amount / total) * 100;
    return `<text x="14" y="${y + 12}" font-family="${FONT}" font-size="9" fill="${IN}">${esc(clip(band.label, 26))}</text>
            <rect x="${x0}" y="${y + 3}" width="${w}" height="13" fill="${fill}"/>
            <text x="${x0 + plotW + 10}" y="${y + 13}" font-family="${FONT}" font-size="9" fill="${IN}">${usd(band.amount)}</text>
            <text x="${W - 16}" y="${y + 13}" text-anchor="end" font-family="${FONT}" font-size="8.5" fill="${IN}" opacity="0.6">${pct.toFixed(1)}%</text>`;
  }).join('');

  const rule = `<line x1="${x0}" y1="${top}" x2="${x0}" y2="${H - 12}" stroke="${RL}" stroke-width="1"/>`;

  return figure(
    frame(W, H, `${title} — total ${usd(total)}`, `${rule}${rows}`),
    `${title}: ${b.map((x) => `${x.label} ${usd(x.amount)}`).join(', ')}; total ${usd(total)}`,
    W, H,
    `${title} — cost elements by magnitude, total ${usd(total)}.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work share — the eligibility question, answered visually
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The prime/partner work split against its mandated floor.
 *
 * SBIR and STTR evaluators check the small-business work share before they read anything else, so
 * it gets its own figure with the floor drawn ON the bar. The marker is what makes this worth a
 * picture: "56% vs a 40% floor" is a sentence, but a bar with the threshold on it is checkable in
 * one glance.
 */
export function workShareFigure(primePct: number, floorPct: number, primeLabel = 'Small business concern', partnerLabel = 'Partner / subcontract'): CanvasNode[] {
  if (!Number.isFinite(primePct) || primePct <= 0 || primePct > 100) return [];

  const W = 468, H = 128;
  const x0 = 20, barW = W - 40, barY = 52, barH = 30;
  const primeW = (primePct / 100) * barW;
  const floorX = x0 + (floorPct / 100) * barW;
  const pass = primePct >= floorPct;

  const body = `
    <rect x="${x0}" y="${barY}" width="${barW}" height="${barH}" fill="${P4}"/>
    <rect x="${x0}" y="${barY}" width="${primeW}" height="${barH}" fill="${P1}"/>
    <text x="${x0 + 10}" y="${barY + 20}" font-family="${FONT}" font-size="11" font-weight="bold" fill="${WH}">${primePct.toFixed(1)}%</text>
    <text x="${x0 + barW - 10}" y="${barY + 20}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${IN}">${(100 - primePct).toFixed(1)}%</text>
    <line x1="${floorX}" y1="${barY - 8}" x2="${floorX}" y2="${barY + barH + 8}" stroke="${AC}" stroke-width="2"/>
    <text x="${floorX}" y="${barY - 12}" text-anchor="middle" font-family="${FONT}" font-size="8.5" font-weight="bold" fill="${AC}">floor ${floorPct}%</text>
    <rect x="${x0}" y="${barY + barH + 16}" width="9" height="9" fill="${P1}"/>
    <text x="${x0 + 14}" y="${barY + barH + 24}" font-family="${FONT}" font-size="8.5" fill="${IN}">${esc(clip(primeLabel, 34))}</text>
    <rect x="${x0 + 210}" y="${barY + barH + 16}" width="9" height="9" fill="${P4}"/>
    <text x="${x0 + 224}" y="${barY + barH + 24}" font-family="${FONT}" font-size="8.5" fill="${IN}">${esc(clip(partnerLabel, 34))}</text>`;

  return figure(
    frame(W, H, 'Work share of the research effort', body),
    `Work share: ${primePct.toFixed(1)}% ${primeLabel} against a ${floorPct}% floor — ${pass ? 'compliant' : 'BELOW FLOOR'}`,
    W, H,
    `Work share — ${primePct.toFixed(1)}% ${primeLabel.toLowerCase()} against the ${floorPct}% floor (${pass ? 'compliant' : 'below floor'}).`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparison — where the proposed approach sits against the current state
// ─────────────────────────────────────────────────────────────────────────────

export interface Metric { name: string; current: number; proposed: number; unit?: string }

/**
 * Paired bars: today's measured value against the Phase I target, per metric.
 *
 * The single most persuasive figure in a technical volume, because it states the delta the whole
 * proposal exists to produce. Normalised per metric so units never have to agree — the shape
 * carries the argument and the printed numbers carry the precision.
 */
export function improvementFigure(metrics: Metric[], title = 'Current state vs. Phase I target'): CanvasNode[] {
  const m = metrics.filter((x) => x?.name && Number.isFinite(x.current) && Number.isFinite(x.proposed)).slice(0, 4);
  if (m.length === 0) return [];

  const W = 468, H = 190;
  const base = 148, groupW = Math.floor((W - 50) / m.length), barW = Math.min(38, Math.floor(groupW / 3));

  const groups = m.map((mt, i) => {
    const gx = 30 + i * groupW;
    const peak = Math.max(mt.current, mt.proposed) || 1;
    const ch = Math.max(3, Math.round((mt.current / peak) * 92));
    const ph = Math.max(3, Math.round((mt.proposed / peak) * 92));
    const u = mt.unit ? esc(mt.unit) : '';
    return `<rect x="${gx}" y="${base - ch}" width="${barW}" height="${ch}" fill="${P4}"/>
            <text x="${gx + barW / 2}" y="${base - ch - 5}" text-anchor="middle" font-family="${FONT}" font-size="8.5" fill="${IN}">${mt.current}${u}</text>
            <rect x="${gx + barW + 6}" y="${base - ph}" width="${barW}" height="${ph}" fill="${AC}"/>
            <text x="${gx + barW + 6 + barW / 2}" y="${base - ph - 5}" text-anchor="middle" font-family="${FONT}" font-size="8.5" font-weight="bold" fill="${IN}">${mt.proposed}${u}</text>
            <text x="${gx + barW + 3}" y="${base + 14}" text-anchor="middle" font-family="${FONT}" font-size="8.5" fill="${IN}">${esc(clip(mt.name, 18))}</text>`;
  }).join('');

  const legend = `<rect x="30" y="${H - 18}" width="9" height="9" fill="${P4}"/><text x="44" y="${H - 10}" font-family="${FONT}" font-size="8.5" fill="${IN}">Current</text>
                  <rect x="110" y="${H - 18}" width="9" height="9" fill="${AC}"/><text x="124" y="${H - 10}" font-family="${FONT}" font-size="8.5" fill="${IN}">Phase I target</text>`;

  return figure(
    frame(W, H, title, `<line x1="24" y1="${base}" x2="${W - 20}" y2="${base}" stroke="${IN}" stroke-width="1"/>${groups}${legend}`),
    `${title}: ${m.map((x) => `${x.name} ${x.current}→${x.proposed}${x.unit ?? ''}`).join(', ')}`,
    W, H,
    `${title} — ${m.map((x) => `${x.name} ${x.current}${x.unit ?? ''} → ${x.proposed}${x.unit ?? ''}`).join('; ')}.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover banner — the one piece of pure identity a proposal is allowed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A title band for the cover page: company, solicitation and volume.
 *
 * Not decoration — a submitted volume that does not carry its own identifiers on page one is a
 * common administrative rejection, and the band puts them where a reviewer looks first.
 */
export function coverBanner(companyName: string, solicitationNumber: string, volumeName: string): CanvasNode[] {
  const W = 468, H = 96;
  const body = `
    <rect x="0" y="0" width="${W}" height="${H}" fill="${P1}"/>
    <rect x="0" y="${H - 6}" width="${W}" height="6" fill="${AC}"/>
    <text x="24" y="38" font-family="${FONT}" font-size="17" font-weight="bold" fill="${WH}">${esc(clip(companyName, 42))}</text>
    <text x="24" y="60" font-family="${FONT}" font-size="11" fill="${WH}" opacity="0.9">${esc(clip(volumeName, 56))}</text>
    <text x="24" y="78" font-family="${FONT}" font-size="10" fill="${WH}" opacity="0.75" letter-spacing="1">${esc(solicitationNumber)}</text>`;
  return [svgNode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${body}</svg>`,
    `${companyName} — ${volumeName} — ${solicitationNumber}`,
    W, H,
  )];
  // No caption: a banner is page furniture, not a numbered figure.
}
