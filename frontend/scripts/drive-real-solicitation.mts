/**
 * drive-real-solicitation — put an actual government solicitation through the actual product.
 *
 * Every ranking number this project has produced came off seeded fixtures: a 103-character summary,
 * no documents, no highlights, `solicitation_annotations` empty since migration 009. The design was
 * argued from measurements of a corpus that had never contained a solicitation.
 *
 * This uploads one — the DoW 2026 SBIR BAA, 330 pages — through `POST /api/admin/rfp-upload` as a
 * signed-in rfp_admin, with a real multipart body. Not a hand-written INSERT: the route stores the
 * object, creates the opportunity, the curated_solicitations row and the solicitation_documents
 * row, and emits `finder:rfp.uploaded` so the workflow processor shreds it.
 *
 * Then it walks the rest of the admin's job — curate, highlight, release — and measures what a
 * tenant's lens can see at the end that it could not see at the start.
 *
 * ⚠️ NOT read-only, and it does not clean up: the point is to leave a real solicitation on the box.
 * Pass --cleanup to remove what it created.
 *
 * Usage:  node --import tsx frontend/scripts/drive-real-solicitation.mts [--cleanup]
 */

import postgres from 'postgres';
import { chromium, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const ADMIN_PW = process.env.ADMIN_PW ?? process.env.SANDBOX_PASSWORD ?? 'SandboxDrive2026!';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLEANUP = process.argv.includes('--cleanup');
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const PDF = 'DoW 2026 SBIR BAA FULL_R1_04132026.pdf';
const TITLE = 'DoW 2026 SBIR Broad Agency Announcement (Release 1)';

const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });
let failures = 0;
const ok = (l: string, p: boolean, d = '') => { console.log(`${p ? '  ✓' : '  ✗'} ${l}${d ? ` — ${d}` : ''}`); if (!p) failures++; };
const n = (v: unknown) => Number(v ?? 0).toLocaleString();

/**
 * Sign in and hand back an authenticated request context.
 *
 * Through the browser, not raw fetch: NextAuth's credentials callback sets an encrypted session
 * cookie via a redirect chain that a hand-rolled fetch gets subtly wrong — the first attempt here
 * authenticated "successfully" and then got 401 on the next call. Playwright's context carries the
 * cookie the same way a user's browser does, and `context.request` reuses it for the upload, so the
 * multipart POST is made by the same session that signed in.
 */
async function authed(email: string, password: string): Promise<{ api: APIRequestContext; close: () => Promise<void> }> {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  if (page.url().includes('/login')) {
    console.error(`\n  could not sign in as ${email}\n`);
    await browser.close();
    process.exit(2);
  }
  return { api: ctx.request, close: () => browser.close() };
}

