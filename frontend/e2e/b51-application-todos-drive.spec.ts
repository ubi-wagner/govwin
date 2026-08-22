/**
 * B51 — one application raises ONE ToDo, and deciding it drains that ToDo.
 *
 * Bug log B51 recorded three accepted applications sitting behind six open ToDos. Two causes:
 *   (a) the mig-040 automation rule `Auto-todo on application` raised a SECOND, untyped and
 *       entity-less copy of the question the route's own `application_triage` ToDo already asked;
 *   (b) neither accept nor reject ever closed what they answered.
 *
 * This drive proves both halves against the real surfaces — the public /apply form and the
 * operator's own queue screen — because the failure is only visible end to end: (a) is about what
 * an EVENT consumer does after the POST returns 201, and (b) is about the state of a row after a
 * button is pressed on a different screen by a different actor.
 *
 * It asserts on the DATABASE, not on the UI, at the two moments that matter. The admin queue page
 * shows applications, not ToDos, so a screen check would have passed throughout the entire period
 * the bug existed — which is precisely how the queue grew to six.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execSync } from 'child_process';

const ADMIN_PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';
const OWNER_DB = process.env.DATABASE_URL_OWNER
  || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';

/**
 * Read as the OWNER on purpose. These rows are platform-scope (`tenant_id IS NULL`) and the point
 * of the check is what is actually stored — a read through the app's own RLS-scoped client would
 * be reading through the same layer the fix had to work around.
 */
function q(sqlText: string): string[] {
  // Flatten first: `psql -c` takes ONE statement, and a template literal wrapped for readability
  // carries real newlines that psql reads as a statement break ("syntax error at end of input").
  const flat = sqlText.replace(/\s+/g, ' ').trim();
  const out = execSync(
    `psql ${JSON.stringify(OWNER_DB)} -tAc ${JSON.stringify(flat)}`,
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'changeme' } },
  );
  return out.trim().split('\n').filter(Boolean);
}

/**
 * Stamp the DOMAIN, not just the local part. The apply route enforces one administrator per
 * company by matching the email domain against every prior application (`DOMAIN_MATCH`, 409) —
 * correct product behaviour, and it means a fixed domain makes this drive pass exactly once and
 * refuse every re-run afterwards.
 */
const STAMP = Date.now().toString(36);
const CO = {
  company: `Halyard Composites ${STAMP}`,
  contact: 'Dana Whitlock',
  title: 'Director of Research',
  email: `dana.whitlock@halyard-${STAMP}.test`,
  state: 'Ohio',
  tech: 'Continuous-fibre thermoplastic layup for unmanned airframe spars, cutting cure time from '
      + 'eight hours to forty minutes at equivalent interlaminar shear strength.',
  motivation: 'We have flight-test data and no proposal function; we are chasing AFWERX and Navy '
      + 'SBIR topics and keep missing deadlines on the paperwork rather than the technology.',
  referral: 'Ohio Aerospace Institute',
};

/** A second applicant, for the reject path — same shape, its own domain (see the note above). */
const NO = {
  company: `Cordwain Optics ${STAMP}`,
  contact: 'Rafael Ibarra',
  title: 'Managing Partner',
  email: `rafael.ibarra@cordwain-${STAMP}.test`,
  state: 'Ohio',
  tech: 'We resell commercial off-the-shelf inspection cameras with a custom mounting bracket and '
      + 'are looking for federal customers for the existing catalogue.',
  motivation: 'We want introductions to programme offices and someone to write the paperwork.',
  referral: 'Web search',
};

async function signIn(page: Page, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('about:blank');
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="password"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

type Applicant = typeof CO;

/** Walk the PUBLIC form as an anonymous visitor and submit it; returns the new application's id. */
async function applyAtPublicForm(page: Page, context: BrowserContext, who: Applicant): Promise<string> {
  await context.clearCookies();
  await page.goto('/apply', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.fill('input[name="contactName"]', who.contact);
  await page.fill('input[name="contactEmail"]', who.email);
  await page.fill('input[name="contactTitle"]', who.title);
  await page.fill('input[name="companyName"]', who.company);
  const st = page.locator('input[name="companyState"]'); if (await st.count()) await st.fill(who.state);
  const sam = page.locator('input[name="samRegistered"][value="yes"]'); if (await sam.count()) await sam.first().check();
  await page.fill('textarea[name="techSummary"]', who.tech);
  await page.fill('textarea[name="motivation"]', who.motivation);
  await page.fill('input[name="referralSource"]', who.referral);
  for (const g of ['techAreas', 'targetPrograms', 'targetAgencies', 'desiredOutcomes']) {
    const b = page.locator(`input[type="checkbox"][name="${g}"]`);
    if (await b.count()) await b.first().check();
  }
  const req = page.locator('input[type="checkbox"][required]');
  for (let i = 0; i < await req.count(); i++) {
    const x = req.nth(i); if (!(await x.isChecked())) await x.check().catch(() => {});
  }
  // The terms gate: scroll-to-accept plus a signature that must equal the contact email exactly.
  const openTerms = page.getByRole('button', { name: /terms|conditions|read/i }).first();
  if (await openTerms.count()) { await openTerms.click().catch(() => {}); await page.waitForTimeout(400); }
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('div,section'))) {
      if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight;
    }
  }).catch(() => {});
  await page.waitForTimeout(300);
  const sig = page.locator('input[type="email"]').last();
  if (await sig.count()) await sig.fill(who.email).catch(() => {});
  const agree = page.getByRole('button', { name: /agree|accept|confirm/i }).first();
  if (await agree.count()) await agree.click().catch(() => {});
  await page.waitForTimeout(400);
  const submitted = page.waitForResponse(
    (r) => r.url().includes('/api/applications') && r.request().method() === 'POST', { timeout: 45_000 });
  await page.click('button[type="submit"]');
  expect((await submitted).status(), `${who.company} submitted`).toBeLessThan(300);

  const [appId] = q(`SELECT id FROM applications WHERE contact_email = '${who.email}'`);
  expect(appId, 'the application was stored').toBeTruthy();
  return appId;
}

