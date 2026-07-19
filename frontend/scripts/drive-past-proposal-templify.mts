/**
 * Drive-test #18: past-proposal → template (templify) + regen, via the real API.
 *
 * A past proposal is an uploaded package (document_cocoon) of section atoms. This proves:
 *   1. the library lists it as a past proposal (with its section count, not-yet-templified);
 *   2. TEMPLIFY → a tenant document_template skeleton, provenance-linked to the cocoon,
 *      audited (library:template.extracted, source=past_proposal);
 *   3. the library now shows it templified (cross-linked to the template);
 *   4. REGEN → a fresh tenant_document from that template, audited (library:document.created).
 *
 * Self-contained: seeds a cocoon + ordered primitive atoms (simulating upload→atomize),
 * drives the API with the tenant admin's session, asserts DB + events, then cleans up.
 */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const PW = 'DemoPass123!';
const ADMIN = 'admin@acme-navy.test';
const SLUG = 'acme-navy-systems';
const sql = postgres(process.env.DATABASE_URL!, { max: 2 });
let exitCode = 0;
const ok = (c: boolean, l: string) => { console.log(`${c ? '✅' : '❌ FAIL'}  ${l}`); if (!c) exitCode = 1; };

const SECTIONS = [
  { title: 'Identification and Significance of the Problem', body: 'The problem of counter-UAS detection in cluttered RF environments is significant because current sensors saturate. Our prior award demonstrated a 40% improvement.' },
  { title: 'Technical Objectives', body: 'Objective 1: demonstrate real-time classification at TRL 5. Objective 2: integrate with the existing C2 stack. Objective 3: validate against a live-fly dataset.' },
  { title: 'Technical Approach and Work Plan', body: 'We use a staged approach: sensor fusion, an edge inference model, and a transition-ready API. Task 1 builds the pipeline; Task 2 trains the model; Task 3 runs the flight test.' },
  { title: 'Key Personnel and Facilities', body: 'Dr. Rao (PI) led two prior Phase II efforts. Our lab holds a CMMC L2 self-assessment and an anechoic chamber for controlled RF testing.' },
];

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  // multi-membership? pick Acme.
  if (page.url().includes('/select-company')) {
    await page.locator('form:has-text("Acme") button[type="submit"]').first().click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000);
  }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let cocoonId = '';
