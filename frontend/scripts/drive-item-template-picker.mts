/**
 * Drive-test #77: required-item → template picker in the curation workspace.
 *
 * In the AddEditItemModal an RFP admin links a canvas TEMPLATE (mold) + expert notes to a
 * required item; provisioning seeds that item's section from the template. This proves the
 * UI persists template_id + expert_notes and surfaces the linked template as a badge.
 *
 * Isolated: seeds a throwaway volume+item on a real solicitation, drives the real modal,
 * asserts the DB + the badge, then deletes the volume (cascades). Non-destructive to demo data.
 */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const PW = 'DemoPass123!';
const ADMIN = 'eric@rfppipeline.com';
const SOL = '574fcd0b-45a7-4d4d-9811-c4aa5fc5c45c'; // C-UAS (has volumes)
const NOTES = 'PICKER-TEST: hit the C-UAS autonomy KPP and TRL-6 evidence.';
const sql = postgres(process.env.DATABASE_URL!, { max: 2 });
let exitCode = 0;
const ok = (c: boolean, l: string) => { console.log(`${c ? '✅' : '❌ FAIL'}  ${l}`); if (!c) exitCode = 1; };

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
let volId = '';
try {
  // Pick a technical-volume template to link.
  const [tpl] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM document_templates ORDER BY is_system DESC, name ASC LIMIT 1`;
  ok(!!tpl, `a template exists to link (${tpl?.name})`);

  // Seed an isolated throwaway volume + item on the solicitation (volume_number 99 avoids collisions).
  const [vol] = await sql<{ id: string }[]>`
    INSERT INTO solicitation_volumes (solicitation_id, volume_number, volume_name, volume_format)
    VALUES (${SOL}::uuid, 99, 'ZZ Picker Test Volume', 'custom') RETURNING id`;
  volId = vol.id;
  await sql`
    INSERT INTO volume_required_items (volume_id, item_number, item_name, item_type, required)
    VALUES (${volId}::uuid, 1, 'Picker Test Item', 'word_doc', true)`;

  await login(page, ADMIN);
  await page.goto(`${BASE}/admin/rfp-curation/${SOL}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  ok((await page.locator('text=Response Volumes').count()) > 0, 'curation workspace shows Response Volumes');

  // Expand our throwaway volume (click the clickable header, not the outer container).
  const header = page.locator('div.cursor-pointer:has-text("ZZ Picker Test Volume")').first();
  await header.scrollIntoViewIfNeeded();
  await header.click();
  await page.waitForTimeout(600);
  const row = page.locator('tr:has-text("Picker Test Item")').first();
  await row.locator('button:has-text("Edit")').click();
  await page.waitForTimeout(500);
  ok((await page.locator('text=Edit Required Item').count()) > 0, 'Edit modal opened');
  ok((await page.locator('text=Section grounding').count()) > 0, 'modal shows the Section grounding block');

  // Pick the template (grounding select = last select in the form) + fill expert notes, save.
  const modalForm = page.locator('form:has-text("Section grounding")');
  await modalForm.locator('select').last().selectOption({ label: tpl.name });
  await modalForm.locator('textarea').fill(NOTES);
  await modalForm.locator('button[type="submit"]').click();
  await page.waitForTimeout(1500);

  // Assert DB persisted template_id + expert_notes on our item.
  const [dbItem] = await sql<{ templateId: string | null; expertNotes: string | null }[]>`
    SELECT template_id AS "templateId", expert_notes AS "expertNotes"
    FROM volume_required_items WHERE volume_id = ${volId}::uuid AND item_number = 1`;
  ok(dbItem?.templateId === tpl.id, `template_id persisted (${dbItem?.templateId === tpl.id ? 'linked' : dbItem?.templateId})`);
  ok(dbItem?.expertNotes === NOTES, `expert_notes persisted (${dbItem?.expertNotes ? 'set' : 'MISSING'})`);

  // Assert the badge renders after refresh (reload collapses the volume → expand + scroll first).
  await page.goto(`${BASE}/admin/rfp-curation/${SOL}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const header2 = page.locator('div.cursor-pointer:has-text("ZZ Picker Test Volume")').first();
  await header2.scrollIntoViewIfNeeded();
  await header2.click();
  await page.waitForTimeout(700);
  const row2 = page.locator('tr:has-text("Picker Test Item")').first();
  await row2.scrollIntoViewIfNeeded();
  const tplNamePart = tpl.name.split('·').pop()!.trim(); // avoid middot in the text selector
  ok((await row2.getByText(tplNamePart).count()) > 0, 'linked-template badge shows on the item row');
  ok((await row2.getByText('notes').count()) > 0, 'expert-notes badge shows on the item row');

  console.log('\nTemplate-picker drive-test complete.');
} catch (e) {
  console.error('DRIVE-TEST ERROR', e);
  exitCode = 1;
} finally {
  if (volId) { try { await sql`DELETE FROM solicitation_volumes WHERE id = ${volId}::uuid`; } catch { /* ignore */ } }
  await browser.close();
  await sql.end();
  process.exitCode = exitCode;
}
