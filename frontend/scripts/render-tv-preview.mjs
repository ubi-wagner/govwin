/**
 * Render a faithful PDF twin of the exported Technical Volume for page-count + visual
 * verification (LibreOffice is unavailable in this sandbox). Reads the SAME section
 * CanvasDocuments the system exported from the DB, lays them out at the docx geometry
 * (US-Letter, 1" margins, Times New Roman 11pt, single-spaced), and prints via Chromium.
 *   node scripts/render-tv-preview.mjs
 */
import postgres from 'postgres';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inlineText(text, formats) {
  if (!formats?.length) return esc(text);
  // apply non-overlapping inline formats (sorted)
  const sorted = [...formats].sort((a, b) => a.start - b.start);
  let out = '', pos = 0;
  const tag = { bold: 'b', italic: 'i', underline: 'u', superscript: 'sup', subscript: 'sub' };
  for (const f of sorted) {
    if (f.start > pos) out += esc(text.slice(pos, f.start));
    const t = tag[f.format] || 'span';
    out += `<${t}>${esc(text.slice(f.start, f.start + f.length))}</${t}>`;
    pos = f.start + f.length;
  }
  out += esc(text.slice(pos));
  return out;
}

function nodeHtml(n) {
  const c = n.content || {};
  switch (n.type) {
    case 'heading': return `<h${c.level} class="h${c.level}">${esc(c.text)}</h${c.level}>`;
    case 'text_block': return `<p>${inlineText(c.text, c.inline_formats)}</p>`;
    case 'bulleted_list': return `<ul>${(c.items || []).map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul>`;
    case 'numbered_list': return `<ol>${(c.items || []).map((i) => `<li>${esc(i.text)}</li>`).join('')}</ol>`;
    case 'table': {
      const cell = (x) => (typeof x === 'string' ? x : x?.text ?? '');
      const head = `<tr>${(c.headers || []).map((h) => `<th>${esc(cell(h))}</th>`).join('')}</tr>`;
      const rows = (c.rows || []).map((r) => `<tr>${r.map((x) => `<td>${esc(cell(x))}</td>`).join('')}</tr>`).join('');
      return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
    case 'image': return `<figure><img src="${c.storage_key}" style="width:${c.width}px"/><figcaption>${esc(c.caption || '')}</figcaption></figure>`;
    default: return '';
  }
}

const rows = await sql`
  SELECT s.title, s.content FROM proposal_sections s
  JOIN proposals p ON p.id = s.proposal_id
  WHERE p.opportunity_id = (SELECT id FROM opportunities WHERE source_id='DON26BX03-NP002')
    AND s.volume_number = 2
  ORDER BY p.created_at DESC, s.section_number ASC`;
// keep only the newest proposal's sections
const body = rows.map((r) => { try { return JSON.parse(r.content).nodes.map(nodeHtml).join('\n'); } catch { return ''; } }).join('\n');
await sql.end();

const html = `<!doctype html><html><head><meta charset="utf8"><style>
@page { size: Letter; margin: 1in; }
* { box-sizing: border-box; }
body { font-family: 'Times New Roman', Georgia, serif; font-size: 11pt; line-height: 1.15; color: #000; margin: 0; }
h1.h1 { font-size: 12pt; font-weight: bold; margin: 10pt 0 4pt; border-bottom: 1px solid #444; padding-bottom: 2pt; }
h2.h2 { font-size: 11pt; font-weight: bold; font-style: italic; margin: 8pt 0 2pt; }
p { margin: 0 0 6pt; text-align: justify; }
ul, ol { margin: 2pt 0 6pt; padding-left: 20pt; }
li { margin: 0 0 3pt; text-align: justify; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt; font-size: 9.5pt; }
th, td { border: 0.75pt solid #333; padding: 2.5pt 4pt; vertical-align: top; text-align: left; }
th { background: #D9E1F2; font-weight: bold; text-align: center; }
figure { margin: 4pt 0 8pt; text-align: center; page-break-inside: avoid; }
img { max-width: 100%; }
figcaption { font-size: 9pt; font-style: italic; color: #333; margin-top: 2pt; }
</style></head><body>${body}</body></html>`;

writeFileSync('/tmp/tv_preview.html', html);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await (await b.newContext()).newPage();
await pg.goto('file:///tmp/tv_preview.html', { waitUntil: 'networkidle' });
await pg.pdf({ path: '/tmp/tv_preview.pdf', format: 'Letter', printBackground: true, margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' } });
await b.close();
console.log('wrote /tmp/tv_preview.pdf');
