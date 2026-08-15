/**
 * Pristine pass — mobile audit of every Command Center destination (COMMAND_CENTER_DESIGN.md).
 * At a 390px phone width, visit each surface the CC's action buttons + row links point to, and
 * flag: a hard failure (bounce to /login, 5xx, error boundary) OR a soft mobile issue (the page
 * body scrolls horizontally). Screenshots each for eyeball review. Run:
 *   npx playwright test --project=hitl hitl-cc-mobile-audit
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const DIR = process.env.CC_SHOT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/cc-shots/mobile';
test.use({ viewport: { width: 390, height: 844 } });
test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });

async function login(page: Page, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced`).not.toHaveURL(/\/login/);
}

const P = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58'; // Foundation TVSF proposal

async function sweep(page: Page, label: string, urls: Array<[string, string]>): Promise<string[]> {
  const issues: string[] = [];
  for (const [name, url] of urls) {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => null);
    const status = resp?.status() ?? 0;
    const path = new URL(page.url()).pathname;
    const bounced = /^\/login/.test(path);
    // A crashed/blank page has almost no body text — a far more reliable "broken" signal than
    // substring-matching "error", which false-positives on admin monitoring/tooling copy.
    const body = ((await page.textContent('body').catch(() => '')) || '').trim();
    const blank = body.length < 300;
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    const overflow = sw > iw + 2;
    if (bounced || status >= 400 || blank) issues.push(`❌ ${label}/${name}: HARD (status=${status} bounced=${bounced} blank=${blank})`);
    else if (overflow) {
      const culprit = await page.evaluate((vw) => {
        let worst = ''; let worstW = 0;
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.right > vw + 2 && r.width > worstW) {
            worstW = r.width;
            worst = `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') || '').slice(0, 80)}"> w=${Math.round(r.width)} right=${Math.round(r.right)}`;
          }
        }
        return worst;
      }, iw);
      issues.push(`↔️ ${label}/${name}: h-overflow ${sw}>${iw} | ${culprit}`);
    }
    await page.screenshot({ path: `${DIR}/${label}-${name}.png`, fullPage: true }).catch(() => {});
  }
  return issues;
}

test('tenant CC destinations — mobile clean', async ({ page }) => {
  await login(page, 'kate.ulepic@foundation3dp.com', process.env.FOUNDATION_PW || 'DemoPass123!');
  const issues = await sweep(page, 'tenant', [
    ['command', '/portal/foundation/command'],
    ['cards', '/portal/foundation/cards'],
    ['portals', '/portal/foundation/portals'],
    ['proposals', '/portal/foundation/proposals'],
    ['proposal', `/portal/foundation/proposals/${P}`],
    ['todos', '/portal/foundation/todos'],
    ['team', '/portal/foundation/team'],
    ['activity', '/portal/foundation/activity'],
    ['processes', '/portal/foundation/processes'],
    ['dashboard', '/portal/foundation/dashboard'],
    ['atoms', '/portal/foundation/atoms'],
    ['buckets', '/portal/foundation/buckets'],
  ]);
  console.log('\n=== TENANT MOBILE AUDIT ===\n' + (issues.join('\n') || 'clean'));
  const hard = issues.filter((i) => i.startsWith('❌'));
  expect(hard, `\n${hard.join('\n')}`).toEqual([]);
});

test('admin CC destinations — mobile clean', async ({ page }) => {
  await login(page, 'eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
  const issues = await sweep(page, 'admin', [
    ['command', '/admin/command'],
    ['rfp-curation', '/admin/rfp-curation'],
    ['intake', '/admin/intake'],
    ['sources', '/admin/sources'],
    ['applications', '/admin/applications'],
    ['site', '/admin/site'],
    ['purchases', '/admin/purchases'],
    ['agents', '/admin/agents'],
    ['tenants', '/admin/tenants'],
    ['workflows', '/admin/workflows'],
    ['automation', '/admin/automation'],
    ['events', '/admin/events'],
    ['system', '/admin/system'],
  ]);
  console.log('\n=== ADMIN MOBILE AUDIT ===\n' + (issues.join('\n') || 'clean'));
  const hard = issues.filter((i) => i.startsWith('❌'));
  expect(hard, `\n${hard.join('\n')}`).toEqual([]);
});
