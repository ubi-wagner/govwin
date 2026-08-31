/**
 * Put the product into the state the guides describe — through the product.
 *
 * ── WHY NOT JUST INSERT THE ROWS ─────────────────────────────────────────────────────────────
 * The guides are screenshot-grounded: their whole claim is that the picture beside a step is the
 * screen that step produces. A fixture written straight into the database can produce a screen the
 * product would never render — a verdict with no timestamp, a copied corpus with no manifest, an
 * award amount with no basis — and the guide would then illustrate a state a reader cannot reach
 * by following it. That is a worse failure than an out-of-date shot, because it is unfalsifiable
 * from the outside.
 *
 * So every state below is produced by CALLING THE ROUTE a person clicks, signed in as the actor who
 * would click it. What ends up on disk is a photograph of the product, not of a fixture.
 *
 * ⚠️ It LEAVES the state behind, deliberately — that is the point, and the capture runs next. A
 * tenant with a few rated opportunities and one solicitation they have read is an ordinary tenant.
 * Idempotent: re-running re-asserts the same verdicts rather than accumulating new ones.
 *
 *   BASE_URL=http://localhost:3109 node --import tsx frontend/scripts/stage-guide-fixtures.mts
 */
import postgres from 'postgres';
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? process.env.GUIDE_BASE ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });
const SLUG = process.env.TENANT_SLUG ?? 'foundation';

const say = (s: string) => console.log(`  ${s}`);

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return !page.url().includes('/login');
}

async function main() {
  console.log('\nstage-guide-fixtures — the state the guides describe, produced by the product\n');
  const TENANT_PW = process.env.TENANT_PW ?? '';
  const ADMIN_PW = process.env.ADMIN_PW ?? process.env.MASTER_PW ?? process.env.SANDBOX_PASSWORD ?? '';

  const [tAdmin] = await owner<Array<{ email: string }>>`
    SELECT u.email FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
    WHERE t.slug = ${SLUG} AND m.role = 'tenant_admin' AND u.role = 'tenant_admin' AND u.is_active
      AND COALESCE(u.temp_password, false) = false ORDER BY u.created_at LIMIT 1`;
  const [pAdmin] = await owner<Array<{ email: string }>>`
    SELECT email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
      AND COALESCE(temp_password, false) = false
    ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;
  if (!tAdmin || !TENANT_PW) { console.error('CANNOT RUN: no tenant_admin / TENANT_PW unset'); process.exit(2); }
  if (!pAdmin || !ADMIN_PW) { console.error('CANNOT RUN: no platform admin / ADMIN_PW unset'); process.exit(2); }

  // Cards a customer would plausibly have opinions about: open, not yet closed, and carrying a
  // curated record so the rated card actually SHOWS something worth photographing.
  const cards = await owner<Array<{ opportunityId: string; title: string; docs: number }>>`
    SELECT c.opportunity_id, c.card->>'title' AS title,
           jsonb_array_length(COALESCE(c.card->'documents','[]'::jsonb)) AS docs
    FROM tenant_opportunity_cards c JOIN tenants t ON t.id = c.tenant_id
    WHERE t.slug = ${SLUG} AND c.archived_at IS NULL AND c.lifecycle_status = 'open'
      AND ((c.card->>'closeDate') IS NULL OR (c.card->>'closeDate')::timestamptz > now())
    /*
     * Ordered by what the SHOTS need, not by what sorts first. A card with published documents and
     * marked passages is the one whose reading view is worth photographing; requiring a compliance
     * summary as well excluded every topic card on this box (74 carry documents, none of those
     * also carried a matrix), and the first run copied 0 documents and would have illustrated the
     * empty branch as if it were the feature.
     */
    ORDER BY jsonb_array_length(COALESCE(c.card->'documents','[]'::jsonb)) DESC,
             jsonb_array_length(COALESCE(c.card->'highlights','[]'::jsonb)) DESC,
             (jsonb_typeof(c.card->'complianceSummary') = 'object') DESC,
             c.opportunity_id
    LIMIT 6`;
  if (cards.length < 3) {
    console.error(`CANNOT RUN: ${SLUG} has ${cards.length} usable open card(s); need 3`);
    process.exit(2);
  }

  const browser = await chromium.launch({ executablePath: EXE });
  try {
    // ── the customer's verdicts ───────────────────────────────────────────────────────────────
    const tp = await browser.newPage();
    if (!(await signIn(tp, tAdmin.email, TENANT_PW))) { console.error('CANNOT RUN: tenant sign-in failed'); process.exit(2); }
    const vote = async (opp: string, status: string) => tp.evaluate(async ([slug, o, s]) => {
      const r = await fetch(`/api/portal/${slug}/cards/${o}/pursuit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }),
      });
      return r.status;
    }, [SLUG, opp, status] as const);

    say(`up   ${await vote(cards[0].opportunityId, 'monitoring')}  ${cards[0].title?.slice(0, 46)}`);
    say(`up   ${await vote(cards[1].opportunityId, 'monitoring')}  ${cards[1].title?.slice(0, 46)}`);
    say(`down ${await vote(cards[2].opportunityId, 'passed')}  ${cards[2].title?.slice(0, 46)}`);

    // The transfer, on the up-voted card that actually has documents to pull — otherwise the
    // reading view photographs its empty branch and the guide illustrates the wrong thing.
    const withDocs = cards.find((c) => Number(c.docs) > 0) ?? cards[0];
    if (withDocs !== cards[0]) await vote(withDocs.opportunityId, 'monitoring');
    const copied = await tp.evaluate(async ([slug, o]) => {
      const r = await fetch(`/api/portal/${slug}/cards/${o}/documents`, { method: 'POST' });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, [SLUG, withDocs.opportunityId] as const);
    say(`view ${copied.status}  ${JSON.stringify(copied.body).slice(0, 70)}`);
    await tp.close();

    // ── the admin's release decisions ─────────────────────────────────────────────────────────
    const ap = await browser.newPage();
    if (!(await signIn(ap, pAdmin.email, ADMIN_PW))) { console.error('CANNOT RUN: admin sign-in failed'); process.exit(2); }
    const [sol] = await owner<Array<{ id: string; n: number }>>`
      SELECT cs.id, (SELECT count(*)::int FROM opportunities o WHERE o.solicitation_id = cs.id) AS n
      FROM curated_solicitations cs ORDER BY n DESC, cs.created_at DESC LIMIT 1`;
    if (sol) {
      const r1 = await ap.evaluate(async ([id]) => {
        const r = await fetch(`/api/admin/rfp-curation/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ awardBasis: 'estimated', awardAmount: 250000 }),
        });
        return r.status;
      }, [sol.id] as const);
      const r2 = await ap.evaluate(async ([id]) => {
        const r = await fetch(`/api/admin/rfp-curation/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fieldBasis: { highlights: 'marked', source_documents: 'attached' } }),
        });
        return r.status;
      }, [sol.id] as const);
      say(`award ${r1}  basis=estimated $250,000   ·   release bases ${r2}   (${sol.n} topic(s))`);
    }
    await ap.close();
  } finally {
    await browser.close().catch(() => {});
    await owner.end();
  }
  console.log('\n  (left in place — the capture runs against this state)\n');
}
main().catch((e) => { console.error('\nSTAGE ERROR:', e); process.exit(2); });
