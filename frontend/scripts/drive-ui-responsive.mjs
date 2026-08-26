#!/usr/bin/env node
/**
 * drive-ui-responsive.mjs — the states that only exist at another viewport.
 *
 * WHY A SEPARATE PASS. `drive-ui-states.mjs` runs at 1440×900, and at that width a whole class of
 * UI does not exist. The nav rail is a `Drawer` with `inlineAt="lg"`: above the breakpoint it is a
 * static column, below it, it is a slide-out modal reached through a hamburger that is `lg:hidden`.
 * The desktop pass cannot press a button that is not rendered, so the mobile navigation — its
 * closed state, its open overlay, its backdrop — had never been photographed at all.
 *
 * That is not a hypothetical gap. B133 (the nav announced as a dialog on every page) lives exactly
 * on this seam: the role was wrong ABOVE the breakpoint precisely because the component is a real
 * dialog BELOW it, and only rendering both makes the distinction visible.
 *
 * Three widths, chosen for what changes at each rather than for roundness:
 *   390   phone. Rail is a drawer, top bar visible, tables must scroll inside themselves.
 *   820   tablet / a Chrome split-screen half — still below `lg`, so still a drawer.
 *   1440  the desktop control, so a reviewer can see the same page both ways side by side.
 *
 * It also asserts the one layout invariant this codebase states outright: **the page body must
 * never scroll sideways** (`overflow-x-clip` is described in nav-shell.tsx as the systemic guard).
 * A horizontal overflow is reported as a finding with the measured overshoot, not just photographed.
 *
 *   cd frontend && node scripts/drive-ui-responsive.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const REPO = '/home/user/govwin';
const OUT = path.join(REPO, 'docs/ui-states');
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { w: 390, h: 844, name: 'phone' },
  { w: 820, h: 1000, name: 'tablet' },
  { w: 1440, h: 900, name: 'desktop' },
];

/** A page per surface class, not every page — the chrome is what changes, and it is shared. */
const LANES = [
  {
    id: 'admin', email: 'eric@rfppipeline.com', pw: ADMIN_PW,
    routes: ['/admin/dashboard', '/admin/tenants', '/admin/rfp-curation', '/admin/events'],
  },
  {
    id: 'tenant', email: 'kate.ulepic@foundation3dp.com', pw: TENANT_PW,
    routes: ['/portal/foundation/dashboard', '/portal/foundation/cards', '/portal/foundation/atoms', '/portal/foundation/proposals'],
  },
  { id: 'anon', email: null, routes: ['/', '/pricing', '/login', '/federal-rd-101'] },
];

const shots = [];
const findings = [];
const slug = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 46) || 'x';

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2200);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

/** Does the BODY scroll sideways? Inner `overflow-x:auto` scrollers are legitimate and excluded. */
async function horizontalOverflow(page, viewportWidth) {
  return page.evaluate((vw) => {
    const d = document.documentElement;
    const over = Math.max(d.scrollWidth - vw, document.body.scrollWidth - vw);
    if (over <= 1) return null;
    // Name the widest offender so the report points somewhere actionable.
    let worst = null;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 40) {
        const cs = getComputedStyle(el);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
        if (!worst || r.right > worst.right) {
          worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60) };
        }
      }
    }
    return { over: Math.round(over), worst };
  }, viewportWidth);
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
console.log(`· serving ${BASE} · ${WIDTHS.map((w) => w.name).join(' / ')}`);
try {
  for (const lane of LANES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let page;
    try { page = lane.email ? await login(ctx, lane.email, lane.pw) : await ctx.newPage(); }
    catch (e) { console.log(`  ✗ ${lane.id} unavailable — ${String(e.message).slice(0, 60)}`); await ctx.close(); continue; }
    console.log(`\n── ${lane.id} ──`);

    for (const route of lane.routes) {
      for (const vp of WIDTHS) {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(1500);

        const file = `${lane.id}__${slug(route)}__vp-${vp.name}.jpg`;
        await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 80 }).catch(() => {});
        shots.push({ lane: lane.id, route, viewport: vp.name, width: vp.w, file, kind: 'viewport' });

        const of = await horizontalOverflow(page, vp.w);
        if (of) {
          findings.push({ lane: lane.id, route, viewport: vp.name, what: `body scrolls sideways by ${of.over}px${of.worst ? ` — widest: <${of.worst.tag} class="${of.worst.cls}"> ends at ${of.worst.right}` : ''}` });
        }

        // THE STATE THE DESKTOP PASS CANNOT REACH: the nav as a real overlay.
        if (vp.w < 1024) {
          const burger = await page.$('button[aria-label="Open navigation"]');
          if (burger) {
            await burger.click().catch(() => {});
            await page.waitForTimeout(600);
            const f2 = `${lane.id}__${slug(route)}__vp-${vp.name}-nav-open.jpg`;
            await page.screenshot({ path: path.join(OUT, f2), type: 'jpeg', quality: 80 }).catch(() => {});
            shots.push({ lane: lane.id, route, viewport: vp.name, width: vp.w, file: f2, kind: 'nav-drawer-open' });

            // While open below the breakpoint it IS a modal — the other half of B133.
            const roles = await page.evaluate(() => {
              const a = document.querySelector('aside[aria-label="Navigation"]');
              return a ? { role: a.getAttribute('role'), modal: a.getAttribute('aria-modal') } : null;
            });
            if (roles && (roles.role !== 'dialog' || roles.modal !== 'true')) {
              findings.push({ lane: lane.id, route, viewport: vp.name, what: `open mobile nav is role=${roles.role} aria-modal=${roles.modal} — expected dialog/true` });
            }
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(300);
          } else if (lane.id !== 'anon') {
            findings.push({ lane: lane.id, route, viewport: vp.name, what: 'no hamburger below the lg breakpoint — the nav is unreachable at this width' });
          }
        } else {
          // Above the breakpoint the rail must be a landmark, not a dialog (B133).
          const roles = await page.evaluate(() => {
            const a = document.querySelector('aside[aria-label="Navigation"]');
            return a ? { role: a.getAttribute('role'), modal: a.getAttribute('aria-modal') } : null;
          });
          if (roles && roles.role === 'dialog') {
            findings.push({ lane: lane.id, route, viewport: vp.name, what: 'inline nav rail is role=dialog above the breakpoint (B133 regression)' });
          }
        }
      }
      console.log(`  ${route}`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }

console.log(`\n${shots.length} viewport screenshot(s)`);
if (findings.length) {
  console.log(`\n✗ ${findings.length} finding(s):`);
  for (const f of findings) console.log(`  · [${f.lane} ${f.viewport}] ${f.route}: ${f.what}`);
} else {
  console.log('\n✓ no sideways scroll, and the nav carries the right semantics at every width.');
}
fs.writeFileSync(path.join(OUT, 'responsive.json'), JSON.stringify({ shots, findings }, null, 1));
process.exit(findings.length ? 1 : 0);
