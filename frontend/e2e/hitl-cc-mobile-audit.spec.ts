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
        // A real body-overflow contributor pushes past the viewport AND has no ancestor that
        // clips/scrolls horizontally (a child inside overflow-x-auto is contained — ignore it).
        const contained = (el: Element): boolean => {
          let p = el.parentElement;
          while (p && p !== document.body) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
            p = p.parentElement;
          }
          return false;
        };
        const hits: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.right > vw + 2 && r.width > 0 && !contained(el)) {
            hits.push(`<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') || '').slice(0, 70)}"> w=${Math.round(r.width)} right=${Math.round(r.right)}`);
          }
        }
        // Narrowest true offenders first — the smallest element that still pokes out is the leaf to fix.
        hits.sort((a, b) => (parseInt(a.split('w=')[1]) || 0) - (parseInt(b.split('w=')[1]) || 0));
        return hits.slice(0, 3).join('  ||  ') || '(only contained scrollers — likely a false trip)';
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
  // Enforce ZERO: any hard failure OR horizontal overflow fails the audit.
  expect(issues, `\n${issues.join('\n')}`).toEqual([]);
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
  // Enforce ZERO: any hard failure OR horizontal overflow fails the audit.
  expect(issues, `\n${issues.join('\n')}`).toEqual([]);
});
