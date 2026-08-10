/**
 * Render a CanvasDocument to styled, self-contained HTML.
 *
 * Pure (no I/O) so it can back both an in-app HTML preview and the PDF exporter
 * (lib/export/pdf-exporter.ts → Chromium → PDF). Mirrors the node coverage of
 * the docx exporter: headings, text blocks with inline bold/italic/underline/
 * super/subscript + node-level color/alignment, bulleted/numbered lists (nested),
 * tables (cell bg/bold/alignment + currency/number formats), figures (inline
 * `data:` images — used for generated SVG placeholders), captions, footnotes,
 * links, page breaks, spacers. Header/footer are handled by the PDF exporter's
 * running templates (canvas.header/footer), not the body.
 */
import type {
  CanvasDocument,
  CanvasNode,
  CanvasSection,
  CanvasGroup,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  TableCell,
  ImageContent,
  CaptionContent,
  UrlContent,
  FootnoteContent,
  ShapeContent,
  TextBoxContent,
  CalloutContent,
  CodeBlockContent,
  BlockquoteContent,
  ChartContent,
  EquationContent,
  DividerContent,
  VideoContent,
  SignatureContent,
} from '@/lib/types/canvas-document';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function subst(t: unknown, vars: Record<string, string>): string {
  return String(t ?? '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

const INLINE_TAG: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  superscript: 'sup',
  subscript: 'sub',
};

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** text_block → HTML honoring (possibly overlapping) inline_formats. */
function renderRuns(tb: TextBlockContent, vars: Record<string, string>): string {
  const chars = [...subst(tb.text, vars)];
  const n = chars.length;
  if (n === 0) return '';
  const at: Array<Set<string>> = Array.from({ length: n }, () => new Set());
  for (const f of tb.inline_formats ?? []) {
    for (let k = f.start; k < f.start + f.length && k < n; k++) {
      if (k >= 0) at[k].add(f.format);
    }
  }
  let out = '';
  let k = 0;
  while (k < n) {
    const set = at[k];
    let j = k + 1;
    while (j < n && setsEqual(at[j], set)) j++;
    let seg = esc(chars.slice(k, j).join(''));
    for (const f of set) {
      const tag = INLINE_TAG[f] ?? 'span';
      seg = `<${tag}>${seg}</${tag}>`;
    }
    out += seg;
    k = j;
  }
  return out;
}

/** Hex (+optional opacity) → a CSS color. */
function cssColor(hex?: string, opacity?: number): string | undefined {
  if (!hex) return undefined;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (opacity === undefined || opacity >= 1 || h.length < 6) return `#${h}`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, opacity))})`;
}

/** All the CSS bits for a node's style + box + free-position. */
function styleBits(node: CanvasNode): string[] {
  const s = node.style ?? {};
  const bits: string[] = [];
  // text/run
  if (s.color) bits.push(`color:${s.color}`);
  if (s.alignment) bits.push(`text-align:${s.alignment}`);
  if (typeof s.size === 'number') bits.push(`font-size:${s.size}pt`);
  if (s.family) bits.push(`font-family:${JSON.stringify(s.family)}`);
  if (s.weight === 'bold') bits.push('font-weight:bold');
  if (s.style === 'italic') bits.push('font-style:italic');
  const deco: string[] = [];
  if (s.underline) deco.push('underline');
  if (s.strikethrough) deco.push('line-through');
  if (deco.length) bits.push(`text-decoration:${deco.join(' ')}`);
  if (s.highlight) bits.push(`background-color:${s.highlight}`);
  if (typeof s.indent === 'number' && s.indent > 0) bits.push(`margin-left:${s.indent}pt`);
  if (typeof s.space_before === 'number') bits.push(`margin-top:${s.space_before}pt`);
  if (typeof s.space_after === 'number') bits.push(`margin-bottom:${s.space_after}pt`);
  // box: fill / border / radius / opacity / rotation / shadow
  const fill = cssColor(s.fill?.color, s.fill?.opacity);
  if (fill) bits.push(`background-color:${fill}`);
  if (s.border && s.border.style !== 'none' && (s.border.color || s.border.width)) {
    bits.push(`border:${s.border.width ?? 1}pt ${s.border.style ?? 'solid'} ${cssColor(s.border.color ?? '#000000', s.border.opacity)}`);
  }
  if (typeof s.border?.radius === 'number') bits.push(`border-radius:${s.border.radius}pt`);
  if (typeof s.opacity === 'number' && s.opacity < 1) bits.push(`opacity:${s.opacity}`);
  if (typeof s.rotation === 'number' && s.rotation) bits.push(`transform:rotate(${s.rotation}deg)`);
  if (s.shadow) bits.push('box-shadow:0 2px 6px rgba(0,0,0,0.15)');
  // free position (content box that does NOT snap to margins)
  const p = node.position;
  if (p && (p.wrap === 'float' || p.wrap === 'behind' || p.wrap === 'front')) {
    bits.push('position:absolute');
    if (typeof p.x === 'number') bits.push(`left:${p.x}in`);
    if (typeof p.y === 'number') bits.push(`top:${p.y}in`);
    if (typeof p.w === 'number') bits.push(`width:${p.w}in`);
    if (typeof p.h === 'number') bits.push(`height:${p.h}in`);
    bits.push(`z-index:${p.wrap === 'behind' ? -1 : (p.z ?? 5)}`);
  }
  return bits;
}

function styleAttr(node: CanvasNode): string {
  const bits = styleBits(node);
  return bits.length ? ` style="${bits.join(';')}"` : '';
}

function renderList(list: ListContent, ordered: boolean, vars: Record<string, string>): string {
  const tag = ordered ? 'ol' : 'ul';
  const items = (list.items ?? [])
    .map((it) => {
      const kids = it.children && it.children.length
        ? renderList({ items: it.children }, ordered, vars)
        : '';
      return `<li>${esc(subst(it.text, vars))}${kids}</li>`;
    })
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

function fmtCellValue(c: TableCell): string {
  if (c.cell_type === 'currency' && typeof c.value === 'number') {
    return '$' + c.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (c.cell_type === 'number' && typeof c.value === 'number') return c.value.toLocaleString('en-US');
  if (c.cell_type === 'percent' && typeof c.value === 'number') return `${c.value}%`;
  return esc(c.text ?? '');
}

function cellStyle(c: TableCell): string {
  const st = c.style ?? {};
  const bits = ['border:1px solid #cbd5e1', 'padding:4px 8px'];
  if (st.bg) bits.push(`background:${st.bg}`);
  if (st.fg) bits.push(`color:${st.fg}`);
  if (st.bold) bits.push('font-weight:700');
  if (st.alignment) bits.push(`text-align:${st.alignment}`);
  if (c.cell_type === 'currency' || c.cell_type === 'number' || c.cell_type === 'percent') bits.push('text-align:right');
  return ` style="${bits.join(';')}"`;
}

function asCell(v: string | TableCell): TableCell {
  return typeof v === 'string' ? { text: v } : v;
}

function renderTable(t: TableContent, vars: Record<string, string>): string {
  const head = (t.headers ?? [])
    .map((h) => {
      const c = asCell(h);
      const st = { ...(c.style ?? {}), ...(t.header_style ?? {}), bold: true };
      return `<th${cellStyle({ ...c, style: st })}>${esc(subst(c.text, vars))}</th>`;
    })
    .join('');
  const body = (t.rows ?? [])
    .map((row) => {
      const cells = (row ?? [])
        .map((cell) => {
          const c = asCell(cell);
          const span = (c.colSpan && c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '') + (c.rowSpan && c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '');
          return `<td${cellStyle(c)}${span}>${fmtCellValue({ ...c, text: subst(c.text, vars) })}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;width:100%;margin:10px 0;font-size:10pt">${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${body}</tbody></table>`;
}

