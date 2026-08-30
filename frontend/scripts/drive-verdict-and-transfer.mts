/**
 * drive-verdict-and-transfer — the thumb, the copy, and the page the copy was for.
 *
 * The split from migration 240, driven on the built app in the order a customer meets it:
 *
 *     👍 / 👎 write a verdict and nothing else       (pure state, one UPDATE, cannot fail)
 *     👍 reveals "View Solicitation"                 (the transfer is gated on interest, not the reverse)
 *     View Solicitation copies + opens the reading view
 *     👎 sorts last, filters the feed, and REMOVES NOTHING
 *
 * ── THE RED HALVES ───────────────────────────────────────────────────────────────────────────
 * Each check is paired with the one that makes it mean something. "View Solicitation appears" is
 * worthless unless it is ALSO absent before the up-vote. "A passed card is hidden" is worthless
 * unless the row is ALSO still in the database, still current, and still holding its documents —
 * which is the invariant the whole mirror model rests on.
 *
 * ⚠️ NOT read-only: votes on two cards and restores their prior verdict. Sandbox only.
 *
 * Usage:  BASE_URL=http://localhost:3100 node --import tsx frontend/scripts/drive-verdict-and-transfer.mts
 */

import postgres from 'postgres';
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

const NOTE = 'Our take: this one rewards a team that can show a printed structure surviving a real freeze-thaw cycle. '
  + 'The evaluators have funded three paper studies here already and said so at the industry day.';
const PASSAGE = 'The Technical Volume shall not exceed twelve (12) pages, excluding the cover sheet and the '
  + 'Company Commercialization Report, which are not counted against the page limit.';

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

function passwordFor(globalRole: string): string {
  const ADMIN = process.env.ADMIN_PW ?? process.env.SANDBOX_PASSWORD ?? '';
  return ['master_admin', 'rfp_admin', 'partner_admin'].includes(globalRole) ? ADMIN : (process.env.TENANT_PW ?? '');
}

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return !page.url().includes('/login');
}

