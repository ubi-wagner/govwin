/**
 * Mobile admin-ops drive (390×844): exercise the operational interactions — review progress,
 * issue ToDos, approve & advance, review→release — as tenant_admin and rfp_admin, opening the
 * modals/forms (never submitting) and capturing what fits on a phone screen (VIEWPORT shots).
 */
import { chromium } from 'playwright';
import fs from 'fs';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/ux/ops';
fs.mkdirSync(OUT, { recursive: true });
const S = 'foundation';
const PROP = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const log = [];

async function login(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await page.fill('#email', email); await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function shot(page, name, full = false) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }).catch(() => {});
  log.push(name);
  console.log('✓', name, '→', page.url().replace(BASE, ''));
}
async function clickText(page, re) {
  try { const el = page.getByText(re).first(); await el.scrollIntoViewIfNeeded({ timeout: 3000 });
    await el.click({ timeout: 4000 }); await page.waitForTimeout(900); return true; } catch { return false; }
}
async function clickBtn(page, re) {
  try { const el = page.getByRole('button', { name: re }).first();
    await el.click({ timeout: 4000 }); await page.waitForTimeout(1100); return true; } catch { return false; }
}

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  // ── tenant_admin (Kate) ──
  const t = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  let p = await t.newPage(); await login(p, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  // review progress + approve/advance: proposal detail (studio + stage control)
  await p.goto(`${BASE}/portal/${S}/proposals/${PROP}`, { waitUntil: 'networkidle', timeout: 35000 });
  await p.waitForTimeout(800);
  await shot(p, 'ta-01-proposal-top');            // studio + stage tracker on mobile
  // issue ToDo: expand "Assign a task" disclosure → the compose form
  await clickText(p, /Assign a task/i);
  await shot(p, 'ta-02-assign-task-open');        // AssignTaskForm grid-cols-3 at 390px
  // full-page of the section list (approve/lock per-section controls)
  await shot(p, 'ta-03-proposal-full', true);
  await p.close();
  // complete ToDos: the To-dos surface
  p = await t.newPage();
  await p.goto(`${BASE}/portal/${S}/todos`, { waitUntil: 'networkidle', timeout: 35000 });
  await p.waitForTimeout(700); await shot(p, 'ta-04-todos', true);
  await p.close();
  await t.close();

  // ── rfp_admin (Eric) ──
  const a = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  p = await a.newPage(); await login(p, 'eric@rfppipeline.com', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  // review progress: admin dashboard
  await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle', timeout: 35000 });
  await p.waitForTimeout(700); await shot(p, 'ra-01-dashboard', true);
  // review→release: rfp-curation queue, then open a review modal
  await p.goto(`${BASE}/admin/rfp-curation`, { waitUntil: 'networkidle', timeout: 35000 });
  await p.waitForTimeout(800); await shot(p, 'ra-02-curation-queue', true);
  if (await clickBtn(p, /^review$/i) || await clickBtn(p, /^open$/i) || await clickText(p, /^Review$/)) {
    await shot(p, 'ra-03-curation-modal');        // curation review modal viewport on mobile
  } else { console.log('· curation modal trigger not found'); }
  await p.close();
  // approve onboarding: applications
  p = await a.newPage();
  await p.goto(`${BASE}/admin/applications`, { waitUntil: 'networkidle', timeout: 35000 });
  await p.waitForTimeout(700); await shot(p, 'ra-04-applications', true);
  await p.close();
  // issue review gate + launch forms: workflows
  p = await a.newPage();
  await p.goto(`${BASE}/admin/workflows`, { waitUntil: 'networkidle', timeout: 35000 });
  await p.waitForTimeout(700); await shot(p, 'ra-05-workflows-forms', true);
  await p.close();
  await a.close();

  await b.close();
  fs.writeFileSync(`${OUT}/ops.json`, JSON.stringify(log, null, 2));
  console.log('\n== mobile-ops captures:', log.length, '==');
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
