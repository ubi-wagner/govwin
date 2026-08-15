/**
 * SPINE-T6 browser touch-test — the section-editing nervous system as a real actor. App must be serving
 * on :3000 (node .next/standalone/server.js) with DATABASE_URL_OWNER set.
 *   node e2e/spine-section-shots.mts
 * Proves in the real UI: the section editor carries the SectionAssignBar (owner + assign picker) and the
 * SectionAssistBar (Draft / Check compliance / Research), and assigning a section via the UI raises the
 * assignee's entity_type='section' edit ToDo (verified in the DB). Cleans up the ToDo after.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/shots-spine';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const PROP = '108ed23d-2fac-4f6d-b8f1-a78109dcd102';
const SEC = 'b8328309-0101-4942-8f20-462a9e204c4e';
const CONNOR = 'bd51aacd-773f-4294-b4f1-81b5ae689860';
mkdirSync(OUT, { recursive: true });
const sqlOwner = postgres('postgresql://claude@127.0.0.1:5433/govtech_intel', { onnotice: () => {} });

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]).catch(() => {});
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
try {
  await sqlOwner`DELETE FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  await sqlOwner`UPDATE proposal_sections SET assigned_to=NULL WHERE id=${SEC}::uuid`;

  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1700 } });
  const p = await ctx.newPage();
  await login(p, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  await p.goto(`${BASE}/portal/foundation/proposals/${PROP}/sections/${SEC}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  await p.screenshot({ path: `${OUT}/01-section-editor.png`, fullPage: true });
  const body = (await p.textContent('body')) ?? '';
  check('section editor renders the Owner (assign) bar', body.includes('Owner'));
  check('section editor renders the AI assist bar', body.includes('AI assist'));
  check('AI assist offers Check compliance', body.includes('Check compliance'));
  check('AI assist offers Research this section', body.includes('Research this section'));
  check('empty section offers Draft with AI', body.includes('Draft with AI'));
  check('no error boundary', !/Application error|Unhandled Runtime|something went wrong/i.test(body));

  // Assign the section to Connor via the Owner dropdown → the section ToDo should be raised.
  const select = p.locator('select').first();
  if (await select.count()) {
    // Pick Connor by his visible label (name or email).
    await select.selectOption({ label: /connor/i as unknown as string }).catch(async () => {
      // fallback: select by value = Connor's id
      await select.selectOption(CONNOR).catch(() => {});
    });
    await p.waitForTimeout(2000);
    await p.screenshot({ path: `${OUT}/02-after-assign.png`, fullPage: true });
  } else {
    check('Owner dropdown present', false);
  }
  const todos = await sqlOwner<Array<{ status: string; assigneeUserId: string | null; taskType: string }>>`
    SELECT status, assignee_user_id AS "assigneeUserId", task_type AS "taskType"
    FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  check('assigning via the UI raised a section edit ToDo for Connor',
    todos.some((t) => t.taskType === 'edit_section' && t.assigneeUserId === CONNOR && t.status === 'open'));
  await ctx.close();

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-T6 section-editor browser (${pass} checks) · shots ${OUT}`);
} finally {
  await sqlOwner`DELETE FROM tasks WHERE tenant_id=${FND}::uuid AND entity_type='section' AND entity_id=${SEC}::uuid`;
  await sqlOwner`UPDATE proposal_sections SET assigned_to=NULL WHERE id=${SEC}::uuid`;
  await sqlOwner`DELETE FROM system_events WHERE type='section.assigned' AND payload->>'sectionId'=${SEC}`;
  await sqlOwner.end();
  await browser.close();
}
process.exit(fail === 0 ? 0 : 1);