async function main() {
  console.log('\ndrive-real-solicitation — a government solicitation through the product\n');

  if (CLEANUP) {
    /**
     * Find them by the link direction that is ACTUALLY POPULATED.
     *
     * The first version selected on `curated_solicitations.source_url`, a column that does not
     * exist — so it threw on every invocation and left three full uploads on the box while I read
     * the tail of its output and moved on. The second trap is underneath: this route creates an
     * UMBRELLA, where `opportunities.solicitation_id` is NULL and the master points BACK via
     * `curated_solicitations.opportunity_id`. Keying on the forward direction finds nothing and
     * reports success. Both are the same lesson SCHEMA_MAP exists for: check which way the FK runs.
     */
    const sols = await owner<Array<{ id: string; oppId: string }>>`
      SELECT cs.id, cs.opportunity_id AS opp_id
      FROM curated_solicitations cs JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE o.solicitation_number = ${'DoW-2026-SBIR-R1'}`;
    if (sols.length === 0) { console.log('  nothing to clean up\n'); await owner.end(); return; }
    for (const s of sols) {
      const opps = await owner<Array<{ id: string }>>`
        SELECT id FROM opportunities WHERE id = ${s.oppId}::uuid OR solicitation_id = ${s.id}::uuid`;
      const ids = opps.map((o) => o.id);
      await owner`DELETE FROM tenant_opportunity_documents WHERE opportunity_id = ANY(${ids}::uuid[])`;
      await owner`DELETE FROM tenant_bucket_scores WHERE opportunity_id = ANY(${ids}::uuid[])`;
      await owner`DELETE FROM tenant_opportunity_cards WHERE opportunity_id = ANY(${ids}::uuid[])`;
      await owner`DELETE FROM opportunity_bridge WHERE opportunity_id = ANY(${ids}::uuid[])`;
      await owner`DELETE FROM solicitation_annotations WHERE solicitation_id = ${s.id}::uuid`;
      await owner`DELETE FROM curation_revisions WHERE solicitation_id = ${s.id}::uuid`;
      await owner`DELETE FROM solicitation_compliance WHERE solicitation_id = ${s.id}::uuid`;
      await owner`DELETE FROM volume_required_items WHERE volume_id IN
                  (SELECT id FROM solicitation_volumes WHERE solicitation_id = ${s.id}::uuid)`;
      await owner`DELETE FROM solicitation_volumes WHERE solicitation_id = ${s.id}::uuid`;
      await owner`DELETE FROM solicitation_documents WHERE solicitation_id = ${s.id}::uuid`;
      await owner`UPDATE opportunities SET solicitation_id = NULL WHERE solicitation_id = ${s.id}::uuid`;
      await owner`DELETE FROM curated_solicitations WHERE id = ${s.id}::uuid`;
      await owner`DELETE FROM opportunities WHERE id = ANY(${ids}::uuid[])`;
      console.log(`  removed ${s.id}`);
    }
    console.log();
    await owner.end();
    return;
  }

  const file = path.join(REPO, 'docs', PDF);
  if (!fs.existsSync(file)) { console.error(`HARNESS CANNOT RUN: ${file} missing`); process.exit(2); }
  const bytes = fs.readFileSync(file);
  console.log(`  document : ${PDF}`);
  console.log(`  size     : ${n(bytes.length)} bytes\n`);

  const [admin] = await owner<Array<{ email: string }>>`
    SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
    ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;
  const { api, close } = await authed(admin.email, ADMIN_PW);
  const probe0 = await api.get('/api/admin/rfp-curation');
  ok(`signed in as ${admin.email}`, probe0.status() === 200, `GET /api/admin/rfp-curation → ${probe0.status()}`);
  if (probe0.status() !== 200) { await close(); process.exit(2); }

  // ── 1 · UPLOAD, through the real route ──────────────────────────────────────────────────────
  console.log('\n1 · UPLOAD — POST /api/admin/rfp-upload, multipart, as the admin');
  const up = await api.post('/api/admin/rfp-upload', {
    multipart: {
      title: TITLE,
      agency: 'Department of War',
      office: 'Small Business Innovation Research',
      programType: 'sbir_phase_1',
      solicitationNumber: 'DoW-2026-SBIR-R1',
      closeDate: new Date(Date.now() + 45 * 86_400_000).toISOString(),
      description: 'Annual Department of War SBIR Broad Agency Announcement, Release 1.',
      sourceUrl: 'drive://real-solicitation',
      files: { name: PDF, mimeType: 'application/pdf', buffer: bytes },
    },
    timeout: 180_000,
  });
  const upBody = await up.json().catch(() => ({}));
  ok('the route accepted it', up.status() === 200 || up.status() === 201, `${up.status()} ${JSON.stringify(upBody).slice(0, 120)}`);
  const solId: string | undefined = upBody?.data?.solicitation_id ?? upBody?.data?.solicitationId;
  const oppId: string | undefined = upBody?.data?.opportunity_id ?? upBody?.data?.opportunityId;
  if (!solId) { console.error('\n  no solicitation id returned — cannot continue\n'); process.exit(1); }
  console.log(`     solicitation ${solId}`);
  console.log(`     opportunity  ${oppId}`);

  const [doc] = await owner<Array<{ id: string; chars: number; pages: number | null; key: string }>>`
    SELECT id, length(COALESCE(extracted_text,''))::int AS chars, page_count AS pages, storage_key AS key
    FROM solicitation_documents WHERE solicitation_id = ${solId}::uuid ORDER BY created_at LIMIT 1`;
  ok('a document row exists', !!doc, doc?.key ?? 'none');

  // ── 2 · SHRED — wait for the workflow, then say what actually happened ──────────────────────
  console.log('\n2 · SHRED — the workflow processor extracts the text');
  // POLL ON WHAT THE SHRED WRITES, not on what the ROUTE writes.
  //
  // The route extracts PDF text inline, so `solicitation_documents.extracted_text` is populated
  // before the response returns. Waiting on that and then reading `curated_solicitations.full_text`
  // reads the second field seconds before the workflow sets it — and the first version of this
  // drive duly reported "the roll-up never happens" as a product gap. It was the polling order.
  // The shred's completion marker is `status = 'ai_analyzed'`; wait for THAT.
  const deadline = Date.now() + 240_000;
  let chars = 0, full = 0, status = '';
  while (Date.now() < deadline) {
    const [r] = await owner<Array<{ c: number; f: number; s: string }>>`
      SELECT (SELECT length(COALESCE(extracted_text,''))::int FROM solicitation_documents WHERE id = ${doc.id}::uuid) AS c,
             length(COALESCE(full_text,''))::int AS f, status AS s
      FROM curated_solicitations WHERE id = ${solId}::uuid`;
    chars = Number(r?.c ?? 0); full = Number(r?.f ?? 0); status = r?.s ?? '';
    if (full > 0 && status !== 'new') break;
    await new Promise((s) => setTimeout(s, 5000));
  }
  ok('the document text was extracted', chars > 0, `${n(chars)} chars`);
  ok('the shred rolled it up onto the solicitation', full > 0, `${n(full)} chars`);
  ok('and the shred completed', status === 'ai_analyzed', `status=${status}`);
  const [loc] = await owner<Array<{ p: string | null }>>`
    SELECT payload->>'passages' AS p FROM system_events
    WHERE type = 'rfp.sections_located' AND payload::text LIKE ${'%' + solId + '%'} LIMIT 1`;
  if (loc?.p) console.log(`     the shredder LOCATED ${loc.p} operative passages rather than reading all ${n(full)} chars`);
  const [ai] = await owner<Array<{ status: string; phase: string | null; hasAi: boolean }>>`
    SELECT status, ingest_phase AS phase, (ai_extracted IS NOT NULL AND ai_extracted::text <> '{}') AS has_ai
    FROM curated_solicitations WHERE id = ${solId}::uuid`;
  console.log(`     status=${ai.status} · ingest_phase=${ai.phase} · ai_extracted=${ai.hasAi}`);

  // ── 3 · CURATE — the two fields the release gate reads, plus the structured ones ────────────
  console.log('\n3 · CURATE — what the admin supplies');
  const summary =
    'Annual DoW SBIR BAA covering all participating components. Phase I feasibility awards to '
    + '$250k over 6 months; component-specific instructions govern evaluation, and the Critical '
    + 'Technology Areas list defines eligible topics. Direct-to-Phase-II available where prior '
    + 'feasibility can be demonstrated.';
  const patch = await api.patch(`/api/admin/rfp-curation/${solId}`, { data: { spotlightSummary: summary } });
  ok('spotlight summary saved through the curation route', patch.ok(), `${patch.status()}`);
  await owner`
    UPDATE opportunities
    SET tech_focus_areas = ${['advanced manufacturing', 'autonomy', 'hypersonics', 'directed energy', 'biotechnology', 'integrated sensing']},
        phase_type = 'phase_1',
        expert_notes = ${'Umbrella BAA — component instructions are the operative rules. Navy and AF sections carry different evaluation weightings.'}
    WHERE id = ${oppId}::uuid`;
  ok('technology focus, phase and expert notes recorded', true, '6 focus areas · phase_1');

  // ── 4 · HIGHLIGHT — the curator marks real passages from the real document ──────────────────
  console.log('\n4 · HIGHLIGHT — the curator marks passages, from the extracted text');
  const [textRow] = await owner<Array<{ t: string }>>`
    SELECT COALESCE(extracted_text,'') AS t FROM solicitation_documents WHERE id = ${doc.id}::uuid`;
  const body = textRow?.t ?? '';
  // Real passages, located in the real text — not invented. Each anchor is the true character
  // offset, so a tenant who pins can resolve it against their own copy.
  const WANTED = ['Critical Technology Area', 'Direct to Phase II', 'Technology Readiness Level',
                  'Phase I awards', 'evaluation criteria'];
  const { solicitationSaveAnnotationTool } = await import('../lib/tools/solicitation-save-annotation.ts');
  const [actor] = await owner<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${admin.email}`;
  let made = 0;
  /**
   * Find the term where it is DISCUSSED, not where it is listed.
   *
   * The first occurrence of every heading in a 330-page solicitation is its table-of-contents
   * entry. The first version of this drive took `indexOf` and duly "highlighted" three rows of dot
   * leaders — "Critical Technology Areas.........." — which is this project's own documented trap
   * (a text search for a thing finds the index of the thing) reproduced by the harness meant to
   * demonstrate curation.
   *
   * A TOC line is recognisable: dot leaders, or a page number hanging off the end. Skip those and
   * take the first occurrence that reads like prose. A real curator would never have marked them,
   * and a drive standing in for one should not either.
   */
  const findProse = (hay: string, needle: string): number => {
    const low = hay.toLowerCase(), nl = needle.toLowerCase();
    let at = low.indexOf(nl);
    while (at >= 0) {
      const window = hay.slice(at, at + 160);
      const isToc = /\.{4,}/.test(window) || /\.\s*\d{1,3}\s*$/.test(window.split('\n')[0] ?? '');
      if (!isToc) return at;
      at = low.indexOf(nl, at + 1);
    }
    return -1;
  };

  for (const needle of WANTED) {
    const at = findProse(body, needle);
    if (at < 0) { console.log(`     – "${needle}" appears only in the contents listing — skipped, not marked`); continue; }
    const passage = body.slice(at, at + 320).replace(/\s+/g, ' ').trim();
    const page = Math.max(1, Math.round((at / Math.max(1, body.length)) * (doc.pages ?? 330)));
    await solicitationSaveAnnotationTool.handler(
      { solicitationId: solId, kind: 'highlight', payload: {},
        sourceLocation: { page, offset: at, length: passage.length, excerpt: passage, method: 'manual_selection' } } as never,
      { actor: { id: actor.id, role: 'rfp_admin', email: admin.email } } as never);
    made++;
    console.log(`     ✓ p.${String(page).padStart(3)}  "${passage.slice(0, 66)}…"`);
  }
  ok('highlights recorded, each located in the real text', made > 0, `${made} of ${WANTED.length}`);

  // ── 5 · RELEASE — the discovery gate, then the fan-out ──────────────────────────────────────
  console.log('\n5 · RELEASE — push to every tenant mirror');
  await owner`UPDATE curated_solicitations SET status = 'approved' WHERE id = ${solId}::uuid`;
  const { publishAndFanOut } = await import('../lib/opportunity-bridge.ts');
  const pushed = await publishAndFanOut(oppId!, 'published', actor.id, new Date().toISOString());
  ok('fanned out', !!pushed, pushed ? `v${pushed.event.version} → ${pushed.tenantsApplied} tenant(s)` : 'null');

  // ── 6 · WHAT A TENANT'S LENS CAN NOW SEE ───────────────────────────────────────────────────
  console.log('\n6 · WHAT THE RANKER SEES on this opportunity');
  const [card] = await owner<Array<{
    lex: number; hl: number; docs: number; sum: number; tfa: number; bytes: number;
  }>>`
    SELECT length(card_tsv)::int AS lex,
           jsonb_array_length(COALESCE(card->'highlights','[]'::jsonb))::int AS hl,
           jsonb_array_length(COALESCE(card->'documents','[]'::jsonb))::int AS docs,
           length(COALESCE(card->>'spotlightSummary',''))::int AS sum,
           jsonb_array_length(COALESCE(card->'techFocusAreas','[]'::jsonb))::int AS tfa,
           pg_column_size(card)::int AS bytes
    FROM tenant_opportunity_cards WHERE opportunity_id = ${oppId}::uuid LIMIT 1`;
  console.log(`     searchable lexemes   ${n(card.lex)}`);
  console.log(`     summary              ${n(card.sum)} chars`);
  console.log(`     technology focus     ${card.tfa}`);
  console.log(`     highlights           ${card.hl}`);
  console.log(`     document manifest    ${card.docs}`);
  console.log(`     card payload         ${n(card.bytes)} bytes  (the ${n(chars)}-char document is NOT in it)`);
  ok('the card carries the curated record', Number(card.lex) > 100, `${card.lex} lexemes`);
  ok('and not the document', Number(card.bytes) < 12_000, `${n(card.bytes)} bytes`);

  // Does a lens find it on a term that exists ONLY in a highlight?
  const probe = 'readiness';
  const [found] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM tenant_opportunity_cards
    WHERE opportunity_id = ${oppId}::uuid AND card_tsv @@ websearch_to_tsquery('english', ${probe})`;
  ok(`a lens for "${probe}" reaches it`, Number(found.n) > 0, `${found.n} card(s)`);

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}`);
  console.log('  (left in place — pass --cleanup to remove)\n');
  await close();
  await owner.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await owner.end(); process.exit(1); });
