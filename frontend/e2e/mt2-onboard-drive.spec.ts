/**
 * MT-2 — onboard companies through the OFFICIAL public application form.
 *
 * Not a seed script and not an API call: this fills in the real /apply form as an anonymous
 * visitor would, then signs in as the rfp_admin and accepts from the real queue. That path is
 * what creates the tenant, its admin user, and the starter library, and it is the one a customer
 * actually takes.
 *
 * It also re-checks B49 where it was found: the applicant's NAME must appear in the admin's
 * triage ToDo. That bug rendered "Review application from " for every applicant.
 *
 * Run: npx playwright test --project=drive mt2-onboard
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT = process.env.MT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/mt';
const SHOTS = path.join(OUT, 'shots', 'mt2');
const PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';

interface Applicant {
  slug: string; company: string; contact: string; email: string; title: string;
  state: string; tech: string; motivation: string; referral: string;
}

/** Three companies with genuinely different profiles, so the later phases have variety to work with. */
const APPLICANTS: Applicant[] = [
  {
    slug: 'northwind', company: 'Northwind Additive', contact: 'Dana Reyes',
    email: 'dana.reyes@northwind-additive.com', title: 'CEO', state: 'Ohio',
    tech: 'We print structural concrete forms on site using a mobile gantry, cutting formwork cost '
      + 'and schedule on expeditionary and disaster-recovery builds. Our binder chemistry cures in '
      + 'under four hours at field temperatures. We hold two issued patents on the nozzle geometry.',
    motivation: 'The Navy 26.1 topic on additive construction for expeditionary basing is a direct '
      + 'fit and closes in November.',
    referral: 'Referral from our university tech-transfer office',
  },
  {
    slug: 'kestrel', company: 'Kestrel Robotics', contact: 'Amara Okafor',
    email: 'amara@kestrelrobotics.io', title: 'CTO', state: 'Pennsylvania',
    tech: 'We build autonomous survey robots for active construction sites — SLAM navigation that '
      + 'holds up in dust and changing geometry, feeding as-built models back to the BIM. Deployed '
      + 'on eleven commercial sites to date.',
    motivation: 'We want to convert commercial traction into an NSF STTR with a university partner.',
    referral: 'LinkedIn',
  },
  {
    slug: 'calcite', company: 'Calcite Materials', contact: 'Rafael Duarte',
    email: 'rafael.duarte@calcitematerials.com', title: 'Founder', state: 'Michigan',
    tech: 'Our supplementary cementitious material replaces up to 40 percent of Portland clinker '
      + 'using carbonated steel slag, cutting embodied carbon without a strength penalty at 28 days. '
      + 'We operate a pilot line at two tonnes per day.',
    motivation: 'DOE has an open Phase II topic on low-carbon cement and we have Phase I results to '
      + 'build on.',
    referral: 'Search',
  },
];