/** Open one application in the operator's queue and write the review note the buttons gate on. */
async function openInQueue(page: Page, company: string, note: string) {
  await page.goto('/admin/applications', { waitUntil: 'networkidle', timeout: 60_000 });
  const row = page.getByRole('button').filter({ hasText: company }).first();
  await expect(row, `${company} is in the operator queue`).toHaveCount(1);
  await row.click();
  await page.locator('textarea').last().fill(note);
}

test('B51 · one application → one ToDo → accepting it drains the ToDo', async ({ page, context }) => {
  test.setTimeout(300_000);

  // ── 1. Apply as an anonymous visitor, through the form a real applicant fills in. ──────────
  const appId = await applyAtPublicForm(page, context, CO);

  // ── 2. Half (a): exactly ONE ToDo, typed and entity-linked. ────────────────────────────────
  // The automation rule's copy fires off the same capture:application.submitted event, so give
  // the consumer a moment before counting — otherwise a duplicate that arrives late reads as absent.
  await page.waitForTimeout(4_000);
  const linked = q(`SELECT task_type || ' | ' || status || ' | ' || title
                    FROM tasks WHERE entity_type='application' AND entity_id='${appId}'::uuid`);
  expect(linked, 'exactly one ToDo, linked to the application').toHaveLength(1);
  expect(linked[0]).toContain('application_triage');
  expect(linked[0]).toContain('open');
  expect(linked[0]).toContain(CO.company);

  const orphan = q(`SELECT count(*)::int FROM tasks
                    WHERE entity_id IS NULL AND status IN ('open','in_progress')
                      AND title LIKE 'Review application from %'`);
  expect(Number(orphan[0]), 'no untyped, entity-less duplicate (mig 204 retired the rule)').toBe(0);

  // ── 3. The operator decides it, on the screen they actually use. ───────────────────────────
  await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
  await openInQueue(page, CO.company,
    'Flight-test data on a real airframe part and a named Ohio referral. The gap they describe is '
    + 'proposal throughput, not technology maturity, which is exactly what the portal addresses. Accept.');
  const accepted = page.waitForResponse(
    (r) => /\/accept/.test(r.url()) && r.request().method() === 'POST', { timeout: 180_000 });
  await page.getByRole('button', { name: /^Accept$/ }).first().click();
  expect((await accepted).status()).toBeLessThan(300);

  // ── 4. Half (b): the answered question is closed, and says how it was answered. ────────────
  const after = q(`SELECT status || ' | ' || COALESCE(result->>'decision','-') || ' | closer=' ||
                          COALESCE(completed_by::text,'-')
                   FROM tasks WHERE entity_type='application' AND entity_id='${appId}'::uuid`);
  expect(after, 'still exactly one row — closed, not deleted').toHaveLength(1);
  expect(after[0]).toContain('completed');
  expect(after[0]).toContain('accepted');
  expect(after[0]).not.toContain('closer=-');

  // The queue is the thing the operator reads, so assert on the queue itself: nothing about this
  // application is still asking for attention.
  const stillOpen = q(`SELECT count(*)::int FROM tasks
                       WHERE entity_type='application' AND entity_id='${appId}'::uuid
                         AND status IN ('open','in_progress')`);
  expect(Number(stillOpen[0]), 'the admin queue drained').toBe(0);
});

/**
 * Rejecting is the same decision, and it must drain the same way.
 *
 * The two routes are separate files, so "accept closes its ToDos" is not a statement about reject.
 * A queue that drains on yes and not on no still fills up — just more slowly, and only with the
 * applications nobody wanted, which is the worst possible thing to leave in an operator's inbox.
 */
test('B51 · rejecting an application drains its ToDo too', async ({ page, context }) => {
  test.setTimeout(300_000);

  const appId = await applyAtPublicForm(page, context, NO);
  await page.waitForTimeout(4_000);

  const before = q(`SELECT status FROM tasks
                    WHERE entity_type='application' AND entity_id='${appId}'::uuid`);
  expect(before, 'one open ToDo before the decision').toEqual(['open']);

  await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
  await openInQueue(page, NO.company,
    'Reseller of commercial off-the-shelf hardware with no R&D of its own, and the stated goal is '
    + 'introductions rather than proposals. Outside the SBIR/STTR eligibility this cohort is for.');
  const rejected = page.waitForResponse(
    (r) => /\/reject/.test(r.url()) && r.request().method() === 'POST', { timeout: 180_000 });
  await page.getByRole('button', { name: /^(Reject|Decline)$/ }).first().click();
  // The screen may put a confirm in the way; take it if it is there.
  const confirm = page.getByRole('button', { name: /^(Confirm|Yes|Reject)$/ }).last();
  if (await confirm.count()) await confirm.click().catch(() => {});
  expect((await rejected).status()).toBeLessThan(300);

  const after = q(`SELECT status || ' | ' || COALESCE(result->>'decision','-')
                   FROM tasks WHERE entity_type='application' AND entity_id='${appId}'::uuid`);
  expect(after, 'still exactly one row').toHaveLength(1);
  expect(after[0]).toContain('completed');
  expect(after[0]).toContain('rejected');
});
