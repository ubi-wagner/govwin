/**
 * Demo — moving atoms & groups around in the portal UI:
 *   (1) Library: select primitive atoms → "Group into new atom" (compose a group / "Team").
 *   (2) Proposal section (Related Work, unlocked): "+ From Library" → pick atoms →
 *       "Insert into the canvas" → the atoms become section nodes → drag to reorder.
 * Captures a screenshot at each step → docs/proposals/immobileyes-cuas/img/faithful/.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(process.cwd(), '..', 'docs', 'proposals', 'immobileyes-cuas', 'img', 'faithful');
fs.mkdirSync(OUT, { recursive: true });
const [PID, SID] = fs.readFileSync('/tmp/navair_ids.txt', 'utf8').trim().split(/\s+/);
const shot = async (p, name) => { await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); console.log('  📸', name); };

const b = await chromium.launch({ executablePath: EXE });
const p = await (await b.newContext({ viewport: { width: 1560, height: 1080 }, deviceScaleFactor: 2 })).newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'admin@immobileyes.test');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1200);
  console.log('login →', p.url());

  // ── (1) LIBRARY: group atoms ─────────────────────────────────────────────
  await p.goto(`${BASE}/portal/immobileyes/atoms`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  const boxes = p.locator('input[type="checkbox"]:not([disabled])');
  const n = await boxes.count();
  console.log('selectable atom checkboxes:', n);
  // pick 3 primitive atoms to compose into a group
  for (const i of [0, 1, 2]) { if (i < n) { await boxes.nth(i).check().catch(() => {}); await p.waitForTimeout(200); } }
  await p.waitForTimeout(500);
  await shot(p, '30-library-atoms-selected');
  // name + create the group
  const gname = p.getByPlaceholder(/Group name/i);
  if (await gname.count()) { await gname.first().fill('GHOST past-performance & partners'); await p.waitForTimeout(300); }
  const gbtn = p.getByRole('button', { name: /Group into new atom/i });
  if (await gbtn.count()) { await gbtn.first().click().catch(() => {}); await p.waitForTimeout(1800); console.log('  grouped'); }
  await shot(p, '31-library-group-created');

  // ── (2) SECTION: insert atoms into the proposal canvas ───────────────────
  await p.goto(`${BASE}/portal/immobileyes/proposals/${PID}/sections/${SID}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  const fromLib = p.getByRole('button', { name: /From Library/i });
  console.log('"+ From Library" present:', await fromLib.count());
  if (await fromLib.count()) {
    await fromLib.first().click(); await p.waitForTimeout(1200);
    await shot(p, '32-section-insert-panel');
    // select a couple atoms inside the insert panel, then insert
    const panelBoxes = p.locator('input[type="checkbox"]');
    const pn = await panelBoxes.count();
    for (const i of [0, 1]) { if (i < pn) { await panelBoxes.nth(i).check().catch(() => {}); await p.waitForTimeout(200); } }
    await p.waitForTimeout(400);
    const insertBtn = p.getByRole('button', { name: /Insert .*into the canvas/i });
    if (await insertBtn.count()) { await insertBtn.first().click().catch(() => {}); await p.waitForTimeout(1800); console.log('  inserted atoms into section'); }
    await shot(p, '33-section-atoms-inserted');
  } else {
    await shot(p, '32-section-editor');
  }

  // ── drag a node to reorder (best-effort HTML5 DnD) ───────────────────────
  const nodes = p.locator('[draggable="true"]');
  const nn = await nodes.count();
  console.log('draggable nodes:', nn);
  if (nn >= 3) {
    try {
      await nodes.nth(nn - 1).dragTo(nodes.nth(0)); await p.waitForTimeout(1500);
      console.log('  dragged last node → top');
    } catch (e) { console.log('  drag skipped:', e.message.slice(0, 60)); }
    await shot(p, '34-section-node-reordered');
  }
} catch (e) { console.error('ERR', e); process.exitCode = 1; } finally { await b.close(); }
