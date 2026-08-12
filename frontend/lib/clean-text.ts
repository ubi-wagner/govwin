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
