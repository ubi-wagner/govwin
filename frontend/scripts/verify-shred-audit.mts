/**
 * Prove the deterministic shred-completeness audit: obligations stated in the solicitation full_text
 * that are NOT represented in the captured requirements surface as candidate gaps; captured ones do
 * not. Mutates the matrix-fixture solicitation's full_text in place, restores it in finally.
 *   DATABASE_URL=<owner conn> npx tsx scripts/verify-shred-audit.mts
 */
import { sql } from '@/lib/db';
import { auditShredCompleteness } from '@/lib/compliance/shred-audit';

const SOL = 'c2000000-0000-4000-8000-000000000001'; // matrix fixture: 1 volume, items "Technical Approach" + "Key Personnel"

// full_text states 5 obligations: 2 that ARE captured (Technical Approach, Key Personnel) and 3 that are NOT
// (Cost Volume, Commercialization Plan, Letter of Support) — the audit should flag exactly the 3 gaps.
const FULL_TEXT = [
  'The offeror shall provide a detailed Technical Approach describing the proposed methodology.',
  'Key Personnel shall be described with roles, qualifications, and level of effort.',
  'The offeror must submit a Cost Volume with a detailed budget narrative and justification.',
  'Proposals shall include a Commercialization Plan describing the path to market and revenue model.',
  'The offeror shall submit a Letter of Support from the partnering research institution.',
].join(' ');

async function main() {
  const [orig] = await sql<{ ft: string | null }[]>`SELECT full_text AS "ft" FROM curated_solicitations WHERE id=${SOL}::uuid`;
  if (orig === undefined) { console.error('matrix-fixture solicitation missing — run seed_e2e_fixtures.mjs'); process.exit(1); }
  let pass = true;
  const check = (l: string, c: boolean) => { console.log(`${c ? '✅' : '❌'} ${l}`); pass &&= c; };
  try {
    await sql`UPDATE curated_solicitations SET full_text=${FULL_TEXT} WHERE id=${SOL}::uuid`;
    const r = await auditShredCompleteness(SOL);
    const gapsJoined = r.candidateGaps.join(' | ').toLowerCase();
    check(`obligations detected (${r.obligationsFound}) ≥ 5`, r.obligationsFound >= 5);
    check(`captured requirements read from the shred (${r.requirementsCaptured}) ≥ 2`, r.requirementsCaptured >= 2);
    check('Cost Volume flagged as an uncaptured gap', gapsJoined.includes('cost volume'));
    check('Commercialization Plan flagged as an uncaptured gap', gapsJoined.includes('commercialization'));
    check('Letter of Support flagged as an uncaptured gap', gapsJoined.includes('letter of support'));
    check('captured "Technical Approach" NOT flagged as a gap', !gapsJoined.includes('technical approach'));
    check('captured "Key Personnel" NOT flagged as a gap', !gapsJoined.includes('key personnel'));
    check('deterministic layer ran without an AI key (aiPass=false)', r.aiPass === false);
  } finally {
    await sql`UPDATE curated_solicitations SET full_text=${orig?.ft ?? null} WHERE id=${SOL}::uuid`;
  }
  console.log(pass ? '\n✅ SHRED-COMPLETENESS AUDIT PROVEN' : '\n❌ FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