function renderImage(img: ImageContent): string {
  const key = img.storage_key ?? '';
  const dims = `${img.width ? `width:${img.width}px;` : ''}${img.height ? `max-height:${img.height}px;` : ''}`;
  // Inline data: URIs directly (generated SVG placeholders). Anything else is
  // an S3 key we can't resolve here → a labeled placeholder box.
  const inner = key.startsWith('data:')
    ? `<img src="${key}" alt="${esc(img.alt_text)}" style="${dims}max-width:100%" />`
    : `<div style="border:1px dashed #94a3b8;background:#f8fafc;color:#64748b;padding:24px;text-align:center;${dims}">${esc(img.alt_text || 'Image')}</div>`;
  const cap = img.caption ? `<figcaption style="font-size:9pt;color:#475569;text-align:center;margin-top:4px">${esc(img.caption)}</figcaption>` : '';
  return `<figure style="margin:12px 0;text-align:center">${inner}${cap}</figure>`;
}

const CHART_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];

/** A self-contained inline SVG chart (bar / line / area / pie / doughnut / gantt) WITH labels —
 *  category labels, y-axis value ticks, and a multi-series legend — so it reads as a real graph,
 *  not an unlabeled picture. Embeddable anywhere HTML goes; docx/pptx pick it up as an image,
 *  pdf renders it directly. Gantt: horizontal timeline bars, series[0]=start month, series[1]=end. */
