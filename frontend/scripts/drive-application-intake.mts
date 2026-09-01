/**
 * drive-application-intake — the public→private notification, driven as a stranger.
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
 * ⚠️ NOT READ-ONLY. It submits a real application. Teardown removes the application, the contact,
 * the task and the ledger row it created, and nothing else.
 *
 *   cd frontend && DATABASE_URL="$DATABASE_URL_OWNER" npx tsx scripts/drive-application-intake.mts
 * Exit 0 when every link holds; 1 on a finding; 2 if it could not earn a verdict.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
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
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let appId: string | null = null;
  let contactId: string | null = null;

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

    const res = await page.evaluate(async (p) => {
      const r = await fetch('/api/applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmail: p.contact, contactName: 'Probe Founder', contactTitle: 'CEO',
          companyName: p.company, companySize: '1-10', companyState: 'OH',
          samRegistered: true, previousSubmissions: 0, previousAwards: 0,
          techSummary: 'Additive construction for expeditionary basing, driven by the intake probe.',
          techAreas: ['additive construction'], targetPrograms: ['sbir_phase_1'],
          targetAgencies: ['DoD'], desiredOutcomes: ['more wins'],
          motivation: 'production lock check', referralSource: 'harness',
          // Copied from ApplicationSchema, not guessed: `termsAccepted` is a z.literal(true)
          // and omitting it is a 422. The first run of this drive did exactly that, and the
          // product was right to refuse — a field-level error naming the field is the
          // correct behaviour, and the finding was mine.
          termsAccepted: true, termsVersion: 'v1', termsSignature: p.contact,
          sessionId: (() => { try { return sessionStorage.getItem('_rfp_sid'); } catch { return null; } })(),
        }),
      });
      return { status: r.status, body: (await r.text()).slice(0, 200) };
    }, { contact: CONTACT, company: COMPANY });
    ok(res.status >= 200 && res.status < 300, 'the public form accepts the submission', `HTTP ${res.status}`);
    if (res.status >= 300) console.log(`      · ${res.body}`);

    // ══ 2 · IT REACHES THE SYSTEM ═════════════════════════════════════════════════════════════
    console.log('\n2 · It reaches the system — the row, the person, the event');
    const [app] = await sql<{ id: string; status: string; sessionId: string | null; contactId: string | null }[]>`
      SELECT id, status, session_id, contact_id FROM applications WHERE company_name = ${COMPANY}`;
    appId = app?.id ?? null;
    ok(!!appId, 'it lands as an application row', appId ?? 'no row');
    ok(app?.status === 'pending', 'in a state that asks a human for a decision', app?.status ?? '—');
    ok(app?.sessionId === sid, 'carrying the session that brought them', app?.sessionId ?? 'null');

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

    await page.close();
  } finally {
    // Teardown: only what this drive made.
    try {
      if (appId) {
        await sql`DELETE FROM tasks WHERE entity_type = 'application' AND entity_id = ${appId}`;
        await sql`DELETE FROM email_send_ledger WHERE idempotency_key LIKE ${'%' + appId + '%'}`;
        await sql`DELETE FROM system_events WHERE payload->>'applicationId' = ${appId}`;
        await sql`DELETE FROM applications WHERE id = ${appId}::uuid`;
      }
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