let templateId = '';
let documentId = '';
try {
  const [{ id: tenantId }] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug=${SLUG}`;
  // ── Seed a past-proposal cocoon + ordered primitive atoms (simulating upload→atomize) ──
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO document_cocoons (tenant_id, name, scope, program_type, source)
    VALUES (${tenantId}::uuid, 'FY24 Counter-UAS Phase II (WIN) — templify test', 'document', 'sbir', 'upload')
    RETURNING id`;
  cocoonId = c.id;
  for (let i = 0; i < SECTIONS.length; i++) {
    await sql`
      INSERT INTO library_atoms (tenant_id, grain, title, content, status, source, cocoon_id, source_anchor)
      VALUES (${tenantId}::uuid, 'primitive', ${SECTIONS[i].title}, ${SECTIONS[i].body}, 'approved', 'upload',
              ${cocoonId}::uuid, ${sql.json([{ blockIds: [`b${i}`] }])})`;
  }

  await login(page, ADMIN);

  // 1. Library lists it as a past proposal, not yet templified.
  let res = await page.request.get(`${BASE}/api/portal/${SLUG}/library/past-proposals`);
  let list = (await res.json())?.data?.pastProposals ?? [];
  let mine = list.find((p: { id: string }) => p.id === cocoonId);
  ok(!!mine, 'past proposal appears in the library list');
  ok(mine?.sectionCount === SECTIONS.length, `section count = ${SECTIONS.length} (got ${mine?.sectionCount})`);
  ok(!mine?.templateId, 'not templified yet (no linked template)');

  // 2. Templify → a tenant template skeleton.
  res = await page.request.post(`${BASE}/api/portal/${SLUG}/templates/extract`, {
    data: { cocoonId, name: 'Counter-UAS Phase II — reusable', templateType: 'technical_volume' },
  });
  ok(res.status() === 201, `templify → 201 (got ${res.status()})`);
  templateId = (await res.json())?.data?.templateId ?? '';
  ok(!!templateId, 'templify returned a templateId');

  const [tpl] = await sql<{ nodeCount: number; cocoon: string | null; isMine: boolean; sectionCount: number; titles: string[] }[]>`
    SELECT node_count AS "nodeCount", metadata->>'templifiedFromCocoon' AS cocoon, (tenant_id = ${tenantId}::uuid) AS "isMine",
           COALESCE(jsonb_array_length(canvas_document->'sections'), 0) AS "sectionCount",
           COALESCE((SELECT array_agg(s->>'title' ORDER BY ord) FROM jsonb_array_elements(canvas_document->'sections') WITH ORDINALITY AS t(s, ord)), '{}') AS titles
    FROM document_templates WHERE id = ${templateId}::uuid`;
  ok(tpl?.cocoon === cocoonId, 'template is provenance-linked to the past proposal (templifiedFromCocoon)');
  ok(tpl?.isMine === true, 'template is owned by the tenant');
  ok((tpl?.nodeCount ?? 0) > 0, `template has a section skeleton (node_count=${tpl?.nodeCount})`);
  // The whole point of templify: the past proposal's SECTION STRUCTURE is preserved.
  ok(tpl?.sectionCount === SECTIONS.length, `all ${SECTIONS.length} sections preserved (got ${tpl?.sectionCount})`);
  ok(JSON.stringify(tpl?.titles) === JSON.stringify(SECTIONS.map((s) => s.title)),
    `section titles preserved in order (got ${JSON.stringify(tpl?.titles)})`);

  // 3. Audit: library:template.extracted, source=past_proposal.
  const [tev] = await sql<{ payload: { source?: string; cocoonId?: string } }[]>`
    SELECT payload FROM system_events
    WHERE type='template.extracted' AND tenant_id=${tenantId}::uuid AND payload->>'cocoonId'=${cocoonId}
    ORDER BY created_at DESC LIMIT 1`;
  ok(tev?.payload?.source === 'past_proposal', 'templify emitted library:template.extracted (source=past_proposal)');

  // 4. Library now shows it templified + cross-linked.
  res = await page.request.get(`${BASE}/api/portal/${SLUG}/library/past-proposals`);
  list = (await res.json())?.data?.pastProposals ?? [];
  mine = list.find((p: { id: string }) => p.id === cocoonId);
  ok(mine?.templateId === templateId, 'library now cross-links the past proposal to its template');

  // 5. Regen → a fresh draft from the template.
  res = await page.request.post(`${BASE}/api/portal/${SLUG}/documents`, { data: { templateId } });
  ok(res.status() === 201, `regen (new draft from template) → 201 (got ${res.status()})`);
  documentId = (await res.json())?.data?.documentId ?? '';
  ok(!!documentId, 'regen returned a documentId');

  const [doc] = await sql<{ src: string | null }[]>`
    SELECT source_template_id AS src FROM tenant_documents WHERE id = ${documentId}::uuid`;
  ok(doc?.src === templateId, 'the new draft is sourced from the templified template (source_template_id)');

  const [dev] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM system_events
    WHERE type='document.created' AND tenant_id=${tenantId}::uuid AND payload->>'documentId'=${documentId}`;
  ok((dev?.n ?? 0) >= 1, 'regen emitted library:document.created (audited)');

  console.log('\nPast-proposal templify + regen drive-test complete.');
} catch (e) {
  console.error('DRIVE-TEST ERROR', e);
  exitCode = 1;
} finally {
  try {
    if (documentId) await sql`DELETE FROM tenant_documents WHERE id=${documentId}::uuid`;
    if (templateId) await sql`DELETE FROM document_templates WHERE id=${templateId}::uuid`;
    if (cocoonId) {
      await sql`DELETE FROM library_atoms WHERE cocoon_id=${cocoonId}::uuid`;
      await sql`DELETE FROM document_cocoons WHERE id=${cocoonId}::uuid`;
    }
  } catch (e) { console.error('cleanup error', e); }
  await browser.close();
  await sql.end();
  process.exitCode = exitCode;
}
