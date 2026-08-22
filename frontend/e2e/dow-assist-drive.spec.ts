/**
 * Ingest Assist, driven as a real rfp_admin against the live DoW 2026 SBIR BAA.
 *
 * This spec is the PROOF for the two fixes it was written to verify:
 *
 *   A. The shred gate — Assist against a solicitation with no extracted text must REFUSE
 *      (409 SOURCE_TEXT_NOT_READY) instead of silently writing DEFAULT_SBIR_CSO_SKELETON
 *      into the compliance matrix as though it had read the document.
 *   B. The deterministic extractor — with text present, the matrix must come back with the
 *      rules this BAA actually states (10-pt minimum font, 1-inch margins, its SEVEN DSIP
 *      volumes, the 12 mandated Technical Volume sections), each stamped `pattern_match`
 *      with a citable excerpt — and with NO page limit, because the BAA sets none.
 *
 *   C. (added after driving it) A Component's rule is not the solicitation's rule. This BAA
 *      carries the Navy's instructions inline; adopting them bound every proposer to a Navy
 *      page cap, badged "Read from source" with a real citation. B is about not inventing a
 *      value; C is about not promoting one that is real but scoped to someone else.
 *
 * Run: npx playwright test --project=drive dow-assist
 *      (the solicitation is resolved from the DB; DRIVE_SOL_ID overrides — see below)
 */
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { resolveShreddedSolicitation } from './resolve-solicitation';

const SHOTS = 'public/guides/rfp-ingest';

/* Resolved from the DB — `process.env.DRIVE_SOL_ID!` was unset, so every request went to
 * /api/admin/rfp-curation/undefined/… and this file failed on a bare false. The resolver, its
 * rationale, and how to stand a solicitation up live in e2e/resolve-solicitation.ts. */
let SOL = '';
/* dow-assist OWNS a scenario too, and for the opposite reason to the others: it asserts that a
 * deferral blocker keeps the matrix STAGED. Any drive that lands a shared solicitation first turns
 * that assertion into landed:true — which is what happened once ingest-studio started running on
 * the same one. Its scenario must stay untouched. */
test.beforeAll(async () => { SOL = (await resolveShreddedSolicitation('DRIVE_SOL_ID', 'assist')).id; });

async function loginAsRfpAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('A · readiness gate reports the real shred state', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsRfpAdmin(page);

  const res = await page.request.get(`/api/admin/rfp-curation/${SOL}/ingest-assist`);
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  console.log('[drive] readiness:', JSON.stringify(data));
  expect(data.ready).toBe(true);
  expect(data.state).toBe('ready');
  expect(data.chars).toBeGreaterThan(100_000);   // the real 50-page BAA + topic
});

test('A · Assist refuses a solicitation with no usable source text', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsRfpAdmin(page);

  // A solicitation that does not exist must 404 — never fall through to a default build.
  const missing = await page.request.post(
    '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-assist',
    { data: { publish: false } },
  );
  expect(missing.status()).toBe(404);

  // A REAL unshredded solicitation (a crawler lead: title + summary only, no extracted PDF).
  // This is the case that used to write a full, confident, entirely fabricated matrix.
  const bare = process.env.DRIVE_UNSHREDDED_SOL_ID;
  test.skip(!bare, 'set DRIVE_UNSHREDDED_SOL_ID to a solicitation with no shredded text');

  const ready = await page.request.get(`/api/admin/rfp-curation/${bare}/ingest-assist`);
  expect((await ready.json()).data.ready).toBe(false);

  const refused = await page.request.post(`/api/admin/rfp-curation/${bare}/ingest-assist`, {
    data: { publish: false },
  });
  expect(refused.status()).toBe(409);
  const body = await refused.json();
  console.log('[drive] gate:', JSON.stringify(body));
  expect(body.code).toBe('SOURCE_TEXT_NOT_READY');
  expect(body.detail.canForceDefaultSkeleton).toBe(true);

  // …and the opt-in escape hatch still works, stamping every field `default`.
  const forced = await page.request.post(`/api/admin/rfp-curation/${bare}/ingest-assist`, {
    data: { publish: false, allowDefaultSkeleton: true },
  });
  expect(forced.ok()).toBeTruthy();
  const fd = (await forced.json()).data;
  expect(Object.values(fd.fieldSources)).not.toContain('pattern_match');
  expect(fd.source).toBe('default');
});

