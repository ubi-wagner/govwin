/**
 * drive-admin-demand — does a customer's thumb reach the person who can act on it?
 *
 * The upward half of the signal. A verdict was recorded, emitted as capture:topic.pinned, and
 * countable the whole time — and it reached an RFP admin only if they went looking. The build-out
 * decision ("should we make volumes and molds for this one, to turn interest into a purchase?") is
 * made on /admin/cards, and that page showed a replication count, which is the same number for
 * almost every card because every card fans to every tenant.
 *
 * RED FIRST, in the only way that counts here: the admin list is read BEFORE any vote and must show
 * no demand for the card, then again after two tenants vote. A drive that only showed the second
 * state could not tell "the page reports demand" from "the page prints something".
 *
 * ⚠️ NOT read-only: votes on one card as two tenants, and restores. Sandbox only.
 *
 * Usage:  BASE_URL=http://localhost:3103 node --import tsx frontend/scripts/drive-admin-demand.mts
 */

import postgres from 'postgres';
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? process.env.GUIDE_BASE ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return !page.url().includes('/login');
}

async function main() {
  console.log('\ndrive-admin-demand — the thumb reaching the person who can act on it\n');

  const ADMIN_PW = process.env.ADMIN_PW ?? process.env.MASTER_PW ?? process.env.SANDBOX_PASSWORD ?? '';
  const [admin] = await owner<Array<{ email: string }>>`
    SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
      AND COALESCE(temp_password, false) = false
    ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;
  if (!admin || !ADMIN_PW) { console.error('\nHARNESS CANNOT RUN: no signable platform admin / ADMIN_PW unset.\n'); process.exit(2); }

  // A card with NO build-out and NO portal, held by at least two tenants — the exact state the
  // amber flag is meant to name. Selecting for what the check needs, not for what sorts first.
  const [target] = await owner<Array<{ opportunityId: string; title: string; holders: number }>>`
    SELECT c.opportunity_id, max(c.card->>'title') AS title, count(*)::int AS holders
    FROM tenant_opportunity_cards c
    JOIN opportunities o ON o.id = c.opportunity_id
    LEFT JOIN curated_solicitations cs ON cs.opportunity_id = o.id
    WHERE c.archived_at IS NULL AND c.lifecycle_status = 'open'
      AND COALESCE(cs.build_complete, false) = false
      AND NOT EXISTS (SELECT 1 FROM proposal_portals pp WHERE pp.opportunity_id = o.id)
    GROUP BY c.opportunity_id HAVING count(*) >= 2
    ORDER BY count(*) DESC, c.opportunity_id LIMIT 1`;
  if (!target) { console.error('\nHARNESS CANNOT RUN: no un-built-out card held by two tenants.\n'); process.exit(2); }

  const holders = await owner<Array<{ tenantId: string; pursuitStatus: string }>>`
    SELECT tenant_id, pursuit_status FROM tenant_opportunity_cards
    WHERE opportunity_id = ${target.opportunityId}::uuid AND archived_at IS NULL
    ORDER BY tenant_id LIMIT 2`;
  const restore = async () => {
    for (const h of holders) {
      await owner`UPDATE tenant_opportunity_cards SET pursuit_status = ${h.pursuitStatus}
                  WHERE tenant_id = ${h.tenantId}::uuid AND opportunity_id = ${target.opportunityId}::uuid`;
    }
  };

  console.log(`  card  : ${target.title?.slice(0, 54)} (${target.holders} holders, no build-out, unsold)`);
  console.log(`  admin : ${admin.email}\n`);

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    if (!(await signIn(page, admin.email, ADMIN_PW))) {
      console.error(`\nHARNESS CANNOT RUN: sign-in failed for ${admin.email}\n`); process.exit(2);
    }
    // The one row, read by the opportunity title — the table has no per-row id to address.
    const rowText = async (): Promise<string> => {
      await page.goto(`${BASE}/admin/cards`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const row = page.locator('tr', { hasText: (target.title ?? '').slice(0, 34) }).first();
      return (await row.innerText().catch(() => '')) ?? '';
    };

    console.log('1 · Before any vote — the RED half');
    await owner`UPDATE tenant_opportunity_cards SET pursuit_status = 'unreviewed', pursuit_set_at = NULL
                WHERE opportunity_id = ${target.opportunityId}::uuid`;
    const before = await rowText();
    ok('the row renders', before.length > 0, `${before.length} chars`);
    ok('no demand is claimed', !/👍/.test(before), before.replace(/\s+/g, ' ').slice(0, 70));
    ok('and no build-out flag', !/interest · no build-out/.test(before));

    console.log('\n2 · Two tenants vote — one of them opens the documents');
    await owner`UPDATE tenant_opportunity_cards SET pursuit_status = 'monitoring', pursuit_set_at = now()
                WHERE opportunity_id = ${target.opportunityId}::uuid
                  AND tenant_id IN ${owner(holders.map((h) => h.tenantId))}`;
    const after = await rowText();
    ok('the count reaches the admin', /👍\s*2/.test(after), after.replace(/\s+/g, ' ').slice(0, 90));
    const reviewed = (await owner<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards
      WHERE opportunity_id = ${target.opportunityId}::uuid AND docs_copied
        AND pursuit_status IN ('monitoring','pursuing')`)[0].n;
    ok('and the drop-off between saying yes and reading is stated',
      new RegExp(`${reviewed} opened the documents`).test(after),
      `${reviewed} of 2 — the gap is where interest dies`);
    ok('the build-out case is flagged', /interest · no build-out/.test(after));

    console.log('\n3 · The flag is narrow, not decorative');
    // A card nobody voted on must NOT carry it, or the flag means "this row exists".
    const [quiet] = await owner<Array<{ title: string }>>`
      SELECT max(card->>'title') AS title FROM tenant_opportunity_cards
      WHERE opportunity_id <> ${target.opportunityId}::uuid AND archived_at IS NULL
        AND pursuit_status = 'unreviewed' AND COALESCE(card->>'title','') <> ''
      GROUP BY opportunity_id LIMIT 1`;
    if (!quiet) { ok('an unvoted card exists to compare against', false, 'UNCOVERED, not passing'); }
    else {
      const qRow = await page.locator('tr', { hasText: (quiet.title ?? '').slice(0, 34) }).first()
        .innerText().catch(() => '');
      ok('an unvoted card carries no flag', qRow.length > 0 && !/interest · no build-out/.test(qRow),
        quiet.title?.slice(0, 44));
    }
  } finally {
    await restore();
    console.log('\n  (restored: prior verdicts)');
    await browser.close().catch(() => {});
    await owner.end();
  }
  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('\nDRIVE ERROR:', e); process.exit(2); });