export function renderChartSvg(ch: ChartContent): string {
  const cats = (ch.categories ?? []).map((c) => String(c));
  const series = ch.series ?? [];
  const type = String(ch.chart_type);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100));
  const titleTxt = ch.title ? `<text x="{cx}" y="16" text-anchor="middle" font-size="12" font-weight="bold">${esc(ch.title)}</text>` : '';

  // ── GANTT — horizontal timeline bars per category (start→end month) ──
  if (type === 'gantt') {
    const W = 500, padT = ch.title ? 30 : 12, padL = 138, padR = 16, rowH = 24;
    const starts = series[0]?.data ?? [];
    const ends = series[1]?.data ?? starts;
    const maxMonth = Math.max(12, ...ends.map((n) => n || 0), ...starts.map((n) => n || 0));
    const H = padT + cats.length * rowH + 26;
    const plotL = padL, plotW = W - padL - padR, plotB = padT + cats.length * rowH;
    const x = (m: number) => plotL + (m / maxMonth) * plotW;
    let grid = '';
    for (let m = 0; m <= maxMonth; m++) {
      grid += `<line x1="${x(m).toFixed(1)}" y1="${padT}" x2="${x(m).toFixed(1)}" y2="${plotB}" stroke="#e2e8f0" stroke-width="1"/>`;
      if (m > 0) grid += `<text x="${x(m - 0.5).toFixed(1)}" y="${plotB + 13}" text-anchor="middle" font-size="7.5" fill="#64748b">M${m}</text>`;
    }
    const bars = cats.map((c, i) => {
      const s = Math.max(0, (starts[i] ?? 1) - 1), e = Math.max((ends[i] ?? starts[i] ?? 1), s + 1);
      const bx = x(s), bw = Math.max(4, x(e) - x(s)), by = padT + i * rowH + 4, col = CHART_PALETTE[i % CHART_PALETTE.length];
      return `<rect x="${bx.toFixed(1)}" y="${by}" width="${bw.toFixed(1)}" height="${rowH - 8}" rx="2" fill="${col}"/>`
        + `<text x="${plotL - 6}" y="${(by + (rowH - 8) / 2 + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#334155">${esc(c)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;margin:10pt 0" xmlns="http://www.w3.org/2000/svg" data-chart="gantt">${titleTxt.replace('{cx}', String(W / 2))}${grid}${bars}</svg>`;
  }

  const W = 480, H = 300;
  const title = titleTxt.replace('{cx}', String(W / 2));

  // ── PIE / DOUGHNUT (+ slice labels) ──
  if (type === 'pie' || type === 'doughnut') {
    const vals = series[0]?.data ?? [];
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2 - 60, cy = H / 2 + 6, r = 92;
    let a0 = -Math.PI / 2;
    const slices = vals.map((v, i) => {
      const a1 = a0 + (v / total) * 2 * Math.PI;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}"/>`;
    }).join('');
    const hole = type === 'doughnut' ? `<circle cx="${cx}" cy="${cy}" r="46" fill="#fff"/>` : '';
    const legend = cats.map((c, i) => {
      const pct = Math.round(((vals[i] ?? 0) / total) * 100);
      return `<rect x="${W - 150}" y="${44 + i * 18}" width="10" height="10" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}"/><text x="${W - 135}" y="${53 + i * 18}" font-size="9" fill="#334155">${esc(c)} (${pct}%)</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;margin:10pt 0" xmlns="http://www.w3.org/2000/svg" data-chart="${esc(type)}">${title}${slices}${hole}${legend}</svg>`;
  }

  // ── BAR / LINE / AREA (+ y-axis ticks, x category labels, legend) ──
  const named = series.filter((s) => s.name);
  const legendH = named.length > 1 ? 20 : 0;
  const padL = 52, padR = 16, padT = ch.title ? 30 : 14, padB = 40 + legendH;
  const plotL = padL, plotR = W - padR, plotT = padT, plotB = H - padB;
  const plotW = plotR - plotL, plotH = plotB - plotT;
  const rawMax = Math.max(1, ...series.flatMap((s) => s.data ?? []));
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / mag) * mag; // "nice" ceiling
  const yFor = (v: number) => plotB - (v / max) * plotH;
  // y grid + value labels (0, mid, max)
  const yTicks = [0, max / 2, max].map((v) =>
    `<line x1="${plotL}" y1="${yFor(v).toFixed(1)}" x2="${plotR}" y2="${yFor(v).toFixed(1)}" stroke="#eef2f7"/><text x="${plotL - 6}" y="${(yFor(v) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#64748b">${fmt(v)}</text>`).join('');
  const axes = `<line x1="${plotL}" y1="${plotT}" x2="${plotL}" y2="${plotB}" stroke="#94a3b8"/><line x1="${plotL}" y1="${plotB}" x2="${plotR}" y2="${plotB}" stroke="#94a3b8"/>`;
  // x category labels (rotate when crowded)
  const gw = plotW / Math.max(1, cats.length);
  const rot = cats.length > 6;
  const xLabels = cats.map((c, i) => {
    const cxp = plotL + gw * (i + 0.5);
    return rot
      ? `<text x="${cxp.toFixed(1)}" y="${(plotB + 12).toFixed(1)}" text-anchor="end" font-size="7.5" fill="#64748b" transform="rotate(-35 ${cxp.toFixed(1)} ${(plotB + 12).toFixed(1)})">${esc(c)}</text>`
      : `<text x="${cxp.toFixed(1)}" y="${(plotB + 13).toFixed(1)}" text-anchor="middle" font-size="8" fill="#64748b">${esc(c)}</text>`;
  }).join('');
  let body = '';
  if (type === 'line' || type === 'area') {
    const xw = plotW / Math.max(1, cats.length - 1);
    body = series.map((s, si) => {
      const col = s.color || CHART_PALETTE[si % CHART_PALETTE.length];
      const pts = (s.data ?? []).map((v, i) => `${(plotL + i * xw).toFixed(1)},${yFor(v).toFixed(1)}`);
      const dots = (s.data ?? []).map((v, i) => `<circle cx="${(plotL + i * xw).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="2.5" fill="${col}"/>`).join('');
      return `<polyline fill="none" stroke="${col}" stroke-width="2" points="${pts.join(' ')}"/>${dots}`;
    }).join('');
  } else { // bar
    const bw = (gw / Math.max(1, series.length)) * 0.72;
    body = series.map((s, si) => (s.data ?? []).map((v, i) => {
      const h = (v / max) * plotH, xp = plotL + i * gw + (gw - bw * series.length) / 2 + si * bw;
      return `<rect x="${xp.toFixed(1)}" y="${yFor(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${s.color || CHART_PALETTE[si % CHART_PALETTE.length]}"/>`;
    }).join('')).join('');
  }
  const legend = named.length > 1 ? named.map((s, i) => {
    const col = s.color || CHART_PALETTE[series.indexOf(s) % CHART_PALETTE.length];
    const lx = plotL + i * 130;
    return `<rect x="${lx}" y="${H - 14}" width="11" height="11" fill="${col}"/><text x="${lx + 15}" y="${H - 5}" font-size="9" fill="#334155">${esc(s.name || '')}</text>`;
  }).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;margin:10pt 0" xmlns="http://www.w3.org/2000/svg" data-chart="${esc(type)}">${title}${yTicks}${axes}${body}${xLabels}${legend}</svg>`;
}

/** A regular N-pointed star polygon centered at (cx,cy). */
function starPoints(cx: number, cy: number, rOuter: number, points = 5): string {
  const rInner = rOuter * 0.4;
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/**
 * A self-contained SVG for a shape primitive — fill (+opacity), border (color/
 * width/style), whole-shape opacity, rotation, and optional centered text. The
 * raster exporters (docx/xlsx, which have no vector-shape primitive) rasterize
 * this to a PNG; the HTML/PDF path draws shapes as styled divs, so this is
 * export-only. Covers every ShapeKind.
 */
export function renderShapeSvg(node: CanvasNode): string {
  const sc = (node.content ?? {}) as ShapeContent;
  const sh = sc.shape ?? 'rectangle';
  const s = node.style ?? {};
  const W = 320, H = 200, m = 8;
  const x = m, y = m, w = W - 2 * m, h = H - 2 * m;
  const fill = cssColor(s.fill?.color, s.fill?.opacity) ?? '#DCE6F1';
  const strokeCol = cssColor(s.border?.color) ?? (s.border && s.border.style !== 'none' ? '#334155' : null);
  const sw = s.border?.width ?? (strokeCol ? 1 : 0);
  const dash = s.border?.style === 'dashed' ? ' stroke-dasharray="7,4"' : s.border?.style === 'dotted' ? ' stroke-dasharray="2,3"' : '';
  const stroke = sw > 0 && strokeCol ? ` stroke="${strokeCol}" stroke-width="${sw}"${dash}` : '';
  let el: string;
  switch (sh) {
    case 'ellipse': el = `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke}/>`; break;
    case 'rounded_rectangle': el = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" ry="18" fill="${fill}"${stroke}/>`; break;
    case 'triangle': el = `<polygon points="${W / 2},${y} ${W - m},${H - m} ${m},${H - m}" fill="${fill}"${stroke}/>`; break;
    case 'diamond': el = `<polygon points="${W / 2},${y} ${W - m},${H / 2} ${W / 2},${H - m} ${m},${H / 2}" fill="${fill}"${stroke}/>`; break;
    case 'star': el = `<polygon points="${starPoints(W / 2, H / 2, Math.min(w, h) / 2)}" fill="${fill}"${stroke}/>`; break;
    case 'line': el = `<line x1="${m}" y1="${H / 2}" x2="${W - m}" y2="${H / 2}" stroke="${strokeCol ?? '#334155'}" stroke-width="${sw || 2}"${dash}/>`; break;
    case 'arrow': el = `<path d="M${m},${H * 0.38} L${W * 0.66},${H * 0.38} L${W * 0.66},${H * 0.2} L${W - m},${H / 2} L${W * 0.66},${H * 0.8} L${W * 0.66},${H * 0.62} L${m},${H * 0.62} Z" fill="${fill}"${stroke}/>`; break;
    case 'callout_bubble': el = `<path d="M${x + 18},${y} h${w - 36} q18,0 18,18 v${h - 60} q0,18 -18,18 h-${(w - 36) * 0.55} l-22,26 v-26 h-${(w - 36) * 0.45} q-18,0 -18,-18 v-${h - 60} q0,-18 18,-18 Z" fill="${fill}"${stroke}/>`; break;
    default: el = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${stroke}/>`; // rectangle
  }
  const txt = sc.text;
  const textEl = txt
    ? `<text x="${W / 2}" y="${H / 2}" dominant-baseline="central" text-anchor="middle" font-size="16" font-family="${esc(s.family ?? 'Arial')}" fill="${s.color ?? '#1E293B'}">${esc(txt)}</text>`
    : '';
  const g = `<g opacity="${s.opacity ?? 1}"${s.rotation ? ` transform="rotate(${s.rotation} ${W / 2} ${H / 2})"` : ''}>${el}${textEl}</g>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" data-shape="${esc(sh)}">${g}</svg>`;
}

function renderNode(node: CanvasNode, vars: Record<string, string>): string {
  const c = node.content;
  switch (node.type) {
    case 'heading': {
      const h = c as HeadingContent;
      const lvl = Math.min(Math.max(h.level ?? 1, 1), 3);
      const num = h.numbering ? `${esc(h.numbering)} ` : '';
      return `<h${lvl}${styleAttr(node)}>${num}${esc(subst(h.text, vars))}</h${lvl}>`;
    }
    case 'text_block':
      return `<p${styleAttr(node)}>${renderRuns(c as TextBlockContent, vars)}</p>`;
    case 'bulleted_list':
      return renderList(c as ListContent, false, vars);
    case 'numbered_list':
      return renderList(c as ListContent, true, vars);
    case 'table':
      return renderTable(c as TableContent, vars);
    case 'image':
      return renderImage(c as ImageContent);
    case 'caption': {
      const cap = c as CaptionContent;
      return `<p style="font-size:9pt;color:#475569;text-align:center;font-style:italic">${esc(cap.prefix)} ${esc(cap.number)}. ${esc(subst(cap.text, vars))}</p>`;
    }
    case 'footnote': {
      const fn = c as FootnoteContent;
      return `<p style="font-size:8pt;color:#64748b"><sup>${esc(fn.marker)}</sup> ${esc(subst(fn.text, vars))}</p>`;
    }
    case 'url': {
      const u = c as UrlContent;
      return `<p><a href="${esc(u.href)}">${esc(subst(u.display_text, vars))}</a></p>`;
    }
    case 'text_box': {
      const tb = c as TextBoxContent;
      return `<div${styleAttr(node)}>${renderRuns({ text: tb.text, inline_formats: tb.inline_formats }, vars)}</div>`;
    }
    case 'shape': {
      const sh = c as ShapeContent;
      const extra = [...styleBits(node), 'min-height:40pt', 'padding:8pt', 'box-sizing:border-box'];
      if (!node.style?.fill?.color) extra.push('background:#e2e8f0');
      if (sh.shape === 'ellipse') extra.push('border-radius:50%');
      else if (sh.shape === 'rounded_rectangle' && typeof node.style?.border?.radius !== 'number') extra.push('border-radius:8pt');
      const inner = sh.text ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;text-align:center">${esc(subst(sh.text, vars))}</div>` : '';
      return `<div data-shape="${esc(sh.shape)}" style="${extra.join(';')}">${inner}</div>`;
    }
    case 'callout': {
      const ca = c as CalloutContent;
      const col = ({ info: '#3b82f6', warning: '#f59e0b', tip: '#10b981', success: '#22c55e', note: '#64748b' } as Record<string, string>)[ca.variant] ?? '#64748b';
      const title = ca.title ? `<strong>${esc(subst(ca.title, vars))}</strong><br/>` : '';
      return `<div data-callout="${esc(ca.variant)}" style="border-left:3pt solid ${col};background:${col}18;padding:10pt 12pt;margin:10pt 0;border-radius:4pt">${title}${esc(subst(ca.text, vars))}</div>`;
    }
    case 'code_block': {
      const cb = c as CodeBlockContent;
      return `<pre style="background:#0f172a;color:#e2e8f0;padding:12pt;border-radius:6pt;overflow-x:auto;font-family:'Courier New',monospace;font-size:9pt;white-space:pre-wrap"><code>${esc(cb.code)}</code></pre>`;
    }
    case 'blockquote': {
      const bq = c as BlockquoteContent;
      const cite = bq.cite ? `<footer style="color:#64748b;font-size:9pt;margin-top:6pt">— ${esc(bq.cite)}</footer>` : '';
      return `<blockquote style="border-left:3pt solid #cbd5e1;padding:6pt 14pt;margin:10pt 0;color:#334155;font-style:italic">${esc(subst(bq.text, vars))}${cite}</blockquote>`;
    }
    case 'chart':
      return renderChartSvg(c as ChartContent);
    case 'equation': {
      const eq = c as EquationContent;
      const tex = eq.latex ?? eq.mathml ?? '';
      return `<div data-latex="${esc(tex)}" style="text-align:center;font-family:'Cambria Math','Times New Roman',serif;font-style:italic;margin:8pt 0">${esc(tex)}</div>`;
    }
    case 'divider': {
      const dv = c as DividerContent;
      return `<hr style="border:0;border-top:${dv.thickness ?? 1}pt ${dv.line_style ?? 'solid'} ${dv.color ?? '#cbd5e1'};margin:12pt 0" />`;
    }
    case 'video': {
      const vd = c as VideoContent;
      const href = vd.url ?? vd.storage_key ?? '#';
      return `<div style="border:1px solid #e2e8f0;border-radius:6pt;padding:12pt;text-align:center;color:#475569">&#9654; <a href="${esc(href)}">${esc(vd.caption || 'Video')}</a></div>`;
    }
    case 'signature': {
      const sg = c as SignatureContent;
      const nm = sg.signer_name ? `<div style="font-size:10pt">${esc(sg.signer_name)}</div>` : '';
      const em = sg.signer_email ? `<div style="font-size:8pt;color:#64748b">${esc(sg.signer_email)}</div>` : '';
      return `<div data-signature style="margin:16pt 0"><div style="border-bottom:1pt solid #334155;width:240pt;height:28pt"></div><div style="font-size:8pt;color:#64748b;margin-top:2pt">${esc(sg.label || 'Signature')}</div>${nm}${em}</div>`;
    }
    case 'page_break':
      return `<div style="page-break-after:always"></div>`;
    case 'spacer':
      return `<div style="height:${(node.style?.space_after ?? 12)}pt"></div>`;
    case 'toc':
      // The document's TOC — a heading-list assembled once in renderCanvasBodyHtml
      // and threaded through `vars` (mirrors the editor's TOC; was silently dropped).
      return vars.__toc_html ?? '';
    default:
      return '';
  }
}

/** Render one group's nodes, wrapping in a keep-together box when marked. */
function renderGroup(group: CanvasGroup, vars: Record<string, string>): string {
  const inner = (group.nodes ?? []).map((n) => renderNode(n, vars)).join('\n');
  return group.keep_together ? `<div style="break-inside:avoid;page-break-inside:avoid">${inner}</div>` : inner;
}

/**
 * Render the section layer (v2). Sections FLOW by default — no forced page
 * breaks — so content runs continuously across page boundaries (the fix for
 * the bottom-of-page whitespace). `break_before` starts a new page; a
 * `keep_together` section (or group) gets `break-inside: avoid` so the
 * renderer keeps it whole and pushes it to the next page instead of splitting.
 */
function renderSectionsToHtml(sections: CanvasSection[], vars: Record<string, string>): string {
  return sections
    .map((s, i) => {
      const inner = (s.groups ?? []).map((g) => renderGroup(g, vars)).join('\n');
      const bits: string[] = [];
      if (s.layout?.break_before && i > 0) bits.push('page-break-before:always', 'break-before:page');
      if (s.layout?.mode === 'keep_together') bits.push('break-inside:avoid', 'page-break-inside:avoid');
      const style = bits.length ? ` style="${bits.join(';')}"` : '';
      return `<section${style}>${inner}</section>`;
    })
    .join('\n');
}

/**
 * The shared <style> block used by BOTH the export HTML and the in-app preview,
 * derived from the canvas' default font + line spacing. Kept identical to what
 * renderCanvasToHtml used to inline so the PDF export is byte-for-byte unchanged.
 */
export function canvasBaseCss(doc: CanvasDocument): string {
  const font = doc.canvas?.font_default ?? { family: 'Times New Roman', size: 12 };
  const lineSpacing = doc.canvas?.line_spacing ?? 1.15;
  return `
    * { box-sizing: border-box; }
    body { font-family: ${JSON.stringify(font.family ?? 'Times New Roman')}, serif; font-size: ${font.size ?? 12}pt; line-height: ${lineSpacing}; color: ${font.color ?? '#111827'}; margin: 0; }
    h1 { font-size: ${(font.size ?? 12) * 1.6}pt; margin: 16px 0 8px; }
    h2 { font-size: ${(font.size ?? 12) * 1.3}pt; margin: 14px 0 6px; }
    h3 { font-size: ${(font.size ?? 12) * 1.1}pt; margin: 12px 0 4px; }
    p { margin: 6px 0; }
    ul, ol { margin: 6px 0 6px 22px; }
    li { margin: 3px 0; }
    a { color: #2563eb; }
    th { background: #1e293b; color: #fff; }
  `;
}

/**
 * Render just the document BODY (no <html>/<head>/<style>) so callers can wrap it
 * in a page frame — the in-app preview does exactly this, while the PDF exporter
 * uses renderCanvasToHtml below. Pure; safe to run in the browser.
 */
/** Collect heading nodes across the document (sections→groups→nodes, or flat nodes). */
function collectDocHeadings(doc: CanvasDocument): { level: number; text: string; numbering?: string }[] {
  const out: { level: number; text: string; numbering?: string }[] = [];
  const scan = (nodes: CanvasNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'heading') {
        const h = n.content as HeadingContent;
        out.push({ level: Math.min(Math.max(h.level ?? 1, 1), 3), text: h.text, numbering: h.numbering });
      }
    }
  };
  if (doc.sections?.length) {
    for (const s of doc.sections) for (const g of s.groups ?? []) scan(g.nodes);
  } else {
    scan(doc.nodes);
  }
  return out;
}

/** Build the table-of-contents HTML — mirrors the editor's TOC (title + indented,
 *  numbering-prefixed, level-weighted heading list). Empty when there are no headings. */
function buildTocHtml(doc: CanvasDocument, vars: Record<string, string>): string {
  const headings = collectDocHeadings(doc);
  if (!headings.length) return '';
  const rows = headings
    .map((h) => {
      const weight =
        h.level === 1 ? 'font-weight:600;color:#1f2937' : h.level === 2 ? 'font-weight:500;color:#374151' : 'color:#4b5563';
      const num = h.numbering ? `<span style="color:#64748b">${esc(h.numbering)} </span>` : '';
      return `<div style="margin-left:${(h.level - 1) * 20}pt;padding:2pt 0"><span style="${weight}">${num}${esc(subst(h.text, vars))}</span></div>`;
    })
    .join('');
  return `<nav data-toc style="margin:4pt 0 14pt"><div style="font-size:9pt;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:6pt">Table of Contents</div>${rows}</nav>`;
}

export function renderCanvasBodyHtml(doc: CanvasDocument, variables: Record<string, string> = {}): string {
  // Assemble the TOC once (the per-node renderer can't see the whole doc) and thread it
  // through `vars` so the 'toc' node renders it — in BOTH the PDF export and the in-app
  // preview, which share this body renderer.
  const toc = buildTocHtml(doc, variables);
  const vars = toc ? { ...variables, __toc_html: toc } : variables;
  return doc.sections && doc.sections.length
    ? renderSectionsToHtml(doc.sections, vars)
    : (doc.nodes ?? []).map((n) => renderNode(n, vars)).join('\n');
}

export function renderCanvasToHtml(doc: CanvasDocument, variables: Record<string, string> = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${canvasBaseCss(doc)}</style></head><body>${renderCanvasBodyHtml(doc, variables)}</body></html>`;
}

/**
 * Render a page-FRAMED, self-contained HTML document for the in-app "preview as
 * downloaded" — the same body as the PDF export, wrapped in a letter/A4 page at the
 * canvas' real width + margins, with the header/footer templates substituted and drawn
 * in the page margins (the PDF exporter draws these as Chromium running templates, which
 * the plain export body omits). Pure — the SAME function backs the section preview
 * (client-side, live edits) and the full-document preview (server-assembled), so both
 * look identical. Continuous scroll (not hard-paginated) — a faithful layout, not a
 * page-by-page raster; the .docx/.pdf download remains the exact file.
 */
export function renderCanvasPreviewHtml(doc: CanvasDocument, variables: Record<string, string> = {}): string {
  const c = doc.canvas;
  const PT_TO_PX = 96 / 72;
  const wPx = Math.round((c?.width ?? 612) * PT_TO_PX);
  const hPx = Math.round((c?.height ?? 792) * PT_TO_PX);
  const m = c?.margins ?? { top: 72, right: 72, bottom: 72, left: 72 };
  // Header/footer substitution: known vars resolve; live page-number tokens render as "•" (a
  // continuous-scroll preview has no fixed pagination — the .pdf/.docx supplies real numbers);
  // any other unresolved {token} is dropped rather than shown literally.
  const hfVars: Record<string, string> = { n: '•', page: '•', page_number: '•', N: '•', pages: '•', total_pages: '•', ...variables };
  const substHf = (t: unknown) => String(t ?? '').replace(/\{(\w+)\}/g, (_, k) => hfVars[k] ?? '');
  const header = c?.header ? `<div class="pv-hf pv-header">${esc(substHf(c.header.template))}</div>` : '';
  const footer = c?.footer ? `<div class="pv-hf pv-footer">${esc(substHf(c.footer.template))}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #4b5563; }
    ${canvasBaseCss(doc)}
    .pv-page { width: ${wPx}px; min-height: ${hPx}px; margin: 24px auto; background: ${c?.background ?? '#fff'};
      padding: ${m.top}pt ${m.right}pt ${m.bottom}pt ${m.left}pt; box-shadow: 0 4px 24px rgba(0,0,0,.35); }
    .pv-hf { color: #6b7280; font-size: ${c?.header?.font?.size ?? 10}pt; }
    .pv-header { border-bottom: 1px solid #e5e7eb; margin-bottom: 14px; padding-bottom: 6px; }
    .pv-footer { border-top: 1px solid #e5e7eb; margin-top: 14px; padding-top: 6px; text-align: center; }
  </style></head><body><div class="pv-page">${header}${renderCanvasBodyHtml(doc, variables)}${footer}</div></body></html>`;
}
