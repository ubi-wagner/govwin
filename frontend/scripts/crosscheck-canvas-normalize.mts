/**
 * Cross-check for B78 — at the layer where the bug actually lived.
 *
 * B78 was a stored PARTIAL canvas (missing `font_default`, or a `header` with no `font`)
 * white-screening the proposal workspace. It cannot be confirmed the way B79 and B80 were: the
 * throw happens during hydration in the browser, so the server's bytes look perfect and a curl
 * check would pass on a broken page. It also should not be confirmed by the surface lens, because
 * that lens is the thing being cross-checked.
 *
 * So this goes one layer down and asks the question directly: run the normalizer over EVERY canvas
 * the database actually holds, and assert it never throws and always returns complete furniture.
 * That is stronger than the unit tests, which assert against shapes I invented — this asserts
 * against shapes the product really produced and stored, including any the fixtures never imagined.
 *
 * It deliberately shares nothing with the four lenses: no Playwright, no HTTP, no lens helper. It
 * imports the shipped module and calls it.
 *
 *   cd frontend && npx tsx scripts/crosscheck-canvas-normalize.mts
 * Exit 0 if every stored canvas normalizes to a complete, renderable rule set; 1 otherwise.
 */
import postgres from 'postgres';
import { normalizeCanvas, withCanvasDefaults, type CanvasDocument } from '../lib/types/canvas-document';

const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

let ok = true;
const A = (label: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  ok = ok && cond;
};

/** The properties a renderer dereferences without guarding — the exact crash surface of B78. */
function complete(c: ReturnType<typeof normalizeCanvas>): string | null {
  if (!c.format) return 'no format';
  if (!c.font_default?.family) return 'font_default.family missing';
  if (typeof c.font_default?.size !== 'number') return 'font_default.size missing';
  for (const k of ['header', 'footer'] as const) {
    const f = c[k];
    if (f && !f.font?.family) return `${k}.font.family missing (the B78 crash)`;
    if (f && typeof f.font?.size !== 'number') return `${k}.font.size missing`;
  }
  return null;
}

console.log(`· reading ${DB.replace(/:[^:@/]*@/, ':***@')} · normalizer called directly, no browser`);

try {
  // 1 · every canvas rule-set stored on a real document
  const docs = await sql<Array<{ id: string; title: string | null; canvas: unknown }>>`
    SELECT id, title, canvas FROM tenant_documents WHERE canvas <> '{}'::jsonb`;
  console.log(`\n══ ${docs.length} stored document canvas rule-set(s) ══`);
  let bad = 0;
  for (const d of docs) {
    try {
      const why = complete(normalizeCanvas(d.canvas as never));
      if (why) { bad += 1; console.log(`      ✗ ${String(d.title ?? d.id).slice(0, 46)} — ${why}`); }
    } catch (e) {
      bad += 1;
      console.log(`      ✗ ${String(d.title ?? d.id).slice(0, 46)} — THREW: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  if (docs.length === 0) console.log('      (none stored — this arm proves nothing on this fixture)');
  else A('every stored rule-set normalizes complete', bad === 0, `${docs.length} checked`);

  // 2 · the shapes that actually caused B78, asserted against the real function.
  // Not a substitute for arm 1 — a guarantee that the specific regression stays closed even if the
  // fixture never happens to hold one of these again.
  console.log('\n══ the B78 shapes, against the shipped normalizer ══');
  const cases: Array<[string, unknown]> = [
    ['null canvas', null],
    ['undefined canvas', undefined],
    ['empty object', {}],
    ['format only', { format: 'letter' }],
    ['header with no font', { format: 'letter', header: { template: 'x', height: 36 } }],
    ['footer with no font', { format: 'letter', footer: { template: 'y', height: 24 } }],
    ['font_default missing size', { format: 'letter', font_default: { family: 'Times' } }],
    ['header font missing size', { format: 'letter', header: { template: 'x', font: { family: 'Times' } } }],
  ];
  let cbad = 0;
  for (const [label, raw] of cases) {
    try {
      const why = complete(normalizeCanvas(raw as never));
      if (why) { cbad += 1; console.log(`      ✗ ${label} — ${why}`); }
    } catch (e) { cbad += 1; console.log(`      ✗ ${label} — THREW: ${(e as Error).message.slice(0, 60)}`); }
  }
  A('every partial shape yields a complete rule set', cbad === 0, `${cases.length} shapes`);

  // 3 · the document-level entry point the editor actually calls
  console.log('\n══ withCanvasDefaults on a document with no canvas at all ══');
  try {
    const doc = withCanvasDefaults({ nodes: [] } as unknown as CanvasDocument);
    A('returns a document carrying complete canvas rules', complete(doc.canvas as never) === null,
      complete(doc.canvas as never) ?? 'complete');
  } catch (e) {
    A('returns a document carrying complete canvas rules', false, `THREW: ${(e as Error).message.slice(0, 60)}`);
  }
} finally {
  await sql.end();
}

console.log(ok
  ? '\n✓ no stored or partial canvas can reach a renderer incomplete.'
  : '\n✗ a canvas normalizes incomplete — B78 is not fully closed.');
process.exit(ok ? 0 : 1);
