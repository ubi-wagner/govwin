/**
 * Prove the submission-deadline gate: a CLOSED solicitation blocks readiness when the close date is
 * confirmed, warns when it is only an estimate, and a future close shows a positive countdown with no
 * blocker. Mutates the fixture opportunity's close_date in place and restores it in finally.
 *   DATABASE_URL=<owner conn> npx tsx scripts/verify-readiness-deadline.mts
 */
import { sql } from '@/lib/db';
import { computeSubmissionReadiness } from '@/lib/proposal/submission-readiness';

const PROP = 'd0000000-0000-4000-8000-000000000002'; // lock-fixture proposal (lighthouse)

async function main() {
  const [p] = await sql<{ tenantId: string; oppId: string }[]>`
    SELECT tenant_id AS "tenantId", opportunity_id AS "oppId" FROM proposals WHERE id=${PROP}::uuid`;
  if (!p?.oppId) { console.error('fixture proposal/opp missing — run seed_e2e_fixtures.mjs'); process.exit(1); }
  const { tenantId: tid, oppId } = p;
  const [orig] = await sql<{ closeDate: Date | null; est: boolean | null }[]>`
    SELECT close_date AS "closeDate", dates_estimated AS "est" FROM opportunities WHERE id=${oppId}::uuid`;

  let pass = true;
  const check = (l: string, c: boolean) => { console.log(`${c ? '✅' : '❌'} ${l}`); pass &&= c; };
  const deadlineBlockers = (r: Awaited<ReturnType<typeof computeSubmissionReadiness>>) =>
    (r?.blockers ?? []).filter((x) => x.category === 'deadline');

  try {
    // 1) past + confirmed → HARD blocker
    await sql`UPDATE opportunities SET close_date = now() - interval '5 days', dates_estimated = false WHERE id=${oppId}::uuid`;
    let r = await computeSubmissionReadiness(PROP, tid);
    let d = deadlineBlockers(r);
    check('past + confirmed close → a deadline BLOCKER (hard)', d.length === 1 && d[0].severity === 'blocker');
    check('summary.deadline.past=true, daysRemaining<0', r?.summary.deadline.past === true && (r?.summary.deadline.daysRemaining ?? 0) < 0);
    check('ready=false past a confirmed close', r?.ready === false);

    // 2) past + estimated → WARNING (never hard-fail on a guessed date)
    await sql`UPDATE opportunities SET close_date = now() - interval '5 days', dates_estimated = true WHERE id=${oppId}::uuid`;
    r = await computeSubmissionReadiness(PROP, tid);
    d = deadlineBlockers(r);
    check('past + ESTIMATED close → a WARNING, not a blocker', d.length === 1 && d[0].severity === 'warning');

    // 3) future → no deadline blocker, positive countdown
    await sql`UPDATE opportunities SET close_date = now() + interval '30 days', dates_estimated = false WHERE id=${oppId}::uuid`;
    r = await computeSubmissionReadiness(PROP, tid);
    check('future close → no deadline blocker', deadlineBlockers(r).length === 0);
    check('summary.deadline: not past, daysRemaining ≈ 30', r?.summary.deadline.past === false
      && (r?.summary.deadline.daysRemaining ?? 0) >= 29 && (r?.summary.deadline.daysRemaining ?? 0) <= 31);
  } finally {
    await sql`UPDATE opportunities SET close_date = ${orig?.closeDate ?? null}, dates_estimated = ${orig?.est ?? null} WHERE id=${oppId}::uuid`;
  }
  console.log(pass ? '\n✅ SUBMISSION-DEADLINE READINESS GATE PROVEN' : '\n❌ FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
