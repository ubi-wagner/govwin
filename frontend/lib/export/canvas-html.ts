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

function styleAttr(node: CanvasNode): string {
  const s = node.style ?? {};
  const bits: string[] = [];
  if (s.color) bits.push(`color:${s.color}`);
  if (s.alignment) bits.push(`text-align:${s.alignment}`);
  if (typeof s.size === 'number') bits.push(`font-size:${s.size}pt`);
  if (s.family) bits.push(`font-family:${JSON.stringify(s.family)}`);
  if (typeof s.indent === 'number' && s.indent > 0) bits.push(`margin-left:${s.indent}pt`);
  if (typeof s.space_before === 'number') bits.push(`margin-top:${s.space_before}pt`);
  if (typeof s.space_after === 'number') bits.push(`margin-bottom:${s.space_after}pt`);
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
    case 'page_break':
      return `<div style="page-break-after:always"></div>`;
    case 'spacer':
      return `<div style="height:${(node.style?.space_after ?? 12)}pt"></div>`;
    case 'toc':
      return '';
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

export function renderCanvasToHtml(doc: CanvasDocument, variables: Record<string, string> = {}): string {
  const canvas = doc.canvas;
  const font = canvas?.font_default ?? { family: 'Times New Roman', size: 12 };
  const lineSpacing = canvas?.line_spacing ?? 1.15;
  const body = doc.sections && doc.sections.length
    ? renderSectionsToHtml(doc.sections, variables)
    : (doc.nodes ?? []).map((n) => renderNode(n, variables)).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
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
  </style></head><body>${body}</body></html>`;
}
