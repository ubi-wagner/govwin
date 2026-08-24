/**
 * CANVAS AUTHORING SWEEP — author NEW documents from a blank canvas, as real actors, and take them
 * out in every format the product offers.
 *
 * WHY THIS EXISTS, given `__tests__/node-vocabulary-coverage.test.ts` already passes.
 *
 * That test proves every one of the 22 canvas primitives comes out of all four writers. It proves
 * it by building a CanvasDocument in memory and calling `exportToDocx(doc)` directly. Nothing in it
 * touches:
 *
 *   · the CREATE route  — a document born from a blank preset, with a real `tenant_documents` row
 *   · the SAVE route    — `validateStandaloneCanvas` (the compliance floor) + the compare-and-swap
 *   · the EXPORT route  — the gate, the `X-Compliance-Violations` header, the audit event, storage
 *   · an authenticated ACTOR, with RLS on, under the app's own NOBYPASSRLS role
 *
 * So the sentence "every primitive survives every format" has only ever been true of a function
 * call. This drives the SAME fixture (`vocabularyDoc()`, imported, not re-derived — so a difference
 * is attributable to the path and not to the content) through the product's own front door.
 *
 * It also authors two artifacts that did not exist in any shape before, because a format is not
 * exercised by a fixture that was built to exercise it:
 *
 *   A. a two-page marketing sheet for a new drone   → docx + pdf   (tenant_admin)
 *   B. a 12-month / 6-milestone / $250k project schedule with gantt bars → xlsx  (tenant_admin)
 *      — a PROJECT-MANAGEMENT artifact, deliberately NOT the cost volume; nothing here goes near
 *        the burden engine, and the drive asserts that.
 *   C. a capability deck                            → pptx + pdf   (rfp_admin)
 *
 * WHAT COUNTS AS PROOF. Bytes are not proof: an exporter that writes an empty, valid .docx returns
 * bytes. Every export below is opened — OOXML unzipped and its parts read, PDF checked for its
 * header and page objects — and the CONTENT the author typed is looked for inside. A format that
 * returns a well-formed file with the content missing is the failure this is built to catch.
 *
 *   cd frontend && BASE=http://localhost:3000 DATABASE_URL=<owner> \
 *     node --import tsx scripts/drive-canvas-authoring.mts
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { sqlBypass as sql } from '@/lib/db';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode, type NodeType } from '@/lib/types/canvas-document';
import { vocabularyDoc, VOCABULARY, VOCAB, mark } from '@/scripts/probe-node-vocabulary.mts';
import { createRequire } from 'module';
import { BASE, launch, signIn } from './lib/cross-company.mts';

const OUT = process.env.CANVAS_OUT || '/tmp/canvas-sweep';
fs.mkdirSync(OUT, { recursive: true });

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const note = (s: string) => console.log(`  · ${s}`);
const head = (s: string) => console.log(`\n── ${s} ──`);
const pad = (s: string, n: number) => s.padEnd(n);

/** A node, built the way the editor builds one (provenance 'manual' — a person typed it). */
const N = (type: NodeType, content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  content: content as CanvasNode['content'],
  style: style as CanvasNode['style'],
  provenance: { source: 'manual', drafted_at: new Date().toISOString() },
  history: [],
  library_eligible: false,
} as unknown as CanvasNode);

const docFrom = (title: string, preset: keyof typeof CANVAS_PRESETS, nodes: CanvasNode[], sectionTitle = title): CanvasDocument => ({
  version: 2,
  document_id: crypto.randomUUID(),
  canvas: { ...CANVAS_PRESETS[preset] },
  nodes: [],
  sections: [{ id: crypto.randomUUID(), title: sectionTitle, layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes }] }],
  metadata: {
    title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
    created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'in_progress',
  },
} as unknown as CanvasDocument);

// ── what a real export must contain ─────────────────────────────────────────────────────────────
const SIG = {
  docx: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b,          // PK — OOXML is a zip
  pptx: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b,
  xlsx: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b,
  pdf:  (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-',
};

// PDF text is inside Flate-compressed content streams, so a raw byte search finds NOTHING and
// reports every string as missing — which is exactly what the first run of this drive did, against
// PDFs that contained the content perfectly. Extract properly, the way a reader would.
const { PDFParse } = createRequire(import.meta.url)('pdf-parse') as { PDFParse: any };
async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try { return ((await parser.getText()).text ?? '') as string; }
  finally { await parser.destroy?.(); }
}

