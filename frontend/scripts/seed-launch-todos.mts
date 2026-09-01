/**
 * seed-launch-todos — the pre-launch decisions, raised as real work items.
 *
 * ── WHY A SCRIPT AND NOT A DOCUMENT ──────────────────────────────────────────────────────────
 * These came out of docs/TERMS_REVIEW_2026-09-01.md §5. A checklist in a document is read once and
 * then competes with every other document; a ToDo carries a due date, a nudge, and sits on the
 * surface an admin already opens. The whole argument for the work-item ledger over an email applies
 * here too — so this writes through `createTask`, the same helper the public capture routes use,
 * rather than inserting rows of its own.
 *
 * ── WHY A SCRIPT AND NOT A MIGRATION ─────────────────────────────────────────────────────────
 * A migration would re-create these on every fresh database, including every developer's, forever.
 * These are operational items for ONE deployment at ONE moment. Run it deliberately, once, against
 * the database that needs them.
 *
 * ── IDEMPOTENT ───────────────────────────────────────────────────────────────────────────────
 * Re-running skips anything already present with the same title and still open, so a second run
 * after acting on some of them does not resurrect what was completed. Nothing is ever updated or
 * deleted — a ToDo somebody already dismissed stays dismissed.
 *
 *   cd frontend && DATABASE_URL_OWNER=<target> npx tsx scripts/seed-launch-todos.mts
 *   …add --dry-run to see what it would create and write nothing.
 *
 * ⚠️ This WRITES. Point it at production only when you mean to.
 */
import postgres from 'postgres';
import { createTask } from '../lib/tasks/tasks';
import { TERMS_VERSION } from '../lib/terms';

const DRY = process.argv.includes('--dry-run');
const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!DB) { console.error('CannotRun: set DATABASE_URL_OWNER to the target database.'); process.exit(2); }
const sql = postgres(DB, { max: 2, onnotice: () => {},
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });

/** Every item states WHAT to decide, not just that a decision exists — a ToDo whose description
 *  says "review the terms" sends the reader back to the document this was meant to replace. */
const ITEMS: Array<{ title: string; description: string; days: number }> = [
  {
    title: 'Two ToDos per application — decide which automation rule stays',
    days: 7,
    description:
      'Every application raises the actionable application_triage ToDo AND a broadcast note from '
      + 'the active rule "Admin alert on new application", which can only be Acknowledged. A '
      + 'sibling rule "Auto-todo on application" exists and is DISABLED, which suggests the '
      + 'duplication was already noticed. At real volume this doubles the admin queue for no extra '
      + 'information. Disable one of them in /admin/automation.',
  },
  {
    title: `Ohio counsel reviews Terms ${TERMS_VERSION} before it binds anyone`,
    days: 14,
    description:
      `${TERMS_VERSION} was drafted from an engineering review, not by a lawyer `
      + '(docs/TERMS_REVIEW_2026-09-01.md). Counsel should read the whole document and especially '
      + 'the three places where getting it wrong costs most: §16 liability carve-outs, §21 '
      + 'arbitration and class waiver, §10(c) controlled-data prohibition. Until then, treat v4 as '
      + 'a draft. Existing acceptances are of v3 and must not be backfilled.',
  },
  {
    title: 'Confirm a signed DPA exists with every subprocessor we name',
    days: 21,
    description:
      'The privacy page previously claimed "each bound by data processing agreements" — an '
      + 'affirmative representation. That claim was removed pending verification. Confirm signed '
      + 'DPAs with Anthropic, Voyage AI, Postmark, Google, Cloudflare, Railway and Stripe, then '
      + 'restate it — or leave it out. A subprocessor claim that is wrong is worse than none.',
  },
  {
    title: 'Decide the 72-hour breach-notification commitment',
    days: 21,
    description:
      'Terms §12(d) commits to notifying customers within 72 hours of confirming a breach — '
      + 'stricter than most US state law requires, and self-imposed. Keep it as a trust '
      + 'differentiator, or soften to "without undue delay and as required by applicable law". It '
      + 'is a contractual deadline either way.',
  },
  {
    title: 'Decide whether any customer can be a sole proprietor',
    days: 21,
    description:
      'If a customer can be an individual rather than an entity, consumer-protection rules may '
      + 'reach the arbitration clause (§21) and the non-refundable portal term (§9(f)). Worth '
      + 'answering before the first non-corporate applicant, not after.',
  },
  {
    title: 'Switch Postmark on, then re-run the intake drive',
    days: 7,
    description:
      'EMAIL_DRIVER=postmark, POSTMARK_SERVER_TOKEN (the SERVER token — the Account token cannot '
      + 'send and 401s in a way that reads like a wrong key), POSTMARK_WEBHOOK_SECRET, and the '
      + 'webhook at https://postmark:<secret>@<host>/api/webhooks/postmark. Plus DKIM and '
      + 'Return-Path DNS. Then run drive-application-intake: its PRODUCTION GATE line must read '
      + "status='sent' rather than 'failed'. /admin/crm shows the transport in force.",
  },
];

async function main() {
  const [admin] = await sql<{ id: string; email: string; role: string }[]>`
    SELECT id, email, role FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
     ORDER BY CASE role WHEN 'master_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;
  if (!admin) { console.error('CannotRun: no active rfp_admin or master_admin to act as.'); process.exit(2); }
  console.log(`· target ${DB.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`· acting as ${admin.email} (${admin.role})${DRY ? '  [DRY RUN — nothing written]' : ''}\n`);

  let made = 0; let skipped = 0;
  for (const item of ITEMS) {
    const [existing] = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM tasks
       WHERE entity_type = 'launch' AND title = ${item.title} AND status = 'open' LIMIT 1`;
    if (existing) { console.log(`  – already open: ${item.title}`); skipped++; continue; }
    if (DRY) { console.log(`  + would create: ${item.title}  (due in ${item.days}d)`); made++; continue; }
    await createTask({
      actor: { id: admin.id, email: admin.email, role: admin.role as never, tenantId: null },
      tenantId: null, assigneeRole: 'rfp_admin', taskType: 'admin_review',
      title: item.title, description: item.description,
      entityType: 'launch', entityId: null,
      dueAt: new Date(Date.now() + item.days * 86_400_000).toISOString(),
      nudgeDays: [Math.max(1, Math.ceil(item.days / 2))],
    });
    console.log(`  ✓ ${item.title}  (due in ${item.days}d)`);
    made++;
  }
  console.log(`\n${DRY ? 'would create' : 'created'} ${made} · skipped ${skipped} already open`);
  await sql.end();
}

main().catch((e) => { console.error('seed failed:', e); process.exit(1); });