test('B · Assist reads the BAA and stamps pattern_match provenance', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await loginAsRfpAdmin(page);

  const res = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-assist`, {
    data: { publish: false },
    timeout: 180_000,
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  console.log('[drive] assist:', JSON.stringify(data, null, 2));

  // Read, not guessed.
  expect(data.fieldSources.min_font_size).toBe('pattern_match');
  expect(data.fieldSources.margins).toBe('pattern_match');
  expect(data.fieldSources.required_sections).toBe('pattern_match');
  expect(data.fieldSources.volumes).toBe('pattern_match');

  // The BAA states no page limit — it defers to the Component instructions. Assert we say so.
  expect(String(data.notes.join(' '))).toMatch(/defers the technical-volume page limit/i);

  /* THE DEFERRAL IS A BLOCKER, SO THE RUN STAGES RATHER THAN LANDS.
   *
   * `data.volumes` is the LANDED count and reads 0 here — not because the parse found no volumes,
   * but because an unfounded page limit must not reach a live matrix unreviewed. This assertion
   * used to be `expect(data.volumes).toBe(7)`, written when the deferral produced no blocker and
   * the run landed. Asserting the landed count would now quietly require the WRONG behaviour.
   */
  expect(data.landed, 'a deferral blocker must stay staged for a human').toBe(false);
  expect(String(data.blockers.join(' '))).toMatch(/page limit/i);

  // The document's own seven volumes ARE read — they sit on the staged draft, which is where a
  // staged run's parse lives. Read it as the review panel does.
  const dsn = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  const sql = postgres(dsn!, { max: 1 });
  try {
    const [draft] = await sql<{ vols: number; plt: string | null }[]>`
      SELECT jsonb_array_length(parsed->'volumes')::int AS vols,
             parsed->'compliance'->>'pageLimitTechnical' AS plt
      FROM solicitation_compliance_drafts
      WHERE solicitation_id = ${SOL} AND status = 'staged'
      ORDER BY created_at DESC LIMIT 1`;
    expect(draft?.vols, "the document's own seven volumes, not the six-volume default").toBe(7);
    expect(draft?.plt, 'no page limit may be invented for a document that sets none').toBeNull();
  } finally { await sql.end(); }

  /* A COMPONENT RULE IS NOT THE SOLICITATION'S RULE.
   *
   * This BAA carries the Navy's own instructions inline: "DON Phase I Technical Volume (Volume 2)
   * page limit is not to exceed 10 pages", one bullet under "the DON Proposal Submission
   * Instructions take precedence". That bound page_limit_technical to 10 solicitation-wide, badged
   * `pattern_match` with a real page-31 citation — so an Air Force proposer was told their cap was
   * 10 on the authority of a Navy rule, with evidence that looked stronger than a default. The
   * finding must be SURFACED (a curator building for the Navy needs it) and must NOT be adopted.
   */
  const componentNote = data.notes.find((n: string) => /NOT applied solicitation-wide/i.test(n));
  expect(componentNote, 'the Component-specific rule must be surfaced, not silently dropped').toBeTruthy();
  expect(componentNote).toMatch(/DON/);

  /* The cell stays `pattern_match` — and that is the RIGHT answer, not a leftover.
   *
   * A deferral is itself a reading: "we read that this document sets no limit here"
   * (parse-solicitation.ts:192). That provenance is what makes the UI render "Set elsewhere" with a
   * citation instead of a red "Default — unverified", and it is why the default 10 was cleared
   * rather than left standing. What must never happen is a NUMBER arriving under that badge, which
   * is exactly what the draft assertion above pins: pageLimitTechnical is null.
   */
  expect(data.fieldSources.page_limit_technical, 'read-as-deferred, not read-as-10').toBe('pattern_match');

  await page.goto(`/admin/rfp-curation/${SOL}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/08-after-ingest-assist.png`, fullPage: true });

  /* WHAT THE CURATOR SEES WHILE THE MATRIX IS STAGED.
   *
   * These assertions used to require "Read from source" and "Set elsewhere" badges. Those render
   * off `solicitation_compliance.field_provenance`, which is written on LANDING — and a deferral
   * blocker deliberately keeps this run staged, so the live row's provenance is `{}` and every
   * cell reads "Default — unverified". That is the honest rendering: nothing landed, so nothing
   * may claim to have been read. Asserting the landed badges here would have required the matrix
   * to land despite its blocker. The badge rendering itself is covered where it belongs, by
   * ingest-studio-drive's staged → reviewed → landed walk.
   *
   * What must be true HERE is that the curator is told WHY the page-limit cell is empty.
   */
  await expect(page.getByText(/defers the technical-volume page limit/i).first())
    .toBeVisible({ timeout: 15_000 });
  console.log('[drive] staged with the deferral surfaced — no value claimed as read');
});
