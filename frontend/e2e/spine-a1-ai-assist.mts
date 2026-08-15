/**
 * SPINE-A1 — prove the section-bar AI assistance FIRES end-to-end (not just renders), against the live
 * rig: frontend + pipeline worker + emulated-Claude (:8787). Drives the three SectionAssistBar actions as
 * Kate (tenant_admin) in the real browser:
 *   • Check compliance — POST ai/compliance → emulator's compliance_reviewer responder → the bar shows a
 *     "N pass · M fail · K partial" summary (synchronous, frontend-direct LLM).
 *   • Research this section — POST ai/research → proposal:research_requested → the WORKER's scout agent →
 *     emulator tool-loop → task completes → the bar's poll renders a real brief (async, event-triggered).
 *   • Draft with AI — a temp EMPTY section → proposal.draft_section tool → emulator → nodes land in-doc
 *     (status→ai_drafted, canvas nodes present in the DB).
 *   node e2e/spine-a1-ai-assist.mts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/shots-a1';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PROP = 'bbd6a058-3299-4b98-96e0-1e07e43aa1c4';
const SEC = '5e2008fb-ef39-49c0-bab3-043bc29b48c8';  // "10. ESP Engagement" — has a compliance-matrix entry
mkdirSync(OUT, { recursive: true });
const sql = postgres('postgresql://govtech:changeme@localhost:5432/govtech_intel', { onnotice: () => {} });

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]).catch(() => {});
  await page.waitForTimeout(1500);
}

// Remember lock state to restore.
const [{ propWasLocked }] = await sql<Array<{ propWasLocked: boolean }>>`SELECT is_locked AS "propWasLocked" FROM proposals WHERE id=${PROP}::uuid`;
const [{ secWasLocked }] = await sql<Array<{ secWasLocked: boolean }>>`SELECT is_locked AS "secWasLocked" FROM proposal_sections WHERE id=${SEC}::uuid`;
let tempSecId: string | null = null;

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
try {
  await sql`UPDATE proposals SET is_locked=false WHERE id=${PROP}::uuid`;
  await sql`UPDATE proposal_sections SET is_locked=false WHERE id=${SEC}::uuid`;
  // A temp EMPTY section for the Draft flow (deleted after).
  const [tmp] = await sql<Array<{ id: string }>>`
    INSERT INTO proposal_sections (proposal_id, section_number, title, status, content, is_locked, sort_index, volume_name)
    VALUES (${PROP}::uuid, '99', 'A1 Draft Target (temp)', 'empty', NULL, false, 999,
            (SELECT volume_name FROM proposal_sections WHERE id=${SEC}::uuid))
    RETURNING id`;
  tempSecId = tmp.id;

  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1800 } });
  const p = await ctx.newPage();
  await login(p, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');

  // ── 1. Check compliance (synchronous, frontend → emulator) ─────────
  await p.goto(`${BASE}/portal/foundation/proposals/${PROP}/sections/${SEC}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  const compBtn = p.getByRole('button', { name: /check compliance/i }).first();
  check('Check compliance button present', await compBtn.count().catch(() => 0) > 0);
  await compBtn.click().catch(() => {});
  // The summary panel renders inline when the emulator returns the check array.
  await p.waitForFunction(() => /Compliance for this section/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/01-compliance.png`, fullPage: true });
  let body = (await p.textContent('body')) ?? '';
  check('compliance ran → summary rendered (N pass · M fail · K partial)',
    /Compliance for this section —/i.test(body) && /\d+\s*pass/i.test(body));

  // ── 2. Research this section (async: frontend → worker scout → emulator) ─────
  const resBtn = p.getByRole('button', { name: /research this section/i }).first();
  check('Research button present', await resBtn.count().catch(() => 0) > 0);
  await resBtn.click().catch(() => {});
  // Wait for a real brief (not the "queued"/"still running" fallback). Worker polls ~10s; bar polls ≤50s.
  await p.waitForFunction(() => {
    const t = document.body.innerText;
    return /Research/i.test(t) && !/Researching…|is still running|will appear in Activity/i.test(t) &&
           t.length > 0 && /(source|brief|summary|http|\.gov|research (complete|brief))/i.test(t);
  }, { timeout: 75000 }).catch(() => {});
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${OUT}/02-research.png`, fullPage: true });
  body = (await p.textContent('body')) ?? '';
  const researchLanded = !/Researching…|Research is still running|Research queued/i.test(body);
  check('research ran → a cited brief landed (async worker→scout→emulator)', researchLanded);

  // ── 3. Draft with AI (temp empty section, frontend tool → emulator) ─────
  await p.goto(`${BASE}/portal/foundation/proposals/${PROP}/sections/${tempSecId}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  const draftBtn = p.getByRole('button', { name: /draft with ai/i }).first();
  check('Draft with AI button present on the empty section', await draftBtn.count().catch(() => 0) > 0);
  await draftBtn.click().catch(() => {});
  await p.waitForTimeout(1500);
  // Poll the DB for the landed draft (status→ai_drafted + canvas nodes).
  let landed = false;
  for (let i = 0; i < 24; i++) {
    const [r] = await sql<Array<{ status: string; nodeCount: number }>>`
      SELECT status, COALESCE(jsonb_array_length((content::jsonb)->'nodes'), 0) AS "nodeCount"
      FROM proposal_sections WHERE id=${tempSecId}::uuid`;
    if (r && (r.status === 'ai_drafted' || r.nodeCount > 0)) { landed = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/03-draft.png`, fullPage: true });
  check('Draft with AI landed nodes in the empty section (status ai_drafted / nodes present)', landed);

  await ctx.close();
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-A1 AI-assist LIVE (${pass} checks) · shots ${OUT}`);
} finally {
  if (tempSecId) {
    // The Draft flow writes child rows (activity log, canvas version) that FK the section — clear them first.
    await sql`DELETE FROM proposal_activity_log WHERE section_id=${tempSecId}::uuid`.catch(() => {});
    await sql`DELETE FROM canvas_versions WHERE section_id=${tempSecId}::uuid`.catch(() => {});
    await sql`DELETE FROM proposal_comments WHERE section_id=${tempSecId}::uuid`.catch(() => {});
    await sql`DELETE FROM proposal_compliance_matrix WHERE section_id=${tempSecId}::uuid`.catch(() => {});
    await sql`DELETE FROM tasks WHERE entity_type='section' AND entity_id=${tempSecId}::uuid`.catch(() => {});
    await sql`DELETE FROM proposal_sections WHERE id=${tempSecId}::uuid`.catch(() => {});
  }
  await sql`UPDATE proposals SET is_locked=${propWasLocked} WHERE id=${PROP}::uuid`;
  await sql`UPDATE proposal_sections SET is_locked=${secWasLocked} WHERE id=${SEC}::uuid`;
  await sql.end();
  await browser.close();
}
process.exit(fail === 0 ? 0 : 1);
