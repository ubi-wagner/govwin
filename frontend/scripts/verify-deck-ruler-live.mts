/**
 * The ruler, the grid boundaries and the group boxes — on REAL DECKS, stored through the product.
 *
 * WHY THIS EXISTS. The slide half of the canvas has been verified only against things that are not
 * documents: `calibrate-slide-ruler` builds 7 synthetic decks in memory, and `sweep-mold-quality`
 * renders 5 slide_16_9 molds that are skeletons whose whole content is brackets. Measured on this
 * box, every one of the 64 stored proposal sections is `letter`:
 *
 *     stored artifacts by canvas format → letter: 64      (slides: none)
 *     molds by format                   → letter: 34 · slide_16_9: 5
 *
 * So `verify-ruler-on-stored-artifacts`, the harness whose name promises the corpus, has never once
 * measured a deck that came out of the database. A deck is not a narrow letter page: it does not
 * reflow, `estimateSlideCount` is one slide per section rather than a height division, and the
 * failure that matters is not "runs long" but "content falls off the frame and is simply gone".
 * None of that is exercised by a letter corpus, and a green run over 17 letter volumes says
 * nothing about it.
 *
 * WHAT IT DOES. Authors decks through the REAL routes as a signed-in tenant_admin — create → save →
 * export — so auth, RLS and the stored canvas are the product's, not a fixture's. Then, per deck:
 *
 *   ruler vs rendered   estimateSlideCount against `ppt/slides/slideN.xml` members of the actual
 *                       .pptx. The zip is DEFLATE-compressed, so it is unzipped rather than
 *                       regexed — a raw-buffer scan finds filenames and never markup.
 *   overflow            `overflowingSlides` against shapes whose y+cy exceeds the slide frame,
 *                       read from the same XML. This is the assertion with teeth: an unflagged
 *                       overflow is content the customer never sees.
 *   group boxes         `nodesHeightPt` per section against the drawn extent, the same comparison
 *                       the bounding-box overlay puts in front of an author.
 *   boundaries          `pageBoundaries` must produce exactly one landmark per interior break.
 *
 * RED FIRST. One of the decks is built to overflow on purpose. If the overflow deck is not flagged
 * this exits non-zero, so the harness has a case that fails when the product is wrong — a check
 * that has only ever seen good input proves nothing about the bad.
 *
 *   cd frontend && npx tsx scripts/verify-deck-ruler-live.mts
 * Exit 0 when the ruler never UNDER-counts and every deliberate overflow is caught.
 */
import JSZip from 'jszip';
import { sql, sqlBypass } from '@/lib/db';
import { BASE, launch, signIn } from './lib/cross-company.mts';
import {
  CANVAS_PRESETS, estimateSlideCount, overflowingSlides, nodesHeightPt, docNodes,
  type CanvasDocument, type CanvasNode,
} from '@/lib/types/canvas-document';
import { pageBoundaries } from '@/lib/canvas/measure-grid';

