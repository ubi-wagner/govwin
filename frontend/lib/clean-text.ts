/**
 * Strip bytes Postgres text/jsonb reject — NUL + other C0 control chars (except tab / newline / CR)
 * and lone UTF-16 surrogates — which OCR, malformed PDFs (Type-3 fonts), and pasted user input can
 * emit. Without this the atom INSERT throws 22021 and the row is silently lost. Shared by every
 * ingest path (upload-atomize, capture/box, OCR enrich) so no path can write DB-hostile text.
 */
export function cleanText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue; // drop C0 controls (keep tab/newline/CR)
    if (c >= 0xd800 && c <= 0xdbff) { // high surrogate
      const nx = s.charCodeAt(i + 1);
      if (nx >= 0xdc00 && nx <= 0xdfff) { out += s[i] + s[i + 1]; i++; continue; } // valid pair
      continue; // lone high surrogate
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue; // lone low surrogate
    out += s[i];
  }
  return out;
}

/** Deep-clean every string inside an arbitrary jsonb-bound value (recurses arrays/objects). */
export function deepCleanStrings(v: unknown): unknown {
  return typeof v === 'string' ? cleanText(v)
    : Array.isArray(v) ? v.map(deepCleanStrings)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepCleanStrings(x)]))
    : v;
}

/**
 * Deep-clean every string inside a canvas node's `content` (the canvas_nodes jsonb path) so a
 * structured atom (image/table/OCR) with DB-hostile bytes can't throw 22021 on insert. Shared by
 * the auto atomize path AND the createAtom choke point so no write path is left unprotected.
 */
export function cleanNodes<T extends { content?: unknown }>(nodes: T[]): T[] {
  // deepCleanStrings preserves the value's shape (only replaces string leaves), so the cast is safe.
  return nodes.map((n) => ({ ...n, content: deepCleanStrings(n.content) }) as T);
}
