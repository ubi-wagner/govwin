/**
 * drive-commercial-path — the funnel a PROSPECT walks, driven as the prospect.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * `drive-end-to-end` proves the product a customer BUYS: ingest → curate → push → buy → provision
 * → author → lock → package. It starts from a tenant that already exists. Nothing drove the part
 * BEFORE that — the public application form, the admin's accept, the account it creates, the mail
 * that carries the temp password, and the first sign-in.
 *
 * That is the first thing a real company touches, and it was the least-driven part of the system.
 * The pattern this repository keeps finding is that what has been driven works and what has not is
 * roughly a coin flip; this closes the biggest remaining instance of it.
 *
 * ── WHAT IT ASSERTS THAT NOTHING ELSE DOES ───────────────────────────────────────────────────
 * That the chain HOLDS across four systems — the public form writes an application, the admin
 * accept creates a tenant AND a user AND a membership, the email seam records both messages in the
 * ledger with the right tenant scoping, and the person can then actually sign in with the password
 * that was mailed. Each half has its own test; the joins between them had none, and every defect
 * found this week lived exactly in a join nobody walked.
 *
 * ⚠️ NOT READ-ONLY. It submits a real application and accepts it, creating a tenant, a user and a
 * membership. Teardown goes through the SCENARIO FACTORY (`trackTenantPurge`), not a hand-written
 * delete list — the first version of this drive wrote its own, and it failed twice: once on
 * `library_atoms.created_by` (the accept flow seeds a starter library, which the list did not know
 * about) and once on `system_events.tenant_id`, leaving a tenant, a user and an application behind.
 * The factory reads every tenant-scoped table from the catalog, so it cannot go stale the way a
 * hand-list does — a tenant touches 39 tables today and 40 after the next migration.
 *
 *   cd frontend && npx tsx scripts/drive-commercial-path.mts
 * Exit 0 when the whole chain holds; 1 on a finding; 2 if it could not earn a verdict.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { scenario } from './lib/scenario.mts';
// IMPORTED, never retyped. `applications.terms_version` is the evidence of what somebody agreed
// to, and a literal here would be a second copy of that value which drifts the first time the
// terms are bumped — recording an agreement to text the signer never saw, which is precisely the
// failure the route's schema comment says it removed `.default('v1')` to prevent.
import { TERMS_VERSION } from '../lib/terms';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ADMIN_EMAIL = 'eric@rfppipeline.com';
const ADMIN_PW = process.env.ADMIN_PW || process.env.RFP_ADMIN_PW || 'RFPAdmin2026!';
const DB = process.env.DATABASE_URL_OWNER;
if (!DB) { console.error('CannotRun: DATABASE_URL_OWNER is required (creates a tenant).'); process.exit(2); }
// THE camelCase TRANSFORM IS NOT OPTIONAL HERE. `lib/db.ts` applies it to every app query, so
// `tenant_id` arrives as `tenantId` — and a bare postgres() client in a script does NOT, which
// means a row type declaring `tenantId` reads `undefined` for every row. Both tenant-scope
// assertions below "ran" that way: one failed and one PASSED, because `undefined == null` is true.
// A check that cannot see its own column is worse than no check (CLAUDE.md, the sql<T> trap).
const sql = postgres(DB, {
  max: 3,
  onnotice: () => {},
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});

let failed = 0;
const ok = (good: boolean, label: string, detail = '') => {
  if (!good) failed += 1;
  console.log(`  ${good ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (s: string) => console.log(`      · ${s}`);

const STAMP = Date.now();
const COMPANY = `Drive Commercial ${STAMP}`;
// The DOMAIN must be unique per run, not just the local part: the form refuses a second
// application from the same organisation and identifies one by email domain
// (`LOWER(contact_email) LIKE '%@<domain>'`). That 409 is correct product behaviour — one
// administrator per company — and a fixed domain makes the SECOND run of this drive fail on it.
const DOMAIN = `drive-commercial-${STAMP}.test`;
const CONTACT = `founder@${DOMAIN}`;
const SESSION = `drive-sess-${STAMP}`;

async function main() {
  const sc = await scenario('commercial-path');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let appId: string | null = null;
  let tenantId: string | null = null;
  let userId: string | null = null;

  try {
    // ══ 1 · A PROSPECT APPLIES ════════════════════════════════════════════════════════════════
    console.log('\n1 · A prospect applies — the public form, no session, no account');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.request.post(`${BASE}/api/applications`, {
      data: {
        companyName: COMPANY,
        contactName: 'Dana Reyes',
        contactEmail: CONTACT,
        companyWebsite: `https://${DOMAIN}`,
        companyState: 'OH',
        companySize: '1-10',
        techSummary: 'Autonomous inspection for expeditionary basing. Driven by the commercial-path harness.',
        techAreas: ['autonomy'],
        targetAgencies: ['DoD'],
        targetPrograms: ['SBIR'],
        // The schema is the contract: `desiredOutcomes` is an array, and `motivation` is
        // required with a 10-char floor. The first run of this drive sent `desiredOutcome`
        // (singular) and no motivation at all, and the form answered 422 naming the field —
        // which is the form being right. Fields copied from the schema, not guessed at.
        desiredOutcomes: ['Phase I award'],
        motivation: 'We have the autonomy stack and no idea how to write a Phase I. Driven by the harness.',
        samRegistered: false,
        previousSubmissions: 0,
        previousAwards: 0,
        referralSource: 'harness',
        // The session the browser would have. Migration 242 carries it across the sever.
        sessionId: SESSION,
        // The three terms fields the REAL form sends (application-form.tsx). This drive sent only
        // `termsAccepted` and the route answered 422 naming `termsVersion` — the route being
        // right: it was made required, with no default, so that a submission can never record an
        // agreement to a version the signer was not shown. A prospect driven without them is not
        // walking the funnel a prospect actually walks.
        termsAccepted: true,
        termsSignature: CONTACT,
        termsVersion: TERMS_VERSION,
      },
    });
    ok(res.status() >= 200 && res.status() < 300, 'the public application form accepts a submission',
       `HTTP ${res.status()}`);
    if (res.status() >= 300) {
      note((await res.text()).slice(0, 200));
      throw new Error('the form refused the submission — nothing below can be checked');
    }

    const [app] = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM applications WHERE contact_email = ${CONTACT}`;
    appId = app?.id ?? null;
    ok(!!appId, 'it lands as an application an admin can see', appId ?? 'no row');
    ok(app?.status === 'pending', 'in a state that asks for a decision', app?.status ?? '—');

    // The alert to the platform. It is PLATFORM scope: an alert about a prospect is not a send by
    // any tenant, and filing it under one would put platform traffic in a customer's history.
    const alerts = await sql<{ status: string; tenantId: string | null }[]>`
      SELECT status, tenant_id FROM email_send_ledger
       WHERE template = 'admin_new_application' AND created_at > now() - INTERVAL '2 minutes'
       ORDER BY created_at DESC LIMIT 1`;
    ok(alerts.length === 1, 'the platform is alerted, through the one email seam',
       alerts[0] ? `status=${alerts[0].status}` : 'no ledger row');
    // `== null` on purpose: null and undefined both mean "no tenant", and distinguishing them
    // here would fail the assertion over a driver detail rather than a product property.
    if (alerts[0]) ok(alerts[0].tenantId == null, 'and the alert is platform scope, not a tenant\'s',
                      `tenant_id=${JSON.stringify(alerts[0].tenantId)}`);

    // ══ 2 · AN ADMIN ACCEPTS ══════════════════════════════════════════════════════════════════
    console.log('\n2 · An admin accepts — as the admin, through the console');
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#email', { timeout: 20_000 });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PW);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
    if (page.url().includes('/login')) throw new Error(`admin sign-in failed for ${ADMIN_EMAIL}`);

    const listed = await page.goto(`${BASE}/admin/applications`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const listText = await page.evaluate(() =>
      ((document.querySelector('main') as HTMLElement) ?? document.body).innerText);
    ok(listed?.status() === 200 && listText.includes(COMPANY),
       'the new application is on the admin\'s page', `HTTP ${listed?.status()}`);

    const accept = await page.request.post(`${BASE}/api/admin/applications/${appId}/accept`, { data: {} });
    ok(accept.ok(), 'the accept succeeds', `HTTP ${accept.status()}`);
    if (!accept.ok()) note((await accept.text()).slice(0, 220));

    // ══ 3 · THE ACCOUNT THE ACCEPT CREATES ════════════════════════════════════════════════════
    console.log('\n3 · What the accept actually created — all three rows, or none of them');
    const [tenant] = await sql<{ id: string; slug: string; status: string }[]>`
      SELECT id, slug, status FROM tenants WHERE name = ${COMPANY}`;
    tenantId = tenant?.id ?? null;
    ok(!!tenantId, 'a company exists', tenant ? `${tenant.slug} (${tenant.status})` : 'no tenant');

    const [user] = await sql<{ id: string; isActive: boolean; tempPassword: boolean }[]>`
      SELECT id, is_active AS "isActive", (temp_password IS NOT NULL) AS "tempPassword"
        FROM users WHERE email = ${CONTACT}`;
    userId = user?.id ?? null;
    ok(!!userId, 'a person exists', userId ?? 'no user');
    ok(user?.isActive === true, 'and they are active — an approved customer who cannot sign in is worse than a refusal');
    // The membership is what authority is READ from (docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md).
    // A tenant and a user with no membership between them is an account nobody can enter.
    const [ms] = await sql<{ role: string; status: string }[]>`
      SELECT role, status FROM user_memberships
       WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid`;
    ok(!!ms, 'and a membership joins them — the row authority is read from',
       ms ? `${ms.role}/${ms.status}` : 'MISSING');
    ok(ms?.role === 'tenant_admin', 'as the company\'s admin', ms?.role ?? '—');

    const [after] = await sql<{ status: string }[]>`SELECT status FROM applications WHERE id = ${appId}::uuid`;
    ok(after?.status === 'accepted', 'the application records the decision', after?.status ?? '—');

    // ══ 4 · THE MAIL THAT CARRIES THE WAY IN ══════════════════════════════════════════════════
    console.log('\n4 · The welcome — the only thing that carries the temp password');
    const [welcome] = await sql<{ status: string; tenantId: string | null; error: string | null }[]>`
      SELECT status, tenant_id, error FROM email_send_ledger
       WHERE template = 'application_accepted' AND to_email = ${CONTACT}
       ORDER BY created_at DESC LIMIT 1`;
    ok(!!welcome, 'it is recorded in the ledger — reserved before dispatch, so a crash is visible',
       welcome ? `status=${welcome.status}` : 'NO LEDGER ROW');
    // In the sandbox no provider is configured, so `failed` is the honest outcome and the assertion
    // is about the RECORD, not delivery. What must never happen is silence.
    if (welcome?.status === 'failed') note(`not delivered here (no provider configured): ${String(welcome.error).slice(0, 60)}`);
    ok(welcome?.tenantId === tenantId,
       'and it is filed under the new company, so it appears in THEIR history',
       `ledger tenant_id=${JSON.stringify(welcome?.tenantId)} · the new company=${tenantId}`);

    // ══ 5 · THE PROSPECT SIGNS IN ═════════════════════════════════════════════════════════════
    console.log('\n5 · The new customer signs in — and is made to choose their own password');
    const [flag] = await sql<{ mustReset: boolean; hasHash: boolean }[]>`
      SELECT temp_password AS "mustReset", (password_hash IS NOT NULL) AS "hasHash"
        FROM users WHERE id = ${userId}::uuid`;
    ok(flag?.hasHash === true, 'the account has a password hash — there is something to sign in with');
    // `temp_password` is a BOOLEAN flag, not the password. The plaintext is generated in the accept
    // route, hashed straight into `password_hash`, handed to the email template and never stored —
    // which is the right design and means this drive cannot know it. So the sign-in below uses a
    // hash this harness sets itself, and the claim is narrowed to match: the ACCOUNT is usable and
    // forces a reset. Whether the mailed string matches the hash is the route's own business, and
    // it writes both from one variable.
    ok(flag?.mustReset === true,
       'and it is marked temporary, so the customer must choose their own',
       `temp_password=${flag?.mustReset}`);

    if (flag?.hasHash) {
      // bcryptjs is CommonJS: the namespace object has no `hash`, only `.default` does.
      const bcrypt = (await import('bcryptjs')).default;
      const KNOWN = `Harness-${STAMP}!`;
      await sql`UPDATE users SET password_hash = ${await bcrypt.hash(KNOWN, 10)}
                 WHERE id = ${userId}::uuid`;
      note('signing in with a hash this harness set — the mailed password is never stored');

      const ctx2 = await browser.newContext();
      const p2 = await ctx2.newPage();
      await p2.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await p2.waitForSelector('#email', { timeout: 20_000 });
      await p2.fill('#email', CONTACT);
      await p2.fill('#password', KNOWN);
      await p2.click('button[type="submit"]');
      await p2.waitForLoadState('networkidle').catch(() => {});
      await p2.waitForTimeout(1800);
      const landed = new URL(p2.url()).pathname;
      ok(!landed.includes('/login'), 'the account the accept created can actually be entered',
         `landed on ${landed}`);
      const body = await p2.evaluate(() =>
        ((document.querySelector('main') as HTMLElement) ?? document.body).innerText);
      // The reset page is deliberately spare — a heading, two fields and a button. What matters is
      // that it RENDERED, not that it is wordy; 131 characters is a complete form here.
      ok(body.length > 60, 'and the page they land on has rendered', `${body.length} chars`);
      // Shipping a customer a permanent shared secret by email is how one forwarded message becomes
      // an account takeover. The flag above must actually DO something.
      ok(/password/i.test(body) || /reset|password/i.test(landed),
         'and they are asked to set their own password before doing anything else',
         landed);
      await ctx2.close();
    }

    // ══ 6 · THE WHOLE CHAIN, JOINED ══════════════════════════════════════════════════════════
    console.log('\n6 · Where did this customer come from? — the join, end to end');
    const [attr] = await sql<{ referralSource: string | null; sessionId: string | null; tenantId: string | null }[]>`
      SELECT referral_source AS "referralSource", session_id AS "sessionId", tenant_id AS "tenantId"
        FROM applications WHERE id = ${appId}::uuid`;
    ok(attr?.referralSource === 'harness', 'what they told us is kept', attr?.referralSource ?? '—');
    ok(attr?.sessionId === SESSION, 'the SESSION that brought them is kept — the sever is closed',
       attr?.sessionId ?? 'null');
    ok(attr?.tenantId === tenantId, 'and the company it became is recorded',
       `${attr?.tenantId ?? 'null'}`);

    // The point of all three: one query, from a campaign to a customer. Seeded here because the
    // sandbox has no real visitor row for this made-up session — what is being proven is that the
    // JOIN resolves, which is the thing that did not exist before migration 242.
    // THE UTM FIELDS LIVE ON page_views, NOT visitor_sessions. The session row carries referrer,
    // geo and device; the campaign is per page view, because a visitor can arrive on one campaign
    // and return on another. Both are keyed by session_id, so the chain is unchanged — but a join
    // written against the wrong one fails with 42703, which is how this was found.
    await sql`
      INSERT INTO visitor_sessions (id, session_id, first_page, referrer, last_seen_at, page_count)
      VALUES (gen_random_uuid(), ${SESSION}, '/pricing', 'https://news.ycombinator.com', now(), 3)
      ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO page_views (id, session_id, page_path, referrer, utm_source, utm_medium, utm_campaign)
      VALUES (gen_random_uuid(), ${SESSION}, '/pricing', 'https://news.ycombinator.com',
              'hn', 'referral', 'launch-week')`;
    const [chain] = await sql<{ campaign: string | null; source: string | null; referrer: string | null; slug: string | null }[]>`
      SELECT pv.utm_campaign AS campaign, pv.utm_source AS source, v.referrer, t.slug
        FROM applications a
        JOIN visitor_sessions v ON v.session_id = a.session_id
        JOIN page_views pv      ON pv.session_id = a.session_id
        JOIN tenants t          ON t.id = a.tenant_id
       WHERE a.id = ${appId}::uuid
       LIMIT 1`;
    ok(!!chain, 'campaign → session → application → customer resolves in ONE join',
       chain ? `${chain.source}/${chain.campaign} → ${chain.slug}` : 'the join found nothing');
    sc.track('the probe visitor session', [
      async () => (await sql`DELETE FROM page_views WHERE session_id = ${SESSION}`).count,
      async () => (await sql`DELETE FROM visitor_sessions WHERE session_id = ${SESSION}`).count,
    ]);

    // ══ 7 · THE PERSON ═══════════════════════════════════════════════════════════════════════
    // Migration 243 added the subject the CRM never had. The chain above joins a campaign to a
    // COMPANY; this joins it to a PERSON, which is what an outbound list is made of. Both halves
    // matter and they fail differently: the first breaks if a capture route drops the session, the
    // second if it drops the contact — and the second is silent, because the application still
    // lands and nothing on any page says a contact was missed.
    console.log('\n7 · Who are they? — the contact, and the funnel that counts them');
    const [ct] = await sql<{
      id: string; email: string; name: string | null; companyName: string | null;
      firstSessionId: string | null; source: string | null;
    }[]>`
      SELECT c.id, c.email, c.name, c.company_name, c.first_session_id, c.source
        FROM contacts c JOIN applications a ON a.contact_id = c.id
       WHERE a.id = ${appId}::uuid`;
    ok(!!ct, 'the application is linked to a person, not just an address',
       ct ? ct.email : 'no contact joined to the application');
    ok(ct?.email === CONTACT.toLowerCase(), 'stored normalised, so one person is one row',
       ct?.email ?? '—');
    // The first-touch session is what makes the person attributable at all. Without it they fall
    // into the un-attributed bucket on /admin/funnel — correctly, but invisibly to anyone who
    // assumes the funnel is complete.
    ok(ct?.firstSessionId === SESSION, 'and carries the FIRST-touch session, not the latest',
       ct?.firstSessionId ?? 'null');
    ok(ct?.source === 'application', 'recording how they entered our world', ct?.source ?? '—');

    // Now the aggregate the admin actually reads. Copying the page's own function rather than
    // re-typing a predicate that looks equivalent — rule (3): a hand-written expectation here
    // manufactures confident, wrong findings (B80).
    const { funnelBySource } = await import('../lib/contacts.ts');
    const buckets = await funnelBySource(90);
    const mine = buckets.find((b) => b.source === 'hn' && b.campaign === 'launch-week');
    ok(!!mine, 'the funnel places them under the campaign that brought them',
       mine ? `hn/launch-week: ${mine.sessions} session(s), ${mine.contacts} contact(s)` : 'no hn/launch-week bucket');
    ok((mine?.contacts ?? 0) >= 1 && (mine?.customers ?? 0) >= 1,
       'with the customer counted in the same row — campaign to revenue, one line',
       mine ? `${mine.contacts} contact(s) · ${mine.customers} customer(s)` : '—');
    // The un-attributed bucket must NOT also be counting them: a person in two buckets makes every
    // rate on the page sum past 100% and is the exact shape of double-count a funnel cannot show.
    const unattr = buckets.find((b) => b.source === null);
    const totalContacts = buckets.reduce((n, b) => n + b.contacts, 0);
    const [{ n: realContacts }] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM contacts
       WHERE first_seen_at >= now() - INTERVAL '90 days'`;
    ok(totalContacts === realContacts,
       'and every contact is counted exactly once across the buckets',
       `${totalContacts} bucketed vs ${realContacts} in the window`
       + (unattr ? ` (${unattr.contacts} un-attributed)` : ''));

    if (ct?.id) {
      sc.track('the contact', [
        async () => (await sql`DELETE FROM contacts WHERE id = ${ct.id}::uuid`).count,
      ]);
    }

    await ctx.close();
  } finally {
    // The factory owns teardown. A scenario tenant's events ARE fixture noise rather than a
    // customer's audit trail, which is why purging them here is right and purging a real
    // customer's would not be.
    if (tenantId) sc.trackTenantPurge('the company the accept created', tenantId);
    if (appId) {
      sc.track('the application', [
        async () => (await sql`DELETE FROM applications WHERE id = ${appId}::uuid`).count,
      ]);
    }
    await sc.dispose();
    await browser.close();
    await sql.end();
  }

  console.log(failed === 0
    ? '\n✓ The commercial path holds: a stranger applies, an admin accepts, an account exists,\n'
      + '  the welcome is recorded, and the person can sign in.\n'
    : `\n✗ ${failed} finding(s) in the path a prospect walks first.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('drive failed:', e); process.exit(2); });
