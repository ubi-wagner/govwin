/**
 * Prove the required-document readiness gate: a mandatory supporting doc still 'missing' must produce
 * a hard `missing_document` blocker (and flip ready→false), and providing/waiving it clears the block.
 *   DATABASE_URL=<owner conn> npx tsx scripts/verify-readiness-docs.mts
 */
import { sql } from '@/lib/db';
import { computeSubmissionReadiness } from '@/lib/proposal/submission-readiness';

const PROP = 'd0000000-0000-4000-8000-000000000002'; // lock-fixture proposal (lighthouse)
const LABEL = 'ZZTEST SF424 (required form)';

async function main() {
  const [p] = await sql<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM proposals WHERE id = ${PROP}::uuid`;
  if (!p) { console.error('fixture proposal missing — run seed_e2e_fixtures.mjs'); process.exit(1); }
  const tid = p.tenantId;
  let pass = true;
  const check = (label: string, cond: boolean) => { console.log(`${cond ? '✅' : '❌'} ${label}`); pass &&= cond; };

  // clean slate
  await sql`DELETE FROM proposal_supporting_docs WHERE proposal_id = ${PROP}::uuid AND requirement_label = ${LABEL}`;

  // baseline: how many missing_document blockers before we add one?
  const before = await computeSubmissionReadiness(PROP, tid);
  const baseMissingDocBlockers = (before?.blockers ?? []).filter((b) => b.category === 'missing_document').length;

  // 1) add a REQUIRED, MISSING doc → expect a new missing_document blocker + documents.missing↑
  await sql`
    INSERT INTO proposal_supporting_docs (proposal_id, tenant_id, requirement_label, category, is_required, status)
    VALUES (${PROP}::uuid, ${tid}::uuid, ${LABEL}, 'supporting_document', true, 'missing')`;
  const missing = await computeSubmissionReadiness(PROP, tid);
  const missingBlockers = (missing?.blockers ?? []).filter((b) => b.category === 'missing_document');
  check('missing required doc → a missing_document BLOCKER appears', missingBlockers.length === baseMissingDocBlockers + 1);
  check('the blocker is hard severity (fails readiness)', missingBlockers.some((b) => b.severity === 'blocker' && b.message.includes('SF424')));
  check('summary.documents counts it as required+missing', (missing?.summary.documents.required ?? 0) >= 1 && (missing?.summary.documents.missing ?? 0) >= 1);
  check('ready = false while a required form is missing', missing?.ready === false);

  // 2) mark it uploaded → the blocker clears
  await sql`UPDATE proposal_supporting_docs SET status='uploaded' WHERE proposal_id = ${PROP}::uuid AND requirement_label = ${LABEL}`;
  const provided = await computeSubmissionReadiness(PROP, tid);
  const stillBlocked = (provided?.blockers ?? []).filter((b) => b.category === 'missing_document' && b.message.includes('SF424')).length;
  check('uploaded → the missing_document blocker for it is gone', stillBlocked === 0);
  check('summary.documents counts it as provided', (provided?.summary.documents.provided ?? 0) >= 1);

  // 3) waived also counts as satisfied
  await sql`UPDATE proposal_supporting_docs SET status='waived' WHERE proposal_id = ${PROP}::uuid AND requirement_label = ${LABEL}`;
  const waived = await computeSubmissionReadiness(PROP, tid);
  check('waived → not a blocker (admin-excused)', (waived?.blockers ?? []).every((b) => !(b.category === 'missing_document' && b.message.includes('SF424'))));

  // cleanup
  await sql`DELETE FROM proposal_supporting_docs WHERE proposal_id = ${PROP}::uuid AND requirement_label = ${LABEL}`;
  console.log(pass ? '\n✅ REQUIRED-DOCUMENT READINESS GATE PROVEN' : '\n❌ FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
