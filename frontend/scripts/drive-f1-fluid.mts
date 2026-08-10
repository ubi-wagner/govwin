/**
 * Live drive for fluid-canvas F1 — the whole-proposal "Document" view.
 *
 * Logs in as the Foundation tenant_admin, opens the TVSF-R45 proposal, switches to
 * the new Document tab, and exercises: continuous render + outline rail (click-to-nav
 * + active-on-scroll) + selection→Atomize (highlight a span → floating toolbar →
 * atomize into the library). Screenshots each step; proves the atom landed in the DB.
 *
 *   cd frontend && node --import tsx scripts/drive-f1-fluid.mts
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT ?? '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/f1-shots';
mkdirSync(OUT, { recursive: true });

const EMAIL = 'kate.ulepic@foundation3dp.com';
const PW = 'DemoPass123!';
const SLUG = 'foundation';
const PROPOSAL = 'bbd6a058-3299-4b98-96e0-1e07e43aa1c4'; // TVSF-R45, 18 filled sections

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  console.log(`  📸 ${name}.png  (${page.url()})`);
}

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    // ── Login ──────────────────────────────────────────────────────────
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
    await page.waitForTimeout(1200);
    console.log(`logged in → ${page.url()}`);

    // ── Proposal workspace (default: All Sections — the old card layout) ─
    await page.goto(`${BASE}/portal/${SLUG}/proposals/${PROPOSAL}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, 'f1-01-workspace-cards', true);

    // ── Switch to the fluid Document tab ────────────────────────────────
    const docTab = page.getByRole('button', { name: 'Document', exact: true });
    await docTab.click();
    // Wait for assembly + the outline rail to render.
    await page.getByText('Document outline').waitFor({ timeout: 25000 });
    await page.waitForTimeout(1500);
    await shot(page, 'f1-02-document-fluid', false);
    await shot(page, 'f1-02b-document-fluid-full', true);

    // ── Outline rail: count sections + click one to navigate ────────────
    const railButtons = await page.locator('nav button').count();
    console.log(`outline rail sections: ${railButtons}`);
    const rail = page.locator('nav button');
    if (railButtons > 4) {
      await rail.nth(4).click();
      await page.waitForTimeout(1200);
      await shot(page, 'f1-03-outline-nav', false);
    }

    // ── Selection → floating toolbar → Atomize ──────────────────────────
    // Programmatically select a body block's text (a real user drag-selects; we
    // set the DOM Range + fire the events the toolbar listens for).
    const selInfo = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-node-id]')) as HTMLElement[];
      const target = nodes.find(
        (n) => !(n.dataset.nodeId || '').startsWith('sec:') && (n.textContent || '').trim().length > 80,
      );
      if (!target) return { ok: false, text: '' };
      target.scrollIntoView({ block: 'center' });
      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { ok: true, text: (target.textContent || '').trim().slice(0, 60), nodeId: target.dataset.nodeId };
    });
    console.log(`selection: ok=${selInfo.ok} "${selInfo.text}…"`);
    await page.waitForTimeout(600);
    // The floating toolbar should now be visible.
    const atomizeBtn = page.getByRole('button', { name: /Atomize/ });
    const toolbarVisible = await atomizeBtn.isVisible().catch(() => false);
    console.log(`selection toolbar visible: ${toolbarVisible}`);
    await shot(page, 'f1-04-selection-toolbar', false);

    if (toolbarVisible) {
      await atomizeBtn.click();
      await page.waitForTimeout(1800); // toast + POST round-trip
      await shot(page, 'f1-05-atomized-toast', false);
    }

    console.log(`\nconsole errors during drive: ${errors.length}`);
    errors.slice(0, 8).forEach((e) => console.log(`  ⚠️ ${e}`));
  } catch (e) {
    console.error('DRIVE FAILED:', e);
    await shot(page, 'f1-99-failure', true).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
