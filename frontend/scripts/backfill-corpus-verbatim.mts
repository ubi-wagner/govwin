/**
 * Backfill `library_atoms.corpus_verbatim` (mig 197 / LIB-HYGIENE).
 *
 * The flag is stamped at creation, so every atom that existed BEFORE the check went in is still
 * unmarked — including the agency boilerplate already sitting in the demo tenants' libraries,
 * which is precisely the material this exists to stop the drafter reaching for. This walks the
 * existing library once and marks what the corpus says is the agency's.
 *
 * Read-mostly and reversible: it only ever sets the flag, never unsets one, and never touches the
 * atom's content, status, tags or archive state. An atom is not deleted, hidden, or made
 * uninsertable — it just stops being an automatic draft candidate.
 *
 *   cd frontend && DATABASE_URL=$DATABASE_URL_OWNER node --import tsx scripts/backfill-corpus-verbatim.mts
 *   ... --dry   report what WOULD be marked, write nothing
 */
import postgres from 'postgres';
import { corpusProbe } from '@/lib/library/corpus-verbatim';

const DRY = process.argv.includes('--dry');
const DB = process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 4, transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });

async function main() {
  // Owner connection on purpose: this walks EVERY tenant's library and reads the platform-owned
  // solicitation corpus. It is an operator script, not a request path.
  const atoms = await sql<Array<{ id: string; tenantId: string; title: string | null; content: string | null }>>`
    SELECT id, tenant_id AS "tenantId", title, content
    FROM library_atoms
    WHERE corpus_verbatim = false
      AND content IS NOT NULL
      AND char_count >= 120
    ORDER BY created_at
  `;
  console.log(`scanning ${atoms.length} unmarked atoms with enough text to judge`);

  let marked = 0, skipped = 0;
  for (const a of atoms) {
    const probe = corpusProbe(a.content);
    if (!probe) { skipped += 1; continue; }
    const [hit] = await sql<Array<{ found: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM solicitation_documents d
        WHERE d.extracted_text IS NOT NULL
          AND strpos(lower(regexp_replace(d.extracted_text, '\\s+', ' ', 'g')), ${probe}) > 0
      ) AS "found"
    `;
    if (!hit?.found) continue;
    marked += 1;
    const label = (a.title ?? a.content ?? '').slice(0, 70).replace(/\s+/g, ' ');
    console.log(`  ${DRY ? 'would mark' : 'marked'}: ${label}…`);
    if (!DRY) {
      await sql`UPDATE library_atoms SET corpus_verbatim = true WHERE id = ${a.id}::uuid`;
    }
  }

  console.log(`\n${DRY ? 'DRY RUN — ' : ''}${marked} atom(s) are the agency's words; ${skipped} too short to judge; ${atoms.length - marked - skipped} are the tenant's own.`);
  await sql.end();
}

main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
