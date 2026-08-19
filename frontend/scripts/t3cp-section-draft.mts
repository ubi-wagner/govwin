/** T3CP-D — per-section "Draft with AI" for the Immobileyes T3CP build, as the buying
 *  tenant_admin, exactly the way components/proposal/section-assist-bar.tsx does it:
 *
 *    GET  /api/portal/<slug>/atoms/select?…            (rank the tenant's library atoms)
 *    POST /api/tools/proposal.draft_section            (the drafter — live/emulated Claude)
 *    PUT  /api/portal/<slug>/proposals/<p>/sections/<s>/save   (archive a version + land)
 *
 *  Why this and not only the full-draft workforce: the pipeline's draft_v0 action
 *  (pipeline/src/workflows/actions/draft_v0.py:209) excludes any section whose
 *  content_source='template' AND whose canvas passes _has_prose(). The registry-fallback
 *  molds provisioning stamps carry long bracketed placeholder paragraphs, which clear the
 *  25-word prose threshold — so the full-draft cohort saw only 2 of 14 sections. This is
 *  the product's own per-section remedy (the section bar's "Draft with AI"), which has no
 *  such filter.
 *
 *  cd frontend && node --import tsx scripts/t3cp-section-draft.mts [proposalId] */
import { chromium, type Browser, type APIRequestContext } from 'playwright';
import { createEmptyCanvas, CANVAS_PRESETS, type CanvasNode } from '@/lib/types/canvas-document';

const BASE = 'http://localhost:3000';
const SLUG = 'immobileyes';
const PROP = process.argv[2] ?? '082c1f9a-bb83-45b3-8eb9-7754ce210ec9';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => {
  console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`);
  if (!c) failures++;
};

async function login(b: Browser, email: string, password: string): Promise<APIRequestContext> {
  const page = await (await b.newContext()).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log(`✓ logged in as ${email}`);
  return page.request;
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const buyer = await login(b, 'admin@immobileyes.test', 'DemoPass123!');

// The section list the workspace reads.
const sr = await buyer.get(`${BASE}/api/portal/${SLUG}/proposals/${PROP}/sections`);
const sBody = await sr.json().catch(() => ({}));
const sections: Array<{
  id: string; title: string; status: string; pageAllocation: number | null;
  contentSource: string | null; sortIndex: number | null;
}> = sBody?.data?.sections ?? sBody?.data ?? [];
ok('sections route returned the build', sr.status() === 200 && sections.length > 0,
  `HTTP ${sr.status()} n=${sections.length}`);
if (!sections.length) { console.log(JSON.stringify(sBody).slice(0, 600)); await b.close(); process.exit(1); }

// Only the molded sections — the ones the full-draft cohort skipped. Never touch a section a
// human has edited, and never re-draft the computed cost workbook (it is priced data, not prose).
const targets = sections.filter((s) =>
  s.contentSource === 'template' && !/cost volume/i.test(s.title));
console.log(`  ${targets.length} molded section(s) to draft (of ${sections.length})`);

let drafted = 0;
for (const s of targets) {
  try {
    // 1 · rank this tenant's library atoms for the section (semantic query = the title)
    let libraryAtoms: Array<{ id: string; content: string; category: string }> = [];
    try {
      const qs = new URLSearchParams({ limit: '5', sectionId: s.id, text: s.title });
      const r = await buyer.get(`${BASE}/api/portal/${SLUG}/atoms/select?${qs.toString()}`);
      if (r.status() === 200) {
        const ranked = ((await r.json()).data?.atoms ?? []) as Array<{ id: string; content: string | null }>;
        libraryAtoms = ranked.filter((a) => a.content?.trim())
          .map((a) => ({ id: a.id, content: a.content as string, category: 'section' }));
      }
    } catch { /* draft without library context */ }

    // 2 · the drafter
    const t = await buyer.post(`${BASE}/api/tools/proposal.draft_section`, {
      data: { input: {
        proposalId: PROP, sectionId: s.id, sectionTitle: s.title,
        ...(s.pageAllocation ? { pageLimit: s.pageAllocation } : {}),
        libraryAtoms,
      } },
      timeout: 180_000,
    });
    const tBody = await t.json().catch(() => ({}));
    const nodes: CanvasNode[] = tBody?.data?.nodes ?? [];
    if (t.status() !== 200 || nodes.length === 0) {
      ok(`draft "${s.title.slice(0, 46)}"`, false,
        `HTTP ${t.status()} ${JSON.stringify(tBody).slice(0, 220)}`);
      continue;
    }

    // 3 · land it through the section save route (archives a version, sets ai_drafted)
    const now = new Date().toISOString();
    const doc = createEmptyCanvas({
      documentId: s.id, canvas: CANVAS_PRESETS.letter_sbir_phase1,
      metadata: {
        title: s.title, volume_id: '', required_item_id: '', proposal_id: PROP,
        solicitation_id: '', created_at: now, last_modified_at: now, last_modified_by: '',
        version_number: 1, status: 'ai_drafted',
      },
    });
    doc.nodes = nodes;
    const sv = await buyer.put(
      `${BASE}/api/portal/${SLUG}/proposals/${PROP}/sections/${s.id}/save`,
      { data: { content: doc, status: 'ai_drafted', source: 'ai_draft' }, timeout: 120_000 },
    );
    if (sv.status() !== 200) {
      ok(`save "${s.title.slice(0, 46)}"`, false,
        `HTTP ${sv.status()} ${JSON.stringify(await sv.json().catch(() => ({}))).slice(0, 220)}`);
      continue;
    }
    drafted++;
    console.log(`  ✓ ${s.title.slice(0, 62)} — ${nodes.length} nodes, ${libraryAtoms.length} atoms`);
  } catch (e) {
    ok(`draft "${s.title.slice(0, 46)}"`, false, String(e).slice(0, 200));
  }
}
ok(`drafted ${drafted}/${targets.length} molded sections`, drafted === targets.length);

await b.close();
console.log(failures === 0 ? '\nT3CP-D: ALL GREEN' : `\nT3CP-D: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
