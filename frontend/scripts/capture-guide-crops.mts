/**
 * Element-accurate crops for the guide steps that describe a specific control.
 *
 * ── WHY BY SELECTOR AND NOT BY FRACTION ──────────────────────────────────────────────────────
 * `docs/manuals/guides/_src/crop_bands.py` slices bands out of a full-page shot using fractional
 * boxes — fine for "the top third of the sources page", useless for "the Demand cell", which moves
 * whenever a column is added. Guessing a fraction produces a crop that is *nearly* the control, and
 * a guide illustrated with nearly-the-control is worse than one with no picture: the reader trusts
 * it and looks for something that is not there.
 *
 * These two are photographed by locator, against the live product, as the actor who sees them.
 *
 *   BASE_URL=http://localhost:3109 node --import tsx frontend/scripts/capture-guide-crops.mts
 */
import postgres from 'postgres';
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? process.env.GUIDE_BASE ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });
const ROOT = '/home/user/govwin';
const AC = `${ROOT}/docs/manuals/img/crops/admin`;
const TC = `${ROOT}/docs/manuals/img/crops/tenant`;

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return !page.url().includes('/login');
}

async function main() {
  mkdirSync(AC, { recursive: true });
  mkdirSync(TC, { recursive: true });
  console.log('\ncapture-guide-crops — the controls the new steps point at\n');

  const TENANT_PW = process.env.TENANT_PW ?? '';
  const ADMIN_PW = process.env.ADMIN_PW ?? process.env.MASTER_PW ?? process.env.SANDBOX_PASSWORD ?? '';
  const [tAdmin] = await owner<Array<{ email: string }>>`
    SELECT u.email FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
    WHERE t.slug = 'foundation' AND m.role = 'tenant_admin' AND u.role = 'tenant_admin' AND u.is_active
      AND COALESCE(u.temp_password, false) = false ORDER BY u.created_at LIMIT 1`;
  const [pAdmin] = await owner<Array<{ email: string }>>`
    SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
      AND COALESCE(temp_password, false) = false
    ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;

  const browser = await chromium.launch({ executablePath: EXE });
  let made = 0;
  try {
    // ── admin · the Demand cell, on a row that actually has demand ────────────────────────────
    if (pAdmin && ADMIN_PW) {
      const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      if (await signIn(p, pAdmin.email, ADMIN_PW)) {
        await p.goto(`${BASE}/admin/cards`, { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(3000);
        // The row carrying a thumbs count — chosen by CONTENT, because the row order changes with
        // every sort and a positional crop would eventually photograph a different opportunity.
        const row = p.locator('tr').filter({ hasText: '👍' }).first();
        if (await row.count() > 0) {
          await row.screenshot({ path: `${AC}/cards-row.png` });
          console.log(`  ✓ admin/cards-row.png — ${(await row.innerText()).replace(/\s+/g, ' ').slice(0, 76)}`);
          made += 1;
        } else {
          console.log('  ⚠ admin/cards-row.png NOT captured — no row shows a rating; stage fixtures first');
        }
      } else console.log('  ⚠ admin sign-in failed');
      await p.close();
    }

    // ── admin · the curation summary panel, where the release decisions are made ──────────────
    if (pAdmin && ADMIN_PW) {
      const p = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      if (await signIn(p, pAdmin.email, ADMIN_PW)) {
        // The solicitation with the most topics — the one whose release decisions matter most, and
        // the one the guide's worked example follows.
        const [sol] = await owner<Array<{ id: string }>>`
          SELECT cs.id FROM curated_solicitations cs
          ORDER BY (SELECT count(*) FROM opportunities o WHERE o.solicitation_id = cs.id) DESC,
                   cs.created_at DESC LIMIT 1`;
        if (sol) {
          await p.goto(`${BASE}/admin/rfp-curation/${sol.id}`, { waitUntil: 'domcontentloaded' });
          await p.waitForTimeout(3500);
          const panel = p.locator('text=/Spotlight-match summary/').first()
            .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
          if (await panel.count() > 0) {
            await panel.screenshot({ path: `${AC}/curation-summary.png` });
            console.log(`  ✓ admin/curation-summary.png — ${(await panel.innerText()).replace(/\s+/g, ' ').slice(0, 76)}`);
            made += 1;
          } else console.log('  ⚠ admin/curation-summary.png NOT captured — panel not found');
        }
      }
      await p.close();
    }

    // ── tenant · the bucket composition + reach block ─────────────────────────────────────────
    if (tAdmin && TENANT_PW) {
      const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      if (await signIn(p, tAdmin.email, TENANT_PW)) {
        await p.goto(`${BASE}/portal/foundation/buckets`, { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(2000);
        const open = p.getByRole('button', { name: /New bucket|Create/ }).first();
        if (await open.count() > 0) await open.click().catch(() => {});
        await p.waitForTimeout(500);
        // Type criteria the feed can and cannot satisfy, so the crop shows BOTH halves of the
        // reach line — a shot of an all-green reach teaches nothing about what it is for.
        for (const [ph, v] of [[/keyword/i, 'additive'], [/naics/i, '541715, 236220'], [/agenc/i, 'Navy']] as const) {
          const f = p.getByPlaceholder(ph).first();
          if (await f.count() > 0) await f.fill(v);
        }
        await p.waitForTimeout(800);
        const block = p.locator('text=/Scores on \\d+ signal/').first().locator('xpath=ancestor::div[1]');
        if (await block.count() > 0) {
          await block.screenshot({ path: `${TC}/bucket-form.png` });
          console.log(`  ✓ tenant/bucket-form.png — ${(await block.innerText()).replace(/\s+/g, ' ').slice(0, 76)}`);
          made += 1;
        } else {
          console.log('  ⚠ tenant/bucket-form.png NOT captured — composition block not found');
        }
      } else console.log('  ⚠ tenant sign-in failed');
      await p.close();
    }
  } finally {
    await browser.close().catch(() => {});
    await owner.end();
  }
  console.log(`\n  ${made}/3 crop(s) captured\n`);
  process.exit(made === 3 ? 0 : 1);
}
main().catch((e) => { console.error('\nCROP ERROR:', e); process.exit(2); });