async function apply(page: Page, a: Applicant) {
  await page.goto('/apply', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.fill('input[name="contactName"]', a.contact);
  await page.fill('input[name="contactEmail"]', a.email);
  await page.fill('input[name="contactTitle"]', a.title);
  await page.fill('input[name="companyName"]', a.company);
  const st = page.locator('input[name="companyState"]');
  if (await st.count()) await st.fill(a.state);
  // SAM registration is a required radio group.
  const sam = page.locator('input[name="samRegistered"][value="yes"]');
  if (await sam.count()) await sam.first().check();
  await page.fill('textarea[name="techSummary"]', a.tech);
  await page.fill('textarea[name="motivation"]', a.motivation);
  await page.fill('input[name="referralSource"]', a.referral);

  // Tick one box in each multi-select group so the arrays are not empty.
  for (const group of ['techAreas', 'targetPrograms', 'targetAgencies', 'desiredOutcomes']) {
    const boxes = page.locator(`input[type="checkbox"][name="${group}"]`);
    if (await boxes.count()) await boxes.first().check();
  }
  // Any remaining required checkbox (terms) — tick whatever is still unchecked and required.
  const required = page.locator('input[type="checkbox"][required]');
  for (let i = 0; i < await required.count(); i++) {
    const b = required.nth(i);
    if (!(await b.isChecked())) await b.check().catch(() => {});
  }
}

test('three companies apply publicly, and an admin accepts them from the real queue', async ({ page, context }) => {
  test.setTimeout(20 * 60_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── 1. Anonymous applications through the public form ──
  const submitted: Applicant[] = [];
  for (const a of APPLICANTS) {
    await context.clearCookies();
    await apply(page, a);
    await page.screenshot({ path: `${SHOTS}/${a.slug}-1-form.png`, fullPage: true });

    const resp = page.waitForResponse((r) => r.url().includes('/api/applications') && r.request().method() === 'POST', { timeout: 60_000 });
    await page.click('button[type="submit"]');
    const r = await resp;
    const body = await r.json().catch(() => ({}));
    console.error(`[apply] ${a.company} → ${r.status()} ${JSON.stringify(body).slice(0, 160)}`);
    expect(r.status(), `${a.company} application rejected`).toBeLessThan(300);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/${a.slug}-2-submitted.png`, fullPage: true });
    submitted.push(a);
  }
  expect(submitted.length).toBe(APPLICANTS.length);

  // ── 2. The admin works the real queue ──
  await context.clearCookies();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'eric@rfppipeline.com');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  await page.goto('/admin/applications', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/admin-1-queue.png`, fullPage: true });
  for (const a of APPLICANTS) {
    await expect(page.getByText(a.company).first(), `${a.company} missing from the queue`).toBeVisible({ timeout: 15_000 });
  }

  // B49 regression, checked where it was found: the applicant's NAME must be in the triage ToDo.
  await page.goto('/admin/dashboard', { waitUntil: 'networkidle', timeout: 60_000 });
  const body = (await page.textContent('body')) ?? '';
  expect(body, 'B49 regression — a ToDo title with no applicant name')
    .not.toMatch(/Review application from\s*(?:$|[^A-Za-z])/m);
  for (const a of APPLICANTS) {
    expect(body, `${a.company} not named in any admin ToDo`).toContain(a.company);
  }
  await page.screenshot({ path: `${SHOTS}/admin-2-todos-named.png`, fullPage: true });

  // ── 3. The admin ACCEPTS each one, which is what creates the tenant ──
  // The Accept button is gated on at least 10 characters of review notes: a real HITL gate, so
  // the drive has to write a real assessment rather than click through.
  await page.goto('/admin/applications', { waitUntil: 'networkidle', timeout: 60_000 });
  // The accept response carries the generated temp password. Capturing it is what lets MT-3 sign
  // in as these admins the way a real new customer does — through the forced password reset — and
  // it is the only place that value is ever visible.
  const accepted: Array<{ company: string; slug: string; adminEmail: string; tempPassword: string }> = [];
  for (const a of APPLICANTS) {
    const row = page.getByRole('button').filter({ hasText: a.company }).first();
    await expect(row, `${a.company} row not found`).toBeVisible({ timeout: 15_000 });
    await row.click();                                   // expand
    const notes = page.locator('textarea').last();
    await notes.fill(
      `Reviewed ${a.company}. ${a.contact} (${a.title}) — technology is a credible fit for the `
      + `federal programs they name, SAM registration confirmed. Accepting for onboarding.`);
    const acceptResp = page.waitForResponse(
      (r) => /\/api\/admin\/applications\/[0-9a-f-]{36}\/accept/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 90_000 });
    await page.getByRole('button', { name: /^Accept$/ }).first().click();
    const ar = await acceptResp;
    const ab = await ar.json().catch(() => ({}));
    console.error(`[accept] ${a.company} → ${ar.status()} ${JSON.stringify(ab).slice(0, 220)}`);
    expect(ar.status(), `${a.company} accept failed`).toBeLessThan(300);
    const d = (ab as { data?: Record<string, string> }).data ?? {};
    accepted.push({
      company: a.company,
      slug: d.slug ?? d.tenantSlug ?? '',
      adminEmail: d.adminEmail ?? d.email ?? a.email,
      tempPassword: d.tempPassword ?? '',
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${a.slug}-3-accepted.png`, fullPage: true });
  }
  expect(accepted.length).toBe(APPLICANTS.length);

  fs.writeFileSync(path.join(OUT, 'mt2-applicants.json'),
    JSON.stringify(APPLICANTS.map((a) => ({ ...a, ...accepted.find((x) => x.company === a.company) })), null, 2));
  console.error(`\n✓ ${APPLICANTS.length} applied publicly, each named in its ToDo, all accepted into tenants`);
  for (const x of accepted) {
    console.error(`   ${x.company} → slug=${x.slug || '(not reported)'} admin=${x.adminEmail} temp=${x.tempPassword ? 'yes' : 'NOT RETURNED'}`);
  }
});
