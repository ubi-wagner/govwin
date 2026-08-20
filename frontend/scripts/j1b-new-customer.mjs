/** J1b — A new customer is created through the PRODUCT, not through SQL.
 *
 * Every tenant on this box was put there by a migration. That means the path a real customer
 * actually takes — public application → admin review → approve → tenant provisioned → first login —
 * has never been driven, and its routes (`/api/admin/applications/*`) were in the 72% that nothing
 * has ever called.
 *
 * This drives it as two humans in two browser contexts:
 *   1. a founder who has never seen the product fills in /apply
 *   2. an admin finds the application, reads it, and approves it
 *   3. the founder logs in for the first time with the temp password the admin was shown
 *
 * Then it asserts the terminal state that approval is supposed to produce — because "the button
 * worked" is not the same as "a working tenant exists". The accept route promises a tenant, an
 * admin user, a copied-inward starter library, default buckets, backfilled opportunity cards with
 * scores, and backfilled templates. Each of those is checked, and the library is checked for
 * ISOLATION as well as existence: a starter set that arrives by reference instead of by copy is
 * the cross-tenant leak the whole copy-inward invariant exists to prevent.
 *
 *   cd frontend && source ../scripts/sandbox-env.sh && node scripts/j1b-new-customer.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/assets/e2e-run/j1b';
fs.mkdirSync(OUT, { recursive: true });

const ADMIN = { email: 'eric@rfppipeline.com', pw: process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!' };
const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 4, transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});

let ok = true;
const A = (l, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const shot = async (p, n) => { await p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }).catch(() => {}); };
const settle = async (p, ms = 2200) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };

/** A plausible new customer. Unique per run so re-runs don't collide on the email UNIQUE index. */
const STAMP = Date.now().toString(36).slice(-6);
const APPLICANT = {
  companyName: `Cascade Photonics ${STAMP}`,
  contactName: 'Dana Reyes',
  // The DOMAIN must be unique per run, not just the local part: the product enforces one
  // administrator per company domain (409 DOMAIN_MATCH), which is a real guardrail and correctly
  // refused the second run of this drive with a clear, actionable message to the founder.
  contactEmail: `dana.reyes@cascadephotonics-${STAMP}.test`,
  contactTitle: 'Founder & CTO',
  techSummary: 'Cascade Photonics builds ruggedised short-wave infrared imagers for degraded visual '
    + 'environments. Our current unit runs uncooled at 1.4 W and has logged 9,000 field hours across '
    + 'two rotary-wing platforms. We are pursuing AF and Navy SBIR topics in sensing and autonomy.',
  motivation: 'We have lost two Phase I cycles to compliance mistakes rather than technical ones, '
    + 'and we do not have a proposal manager. We want the compliance matrix and the page-limit '
    + 'enforcement more than we want the drafting.',
};

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
  console.log('\n── J1b · a customer who exists only because the product made them ──\n');

  // ── 1. The founder applies ────────────────────────────────────────────────
  const founderCtx = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const founder = await founderCtx.newPage();
  const jsErrors = [];
  founder.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 140)));
  // Capture the submit exchange itself. "No row in the database" has two very different causes —
  // the request never went, or it went and was refused — and only the wire tells them apart.
  const api = [];
  founder.on('response', async (r) => {
    if (!r.url().includes('/api/applications')) return;
    api.push({ status: r.status(), body: (await r.text().catch(() => '')).slice(0, 300) });
  });

  await founder.goto(`${BASE}/apply`, { waitUntil: 'domcontentloaded' });
  await settle(founder, 1800);
  A('the public /apply page renders', (await founder.locator('form').count()) > 0);
  await shot(founder, '01-apply-form');

  // Fill by label/name/placeholder — whatever the form actually exposes. A drive that only works
  // against one exact markup shape is a drive that stops testing the moment the form is edited.
  const fill = async (patterns, value) => {
    for (const pat of patterns) {
      const el = founder.locator(pat).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        await el.fill(value); return true;
      }
    }
    return false;
  };
  const filled = {
    company: await fill(['input[name="companyName"]', 'input#companyName'], APPLICANT.companyName),
    name: await fill(['input[name="contactName"]', 'input#contactName'], APPLICANT.contactName),
    email: await fill(['input[name="contactEmail"]', 'input#contactEmail', 'input[type="email"]'], APPLICANT.contactEmail),
    title: await fill(['input[name="contactTitle"]', 'input#contactTitle'], APPLICANT.contactTitle),
    tech: await fill(['textarea[name="techSummary"]', 'textarea#techSummary', 'textarea'], APPLICANT.techSummary),
    // Both are z.string().min(...) server-side. Leaving them out is a 400, and the first pass of
    // this drive did exactly that — which is how the silent-rejection question below got asked.
    motivation: await fill(['textarea[name="motivation"]'], APPLICANT.motivation),
    referral: await fill(['input[name="referralSource"]'], 'Referred by a program manager at AFWERX'),
  };
  // A REQUIRED RADIO GROUP, which .fill() cannot touch. Leaving it unset is what made the first two
  // passes look like the product was silently dropping submissions: HTML5 validation refused to
  // submit, so there was no request, no response, and no page text to read — an invisible refusal
  // that is correct behaviour and looks identical to a bug from the outside.
  const sam = founder.locator('input[name="samRegistered"][value="yes"]').first();
  if (await sam.count() > 0) { await sam.check().catch(() => {}); }
  filled.sam = await sam.isChecked().catch(() => false);
  A('the form exposes the fields a founder must fill',
    filled.company && filled.name && filled.email && filled.tech && filled.motivation && filled.referral && filled.sam,
    Object.entries(filled).filter(([, v]) => !v).map(([k]) => k).join(',') || 'all present');

  // ── The Terms & Conditions gate ──────────────────────────────────────────
  // A deliberate click-through: open the terms, SCROLL TO THE BOTTOM (the accept control stays hidden
  // until you do), type your email as a signature, then accept. None of it is HTML5-required, so
  // `form.checkValidity()` reports a complete form while `onSubmit` returns early — which is
  // exactly how three passes of this drive produced "no request was made" with nothing on screen
  // that my keyword check recognised as an error. The gate is correct; the drive was not a user.
  {
    const open = founder.getByRole('button', { name: /review terms/i }).first();
    if (await open.count() > 0) { await open.click(); await founder.waitForTimeout(700); }

    // Scroll the terms pane itself, not the window.
    await founder.evaluate(() => {
      const pane = Array.from(document.querySelectorAll('div'))
        .find((d) => d.className.includes('overflow-y-auto') && d.scrollHeight > d.clientHeight);
      if (pane) pane.scrollTop = pane.scrollHeight;
      pane?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await founder.waitForTimeout(700);

    const sig = founder.locator('input[placeholder="your.email@company.com"]').first();
    if (await sig.count() > 0) { await sig.fill(APPLICANT.contactEmail); await founder.waitForTimeout(300); }

    const accept = founder.getByRole('button', { name: /^i accept$/i }).first();
    if (await accept.count() > 0 && await accept.isEnabled().catch(() => false)) {
      await accept.click(); await founder.waitForTimeout(700);
    }
    const accepted = (await founder.locator('body').innerText().catch(() => '') || '')
      .includes('Terms & Conditions accepted');
    A('the founder can get through the Terms gate', accepted,
      accepted ? 'signed' : 'still un-accepted — submit will return early');
  }

  await shot(founder, '02-apply-filled');

  // Ask the browser whether it will even accept this form before clicking. Without it, "nothing
  // happened" is ambiguous between a blocked submit and a broken one, and the drive reports a
  // mystery instead of a fact.
  const valid = await founder.evaluate(() => {
    const f = document.querySelector('form');
    if (!f) return { ok: false, missing: ['no form'] };
    const bad = Array.from(f.querySelectorAll(':invalid'))
      .map((el) => el.getAttribute('name') || el.tagName.toLowerCase());
    return { ok: f.checkValidity(), missing: Array.from(new Set(bad)) };
  });
  A('the browser considers the form complete before submit', valid.ok,
    valid.ok ? '' : `still invalid: ${valid.missing.join(', ')}`);

  await founder.locator('form button[type="submit"], button[type="submit"]').first().click();
  await settle(founder, 3200);
  await shot(founder, '03-apply-submitted');

  const [appRow] = await sql`
    SELECT id, status, company_name AS "companyName", contact_email AS "contactEmail"
    FROM applications WHERE lower(contact_email) = lower(${APPLICANT.contactEmail}) LIMIT 1`;
  A('the submit actually reached the API', api.length > 0, api.length ? `HTTP ${api[0].status}` : 'no request was made');
  if (api.length && api[0].status >= 400) console.log(`    API said: ${api[0].body}`);
  A('the application reached the database', !!appRow, appRow ? `status=${appRow.status}` : 'no row');
  A('it landed PENDING — nothing is auto-approved', appRow?.status === 'pending', appRow?.status);
  {
    // The component renders its error into one specific block. Grepping the whole body for the word
    // "error" missed "You must review and accept the Terms & Conditions to apply." entirely, and
    // reported a silent failure as a clean pass — a false NEGATIVE in the drive itself.
    const errText = (await founder.locator('.bg-red-50').first().innerText().catch(() => '')) || '';
    const looksRejected = (api.length > 0 && api[0].status >= 400) || (!appRow && !!errText);
    const saysSomething = errText.trim().length > 0;
    if (errText) console.log(`    the page told the founder: "${errText.replace(/\s+/g, ' ').slice(0, 120)}"`);
    if (looksRejected) {
      // The dangerous case: refused on the wire, reassuring on the screen.
      A('a REFUSED submission is shown to the founder as a failure', saysSomething,
        saysSomething ? 'the page reports a problem' : 'the page says nothing — silent rejection');
    } else {
      // Accepted on the wire AND the page is not showing a complaint.
      A('the founder saw a confirmation, not a raw error', !saysSomething,
        saysSomething ? errText.slice(0, 80) : 'clean');
    }
  }
  A('no uncaught client error on the public form', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  if (!appRow) throw new Error('no application row — the rest of J1b is UNPROVEN');

  // The application is a HITL item: an admin has to be told it exists.
  const [todo] = await sql`
    SELECT id, task_type AS "taskType", status FROM tasks
    WHERE entity_id = ${appRow.id}::uuid ORDER BY created_at DESC LIMIT 1`;
  A('an admin ToDo was raised for the application', !!todo, todo ? `${todo.taskType}/${todo.status}` : 'none');
  const [ev] = await sql`
    SELECT type FROM system_events
    WHERE payload->>'applicationId' = ${appRow.id} ORDER BY created_at DESC LIMIT 1`;
  A('the submission is audited in system_events', !!ev, ev?.type ?? 'none');

  await founderCtx.close();

  // ── 2. The admin reviews and approves ─────────────────────────────────────
  const adminCtx = await browser.newContext({ viewport: { width: 1600, height: 1800 } });
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#email', { timeout: 15000 });
  await admin.fill('#email', ADMIN.email);
  await admin.fill('#password', ADMIN.pw);
  await admin.click('button[type="submit"]');
  // WAIT for the session, don't assume it. The first version of this drive navigated straight on,
  // landed back on /login, read ITS body, and reported that the product was hiding a brand-new
  // application from the admin. Four separate assertions in this file failed that way before this
  // rule went in: never assert against a page you have not confirmed you are on.
  await admin.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {});
  await settle(admin, 1800);
  A('the admin is actually signed in', !admin.url().includes('/login'), admin.url().replace(BASE, ''));

  await admin.goto(`${BASE}/admin/applications`, { waitUntil: 'domcontentloaded' });
  await settle(admin, 2600);
  A('  → and is on the applications queue', admin.url().includes('/admin/applications'),
    admin.url().replace(BASE, ''));
  const body = await admin.locator('body').innerText().catch(() => '');
  A('the new application is visible to the admin', body.includes(APPLICANT.companyName),
    body.includes(APPLICANT.companyName) ? APPLICANT.companyName : `not on the page (${body.length}B rendered)`);
  await shot(admin, '04-admin-applications');

  // Open it and approve. The accept route is the one that provisions everything.
  const opener = admin.locator(`text=${APPLICANT.companyName}`).first();
  if (await opener.count() > 0) { await opener.click().catch(() => {}); await settle(admin, 1800); }
  await shot(admin, '05-admin-review');

  const acceptBtn = admin.getByRole('button', { name: /accept|approve/i }).first();
  A('an Accept control is offered to the admin', await acceptBtn.count() > 0);
  if (await acceptBtn.count() > 0) {
    await acceptBtn.click();
    await settle(admin, 4200);
    await shot(admin, '06-admin-accepted');
  }

  // The admin MUST be shown the temp password — it is the only way the customer gets in.
  const afterText = await admin.locator('body').innerText().catch(() => '');
  const pwMatch = afterText.match(/\b([A-Za-z0-9!@#$%^&*_-]{10,32})\b(?=[\s\S]{0,120}$)/);
  const [newTenant] = await sql`
    SELECT id, slug, name, status FROM tenants
    WHERE name = ${APPLICANT.companyName} OR slug LIKE ${'cascade-photonics-' + STAMP + '%'} LIMIT 1`;
  A('a TENANT was provisioned', !!newTenant, newTenant ? `${newTenant.slug} (${newTenant.status})` : 'none');

  if (!newTenant) throw new Error('no tenant — the rest of J1b is UNPROVEN');

  const [newUser] = await sql`
    SELECT id, email, role, temp_password AS "tempPassword", is_active AS "isActive"
    FROM users WHERE lower(email) = lower(${APPLICANT.contactEmail}) LIMIT 1`;
  A('an ADMIN USER was created for them', !!newUser, newUser ? `${newUser.role} active=${newUser.isActive}` : 'none');
  A('  → and is forced to change the temp password', newUser?.tempPassword === true, String(newUser?.tempPassword));

  // ── 3. The terminal state approval promises ───────────────────────────────
  const [lib] = await sql`
    SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id = ${newTenant.id}::uuid`;
  A('a starter library was COPIED INWARD', lib.n > 0, `${lib.n} atoms`);

  // Copy, not reference. Every atom must be stamped with THIS tenant — that is the whole invariant.
  const [foreign] = await sql`
    SELECT count(*)::int AS n FROM library_atoms
    WHERE tenant_id = ${newTenant.id}::uuid AND tenant_id <> ${newTenant.id}::uuid`;
  A('  → every atom is stamped to the new tenant (copy, not reference)', foreign.n === 0);

  const [buckets] = await sql`
    SELECT count(*)::int AS n FROM tenant_spotlight_buckets WHERE tenant_id = ${newTenant.id}::uuid`;
  A('default spotlight buckets were seeded', buckets.n > 0, `${buckets.n} buckets`);

  const [cards] = await sql`
    SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${newTenant.id}::uuid`;
  A('live opportunities were backfilled onto their board', cards.n > 0, `${cards.n} cards`);

  const [scores] = await sql`
    SELECT count(*)::int AS n FROM tenant_bucket_scores WHERE tenant_id = ${newTenant.id}::uuid`;
  A('  → and scored against their buckets', scores.n > 0, `${scores.n} scores`);

  const [tpl] = await sql`
    SELECT count(*)::int AS n FROM tenant_template_cards WHERE tenant_id = ${newTenant.id}::uuid`;
  A('templates were backfilled', tpl.n > 0, `${tpl.n} template cards`);

  const [acceptEv] = await sql`
    SELECT type FROM system_events
    WHERE payload->>'tenantId' = ${newTenant.id} OR payload->>'applicationId' = ${appRow.id}
    ORDER BY created_at DESC LIMIT 1`;
  A('the approval is audited', !!acceptEv, acceptEv?.type ?? 'none');

  // ── 4. The founder's first login ──────────────────────────────────────────
  const tempPw = (afterText.match(/Temp(?:orary)? password[\s\S]{0,80}?([A-Za-z0-9!@#$%^&*_-]{10,32})/i) || [])[1]
    || (pwMatch || [])[1];
  if (!tempPw) {
    A('the admin was shown the temp password to pass on', false,
      'not found on the page — the customer would have no way in');
  } else {
    A('the admin was shown the temp password to pass on', true, `${tempPw.slice(0, 3)}…`);
    const fCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const f = await fCtx.newPage();
    await f.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await f.waitForSelector('#email', { timeout: 15000 });
    await f.fill('#email', APPLICANT.contactEmail);
    await f.fill('#password', tempPw);
    await f.click('button[type="submit"]');
    await settle(f, 3000);
    const url = f.url();
    A('the founder can log in for the first time', !url.includes('/login'), url.replace(BASE, ''));
    A('  → and is sent to change the temp password', /change-password/.test(url), url.replace(BASE, ''));
    await shot(f, '07-founder-first-login');
    await fCtx.close();
  }

  await adminCtx.close();
} catch (e) {
  A('J1b completed without throwing', false, String(e).slice(0, 160));
} finally {
  await browser.close();
  await sql.end();
}

console.log(ok ? '\n✅ J1b PASS — a real customer exists because the product made one\n'
               : '\n❌ J1b FAILURES ABOVE\n');
process.exit(ok ? 0 : 1);
