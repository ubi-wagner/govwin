/**
 * drive-card-decision — the two things the card was NOT expanded for, driven on the real product.
 *
 * The card grew for MATCHING: technology focus, phase, topic identity, volumes, required items, the
 * curator's highlights. Both scorers read them and a lens can find an opportunity through them.
 * Two questions it did not answer, both measured before this ran:
 *
 *   1 · **How much work is this?** `complianceSummary` — page limits, submission format, volume
 *       count — was on 42 of 63 cards and read by NO code. `provisionReady` was on 7 of 63, and
 *       lib/provisioning/complete.ts described releasing a build-out as the moment "the
 *       provisionReady badge flips on" while no badge existed anywhere in the tree.
 *   2 · **Does my lens reach anything?** `naics_codes` is an EMPTY ARRAY on all 22 master
 *       opportunities on this box, so it is empty on all 63 cards — and the bucket author was shown
 *       "NAICS codes 25%" with a hedge ("a signal is skipped for any opportunity that does not
 *       carry that field") that reads identically whether the field is on everything or nothing.
 *
 * ── RED FIRST, ON THE SAME BUILD ─────────────────────────────────────────────────────────────
 * Each check has a negative half that must hold for the positive half to mean anything: a card with
 * NO compliance matrix must show NO effort line (or the line proves only that we print something),
 * and a criterion the feed DOES carry must report full reach (or "0/N" proves only that we always
 * say zero). A drive that only shows the green cannot tell rendering from reporting.
 *
 * ⚠️ NOT read-only: pins one card and unpins it, and creates + deletes one bucket. Sandbox only.
 *
 * Usage:  node --import tsx frontend/scripts/drive-card-decision.mts
 */

import postgres from 'postgres';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
/** Where the run's screenshots land. Gitignored — regenerate rather than commit them. */
const SHOTS = process.env.SHOT_DIR ?? '.artifacts/card-decision';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