async function main() {
  console.log('\ndrive-verdict-and-transfer — a verdict that cannot fail, a transfer that can\n');

  // Selected for what the checks need: a tenant with a signable tenant_admin and at least two OPEN,
  // NOT-past-close cards (the feed filters past-close client-side, so a card chosen without that
  // predicate reads as a render failure — the defect this drive's sibling already hit).
  const [t] = await owner<Array<{ tenantId: string; slug: string; n: number }>>`
    SELECT c.tenant_id, t.slug, count(*)::int AS n
    FROM tenant_opportunity_cards c JOIN tenants t ON t.id = c.tenant_id
    WHERE c.archived_at IS NULL AND c.lifecycle_status = 'open'
      AND (c.card->>'closeDate') IS NOT NULL AND (c.card->>'closeDate')::timestamptz > now()
      AND EXISTS (SELECT 1 FROM user_memberships m JOIN users u ON u.id = m.user_id
                   WHERE m.tenant_id = c.tenant_id AND m.role = 'tenant_admin'
                     AND u.role = 'tenant_admin' AND u.is_active)
    GROUP BY c.tenant_id, t.slug HAVING count(*) >= 2
    ORDER BY count(*) DESC, t.slug LIMIT 1`;
  if (!t) { console.error('\nHARNESS CANNOT RUN: no tenant has two open, not-yet-closed cards.\n'); process.exit(2); }

  const [admin] = await owner<Array<{ email: string; globalRole: string }>>`
    SELECT u.email, u.role AS global_role FROM user_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${t.tenantId}::uuid AND m.role = 'tenant_admin' AND u.role = 'tenant_admin' AND u.is_active
    ORDER BY u.created_at LIMIT 1`;
  if (!passwordFor(admin.globalRole)) { console.error('\nHARNESS CANNOT RUN: TENANT_PW unset — source scripts/sandbox-env.sh\n'); process.exit(2); }

  const picks = await owner<Array<{ opportunityId: string; title: string; pursuitStatus: string; docsCopied: boolean }>>`
    SELECT opportunity_id, card->>'title' AS title, pursuit_status, docs_copied
    FROM tenant_opportunity_cards
    WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL AND lifecycle_status = 'open'
      AND (card->>'closeDate')::timestamptz > now()
    ORDER BY opportunity_id LIMIT 2`;
  const [up, down] = picks;
  const restore = async () => {
    for (const p of picks) {
      await owner`UPDATE tenant_opportunity_cards SET pursuit_status = ${p.pursuitStatus},
                    pursuit_set_at = CASE WHEN ${p.pursuitStatus} = 'unreviewed' THEN NULL ELSE pursuit_set_at END
                  WHERE tenant_id = ${t.tenantId}::uuid AND opportunity_id = ${p.opportunityId}::uuid`;
    }
  };

  console.log(`  tenant : ${t.slug} (${t.n} open, not-yet-closed cards)`);
  console.log(`  👍 card: ${up.title?.slice(0, 50)}`);
  console.log(`  👎 card: ${down.title?.slice(0, 50)}\n`);

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    if (!(await signIn(page, admin.email, passwordFor(admin.globalRole)))) {
      console.error(`\nHARNESS CANNOT RUN: sign-in failed for ${admin.email}\n`); process.exit(2);
    }
    const open = async (opp: string) => {
      await page.goto(`${BASE}/portal/${t.slug}/cards?opp=${opp}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      return page.locator(`#opp-${opp}`).first();
    };

    // ── 1 · The transfer is REVEALED by the verdict, not the other way round ─────────────────
    console.log('1 · 👍 reveals the transfer');
    await owner`UPDATE tenant_opportunity_cards SET pursuit_status='unreviewed', pursuit_set_at=NULL
                WHERE tenant_id=${t.tenantId}::uuid AND opportunity_id=${up.opportunityId}::uuid`;
    let cardEl = await open(up.opportunityId);
    // RED HALF — before any verdict there must be NO transfer control at all.
    ok('no "View Solicitation" before the up-vote',
      await cardEl.getByText('View Solicitation').count() === 0);
    ok('both thumbs are offered', await cardEl.getByRole('button', { name: /👍/ }).count() === 1
      && await cardEl.getByRole('button', { name: /👎/ }).count() === 1);

    await cardEl.getByRole('button', { name: /👍/ }).click();
    await page.waitForTimeout(2000);
    cardEl = page.locator(`#opp-${up.opportunityId}`).first();
    ok('the up-vote lands as `monitoring`',
      (await owner`SELECT pursuit_status AS s FROM tenant_opportunity_cards
                   WHERE tenant_id=${t.tenantId}::uuid AND opportunity_id=${up.opportunityId}::uuid`)[0].s === 'monitoring');
    ok('and it is dated',
      (await owner`SELECT pursuit_set_at IS NOT NULL AS d FROM tenant_opportunity_cards
                   WHERE tenant_id=${t.tenantId}::uuid AND opportunity_id=${up.opportunityId}::uuid`)[0].d === true);
    ok('"View Solicitation" is now offered', await cardEl.getByText('View Solicitation').count() > 0);
    // The verdict alone must NOT have moved any bytes — that is the whole point of the split.
    const copiedAfterVote = (await owner`SELECT count(*)::int AS n FROM tenant_opportunity_documents
                                         WHERE tenant_id=${t.tenantId}::uuid AND opportunity_id=${up.opportunityId}::uuid`)[0].n;
    const wasCopied = up.docsCopied;
    ok('the vote itself copied nothing', wasCopied || copiedAfterVote === 0,
      wasCopied ? 'card already held a copy before the run' : `${copiedAfterVote} document rows`);

    // ── 2 · The reading view exists, and leads with the analyst ──────────────────────────────
    console.log('\n2 · The transfer has somewhere to go');
    /*
     * SEED WHAT THE PAGE EXISTS TO SHOW, IF THE BOX DOES NOT HAVE IT.
     *
     * The first run of this drive went green with two checks reporting UNCOVERED: the card carried
     * no expert note and no highlights, so the two sections that justify the page were never
     * rendered and never asserted. A green that skipped the substance is exactly the shape this
     * repo calls uncovered rather than passing — and `expert_notes` reaching a customer is the
     * whole R3 finding, so it cannot be the part that goes unproven.
     *
     * Seeded through the REAL machinery: the note on the master, the highlight as a real
     * `solicitation_annotations` row with an excerpt, then a genuine `publishAndFanOut`. If it
     * arrives, it arrived the way the product delivers it.
     */
    let seeded = false;
    const [pre] = await owner<Array<{ note: string | null; hl: number; solId: string | null }>>`
      SELECT c.card->>'expertNotes' AS note,
             jsonb_array_length(COALESCE(c.card->'highlights','[]'::jsonb)) AS hl,
             COALESCE(o.solicitation_id, cs.id)::text AS sol_id
      FROM tenant_opportunity_cards c
      JOIN opportunities o ON o.id = c.opportunity_id
      LEFT JOIN curated_solicitations cs ON cs.opportunity_id = o.id
      WHERE c.tenant_id = ${t.tenantId}::uuid AND c.opportunity_id = ${up.opportunityId}::uuid`;
    if ((!pre?.note || pre.hl === 0) && pre?.solId) {
      const [actor] = await owner<Array<{ id: string }>>`
        SELECT id FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active ORDER BY created_at LIMIT 1`;
      if (actor) {
        await owner`UPDATE opportunities SET expert_notes = ${NOTE} WHERE id = ${up.opportunityId}::uuid`;
        await owner`INSERT INTO solicitation_annotations
                      (solicitation_id, actor_id, kind, compliance_variable_name, source_location, excerpt, payload)
                    VALUES (${pre.solId}::uuid, ${actor.id}::uuid, 'highlight', 'page_limit',
                            ${owner.json({ page: 12, offset: 0, length: PASSAGE.length })}, ${PASSAGE},
                            ${owner.json({ seededBy: 'drive-verdict-and-transfer' })})`;
        const { publishAndFanOut } = await import('../lib/opportunity-bridge.ts');
        await publishAndFanOut(up.opportunityId, 'updated', null, new Date().toISOString());
        seeded = true;
        console.log('  (seeded a curation note + one marked passage through the real bridge)');
      }
    }

    await cardEl.getByText('View Solicitation').first().click();
    await page.waitForTimeout(3500);
    const onReader = page.url().includes('/solicitation');
    if (!onReader) {
      // The copy runs first on an uncopied card; the link appears once it lands.
      await page.goto(`${BASE}/portal/${t.slug}/cards/${up.opportunityId}/solicitation`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
    }
    const body = await page.locator('body').innerText().catch(() => '');
    ok('the reading view renders', body.length > 0 && !/Application error|500|Internal Server/i.test(body),
      `${body.length} chars`);
    ok('it names the opportunity', body.includes((up.title ?? '').slice(0, 24)));
    const [expected] = await owner<Array<{ note: string | null; hl: number; docs: number; manifest: number }>>`
      SELECT card->>'expertNotes' AS note,
             jsonb_array_length(COALESCE(card->'highlights','[]'::jsonb)) AS hl,
             jsonb_array_length(COALESCE(card->'documents','[]'::jsonb)) AS manifest,
             (SELECT count(*)::int FROM tenant_opportunity_documents d
               WHERE d.tenant_id=${t.tenantId}::uuid AND d.opportunity_id=${up.opportunityId}::uuid) AS docs
      FROM tenant_opportunity_cards
      WHERE tenant_id=${t.tenantId}::uuid AND opportunity_id=${up.opportunityId}::uuid`;
    ok('the curation note reaches the customer — R3, authored and carried and never rendered',
      !!expected.note && body.includes(expected.note.slice(0, 40)),
      expected.note ? `"${expected.note.slice(0, 44)}…"` : 'no note on the card — UNCOVERED, not passing');
    /*
     * ⚠️ CASE-INSENSITIVE ON PURPOSE. `innerText` returns text as the CSS RENDERS it, and these
     * headings carry `uppercase`, so a matcher typed from the source string ("What our analysts
     * marked") never matches the DOM ("WHAT OUR ANALYSTS MARKED"). The first run of this drive
     * failed here on a page that was rendering the passage perfectly — the instrument was wrong,
     * not the product, which is why the rule is to validate the harness before believing a finding.
     */
    ok('the marked passage renders, with its page',
      expected.hl > 0 && /what our analysts marked/i.test(body) && /page 12/.test(body),
      expected.hl > 0 ? `${expected.hl} passage(s)` : 'no highlights on the card — UNCOVERED, not passing');
    void seeded;
    // Absent is not empty: with a manifest and no local copy the page must say WHICH, not "none".
    if (expected.docs === 0 && expected.manifest > 0) {
      ok('an uncopied corpus is reported honestly, not as "no documents"',
        /published \d+ document/.test(body) && !/has not published any documents/.test(body));
    } else if (expected.docs > 0) {
      ok(`${expected.docs} copied document(s) are readable`, /characters/.test(body));
    }

    // ── 3 · 👎 sorts and filters, and REMOVES NOTHING ────────────────────────────────────────
    console.log('\n3 · 👎 is a verdict, not a delete');
    const before = (await owner`SELECT count(*)::int AS n FROM tenant_opportunity_cards
                                WHERE tenant_id=${t.tenantId}::uuid`)[0].n;
    const docsBefore = (await owner`SELECT count(*)::int AS n FROM tenant_opportunity_documents
                                    WHERE tenant_id=${t.tenantId}::uuid`)[0].n;
    const downEl = await open(down.opportunityId);
    await downEl.getByRole('button', { name: /👎/ }).click();
    await page.waitForTimeout(2200);
    ok('the down-vote lands as `passed`',
      (await owner`SELECT pursuit_status AS s FROM tenant_opportunity_cards
                   WHERE tenant_id=${t.tenantId}::uuid AND opportunity_id=${down.opportunityId}::uuid`)[0].s === 'passed');
    // THE MIRROR INVARIANT — the reason a down-vote is safe to offer at all.
    const after = (await owner`SELECT count(*)::int AS n FROM tenant_opportunity_cards
                               WHERE tenant_id=${t.tenantId}::uuid`)[0].n;
    const docsAfter = (await owner`SELECT count(*)::int AS n FROM tenant_opportunity_documents
                                   WHERE tenant_id=${t.tenantId}::uuid`)[0].n;
    ok('the mirror still holds every card', after === before, `${before} → ${after}`);
    ok('and every copied document', docsAfter === docsBefore, `${docsBefore} → ${docsAfter}`);
    // Filtered from the DEFAULT view...
    await page.goto(`${BASE}/portal/${t.slug}/cards`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    ok('a passed card is out of the default feed',
      await page.locator(`#opp-${down.opportunityId}`).count() === 0);
    // ...and recoverable, which is what "an advisor says pursue it" needs.
    await page.getByText('Show passed').click().catch(() => {});
    await page.waitForTimeout(2000);
    ok('and comes straight back with "Show passed"',
      await page.locator(`#opp-${down.opportunityId}`).count() > 0);
  } finally {
    // Remove only what this run created; the note is cleared and the opp republished so the box is
    // left as it was found rather than carrying a harness's prose into the next drive's fixtures.
    try {
      await owner`DELETE FROM solicitation_annotations WHERE payload->>'seededBy' = 'drive-verdict-and-transfer'`;
      await owner`UPDATE opportunities SET expert_notes = NULL
                   WHERE id = ${up.opportunityId}::uuid AND expert_notes = ${NOTE}`;
      const { publishAndFanOut } = await import('../lib/opportunity-bridge.ts');
      await publishAndFanOut(up.opportunityId, 'updated', null, new Date().toISOString());
    } catch (e) { console.error('  (seed cleanup failed)', (e as Error).message); }
    await restore();
    console.log('\n  (restored: prior verdicts)');
    await browser.close().catch(() => {});
    await owner.end();
  }
  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('\nDRIVE ERROR:', e); process.exit(2); });