let pass = 0, fail = 0;
const ok = (b: boolean, label: string, detail = '') => {
  if (b) pass++; else fail++;
  console.log(`${b ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (m: string) => console.log(`   ${m}`);

interface Session { ctx: import('playwright').BrowserContext }

async function api(s: Session, method: string, url: string, body: unknown) {
  const page = s.ctx.pages()[0];
  return await page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, {
      method: m as string, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  }, [method, url, body] as const) as { status: number; json: any };
}

/** Export through the real route and bring the BYTES back, base64 over the page bridge. */
async function exportDeck(s: Session, url: string, document: CanvasDocument, format: string) {
  const page = s.ctx.pages()[0];
  const r = await page.evaluate(async ([u, d, f]) => {
    const res = await fetch(u as string, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: d, format: f }),
    });
    const ab = await res.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(ab);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { status: res.status, b64: btoa(bin), violations: res.headers.get('X-Compliance-Violations') || '' };
  }, [url, document, format] as const) as { status: number; b64: string; violations: string };
  return { status: r.status, buf: Buffer.from(r.b64, 'base64'), violations: r.violations };
}

async function slideXml(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
  return Promise.all(names.map((n) => zip.files[n].async('string')));
}

/** Bottom-most shape edge per slide, in EMU — y+cy past the frame is content that is cut off. */
function bottomsEmu(xmls: string[]): number[] {
  return xmls.map((xml) => {
    let max = 0;
    for (const m of xml.matchAll(/<a:off[^>]*y="(-?\d+)"[^>]*\/>\s*<a:ext[^>]*cy="(\d+)"/g)) {
      max = Math.max(max, Number(m[1]) + Number(m[2]));
    }
    return max;
  });
}
const EMU_PER_PT = 12700;

let seq = 0;
const node = (type: string, content: unknown): CanvasNode => ({
  id: `d${++seq}`, type, content, style: {}, provenance: { source: 'manual' }, history: [],
  library_eligible: false,
} as unknown as CanvasNode);

const heading = (text: string) => node('heading', { level: 1, text });
const bullets = (items: string[]) => node('bulleted_list', { items: items.map((text) => ({ text })) });
const para = (text: string) => node('text_block', { text });
const brk = () => node('page_break', {});

function deck(title: string, nodes: CanvasNode[]): CanvasDocument {
  return {
    version: 1,
    canvas: { ...CANVAS_PRESETS.slide_deck },
    metadata: { title },
    nodes,
  } as unknown as CanvasDocument;
}

/** A well-formed 4-slide deck: title, approach, milestones, close. Nothing should overflow. */
function cleanDeck(): CanvasDocument {
  return deck('Counter-UAS Edge Autonomy — Program Review', [
    heading('Counter-UAS Edge Autonomy'),
    para('Phase II program review · Immobileyes Inc. · AF254-D001'),
    brk(),
    heading('Technical approach'),
    bullets([
      'On-board detection at 30 Hz with no uplink dependency',
      'Sensor fusion across EO/IR and passive RF',
      'Deterministic hand-off to the operator on low confidence',
    ]),
    brk(),
    heading('Milestones'),
    bullets([
      'M1 — flight-representative payload integrated',
      'M2 — contested-environment field trial',
      'M3 — transition package delivered',
    ]),
    brk(),
    heading('What we need from the government'),
    bullets(['Range access at two test windows', 'Government-furnished threat library']),
  ]);
}

/**
 * A deck built to OVERFLOW its frame, so the harness has a case that must be caught.
 *
 * A slide does not reflow: 30 bullets on one slide do not become two slides, they become one slide
 * whose bottom shapes sit past the frame and are cut off in the delivered file. That is the failure
 * this whole path exists to catch, so it has to appear in the corpus deliberately.
 */
function overflowingDeck(): CanvasDocument {
  return deck('Overflow probe — deliberately over-stuffed', [
    heading('Qualification evidence'),
    bullets(Array.from({ length: 30 }, (_, i) =>
      `Qualification milestone ${i + 1} — coupons sectioned, tested and dispositioned against AMS spec`)),
    brk(),
    heading('A slide that fits'),
    bullets(['One point', 'Two points']),
  ]);
}

async function main() {
  const [target] = await sql<Array<{ slug: string; tenantId: string; name: string }>>`
    SELECT t.slug, t.id AS "tenantId", t.name FROM tenants t
    JOIN user_memberships m ON m.tenant_id = t.id
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role = 'tenant_admin'
    GROUP BY t.slug, t.id, t.name ORDER BY t.created_at LIMIT 1`;
  if (!target) { console.error('CANT-RUN no tenant with an active tenant_admin — missing fixture.'); process.exit(1); }
  const [member] = await sql<Array<{ email: string }>>`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id = u.id
    WHERE m.tenant_id = ${target.tenantId}::uuid AND u.is_active AND u.role = 'tenant_admin'
    ORDER BY u.created_at LIMIT 1`;
  if (!member) { console.error('CANT-RUN tenant has no active tenant_admin.'); process.exit(1); }

  console.log(`\n── decks through the real routes as ${member.email} @ ${target.slug} ──\n`);
  const browser = await launch();
  const s: Session = { ctx: await signIn(browser, member.email, process.env.TENANT_PW || 'DemoPass123!') };
  const created: string[] = [];

  const cases: Array<{ title: string; doc: CanvasDocument; mustOverflow: boolean }> = [
    { title: 'Program review deck', doc: cleanDeck(), mustOverflow: false },
    { title: 'Overflow probe deck', doc: overflowingDeck(), mustOverflow: true },
  ];

  for (const c of cases) {
    console.log(`\n══ ${c.title} ══`);

    // CREATE → SAVE through the product, so what is measured is what the database holds.
    // The create route answers 201 with { data: { documentId } } — asserting 200 and reading
    // `data.id` was this harness being wrong about the product, which is the usual first output of
    // a new instrument. Read the contract, do not assume it.
    const cr = await api(s, 'POST', `/api/portal/${target.slug}/documents`, { preset: 'deck', title: c.title });
    const documentId = cr.json?.data?.documentId;
    ok(cr.status === 201 && !!documentId, 'deck created through the portal route', `status ${cr.status}`);
    if (!documentId) continue;
    created.push(documentId);

    // The save route's field is `content`, not `canvas`.
    const sv = await api(s, 'PUT', `/api/portal/${target.slug}/documents/${documentId}/save`,
      { content: c.doc, title: c.title });
    ok(sv.status === 200, 'deck saved (stored canvas is the product’s)', `status ${sv.status}`);

    // Read it BACK from the database rather than measuring the object we just built in memory —
    // a round trip is where a canvas loses its format or its nodes. `tenant_documents.canvas` is a
    // column, not a key inside metadata.
    // READ ON THE OWNER POOL. This script sets no `app.tenant_id`, so the context-aware `sql` is
    // scoped to nothing and returns zero rows — which is correct RLS behaviour and useless here.
    //
    // The first version of this then fell back to the in-memory document (`stored?.canvas ?? c.doc`)
    // and carried on. Every assertion after it still passed, while measuring the object built three
    // lines earlier rather than the one the database holds — so the harness's whole claim, that it
    // measures a STORED deck, was false in exactly the way that is hardest to notice: green.
    // A failed read is fatal to the case now, never a silent substitution.
    const [stored] = await sqlBypass<Array<{ canvas: unknown }>>`
      SELECT canvas FROM tenant_documents WHERE id = ${documentId}::uuid`;
    if (!stored?.canvas) {
      ok(false, 'the saved deck is readable back out of the database',
        'nothing came back — every measurement below would have been of the in-memory doc');
      continue;
    }
    ok(true, 'the saved deck is readable back out of the database');
    const storedDoc = stored.canvas as CanvasDocument;
    ok(storedDoc?.canvas?.format === 'slide_16_9', 'stored canvas is still a 16:9 deck',
      String(storedDoc?.canvas?.format));

    // ── the ruler against the rendered artifact ──────────────────────────────────────────────
    const px = await exportDeck(s, `/api/portal/${target.slug}/documents/${documentId}/export`, storedDoc, 'pptx');
    ok(px.status === 200 && px.buf.length > 0, 'exports as .pptx', `${Math.round(px.buf.length / 1024)}KB`);
    if (px.status !== 200) continue;

    const xmls = await slideXml(px.buf);
    const ruler = estimateSlideCount(storedDoc);
    const rendered = xmls.length;
    note(`ruler ${ruler} · rendered ${rendered}`);
    // UNDER-COUNT IS THE FATAL DIRECTION (B64): a ruler that reads short clears a deck that is
    // over an agency slide limit. Over-counting is conservative and allowed.
    ok(ruler >= rendered, 'the ruler never reads SHORT of the rendered deck',
      ruler === rendered ? 'exact' : `over by ${ruler - rendered}`);

    // ── overflow: the failure that loses content outright ────────────────────────────────────
    const frameEmu = storedDoc.canvas.height * EMU_PER_PT;
    const past = bottomsEmu(xmls)
      .map((b, i) => ({ i, b }))
      .filter(({ b }) => b > frameEmu)
      .map(({ i }) => i + 1);
    const flagged = overflowingSlides(storedDoc).map((i) => i + 1);
    note(`ruler flags slide(s) [${flagged.join(', ') || 'none'}] · shapes past frame on [${past.join(', ') || 'none'}]`);

    if (c.mustOverflow) {
      // THE RED CASE. This deck is over-stuffed on purpose; a harness that never sees a failure
      // is not evidence the check works.
      ok(flagged.length > 0, 'the deliberate overflow IS flagged by the ruler',
        flagged.length ? `slide ${flagged.join(', ')}` : 'NOT FLAGGED — content would be cut off silently');
    } else {
      ok(flagged.length === 0, 'a well-formed deck is not falsely flagged',
        flagged.length ? `false positive on ${flagged.join(', ')}` : 'clean');
      ok(past.length === 0, 'no shape sits past the frame in the rendered file',
        past.length ? `slides ${past.join(', ')}` : 'clean');
    }

    // ── boundaries: one landmark per interior break ──────────────────────────────────────────
    const bounds = pageBoundaries(storedDoc.canvas, ruler);
    ok(bounds.length === Math.max(0, ruler - 1),
      'one boundary landmark per interior slide break', `${bounds.length} for ${ruler} slide(s)`);

    // ── group boxes: what the overlay shows an author ────────────────────────────────────────
    // Each run between page breaks is what the overlay boxes. Its modelled height must be a real
    // number — an unmeasurable group renders a box labelled NaN, which is worse than no box.
    const runs: CanvasNode[][] = [[]];
    for (const n of docNodes(storedDoc)) {
      if ((n as { type?: string }).type === 'page_break') runs.push([]);
      else runs[runs.length - 1].push(n);
    }
    const heights = runs.filter((r) => r.length).map((r) => nodesHeightPt(r, storedDoc.canvas));
    ok(heights.every((h) => Number.isFinite(h) && h > 0),
      'every group run measures to a finite, positive height',
      heights.map((h) => Math.round(h) + 'pt').join(' · '));

    // A deck also has to survive the other export target its authors use.
    const pdf = await exportDeck(s, `/api/portal/${target.slug}/documents/${documentId}/export`, storedDoc, 'pdf');
    ok(pdf.status === 200 && pdf.buf.length > 0, 'the same deck exports as .pdf',
      `${Math.round(pdf.buf.length / 1024)}KB`);
  }

  // Clean up: this harness authors real rows through the real routes, and leaving probe decks in a
  // tenant's document list is how a corpus quietly fills with test data.
  //
  // Torn down on the owner pool, as the other harnesses do (lib/scenario.mts): there is no archive
  // route for a tenant document, and a cleanup that quietly 404s leaves the mess it claims to have
  // removed. Deleting only the ids THIS run created — never a title match, which would reach rows
  // a person authored.
  let removed = 0;
  if (created.length) {
    const [{ n }] = await sqlBypass<Array<{ n: number }>>`
      WITH gone AS (DELETE FROM tenant_documents WHERE id = ANY(${created}::uuid[]) RETURNING 1)
      SELECT count(*)::int AS n FROM gone`;
    removed = n;
  }
  note(`\ncleanup: ${removed} of ${created.length} probe deck(s) removed`);
  if (removed !== created.length) {
    ok(false, 'cleanup removed every probe deck it created', `${removed}/${created.length}`);
  }

  await browser.close();
  await sql.end();
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('DRIVE ERROR', e);
  await sql.end().catch(() => {});
  process.exit(1);
});