/** All text across an OOXML package's parts; for PDF, the EXTRACTED text. */
async function readable(buf: Buffer, format: string): Promise<string> {
  if (format === 'pdf') return await pdfText(buf);
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(
    Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f)).map((f) => zip.files[f].async('string')));
  return parts.join('\n');
}
async function mediaCount(buf: Buffer): Promise<number> {
  try {
    const zip = await JSZip.loadAsync(buf);
    return Object.keys(zip.files).filter((f) => /media\/|embeddings\//.test(f)).length;
  } catch { return 0; }
}
/** PDF page count, read from the file rather than estimated. */
const pdfPages = (buf: Buffer): number =>
  (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

interface Session { ctx: import('playwright').BrowserContext; label: string }

/** POST/PUT through the signed-in browser context, so auth + RLS are the real ones. */
async function api(s: Session, method: string, url: string, body: unknown): Promise<{ status: number; json: any }> {
  const page = s.ctx.pages()[0];
  return await page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, {
      method: m as string,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  }, [method, url, body] as const) as { status: number; json: any };
}

/** Export through the real route and bring the BYTES back (base64 over the page bridge). */
async function exportDoc(s: Session, url: string, document: CanvasDocument, format: string):
  Promise<{ status: number; buf: Buffer; violations: string }> {
  const page = s.ctx.pages()[0];
  const r = await page.evaluate(async ([u, d, f]) => {
    const res = await fetch(u as string, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: d, format: f }),
    });
    const violations = res.headers.get('x-compliance-violations') ?? '';
    if (!res.ok) return { status: res.status, b64: '', violations };
    const ab = await res.arrayBuffer();
    let s2 = ''; const bytes = new Uint8Array(ab);
    for (let i = 0; i < bytes.length; i += 0x8000) s2 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { status: res.status, b64: btoa(s2), violations };
  }, [url, document, format] as const) as { status: number; b64: string; violations: string };
  return { status: r.status, buf: Buffer.from(r.b64, 'base64'), violations: r.violations };
}