/** Global role decides the credential, not the membership row (B146/B147). */
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
  console.log('\ndrive-card-decision — size of job, readiness, and whether a lens reaches anything\n');

  // ── Select for what the checks NEED, not for what sorts first ────────────────────────────────
  // A tenant with no curated compliance summary would pass the "absent shows nothing" half and
  // prove nothing about the render; one with no bare card would pass the opposite half.
  const [t] = await owner<Array<{ tenantId: string; slug: string; withCs: number; bare: number; ready: number }>>`
    SELECT c.tenant_id, t.slug,
           count(*) FILTER (WHERE jsonb_typeof(c.card->'complianceSummary') = 'object')::int AS with_cs,
           count(*) FILTER (WHERE jsonb_typeof(c.card->'complianceSummary') <> 'object' OR c.card->'complianceSummary' IS NULL)::int AS bare,
           count(*) FILTER (WHERE (c.card->>'provisionReady') = 'true')::int AS ready
    FROM tenant_opportunity_cards c JOIN tenants t ON t.id = c.tenant_id
    WHERE c.archived_at IS NULL AND c.lifecycle_status = 'open'
      -- Selected for what the checks NEED, not for what sorts first: Purchase is admin-only, so a
      -- tenant with no signable tenant_admin cannot drive step 3 and would report a false CANT-RUN
      -- about the product instead of picking the next tenant (B146/B147).
      AND EXISTS (SELECT 1 FROM user_memberships m JOIN users u ON u.id = m.user_id
                   WHERE m.tenant_id = c.tenant_id AND m.role = 'tenant_admin'
                     AND u.role = 'tenant_admin' AND u.is_active)
    GROUP BY c.tenant_id, t.slug
    HAVING count(*) FILTER (WHERE jsonb_typeof(c.card->'complianceSummary') = 'object') > 0
       AND count(*) FILTER (WHERE jsonb_typeof(c.card->'complianceSummary') <> 'object' OR c.card->'complianceSummary' IS NULL) > 0
    ORDER BY count(*) FILTER (WHERE (c.card->>'provisionReady') = 'true') DESC, t.slug
    LIMIT 1`;
  if (!t) {
    console.error('\nHARNESS CANNOT RUN: no tenant holds BOTH a curated card and an uncurated one, so the\n' +
      'positive and negative halves cannot both be driven on one page. Run drive-curate-baa.mts first.\n');
    process.exit(2);
  }

  const [admin] = await owner<Array<{ email: string; globalRole: string }>>`
    SELECT u.email, u.role AS global_role
    FROM user_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${t.tenantId}::uuid AND m.role = 'tenant_admin' AND u.is_active
      AND u.role = 'tenant_admin'
    ORDER BY u.created_at LIMIT 1`;
  if (!admin) { console.error(`\nHARNESS CANNOT RUN: ${t.slug} has no tenant_admin — Purchase is admin-only.\n`); process.exit(2); }
  if (!passwordFor(admin.globalRole)) {
    console.error('\nHARNESS CANNOT RUN: TENANT_PW unset. Source scripts/sandbox-env.sh — one credential, one place.\n');
    process.exit(2);
  }

  // The card the effort line must appear on, and the one it must NOT.
  const [curated] = await owner<Array<{ opportunityId: string; title: string; cs: unknown; ready: boolean; closeDate: string | null }>>`
    SELECT opportunity_id, card->>'title' AS title, card->'complianceSummary' AS cs,
           card->>'closeDate' AS close_date,
           (card->>'provisionReady') = 'true' AS ready
    FROM tenant_opportunity_cards
    WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL AND lifecycle_status = 'open'
      AND jsonb_typeof(card->'complianceSummary') = 'object'
    ORDER BY ((card->>'provisionReady') = 'true') DESC, opportunity_id LIMIT 1`;
  const [uncurated] = await owner<Array<{ opportunityId: string; title: string }>>`
    SELECT opportunity_id, card->>'title' AS title
    FROM tenant_opportunity_cards
    WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL AND lifecycle_status = 'open'
      AND (jsonb_typeof(card->'complianceSummary') <> 'object' OR card->'complianceSummary' IS NULL)
    ORDER BY opportunity_id LIMIT 1`;

  // The agency every card in this feed carries — the criterion that must report FULL reach, so
  // "0/N" on naics cannot be the harness always saying zero.
  const [liveAgency] = await owner<Array<{ agency: string; n: number }>>`
    SELECT card->>'agency' AS agency, count(*)::int AS n
    FROM tenant_opportunity_cards
    WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL AND lifecycle_status = 'open'
      AND COALESCE(card->>'agency', '') <> ''
    GROUP BY 1 ORDER BY n DESC LIMIT 1`;
  const [feed] = await owner<Array<{ n: number; withNaics: number }>>`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE jsonb_typeof(card->'naicsCodes') = 'array'
                              AND jsonb_array_length(card->'naicsCodes') > 0)::int AS with_naics
    FROM tenant_opportunity_cards
    WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL AND lifecycle_status = 'open'`;

  console.log(`  tenant     : ${t.slug} (${feed.n} open cards; ${t.withCs} curated, ${t.bare} not, ${t.ready} build-out complete)`);
  console.log(`  curated    : ${curated?.title?.slice(0, 52)} ${JSON.stringify(curated?.cs)}`);
  console.log(`  uncurated  : ${uncurated?.title?.slice(0, 52)}`);
  console.log(`  naics on   : ${feed.withNaics} of ${feed.n} cards  ← the finding this drive exists for\n`);

  const browser = await chromium.launch({ executable_path: EXE } as never).catch(() => chromium.launch({ executablePath: EXE }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let pinnedHere = false;
  try {
    if (!(await signIn(page, admin.email, passwordFor(admin.globalRole)))) {
      console.error(`\nHARNESS CANNOT RUN: sign-in failed for ${admin.email}\n`);
      process.exit(2);
    }
    console.log(`  signed in as ${admin.email}\n`);
    await mkdir(SHOTS, { recursive: true }).catch(() => {});

    // ── 1 · SIZE OF JOB, on the card ─────────────────────────────────────────────────────────
    console.log('1 · How much work is this? (complianceSummary → the effort line)');

    /**
     * Read one card, addressed the way the product addresses it.
     *
     * ⚠️ `?opp=` is not a harness convenience — it is the deep link the feed's own "Build →" and the
     * notification routes use, and `pipeline-cards.tsx` force-includes the focused card
     * (`c.opportunityId === focusOpp || …`). Without it a card whose close date has passed is
     * filtered out CLIENT-side and reads as "0 chars", which looks exactly like a render failure.
     * The only `provisionReady` card on this box closes 2026-08-14, so the badge check would have
     * reported a product defect that was really a filter doing its job.
     */
    const cardText = async (oppId: string): Promise<string> => {
      await page.goto(`${BASE}/portal/${t.slug}/cards?opp=${oppId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      return (await page.locator(`#opp-${oppId}`).first().innerText().catch(() => '')) ?? '';
    };

    const curatedText = await cardText(curated.opportunityId);
    await page.screenshot({ path: `${SHOTS}/card-curated.png` }).catch(() => {});
    const uncuratedText = await cardText(uncurated.opportunityId);
    await page.screenshot({ path: `${SHOTS}/card-uncurated.png` }).catch(() => {});
    const cs = (curated.cs ?? {}) as Record<string, unknown>;
    const wantPages = typeof cs.pageLimitTechnical === 'number' ? `${cs.pageLimitTechnical}-page technical` : null;
    const wantVols = typeof cs.volumeCount === 'number' && cs.volumeCount > 0 ? `${cs.volumeCount} volume` : null;

    ok('the curated card renders at all', curatedText.length > 0, `${curatedText.length} chars`);
    if (wantPages) ok(`states the page limit — "${wantPages}"`, curatedText.includes(wantPages));
    if (wantVols) ok(`states the volume count — "${wantVols}"`, curatedText.includes(wantVols));
    if (typeof cs.submissionFormat === 'string' && cs.submissionFormat.trim()) {
      ok('states the submission format', curatedText.includes(cs.submissionFormat.trim().slice(0, 24)));
    }
    // RED HALF — an uncurated card must stay silent rather than print "0 volumes".
    ok('an uncurated card claims NO page limit', !/\d+-page technical/.test(uncuratedText),
      uncuratedText.length > 0 ? 'rendered, and said nothing' : 'card not on page');
    ok('an uncurated card claims NO volume count', !/\d+ volumes?\b/.test(uncuratedText));

    // ── 2 · READY TO BUILD ───────────────────────────────────────────────────────────────────
    console.log('\n2 · Is the build-out done? (provisionReady → the badge complete.ts already claimed)');
    const readyCards = await owner<Array<{ opportunityId: string }>>`
      SELECT opportunity_id FROM tenant_opportunity_cards
      WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL AND lifecycle_status = 'open'
        AND (card->>'provisionReady') = 'true'`;
    const notReady = await owner<Array<{ opportunityId: string }>>`
      SELECT opportunity_id FROM tenant_opportunity_cards
      WHERE tenant_id = ${t.tenantId}::uuid AND archived_at IS NULL AND lifecycle_status = 'open'
        AND COALESCE(card->>'provisionReady', 'false') <> 'true' LIMIT 3`;
    if (readyCards.length === 0) {
      ok('a build-out-complete card exists to badge', false, 'none on this box — check is UNCOVERED, not passing');
    } else {
      for (const r of readyCards) {
        ok(`badged on the built-out card ${r.opportunityId.slice(0, 8)}`, (await cardText(r.opportunityId)).includes('Ready to build'));
      }
    }
    // RED HALF — and its absence is not a negative verdict, so no "not ready" text either.
    let falsePositives = 0;
    for (const r of notReady) if ((await cardText(r.opportunityId)).includes('Ready to build')) falsePositives++;
    ok('NOT badged on cards whose build-out is unfinished', falsePositives === 0, `${notReady.length} checked`);

    // ── 3 · THE PURCHASE MODAL ───────────────────────────────────────────────────────────────
    console.log('\n3 · The decision itself — $1,999 against a title, or against the facts?');
    /*
     * ⚠️ THE SETUP FOLLOWS THE PRODUCT, NOT THE OTHER WAY ROUND (mig 240).
     *
     * This used to force `is_pinned = true`, because Purchase lived behind a pin. It now lives
     * behind the VERDICT — an up-vote reveals the transfer and the money together — so a drive that
     * kept setting the copy flag reported "Purchase is offered on the pinned card: button not
     * found" against a product working exactly as designed. A harness asserting a contract the
     * system no longer has is a harness bug, not a finding.
     */
    await owner`UPDATE tenant_opportunity_cards SET pursuit_status = 'monitoring', pursuit_set_at = now()
                WHERE tenant_id = ${t.tenantId}::uuid AND opportunity_id = ${curated.opportunityId}::uuid`;
    pinnedHere = true;
    await cardText(curated.opportunityId); // re-open the focused card now that it is pinned
    const buy = page.locator(`#opp-${curated.opportunityId}`).getByRole('button', { name: 'Purchase' });
    if (await buy.count() === 0) {
      ok('Purchase is offered once the customer has up-voted', false, 'button not found — modal path UNCOVERED');
    } else {
      await buy.first().click();
      await page.waitForTimeout(900);
      const modal = await page.locator('text=Purchase proposal workspace').first()
        .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').innerText().catch(() => '');
      ok('the modal opens', modal.length > 0);
      ok('states the price (unchanged)', modal.includes('$1,999'));
      if (wantPages) ok('states the page limit before payment', /Page limit/.test(modal));
      if (wantVols) ok('states the volume count before payment', /Volumes/.test(modal));
      // Not just the LABEL: a `<dt>Closes</dt>` with an empty `<dd>` would satisfy /Closes/ and tell
      // the buyer nothing. Assert the card's own close date, formatted the way the modal formats it.
      const wantClose = curated.closeDate
        ? new Date(curated.closeDate).toLocaleDateString(undefined, { timeZone: 'UTC' })
        : null;
      ok('states the deadline before payment', wantClose ? modal.includes(wantClose) : false,
        wantClose ? `${wantClose} · ${modal.match(/Closes[\s\S]{0,40}/)?.[0]?.replace(/\s+/g, ' ') ?? ''}` : 'card carries no close date');
      if (curated.ready) ok('states that the build-out is complete', /Build-out complete/.test(modal));
      await page.screenshot({ path: `${SHOTS}/purchase-modal.png` }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('text=Cancel').first().click().catch(() => {});
    }

    // ── 4 · DOES THE LENS REACH ANYTHING? ────────────────────────────────────────────────────
    console.log('\n4 · Signal coverage — the hedge replaced by a measurement');
    await page.goto(`${BASE}/portal/${t.slug}/buckets`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const newBucket = page.getByRole('button', { name: /New bucket|Create/ }).first();
    if (await newBucket.count() > 0) await newBucket.click().catch(() => {});
    await page.waitForTimeout(600);

    const typeInto = async (label: RegExp, value: string) => {
      const f = page.locator('input').filter({ hasNot: page.locator('[type=checkbox]') });
      const byPlaceholder = page.getByPlaceholder(label).first();
      if (await byPlaceholder.count() > 0) { await byPlaceholder.fill(value); return true; }
      // Fall back to the labelled field.
      const byLabel = page.getByLabel(label).first();
      if (await byLabel.count() > 0) { await byLabel.fill(value); return true; }
      void f;
      return false;
    };

    // A criterion the feed cannot satisfy, alongside one it can — both at once, so the page has to
    // distinguish them rather than label everything the same way.
    const typedNaics = await typeInto(/naics/i, '541715, 236220');
    const typedKw = await typeInto(/keyword/i, 'additive');
    const typedAgency = liveAgency ? await typeInto(/agenc/i, liveAgency.agency.split(' ').slice(-1)[0]) : false;
    await page.waitForTimeout(700);
    const panel = await page.locator('text=/Scores on \\d+ signal/').first()
      .locator('xpath=ancestor::div[1]').innerText().catch(() => '');

    if (!typedNaics || !typedKw) {
      ok('the authoring form exposes keyword + NAICS fields', false, 'could not address them — check UNCOVERED');
    } else {
      ok('the composition line still states the shares', /Scores on \d+ signal/.test(panel), panel.split('\n')[0] ?? '');
      ok(`NAICS reported as reaching 0 of ${feed.n}`, new RegExp(`NAICS codes 0/${feed.n}`).test(panel),
        panel.match(/Reach:[^\n]*/)?.[0] ?? panel.slice(0, 120));
      ok('and called out as carried by the other signals',
        new RegExp(`None of your ${feed.n} opportunities carry NAICS codes`).test(panel),
        panel.match(/[^\n]*None of your[^\n]*/)?.[0] ?? '');
      // RED HALF — a signal the feed DOES carry must not be reported as dead.
      if (typedAgency && liveAgency) {
        ok(`agency NOT reported dead (feed carries it on ${feed.n})`, new RegExp(`agency ${feed.n}/${feed.n}`).test(panel),
          panel.match(/agency \d+\/\d+/)?.[0] ?? '');
      } else {
        ok('a live signal is measured too', false, 'no agency on this feed — the discriminating half is UNCOVERED');
      }
      // And the old hedge is gone where a real measurement exists.
      ok('the un-actionable hedge no longer stands in for the number',
        !/A signal is skipped for any opportunity/.test(panel));
      await page.screenshot({ path: `${SHOTS}/bucket-coverage.png` }).catch(() => {});
    }
  } finally {
    if (pinnedHere) {
      await owner`UPDATE tenant_opportunity_cards SET pursuit_status = 'unreviewed', pursuit_set_at = NULL
                  WHERE tenant_id = ${t.tenantId}::uuid AND opportunity_id = ${curated.opportunityId}::uuid`;
      console.log('\n  (restored: verdict cleared)');
    }
    await browser.close().catch(() => {});
    await owner.end();
  }

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nDRIVE ERROR:', e); process.exit(2); });
