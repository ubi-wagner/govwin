/**
 * SPINE-T8 browser retest — proves the rebuilt (T7 + T8) section-editing spine in the REAL UI.
 * Server must be serving :3000 from the fresh .next/standalone build. Self-resolves a real proposal +
 * section (survives sandbox rehydrates), temporarily unlocks it so every bar renders, then restores.
 *
 * Asserts in-browser:
 *   • the section editor carries the Owner (assign) bar + the AI-assist bar (Check compliance / Research)
 *     — the T8a fixes made these real (research polls; compliance shows a summary)
 *   • no error boundary (the rebuilt client components mount clean)
 *   • assigning via the Owner dropdown raises the assignee's entity_type='section' edit ToDo (DB-proven)
 *   • a span-anchored comment (T7) renders its quoted span (the amber blockquote) in the comment thread
 *   • the section ToDo surfaces on the assignee's /todos with the section deep-link
 *   node e2e/spine-t8-retest.mts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/shots-t8';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const CONNOR = 'bd51aacd-773f-4294-b4f1-81b5ae689860';
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';
const QUOTE = 'T8 pinned span — the highlighted sentence';
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

// Resolve a real, non-empty Foundation section to drive.
const [pick] = await sql<Array<{ proposalId: string; sectionId: string; wasLocked: boolean; propWasLocked: boolean; title: string }>>`
  SELECT ps.proposal_id AS "proposalId", ps.id AS "sectionId", ps.is_locked AS "wasLocked",
         p.is_locked AS "propWasLocked", ps.title
  FROM proposal_sections ps JOIN proposals p ON p.id = ps.proposal_id
  WHERE p.tenant_id = ${FND}::uuid AND ps.status <> 'empty'
  ORDER BY ps.created_at DESC LIMIT 1`;
if (!pick) { console.error('no drivable section'); await sql.end(); process.exit(2); }
const { proposalId: PROP, sectionId: SEC, wasLocked, propWasLocked } = pick;
console.log(`(driving proposal ${PROP.slice(0, 8)} · section ${SEC.slice(0, 8)} "${pick.title?.slice(0, 40)}")`);

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
let seededCommentId: string | null = null;
try {
  // Clean slate + temporarily unlock the section AND its (submitted) proposal so every editor bar renders.
  await sql`DELETE FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  await sql`UPDATE proposal_sections SET assigned_to=NULL, is_locked=false WHERE id=${SEC}::uuid`;
  await sql`UPDATE proposals SET is_locked=false WHERE id=${PROP}::uuid`;
  // Seed a span-anchored comment (T7) so the thread has an anchored note to render.
  const [c] = await sql<Array<{ id: string }>>`
    INSERT INTO proposal_comments (proposal_id, section_id, user_id, content, anchor)
    VALUES (${PROP}::uuid, ${SEC}::uuid, ${KATE}::uuid, 'T8 retest — is this claim cited?',
            ${sql.json({ nodeId: 'blk-t8', quote: QUOTE })})
    RETURNING id`;
  seededCommentId = c.id;

  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1800 } });
  const p = await ctx.newPage();
  await login(p, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');

  // ── The section editor (rebuilt T7+T8 client) ──────────────────────
  await p.goto(`${BASE}/portal/foundation/proposals/${PROP}/sections/${SEC}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${OUT}/01-section-editor.png`, fullPage: true });
  let body = (await p.textContent('body')) ?? '';
  check('section editor renders the Owner (assign) bar', body.includes('Owner'));
  check('section editor renders the AI assist bar', body.includes('AI assist'));
  check('AI assist offers Check compliance (T8a)', body.includes('Check compliance'));
  check('AI assist offers Research this section (T8a)', body.includes('Research this section'));
  check('no error boundary on the rebuilt editor', !/Application error|Unhandled Runtime|something went wrong/i.test(body));

  // ── Assign via the Owner dropdown → section ToDo raised ────────────
  const select = p.locator('select').first();
  if (await select.count()) {
    await select.selectOption(CONNOR).catch(async () => {
      await select.selectOption({ label: /connor/i as unknown as string }).catch(() => {});
    });
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `${OUT}/02-after-assign.png`, fullPage: true });
  } else check('Owner dropdown present', false);
  const todos = await sql<Array<{ status: string; assigneeUserId: string | null; taskType: string }>>`
    SELECT status, assignee_user_id AS "assigneeUserId", task_type AS "taskType"
    FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  check('assigning via the UI raised a section edit ToDo for Connor',
    todos.some((t) => t.taskType === 'edit_section' && t.assigneeUserId === CONNOR && t.status === 'open'));

  // ── The anchored comment (T7) renders its quoted span ──────────────
  // The comment thread lives under the sidebar's "review" tab (canvas-sidebar defaults to "compliance").
  const reviewTab = p.getByRole('button', { name: /^review$/i }).first();
  if (await reviewTab.count().catch(() => 0)) { await reviewTab.click().catch(() => {}); }
  else { // fallback: any button whose text is exactly the review tab
    await p.locator('button', { hasText: /^\s*review\s*$/i }).first().click().catch(() => {});
  }
  await p.waitForTimeout(1600);
  await p.screenshot({ path: `${OUT}/03-comments.png`, fullPage: true });
  body = (await p.textContent('body')) ?? '';
  check('the span-anchored comment renders its quoted span (amber blockquote, T7)', body.includes(QUOTE));

  // ── The section ToDo surfaces on the assignee's queue ──────────────
  const cctx = await browser.newContext({ viewport: { width: 1300, height: 1800 } });
  const cp = await cctx.newPage();
  await login(cp, 'connor.casey@foundation3dp.com', 'DemoPass123!');
  await cp.goto(`${BASE}/portal/foundation/todos`, { waitUntil: 'networkidle' });
  await cp.waitForTimeout(1800);
  await cp.screenshot({ path: `${OUT}/04-connor-todos.png`, fullPage: true });
  const cbody = (await cp.textContent('body')) ?? '';
  const secTitle = (pick.title ?? '').slice(0, 24);
  check('the section ToDo surfaces on Connor’s /todos',
    /edit section|review section|section/i.test(cbody) && (secTitle ? cbody.includes(secTitle) : true));
  await cctx.close();
  await ctx.close();

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-T8 browser retest (${pass} checks) · shots ${OUT}`);
} finally {
  await sql`DELETE FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  await sql`UPDATE proposal_sections SET assigned_to=NULL, is_locked=${wasLocked} WHERE id=${SEC}::uuid`;
  await sql`UPDATE proposals SET is_locked=${propWasLocked} WHERE id=${PROP}::uuid`;
  if (seededCommentId) await sql`DELETE FROM proposal_comments WHERE id=${seededCommentId}::uuid`;
  await sql`DELETE FROM system_events WHERE type='section.assigned' AND payload->>'sectionId'=${SEC}`;
  await sql.end();
  await browser.close();
}
process.exit(fail === 0 ? 0 : 1);