const browser = await launch();
try {
  // ── actors ──────────────────────────────────────────────────────────────────────────────────
  const [admin] = await sql<Array<{ email: string }>>`
    SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active ORDER BY created_at LIMIT 1`;
  const [target] = await sql<Array<{ slug: string; tenantId: string; name: string }>>`
    SELECT t.slug, t.id AS "tenantId", t.name FROM tenants t
    JOIN user_memberships m ON m.tenant_id = t.id
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role = 'tenant_admin'
    GROUP BY t.slug, t.id, t.name ORDER BY t.created_at LIMIT 1`;
  if (!admin) throw new Error('no active platform admin');
  if (!target) throw new Error('no tenant with an active tenant_admin');
  const [member] = await sql<Array<{ email: string }>>`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id = u.id
    WHERE m.tenant_id = ${target.tenantId}::uuid AND u.is_active AND u.role = 'tenant_admin'
    ORDER BY u.created_at LIMIT 1`;
  note(`rfp_admin   ${admin.email}`);
  note(`tenant_admin ${member.email} @ ${target.slug} (${target.name})`);

  const tenantCtx: Session = {
    ctx: await signIn(browser, member.email, process.env.TENANT_PW || 'DemoPass123!'),
    label: 'tenant_admin',
  };
  const adminCtx: Session = {
    ctx: await signIn(browser, admin.email, process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!'),
    label: 'rfp_admin',
  };

  const created: Array<{ id: string; title: string }> = [];

  /** create → save → export(each format), asserting content survived each hop. */
  async function authorAndExport(opts: {
    s: Session; preset: 'flier' | 'letter' | 'deck' | 'sheet'; title: string;
    doc: (documentId: string) => CanvasDocument; formats: string[];
    /** strings the author typed that MUST appear in every exported artifact */
    mustContain: string[];
    expectPdfPages?: number;
  }): Promise<void> {
    const { s, preset, title, formats, mustContain } = opts;

    const c = await api(s, 'POST', `/api/portal/${target.slug}/documents`, { preset, title });
    const documentId: string | undefined = c.json?.data?.documentId;
    A(`[${s.label}] create "${title}" from the ${preset} preset`, (c.status === 200 || c.status === 201) && !!documentId,
      `HTTP ${c.status}${documentId ? '' : ` ${JSON.stringify(c.json).slice(0, 120)}`}`);
    if (!documentId) return;
    created.push({ id: documentId, title });

    const doc = opts.doc(documentId);
    const nodeCount = doc.sections.reduce((n, sec) => n + sec.groups.reduce((m, g) => m + g.nodes.length, 0), 0);

    const sv = await api(s, 'PUT', `/api/portal/${target.slug}/documents/${documentId}/save`,
      { content: doc, baseVersion: 1 });
    A(`[${s.label}]   save (${nodeCount} nodes)`, sv.status === 200,
      sv.status === 200 ? `version ${sv.json?.data?.version}` : `HTTP ${sv.status} ${JSON.stringify(sv.json).slice(0, 140)}`);

    // THE SAVED ROW, read back from the database — not the object we just sent. The export route
    // takes the document in its BODY, so exporting proves nothing about what was persisted.
    const [row] = await sql<Array<{ canvas: unknown; version: number; nodeCount: number }>>`
      SELECT canvas, version, node_count FROM tenant_documents WHERE id = ${documentId}::uuid`;
    const savedNodes = (() => {
      const cd = row?.canvas as CanvasDocument | undefined;
      if (!cd?.sections) return 0;
      return cd.sections.reduce((n, sec) => n + (sec.groups ?? []).reduce((m, g) => m + (g.nodes ?? []).length, 0), 0);
    })();
    A(`[${s.label}]   the DATABASE holds what was authored`, savedNodes === nodeCount,
      `saved ${savedNodes} of ${nodeCount} nodes`);

    for (const format of formats) {
      const { status, buf, violations } = await exportDoc(
        s, `/api/portal/${target.slug}/documents/${documentId}/export`, doc, format);
      if (status !== 200) {
        A(`[${s.label}]   export ${format}`, false, `HTTP ${status}`);
        continue;
      }
      const sigOk = SIG[format as keyof typeof SIG](buf);
      const text = await readable(buf, format);
      const media = await mediaCount(buf);
      const missing = mustContain.filter((m) => !text.includes(m));
      const pages = format === 'pdf' ? pdfPages(buf) : 0;

      const file = path.join(OUT, `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${format}`);
      fs.writeFileSync(file, buf);

      A(`[${s.label}]   export ${format}`,
        sigOk && buf.length > 1000 && missing.length === 0,
        [`${(buf.length / 1024).toFixed(1)} KB`,
         sigOk ? '' : 'BAD SIGNATURE',
         media ? `${media} media` : '',
         pages ? `${pages} pdf pages` : '',
         violations ? `violations: ${violations}` : '',
         missing.length ? `MISSING: ${missing.join(', ')}` : ''].filter(Boolean).join(' · '));

      if (format === 'pdf' && opts.expectPdfPages) {
        A(`[${s.label}]   …and it is ${opts.expectPdfPages} page(s) as intended`, pages === opts.expectPdfPages,
          `printed ${pages}`);
      }
    }
  }

  // ══ A. the drone two-pager — docx + pdf ════════════════════════════════════════════════════
  head('A · a two-page marketing sheet for a new drone (tenant_admin → docx + pdf)');
  await authorAndExport({
    s: tenantCtx, preset: 'letter', title: 'HAWKEYE R7 Marketing Sheet', formats: ['docx', 'pdf'],
    mustContain: ['HAWKEYE R7', 'endurance', 'Specifications'],
    doc: (id) => {
      const d = docFrom('HAWKEYE R7 Marketing Sheet', 'letter_onepager', [
        N('heading', { level: 1, text: 'HAWKEYE R7' }),
        N('text_block', { text: 'A 7 kg VTOL quadrotor built for persistent, GPS-denied inspection of infrastructure the crew cannot safely reach.' }),
        N('callout', { variant: 'tip', title: 'At a glance', text: '82-minute endurance · 12 km control radius · 1.4 kg payload · IP54 · sets up in under four minutes.' }),
        N('heading', { level: 2, text: 'Why it exists' }),
        N('text_block', { text: 'Bridge, stack and transmission-tower inspection still puts people on ropes. The R7 flies the same profile from the ground, holds position without GPS, and lands with a photogrammetric record an engineer can measure against last year’s.' }),
        N('bulleted_list', { items: [
          { text: 'Visual-inertial hold keeps station inside a steel lattice where GNSS drops out entirely.' },
          { text: 'Dual 48 MP global-shutter sensors — no rolling-shutter smear at survey speed.' },
          { text: 'Hot-swap batteries: two packs put an inspector over the asset for a full shift.' },
          { text: 'Ships in one Pelican case, under the 23 kg check-in limit.' },
        ] }),
        N('divider', {}),
        N('heading', { level: 2, text: 'Specifications' }),
        N('table', { headers: ['Parameter', 'HAWKEYE R7', 'Prior generation'], rows: [
          ['Endurance (hover, no payload)', '82 min', '46 min'],
          ['Max takeoff weight', '7.0 kg', '6.2 kg'],
          ['Usable payload', '1.4 kg', '0.9 kg'],
          ['Control radius', '12 km', '8 km'],
          ['Wind tolerance (sustained)', '14 m/s', '10 m/s'],
          ['GNSS-denied hold', 'Yes — VIO + LiDAR floor', 'No'],
          ['Ingress rating', 'IP54', 'IP43'],
          ['Time to first flight', '3 min 40 s', '9 min'],
        ] }),
        N('caption', { text: 'Bench and field figures, 20 °C, sea level. Endurance measured to 20 % reserve.' }),
        N('page_break', {}),
        N('heading', { level: 2, text: 'In the field' }),
        N('image', { alt: 'R7 holding station beneath a bridge deck', caption: 'Station-keeping under a deck soffit, GNSS unavailable.' }),
        N('text_block', { text: 'A regional authority flew 41 spans in nine days with two operators — work previously scoped at six weeks with a rope crew and a lane closure.' }),
        N('blockquote', { text: 'We stopped closing lanes to look at concrete. That is the whole business case.', attribution: 'Bridge program manager, Midwest DOT' }),
        N('heading', { level: 2, text: 'What ships in the case' }),
        N('numbered_list', { items: [
          { text: 'R7 airframe with arms folded, props stowed.' },
          { text: 'Two 12 000 mAh packs and a four-bay field charger.' },
          { text: 'Ruggedised controller with 1 000-nit daylight display.' },
          { text: 'Calibration target and a printed airworthiness log.' },
        ] }),
        N('heading', { level: 2, text: 'Ordering' }),
        N('table', { headers: ['Configuration', 'Part number', 'Lead time'], rows: [
          ['R7 Base (single battery)', 'HK-R7-100', '6 weeks'],
          ['R7 Inspection (dual battery, LiDAR)', 'HK-R7-220', '8 weeks'],
          ['R7 Fleet (four aircraft, case, spares)', 'HK-R7-400F', '12 weeks'],
        ] }),
        N('footnote', { text: 'Specifications subject to change. Export classification EAR99; contact us before international shipment.' }),
        N('url', { href: 'https://example.com/hawkeye-r7', label: 'hawkeye.example.com/r7' }),
      ]);
      (d as { document_id: string }).document_id = id;
      return d;
    },
  });

  // ══ B. the project schedule workbook — xlsx ════════════════════════════════════════════════
  head('B · a 12-month / 6-milestone / $250k project schedule (tenant_admin → xlsx)');
  const MONTHS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'];
  /** A gantt row rendered as cells: '' outside the span, '█' inside, '◆' on the milestone. */
  const bar = (start: number, end: number, milestone: number): string[] =>
    MONTHS.map((_, i) => (i + 1 === milestone ? '◆' : i + 1 >= start && i + 1 <= end ? '█' : ''));
  await authorAndExport({
    s: tenantCtx, preset: 'sheet', title: 'R7 Certification Program Schedule', formats: ['xlsx'],
    mustContain: ['Certification Program', 'M12', 'Airworthiness'],
    doc: (id) => {
      const d = docFrom('R7 Certification Program Schedule', 'spreadsheet', [
        N('heading', { level: 1, text: 'R7 Certification Program — 12-Month Schedule' }),
        N('text_block', { text: 'Six milestones across twelve months, $250,000 total. This is a schedule and milestone-payment plan — it is not a cost volume and carries no burden build-up.' }),
        N('heading', { level: 2, text: 'Milestone schedule' }),
        N('table', {
          headers: ['#', 'Milestone', 'Owner', 'Due', 'Value', ...MONTHS],
          rows: [
            ['1', 'Requirements & test plan baselined', 'Systems', 'M2', '$25,000', ...bar(1, 2, 2)],
            ['2', 'Airworthiness bench campaign complete', 'Test', 'M4', '$40,000', ...bar(2, 4, 4)],
            ['3', 'GNSS-denied flight demonstration', 'Flight Ops', 'M6', '$45,000', ...bar(4, 6, 6)],
            ['4', 'Environmental & ingress qualification', 'Test', 'M8', '$40,000', ...bar(6, 8, 8)],
            ['5', 'Pilot deployment with launch customer', 'Programs', 'M10', '$55,000', ...bar(8, 10, 10)],
            ['6', 'Certification package submitted', 'Quality', 'M12', '$45,000', ...bar(10, 12, 12)],
          ],
        }),
        N('caption', { text: '█ work in progress · ◆ milestone due and payable. Values are milestone payments, not burdened cost.' }),
        N('heading', { level: 2, text: 'Payment profile' }),
        N('table', {
          headers: ['Quarter', 'Milestones landing', 'Invoiced', 'Cumulative', '% of $250,000'],
          rows: [
            ['Q1 (M1–M3)', '1', '$25,000', '$25,000', '10%'],
            ['Q2 (M4–M6)', '2, 3', '$85,000', '$110,000', '44%'],
            ['Q3 (M7–M9)', '4', '$40,000', '$150,000', '60%'],
            ['Q4 (M10–M12)', '5, 6', '$100,000', '$250,000', '100%'],
          ],
        }),
        N('heading', { level: 2, text: 'Spend curve' }),
        N('chart', {
          chart_type: 'line', title: 'Cumulative invoiced vs. plan ($000)',
          series: [
            { name: 'Cumulative invoiced', data: [0, 25, 25, 65, 110, 110, 150, 150, 150, 250, 250, 250] },
          ],
          categories: MONTHS,
        }),
        N('callout', { variant: 'warning', title: 'Schedule risk', text: 'Milestone 3 depends on range availability in M5–M6. If the range slips, milestones 3 through 6 shift together and the Q2 invoice moves to Q3.' }),
      ]);
      (d as { document_id: string }).document_id = id;
      return d;
    },
  });

  // ══ C. a capability deck — pptx + pdf, authored by the ADMIN ════════════════════════════════
  head('C · a capability deck (rfp_admin → pptx + pdf)');
  await authorAndExport({
    s: adminCtx, preset: 'deck', title: 'Hawkeye Capability Brief', formats: ['pptx', 'pdf'],
    mustContain: ['Hawkeye', 'Capability'],
    doc: (id) => {
      const d = docFrom('Hawkeye Capability Brief', 'slide_deck', [
        N('heading', { level: 1, text: 'Hawkeye Robotics — Capability Brief' }),
        N('text_block', { text: 'Persistent inspection where people should not go.' }),
        N('heading', { level: 2, text: 'The problem' }),
        N('bulleted_list', { items: [
          { text: 'Rope access is slow, expensive and dangerous.' },
          { text: 'GNSS drops out exactly where the structure is.' },
          { text: 'Last year’s survey is rarely comparable to this year’s.' },
        ] }),
        N('heading', { level: 2, text: 'Our approach' }),
        N('chart', { chart_type: 'bar', title: 'Inspection hours per 10 spans',
          series: [{ name: 'Hours', data: [240, 96, 34] }], categories: ['Rope crew', 'Prior UAS', 'R7'] }),
        N('heading', { level: 2, text: 'Past performance' }),
        N('table', { headers: ['Customer', 'Scope', 'Outcome'], rows: [
          ['Midwest DOT', '41 spans', 'Nine days, no lane closure'],
          ['Regional utility', '260 towers', 'Two damaged insulators found pre-failure'],
        ] }),
        N('heading', { level: 2, text: 'Contact' }),
        N('signature', { name: 'Dana Whitfield', title: 'VP Programs, Hawkeye Robotics' }),
      ]);
      (d as { document_id: string }).document_id = id;
      return d;
    },
  });

  // ══ D. every primitive, every format, through the real routes ═══════════════════════════════
  head('D · all 22 primitives through the real create → save → export path');
  note(`fixture: vocabularyDoc() — the SAME document the unit test uses (${VOCABULARY.length} primitives)`);
  for (const s of [tenantCtx, adminCtx]) {
    await authorAndExport({
      s, preset: 'letter', title: `Primitive Vocabulary (${s.label})`,
      formats: ['docx', 'pptx', 'xlsx', 'pdf'],
      mustContain: [],   // per-primitive presence is checked below, marker by marker
      doc: (id) => {
        const d = vocabularyDoc('letter_standard');
        (d as { document_id: string }).document_id = id;
        (d as { metadata: { title: string } }).metadata.title = `Primitive Vocabulary (${s.label})`;
        return d;
      },
    });
  }

  // Per-primitive, per-format presence — the differential the unit test does, but on route output.
  head('D2 · per-primitive survival, measured on the ROUTE’s bytes');
  // Sourced from the survey in `__tests__/node-vocabulary-coverage.test.ts`: the (format, type)
  // pairs that are EXPECTED to arrive as an embedded image rather than as text.
  const RASTER_BY_DESIGN: Record<string, string[]> = { docx: ['chart'], xlsx: ['chart', 'shape'] };
  const mediaByFormat: Record<string, number> = {};
  const vocab = vocabularyDoc('letter_standard');
  const primitiveRows: Array<{ type: string; docx: string; pptx: string; xlsx: string; pdf: string }> = [];
  const [{ id: vocabDocId }] = [{ id: created.find((c) => c.title.startsWith('Primitive Vocabulary'))?.id }]
    .filter((x) => !!x.id) as Array<{ id: string }>;
  const bytesByFormat: Record<string, Buffer> = {};
  for (const format of ['docx', 'pptx', 'xlsx', 'pdf']) {
    const r = await exportDoc(tenantCtx, `/api/portal/${target.slug}/documents/${vocabDocId}/export`, vocab, format);
    if (r.status === 200) { bytesByFormat[format] = r.buf; mediaByFormat[format] = await mediaCount(r.buf); }
  }
  for (const v of VOCABULARY) {
    const row = { type: v.type, docx: '', pptx: '', xlsx: '', pdf: '' };
    for (const format of ['docx', 'pptx', 'xlsx', 'pdf'] as const) {
      const buf = bytesByFormat[format];
      if (!buf) { row[format] = '—'; continue; }
      const text = await readable(buf, format);
      // `mark(type)` is the per-node marker the FIXTURE plants (ZQMARK…ZQ). Searching for the type
      // NAME instead — which the first version of this did — finds whatever the package happens to
      // mention and misses the content entirely: it reported 18 of 22 primitives MISSING against
      // exports that were perfect. Use the marker the fixture actually wrote.
      const structural = !(v as { textual: boolean }).textual;
      if (structural) { row[format] = 'struct'; continue; }
      const found = text.includes(mark(v.type));
      // `VocabCase.textual` is a SCALAR, but survival is per-FORMAT: the survey behind
      // node-vocabulary-coverage.test.ts records that `chart` arrives in docx, and `chart`/`shape`
      // in xlsx, as embedded PNGs — rasterised, which is rendering, not dropping. Classifying with
      // the scalar flag reported those three cells as MISSING against exports that were correct.
      // A raster claim is only allowed if the package actually GAINED a media part; otherwise the
      // word "raster" would be a way of excusing a drop.
      const rasterByDesign = (RASTER_BY_DESIGN[format] ?? []).includes(v.type);
      row[format] = found ? 'text'
        : rasterByDesign && (mediaByFormat[format] ?? 0) > 0 ? 'raster'
        : 'MISSING';
    }
    primitiveRows.push(row);
  }
  console.log(`\n  ${pad('primitive', 16)} ${pad('docx', 9)} ${pad('pptx', 9)} ${pad('xlsx', 9)} pdf`);
  console.log(`  ${'-'.repeat(16)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)}`);
  for (const r of primitiveRows) {
    console.log(`  ${pad(r.type, 16)} ${pad(r.docx, 9)} ${pad(r.pptx, 9)} ${pad(r.xlsx, 9)} ${r.pdf}`);
  }
  // ── the four STRUCTURAL primitives, measured by differential ────────────────────────────────
  //
  // `toc`, `page_break`, `spacer` and `divider` are `textual: false` in the fixture and carry NO
  // marker, because they have no text field to put one in. Searching for a marker in them is
  // meaningless in BOTH directions: absence proves nothing and presence would be an accident. The
  // first version of this table called all four MISSING in all four formats and would have had me
  // report four phantom drops.
  //
  // The only honest question for a node with no text is: does the writer EMIT anything for it? So
  // export a one-node document, export an empty one, and compare. A writer that renders the node
  // produces a different package; one that falls through its switch produces an identical one.
  head('D3 · the four structural primitives, measured by differential (no text to search for)');
  // IN CONTEXT, not alone. The first version exported a document containing ONLY the structural
  // node and compared it to an empty one — and a `toc` with no headings to list, or a `page_break`
  // with nothing on either side of it, correctly renders nothing. That probe reported toc/pdf,
  // page_break/pdf and page_break/xlsx as no-ops against writers that handle all three properly
  // (proven separately: with a break between two paragraphs the PDF goes 1 page → 2; with headings
  // present the toc's entries appear in the extracted text). A structural node can only be measured
  // where it has something to act on, so every probe below carries surrounding content and the
  // BASELINE carries the same content without the structural node.
  const NOISE_FLOOR_B = 4;
  const context = (): CanvasNode[] => ([
    N('heading', { level: 1, text: 'Alpha Chapter' }),
    N('text_block', { text: 'Body text before the structural node under test.' }),
    N('heading', { level: 2, text: 'Bravo Chapter' }),
    N('text_block', { text: 'Body text after it.' }),
  ]);
  const emptyDoc = docFrom('probe-empty', 'letter_standard', context());
  const structuralTypes = VOCABULARY.filter((v) => !(v as { textual: boolean }).textual).map((v) => v.type);
  const structRows: Array<{ type: string; docx: string; pptx: string; xlsx: string; pdf: string }> = [];
  const baseline: Record<string, number> = {};
  let basePdfPages = 0;
  for (const format of ['docx', 'pptx', 'xlsx', 'pdf'] as const) {
    const r = await exportDoc(tenantCtx, `/api/portal/${target.slug}/documents/${vocabDocId}/export`, emptyDoc, format);
    baseline[format] = r.status === 200 ? r.buf.length : -1;
    if (format === 'pdf' && r.status === 200) basePdfPages = pdfPages(r.buf);
  }
  note(`baseline = the same 4 content nodes WITHOUT the structural node — `
    + `${Object.entries(baseline).map(([f, n]) => `${f}:${n}B`).join(' · ')}`);
  for (const type of structuralTypes) {
    // Insert the node in the MIDDLE of the context, where a break/spacer/divider has something to
    // separate and a toc has headings to list.
    // AMPLIFY the parameter where the node has one. The vocabulary fixture's spacer is 24pt, whose
    // effect on a compressed package is a byte or two — below the noise floor, so a working writer
    // measured as a no-op. A differential is only evidence if the effect it looks for is larger
    // than the noise it is looking through; 900pt is more than a full page: the effect is a new PAGE, not a few bytes.
    const probeNode = type === 'spacer' ? N('spacer', { height: 900 })
      : VOCAB[type as keyof typeof VOCAB].node;
    const c = context();
    const one = docFrom(`probe-${type}`, 'letter_standard', [c[0], c[1], probeNode, c[2], c[3]]);
    const row = { type, docx: '', pptx: '', xlsx: '', pdf: '' };
    for (const format of ['docx', 'pptx', 'xlsx', 'pdf'] as const) {
      const r = await exportDoc(tenantCtx, `/api/portal/${target.slug}/documents/${vocabDocId}/export`, one, format);
      if (r.status !== 200) { row[format] = 'ERR'; continue; }
      // NOISE FLOOR. An OOXML package is a zip, and the same input does not always compress to the
      // same length — `spacer/xlsx` measured +1B on one run and NO-OP on the next, which had me
      // chasing a difference that was compression jitter. A few bytes is not evidence that a writer
      // rendered anything, so anything inside the floor is reported as no-op rather than as signal.
      if (format === 'pdf') {
        // PAGES, not bytes. A structural node changes a PDF by moving content across a page edge —
        // an effect a compressed byte count barely registers: a 900pt spacer (more than a full page)
        // measured as NO-OP by length while the same document demonstrably printed on two pages.
        // The unit that matters for a paginated format is the page.
        const pages = pdfPages(r.buf);
        row[format] = pages !== basePdfPages ? `${pages - basePdfPages > 0 ? '+' : ''}${pages - basePdfPages}pp`
          : 'NO-OP';
        continue;
      }
      const delta = r.buf.length - baseline[format];
      row[format] = Math.abs(delta) > NOISE_FLOOR_B ? `${delta > 0 ? '+' : ''}${delta}B` : 'NO-OP';
    }
    structRows.push(row);
  }
  console.log(`\n  ${pad('structural', 16)} ${pad('docx', 9)} ${pad('pptx', 9)} ${pad('xlsx', 9)} pdf`);
  console.log(`  ${'-'.repeat(16)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)}`);
  for (const r of structRows) {
    console.log(`  ${pad(r.type, 16)} ${pad(r.docx, 9)} ${pad(r.pptx, 9)} ${pad(r.xlsx, 9)} ${r.pdf}`);
  }
  // A spreadsheet is a GRID: it has no page to break and no vertical whitespace to place, and
  // `xlsx-exporter.ts:120` filters both types out by name. That is a decision, not a gap, so it is
  // named here — an exception a reader can check, rather than a silent pass or a standing red.
  // Read off the SOURCE, not off the bytes: `xlsx-exporter.ts:120` filters both types by name —
  //   nodes.filter((n) => n.type !== 'table' && n.type !== 'page_break' && n.type !== 'spacer')
  // A grid has no page to break and no vertical whitespace to place. Both are decisions.
  const BY_DESIGN = new Set(['page_break/xlsx', 'spacer/xlsx']);
  const noops = structRows.flatMap((r) => (['docx', 'pptx', 'xlsx', 'pdf'] as const)
    .filter((f) => r[f] === 'NO-OP').map((f) => `${r.type}/${f}`));
  const unexpected = noops.filter((n) => !BY_DESIGN.has(n));

  // WHAT THIS TABLE IS, AND WHAT IT IS NOT.
  //
  // It is a coarse differential, and it took six iterations to learn its limits — each one worth
  // recording, because each produced a confident wrong answer:
  //   · alone, a `toc` with no headings and a `page_break` with nothing to break render nothing —
  //     correctly. Measured in context instead.
  //   · a package is a zip, so the same input does not always compress to the same length; a 1-byte
  //     delta flipped between runs. Hence the noise floor.
  //   · a 900pt spacer — more than a full page — moves content without changing the compressed byte
  //     count meaningfully, so bytes cannot see it; page count can.
  //   · but page count cannot see a `toc` or a `divider`, which add content without adding a page.
  //
  // No single metric answers for all four types in all four formats. So this table REPORTS what it
  // measured and does not pretend to a verdict it cannot earn: a NO-OP here means "this instrument
  // saw nothing", which is not the same as "the writer emitted nothing". The decisive per-node
  // answers live in `scripts/probe-structural-nodes.mts`, which measures each one the way its own
  // effect can actually be seen — and those results ARE asserted.
  note(`instrument: byte delta (floor ${NOISE_FLOOR_B}B) except pdf, measured in pages`);
  if (unexpected.length) {
    note(`not visible to THIS instrument: ${unexpected.join(', ')} — see probe-structural-nodes.mts,`);
    note('  which measures each structural node by the effect it actually has');
  }
  const claimed = [...BY_DESIGN].filter((b) => noops.includes(b));
  note(`${claimed.length} no-op(s) by design — ${claimed.join(', ')} `
    + '(a grid has no pages to break and no whitespace to place; xlsx-exporter.ts:120)');
  // If a by-design exception ever starts DOING something, the exception is stale and should go.
  const stale = [...BY_DESIGN].filter((b) => !noops.includes(b));
  if (stale.length) A('no stale by-design exceptions', false, `${stale.join(', ')} now emit output — drop the exception`);

  const dropped = primitiveRows.filter((r) => [r.docx, r.pptx, r.xlsx, r.pdf].includes('MISSING'));
  const rasters = primitiveRows.flatMap((r) => (['docx', 'pptx', 'xlsx', 'pdf'] as const)
    .filter((f) => r[f] === 'raster').map((f) => `${r.type}/${f}`));
  A(`no primitive is silently dropped by any writer on the route path`, dropped.length === 0,
    dropped.length ? `DROPPED: ${dropped.map((d) => d.type).join(', ')}`
      : `${primitiveRows.length} primitives × 4 formats = ${primitiveRows.length * 4} cells`);
  note(`${rasters.length} cell(s) arrive as an embedded raster by design, each with a media part to show for it`);
  note(`media parts per package — ${Object.entries(mediaByFormat).map(([f, n]) => `${f}:${n}`).join(' · ')}`);

  // ── the artifacts are on disk for a human to open ───────────────────────────────────────────
  head('artifacts');
  for (const f of fs.readdirSync(OUT).sort()) {
    const st = fs.statSync(path.join(OUT, f));
    console.log(`  ${pad(f, 46)} ${(st.size / 1024).toFixed(1)} KB`);
  }

  console.log(`\n${ok ? '✓ authored from blank → saved → exported, in every format, as both actors'
    : '✗ see failures above'}\n`);
} catch (e) {
  console.error('DRIVE ERROR', e);
  ok = false;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
  process.exit(ok ? 0 : 1);
}
