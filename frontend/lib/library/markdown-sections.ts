/**
 * Pure markdown → section splitter for the house-library dogfood. Kept free of any
 * DB/IO imports so it's unit-testable in isolation (house-docs.ts, which does the
 * createAtom writes, re-exports it).
 */
export interface DocSection { title: string; body: string; }

/** Split a markdown doc into sections by its `#`/`##`/`###` headings. Text before the
 *  first heading is folded into an intro section titled from the document. Empty
 *  sections are dropped and bodies trimmed. */
export function splitMarkdownSections(markdown: string, docTitle: string): DocSection[] {
  const out: DocSection[] = [];
  let cur: DocSection | null = null;
  for (const line of markdown.split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      if (cur) out.push(cur);
      cur = { title: h[2].trim().replace(/[#*`]/g, '').slice(0, 200) || docTitle, body: '' };
    } else {
      if (!cur) cur = { title: docTitle, body: '' };
      cur.body += (cur.body ? '\n' : '') + line;
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ title: s.title, body: s.body.trim() })).filter((s) => s.title || s.body);
}
