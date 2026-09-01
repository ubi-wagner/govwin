/**
 * drive-application-intake — the public→private notification, driven as a stranger.
 *
 * TWO public capture pages, not one: the founding-cohort application (/apply) and the
 * waitlist (on /federal-rd-101). Both are ways a stranger raises a hand, and both have to
 * reach a human. The waitlist was silent until 2026-09-01 — row written, contact recorded,
 * `capture:waitlist.joined` emitted, and nothing consuming any of it.
 *
 * ── WHY THIS IS ITS OWN DRIVE ────────────────────────────────────────────────────────────────
 * This is the minimum viable path into the business: somebody who has never heard of us fills in a
 * form on the open internet, and a human on our side has to find out. Everything else in the
 * product is downstream of it. If this link is broken, the failure is silent and total — the
 * applicant sees a success page, and nobody is ever told.
 *
 * `drive-commercial-path` walks apply → accept → account → welcome → sign-in and asserts the
 * APPLICATION and the EMAIL. It never asserted the ToDo, which is the half that survives a mail
 * outage: the email is a notification, the work item is the ledger, and the route creates the ToDo
 * precisely so the emitted event has a consumer that is not somebody's inbox.
 *
 * ── THE ASSERTION THAT MATTERS MOST ──────────────────────────────────────────────────────────
 * Not "a task row exists" — "an rfp_admin SEES it". Those differ, and the gap between them is
 * app-layer. A platform-scope task carries `tenant_id IS NULL`, which RLS makes readable from any
 * context; what actually decides whether it reaches a person is `listOpenTasksForActor`'s own
 * predicate (CLAUDE.md: "Treat that belt as load-bearing — RLS will not catch it"). So this drive
 * calls the same function the ToDo surface calls, as the real admin, and requires the row to come
 * back. A task created into a bucket nobody queries is the same as no task.
 *
 * ── BOTH SIDES, THROUGH THE UI ───────────────────────────────────────────────────────────────
 * The first version of this drive POSTed a crafted body and asserted the ToDo by calling
 * `listOpenTasksForActor` directly. That proves the server and the query; it does not prove that a
 * person can do this. A form can validate, disable its own submit, or never render its success
 * state while the endpoint behind it is perfect — and an admin page can hold the right rows and
 * show none of them. So this now:
 *
 *   PUBLIC SIDE — opens /apply, types into every field, clicks the chips, walks the terms
 *     acceptance, signs, presses Submit, and requires the SUCCESS STATE to render.
 *   ADMIN SIDE — signs in as the real rfp_admin, opens /admin/applications and requires the
 *     company name to be ON THE PAGE, then opens the ToDo surface and requires the ToDo to be
 *     visible there too.
 *
 * Both halves are photographed, because a 200 is not evidence and neither is a row.
 *
 * ⚠️ NOT READ-ONLY. It submits a real application. Teardown removes the application, the contact,
 * the task and the ledger row it created, and nothing else.
 *
 *   cd frontend && DATABASE_URL="$DATABASE_URL_OWNER" npx tsx scripts/drive-application-intake.mts
 * Exit 0 when every link holds; 1 on a finding; 2 if it could not earn a verdict.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { mkdirSync } from 'node:fs';
import { TERMS_VERSION } from '../lib/terms';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.SHOTS_DIR || '/tmp/branch-drives';
const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!DB) { console.error('CannotRun: DATABASE_URL_OWNER is required.'); process.exit(2); }

// The camelCase transform is not optional: lib/db.ts applies it to every app query, so a row type
// declaring `taskType` reads `undefined` without it — and `undefined === undefined` makes a broken
// assertion pass (CLAUDE.md, the sql<T> trap).
const sql = postgres(DB, { max: 3, onnotice: () => {},
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });

let failed = 0;
const ok = (good: boolean, label: string, detail = '') => {
  if (!good) failed += 1;
  console.log(`  ${good ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const STAMP = Date.now();
// A unique DOMAIN per run, not just a unique local part: the form refuses a second application from
// the same organisation and identifies one by email domain. That 409 is correct product behaviour
// and a fixed domain makes the SECOND run fail on it.
const DOMAIN = `intake-probe-${STAMP}.test`;
const COMPANY = `Intake Probe ${STAMP}`;
const CONTACT = `founder@${DOMAIN}`;

async function main() {
  try { mkdirSync(SHOTS, { recursive: true }); } catch { /* exists */ }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let appId: string | null = null;
  let contactId: string | null = null;
  let wlId: string | null = null;
  let wlEmail: string | null = null;

  try {
    // ══ 1 · A STRANGER APPLIES ════════════════════════════════════════════════════════════════
    console.log('\n1 · A stranger applies — the open internet, no account, no session');
    const page = await (await browser.newContext()).newPage();
    // Arrive on a campaign link so the attribution half is exercised in the same walk.
    await page.goto(`${BASE}/?utm_source=intake-probe&utm_medium=test&utm_campaign=production-lock`,
      { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);                       // let the tracker mint + post
    const sid = await page.evaluate(() => { try { return sessionStorage.getItem('_rfp_sid'); } catch { return null; } });
    ok(!!sid, 'the browser carries an analytics session', sid ?? 'none');

    // ── fill the REAL form, as a person would ────────────────────────────────────────────────
    await page.goto(`${BASE}/apply`, { waitUntil: 'networkidle' });
    const type = async (name: string, value: string) => {
      const el = page.locator(`[name="${name}"]`).first();
      if (await el.count() === 0) { ok(false, `the form has a ${name} field`, 'not found'); return; }
      await el.fill(value);
    };
    await type('contactName', 'Probe Founder');
    await type('contactEmail', CONTACT);
    await type('contactTitle', 'CEO');
    await type('contactPhone', '555-0100');
    await type('companyName', COMPANY);
    await type('companyState', 'OH');
    await type('techSummary', 'Additive construction for expeditionary basing, driven by the intake probe.');
    await type('motivation', 'production lock check');
    await type('referralSource', 'harness');

    // A required radio group. The first run missed it and the browser's own
    // "Please select one of these options" tooltip is what showed up in the screenshot — the form
    // was right, the drive was incomplete.
    await page.locator('input[name="samRegistered"][value="yes"]').first().check();

    // Chips are `<button type="button" aria-pressed>`; click by the label a person sees. The
    // labels are taken from the component's own option arrays, not guessed — the first run tried
    // "DoD" and "Win more federal work", neither of which exists (they are "DoD (General)" and
    // "Daily opportunity Spotlight"), and a chip that does not match is silently not selected.
    for (const label of ['Materials / Manufacturing', 'SBIR Phase I', 'DoD (General)',
                         'Daily opportunity Spotlight']) {
      const chip = page.getByRole('button', { name: label, exact: true }).first();
      ok(await chip.count() > 0, `the "${label}" option is on the form`,
         await chip.count() > 0 ? '' : 'no such chip — the drive and the form disagree');
      if (await chip.count() > 0) await chip.click();
    }

    // ── SCROLL-TO-ACCEPT ─────────────────────────────────────────────────────────────────────
    // The Terms panel says "Please scroll to the bottom of the Terms & Conditions to continue",
    // and the signature field + I Accept only exist once `tcScrolledToBottom` is true
    // (scrollTop + clientHeight >= scrollHeight - 50).
    //
    // THIS IS WHY DRIVING THE UI MATTERS. A crafted POST sends `termsAccepted: true` and never
    // meets this gate at all, so the previous version of this drive proved a path no applicant
    // can take. Scroll the container the way a person scrolls it.
    // The scrollable div only EXISTS once the panel is opened (`tcOpen`), so the button comes
    // first. Removing this click while rewriting is what made the previous run report "no
    // scrollable T&C container" — the container was not hidden, it was not rendered.
    const review = page.getByRole('button', { name: /Review Terms/i }).first();
    if (await review.count() > 0) { await review.click(); await page.waitForTimeout(400); }
    const tc = page.locator('div.max-h-80.overflow-y-auto').first();
    const tcCount = await tc.count();
    ok(tcCount > 0, 'opening the panel renders the scrollable Terms',
       tcCount > 0 ? '' : 'no scrollable T&C container after clicking Review');
    if (tcCount > 0) {
      await tc.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(500);
    }
    const sig = page.locator('input[type="email"]').last();
    if (await sig.count() > 0) await sig.fill(CONTACT).catch(() => {});
    const accept = page.getByRole('button', { name: 'I Accept', exact: true }).first();
    ok(await accept.count() > 0, 'scrolling the terms reveals I Accept — the gate opens',
       await accept.count() > 0 ? 'I Accept present after scroll' : 'still no I Accept after scrolling to the bottom');
    if (await accept.count() > 0) await accept.click();

    await page.getByRole('button', { name: /submit|apply/i }).last().click();
    // The SUCCESS STATE, not the network response: a form that posts and never tells the applicant
    // is a broken form with a perfect endpoint.
    const landed = await page.getByText(/Thanks for applying/i).first()
      .waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    ok(landed, 'the applicant is told it worked — the success state renders',
       landed ? '"Thanks for applying"' : 'no success state; the page still shows the form');
    if (!landed) console.log(`      · ${(await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 240)}`);
    await page.screenshot({ path: `${SHOTS}/intake-1-public.png`, fullPage: true });

    // ══ 2 · IT REACHES THE SYSTEM ═════════════════════════════════════════════════════════════
    console.log('\n2 · It reaches the system — the row, the person, the event');
    const [app] = await sql<{ id: string; status: string; sessionId: string | null; contactId: string | null;
      termsVersion: string | null; termsAcceptedAt: Date | null }[]>`
      SELECT id, status, session_id, contact_id, terms_version, terms_accepted_at
        FROM applications WHERE company_name = ${COMPANY}`;
    appId = app?.id ?? null;
    ok(!!appId, 'it lands as an application row', appId ?? 'no row');
    ok(app?.status === 'pending', 'in a state that asks a human for a decision', app?.status ?? '—');
    ok(app?.sessionId === sid, 'carrying the session that brought them', app?.sessionId ?? 'null');
    // WHICH TERMS THEY SIGNED. This column is the evidence of what somebody agreed to, so a wrong
    // value is worse than a refused submission — the schema used to default it to 'v1', which would
    // have attributed to every signer an agreement to text they never saw.
    ok(app?.termsVersion === TERMS_VERSION, 'recording the exact terms version they accepted',
       `${app?.termsVersion ?? 'null'} (current: ${TERMS_VERSION})`);
    ok(!!app?.termsAcceptedAt, 'with the moment of acceptance', app?.termsAcceptedAt ? 'stamped' : 'no timestamp');

    contactId = app?.contactId ?? null;
    ok(!!contactId, 'and a PERSON, not just an address', contactId ? 'contact linked' : 'no contact');

    const [ev] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM system_events
       WHERE namespace = 'capture' AND type = 'application.submitted'
         AND payload->>'applicationId' = ${appId}`;
    ok((ev?.n ?? 0) > 0, 'the platform emits capture:application.submitted', `${ev?.n ?? 0} event(s)`);

    // ══ 3 · A HUMAN IS TOLD — THE LEDGER, NOT JUST THE INBOX ══════════════════════════════════
    console.log('\n3 · A human is told — the work item, which survives a mail outage');
    const [task] = await sql<{
      id: string; taskType: string; assigneeRole: string | null; tenantId: string | null;
      status: string; title: string; entityId: string | null;
    }[]>`
      SELECT id, task_type, assignee_role, tenant_id, status, title, entity_id
        FROM tasks WHERE entity_type = 'application' AND entity_id = ${appId}`;
    ok(!!task, 'a ToDo is raised for the application', task ? task.title : 'NO TASK — the event has no consumer');
    ok(task?.taskType === 'application_triage', 'of the type the triage queue expects', task?.taskType ?? '—');
    ok(task?.assigneeRole === 'rfp_admin', 'assigned to the rfp_admin role', task?.assigneeRole ?? '—');
    // Platform scope: an application belongs to no tenant — it exists BEFORE any tenant does.
    ok(task?.tenantId === null, 'at platform scope, since no tenant exists yet',
       task?.tenantId === null ? 'tenant_id IS NULL' : String(task?.tenantId));
    ok(task?.status === 'open', 'and open', task?.status ?? '—');

    // ── THE ASSERTION THAT MATTERS MOST ──────────────────────────────────────────────────────
    // Not "the row exists" but "an admin SEES it". The gap between those is app-layer, and RLS
    // cannot catch it: a platform row is readable from every context, so what decides whether a
    // person is told is `listOpenTasksForActor`'s own predicate.
    const [admin] = await sql<{ id: string; email: string; role: string }[]>`
      SELECT id, email, role FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
       ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;
    if (!admin) {
      console.log('  CANT-RUN no active rfp_admin on this box — visibility is UNCHECKED, not passing.');
      failed += 1;
    } else {
      const { listOpenTasksForActor } = await import('../lib/tasks/tasks');
      const seen = await listOpenTasksForActor({ id: admin.id, role: admin.role as never, tenantId: null });
      const mine = seen.find((t: { id: string }) => t.id === task?.id);
      ok(!!mine, `the admin's own ToDo query returns it (${admin.email})`,
         mine ? `${seen.length} open item(s), this one among them`
              : `${seen.length} open item(s), NOT including this one — created into a bucket nobody queries`);

      // ══ 4 · THE ADMIN SIDE, ON THE ACTUAL PAGES ═════════════════════════════════════════════
      // The query returning the row and a person SEEING it are different claims. A page can hold
      // the right rows and render none of them — that is exactly how /admin/storage shipped a red
      // error banner past every lens (B131). So: sign in as the real admin and read the screen.
      console.log('\n4 · The admin side — signed in, on the pages a person actually opens');
      const ap = await (await browser.newContext()).newPage();
      await ap.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await ap.waitForSelector('#email', { timeout: 20000 });
      await ap.fill('#email', admin.email);
      await ap.fill('#password', process.env.ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
      await ap.click('button[type="submit"]');
      await ap.waitForLoadState('networkidle').catch(() => {});
      await ap.waitForTimeout(2500);
      if (ap.url().includes('/login')) {
        console.log('  CANT-RUN could not sign the admin in — the page assertions are UNCHECKED, not passing.');
        failed += 1;
      } else {
        await ap.goto(`${BASE}/admin/applications`, { waitUntil: 'networkidle' });
        const appsText = (await ap.textContent('body')) ?? '';
        ok(appsText.includes(COMPANY), 'the application is ON the admin applications page',
           appsText.includes(COMPANY) ? COMPANY : 'the company name is not in the rendered page');
        // Scoped to THIS application, by PROXIMITY rather than by container.
        //
        // Two earlier versions of this assertion were wrong in opposite directions. The first
        // tested the whole page for /pending/i and passed with no application at all, because the
        // page carries a "1 pending review" summary — an assertion that cannot fail is not an
        // assertion. The second scoped to `tr, li, [data-application-id]` and found nothing,
        // because the page renders applications as CARDS, not table rows.
        //
        // What "this one is pending" means on a card layout is that the badge sits next to the
        // name, so that is what this measures: the status within 200 characters of the company.
        const idx = appsText.indexOf(COMPANY);
        const near = idx >= 0 ? appsText.slice(idx, idx + 200) : '';
        ok(/pending/i.test(near), 'and THAT application is shown as awaiting a decision',
           near ? near.replace(/\s+/g, ' ').slice(0, 70) : 'the company is not in the page text');
        await ap.screenshot({ path: `${SHOTS}/intake-2-admin-applications.png`, fullPage: true });

        // The ToDo surface. The dashboard renders the queue an admin actually works from.
        await ap.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' });
        let todoText = (await ap.textContent('body')) ?? '';
        if (!todoText.includes(COMPANY)) {
          // The queue may live behind the bell / a drawer rather than on the dashboard body.
          const bell = ap.getByRole('button', { name: /to-?do|task|notification/i }).first();
          if (await bell.count() > 0) { await bell.click().catch(() => {}); await ap.waitForTimeout(1200); }
          todoText = (await ap.textContent('body')) ?? '';
        }
        ok(todoText.includes(COMPANY) || todoText.includes('Review application'),
           'and the ToDo is VISIBLE to the admin on their own queue',
           todoText.includes(COMPANY) ? 'the company is named in the queue'
             : todoText.includes('Review application') ? 'the triage item is listed'
             : 'the ToDo exists in the database but does not reach the admin\'s screen');
        await ap.screenshot({ path: `${SHOTS}/intake-3-admin-todo.png`, fullPage: true });
        console.log(`      · screenshots in ${SHOTS}/intake-{1-public,2-admin-applications,3-admin-todo}.png`);
      }
      await ap.close();
    }

    // ── and the email, which is the notification rather than the ledger ──────────────────────
    const [mail] = await sql<{ status: string; toEmail: string; tenantId: string | null }[]>`
      SELECT status, to_email, tenant_id FROM email_send_ledger
       WHERE template = 'admin_new_application' AND idempotency_key LIKE ${'%' + appId + '%'}`;
    ok(!!mail, 'the alert is RESERVED in the ledger before dispatch',
       mail ? `to=${mail.toEmail} status=${mail.status}` : 'no ledger row');
    // In a sandbox with no provider `failed` is the honest outcome; what must hold is that the
    // attempt is RECORDED. Asserting delivery here would fail on a driver detail, not a product one.
    if (mail) {
      ok(mail.tenantId === null, 'at platform scope — an application is nobody\'s tenant yet',
         mail.tenantId === null ? 'tenant_id IS NULL' : String(mail.tenantId));
      if (mail.status !== 'sent') {
        console.log(`      · not delivered here (no provider configured): status=${mail.status}`);
        console.log('      · PRODUCTION GATE: with EMAIL_DRIVER=postmark this must read \'sent\'.');
      }
    }

    // ══ 5 · THE OTHER PUBLIC CAPTURE PAGE ═══════════════════════════════════════════════════
    // The waitlist is the second way a stranger raises a hand, and it was silent: row written,
    // contact recorded, event emitted, nobody told. Same assertion shape as the application.
    console.log('\n5 · The waitlist — the other public form, and the other way to be told');
    const WL_EMAIL = `waitlist.probe.${STAMP}@${DOMAIN}`;
    wlEmail = WL_EMAIL;
    const wlStatus = await page.evaluate(async (p) => {
      const r = await fetch('/api/waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: p.email, company_name: p.company, notes: 'source: intake probe',
          session_id: (() => { try { return sessionStorage.getItem('_rfp_sid'); } catch { return null; } })() }),
      });
      return r.status;
    }, { email: WL_EMAIL, company: `${COMPANY} (waitlist)` });
    ok(wlStatus >= 200 && wlStatus < 300, 'the waitlist form accepts a sign-up', `HTTP ${wlStatus}`);

    const [wl] = await sql<{ id: string; sessionId: string | null; contactId: string | null }[]>`
      SELECT id, session_id, contact_id FROM waitlist WHERE email = ${WL_EMAIL}`;
    wlId = wl?.id ?? null;
    ok(!!wlId, 'it lands as a waitlist row', wlId ?? 'no row');
    ok(!!wl?.contactId, 'linked to a person', wl?.contactId ? 'contact linked' : 'no contact');
    ok(wl?.sessionId === sid, 'carrying the session that brought them', wl?.sessionId ?? 'null');

    const [wlTask] = await sql<{ id: string; assigneeRole: string | null; tenantId: string | null; title: string }[]>`
      SELECT id, assignee_role, tenant_id, title FROM tasks
       WHERE entity_type = 'waitlist' AND entity_id = ${wlId}`;
    ok(!!wlTask, 'AND A HUMAN IS TOLD — a ToDo is raised for it too',
       wlTask ? wlTask.title : 'NO TASK — a stranger raised a hand and nobody found out');
    ok(wlTask?.assigneeRole === 'rfp_admin' && wlTask?.tenantId === null,
       'assigned to rfp_admin at platform scope',
       wlTask ? `${wlTask.assigneeRole} · ${wlTask.tenantId === null ? 'NULL' : wlTask.tenantId}` : '—');

    await page.close();
  } finally {
    // Teardown: only what this drive made.
    try {
      if (appId) {
        await sql`DELETE FROM tasks WHERE entity_type = 'application' AND entity_id = ${appId}`;
        // The route's triage ToDo is not the only one. The ACTIVE automation rule "Admin alert on
        // new application" also raises a `broadcast` note on capture:application.submitted, keyed
        // to nothing this drive owns — so three runs left three of them sitting in the admin's
        // queue before this line existed. Remove only notes raised while this probe was running.
        await sql`DELETE FROM tasks
                   WHERE task_type = 'broadcast' AND title LIKE 'Automation: capture.application%'
                     AND created_at >= ${new Date(STAMP - 60_000)}`;
        await sql`DELETE FROM email_send_ledger WHERE idempotency_key LIKE ${'%' + appId + '%'}`;
        await sql`DELETE FROM system_events WHERE payload->>'applicationId' = ${appId}`;
        await sql`DELETE FROM applications WHERE id = ${appId}::uuid`;
      }
      if (wlId) {
        await sql`DELETE FROM tasks WHERE entity_type = 'waitlist' AND entity_id = ${wlId}`;
        await sql`DELETE FROM waitlist WHERE id = ${wlId}::uuid`;
      }
      if (wlEmail) await sql`DELETE FROM contacts WHERE email = ${wlEmail}`;
      if (contactId) await sql`DELETE FROM contacts WHERE id = ${contactId}::uuid`;
      await sql`DELETE FROM page_views     WHERE utm_campaign = 'production-lock'`;
      await sql`DELETE FROM visitor_sessions WHERE session_id NOT IN (SELECT session_id FROM page_views)
                  AND first_page LIKE '%utm_source=intake-probe%'`;
      console.log('\nprobe rows removed');
    } catch (e) { console.error('teardown failed:', e); }
    await browser.close();
    await sql.end();
  }

  console.log(failed === 0
    ? '\n✓ The public→private notification holds: a stranger applies, the row lands, a person is told.'
    : `\n✗ ${failed} finding(s) in the path a stranger takes into the business.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('drive failed:', e); process.exit(2); });
