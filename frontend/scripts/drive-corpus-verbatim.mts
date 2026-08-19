/**
 * Live proof (LIB-HYGIENE / mig 197): the corpus check tells the agency's words from the tenant's.
 *
 * WHY THIS SCRIPT EXISTS. The backfill was run first and reported "0 atoms are the agency's words"
 * across 301 atoms — which read like a clean library and was actually a hollow result: this
 * sandbox's `solicitation_documents` table holds ZERO extracted text, so the check had nothing to
 * compare against and could not have said anything else. A detector that has never fired is not a
 * detector. This gives it something real to find.
 *
 * It seeds one solicitation document with genuine agency instruction text, then three atoms:
 *   · one quoting the solicitation VERBATIM (the boilerplate that should stop being a draft candidate)
 *   · one the tenant actually wrote (must stay retrievable — the reverted folder-fence killed these)
 *   · one short heading that appears in both (must NOT be judged — too little text to attribute)
 * checks each, and asserts the retrieval query's own predicate agrees. Everything is rolled back.
 *
 *   cd frontend && DATABASE_URL=$DATABASE_URL_OWNER node --import tsx scripts/drive-corpus-verbatim.mts
 */
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { corpusProbe } from '@/lib/library/corpus-verbatim';

const DB = process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 4, transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });
let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

/** Real DoD SBIR instruction prose — the shape of text that ends up in a library by accident. */
const AGENCY_TEXT = `
The Phase I technical volume shall not exceed ten (10) pages, including all figures, tables and
appendices. Offerors are advised that pages in excess of the stated limit will not be evaluated
and will be removed from the proposal prior to evaluation. The technical volume shall be prepared
using a font no smaller than 10 point, on standard 8.5 by 11 inch paper with margins of not less
than one inch on all sides. Proposals that do not conform to these instructions may be rejected
without further review. All proposals must be submitted through the Defense SBIR/STTR Innovation
Portal by the date and time specified in the announcement; late submissions will not be accepted.
`.trim();

/** The tenant's own capability narrative — nothing like it appears in a solicitation. */
const TENANT_TEXT = `
Immobileyes has delivered forty-one production installations of its edge vision stack across three
states, each running the same containerized inference pipeline that this proposal extends. Our
field data covers 2.3 million vehicle-hours of continuous operation, and the false-positive rate
measured across that fleet is 0.4 percent — an order of magnitude below the threshold the topic
identifies as the state of the practice. The work proposed here hardens that stack for contested
environments rather than inventing a new one, which is why the schedule below is measured in weeks.
`.trim();

async function main() {
  const [sol] = await sql<Array<{ id: string }>>`SELECT id FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`;
  const [tenant] = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug = 'immobileyes' LIMIT 1`;
  if (!sol || !tenant) { console.error('need a curated solicitation + the immobileyes tenant'); process.exit(2); }

  const before = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM solicitation_documents WHERE extracted_text IS NOT NULL`;
  console.log(`\ncorpus before: ${before[0].n} document(s) with extracted text`);

  const docId = randomUUID();
  const ids = { verbatim: randomUUID(), own: randomUUID(), heading: randomUUID() };

  try {
    await sql`
      INSERT INTO solicitation_documents (id, solicitation_id, document_type, original_filename, storage_key, extracted_text, extracted_at)
      VALUES (${docId}::uuid, ${sol.id}::uuid, 'source', 'drive-corpus-verbatim.pdf',
              ${'drive/corpus-verbatim/' + docId}, ${AGENCY_TEXT}, now())
    `;
    A('seeded one solicitation document with real agency instruction text', true, `${AGENCY_TEXT.length} chars`);

    // The three atoms, inserted directly (this proves the DETECTOR, not createAtom's plumbing —
    // that path is covered by the upload connector test).
    for (const [key, text] of [
      ['verbatim', AGENCY_TEXT],
      ['own', TENANT_TEXT],
      ['heading', 'Technical Volume'],
    ] as const) {
      await sql`
        INSERT INTO library_atoms (id, tenant_id, grain, title, content, word_count, char_count, status, source)
        VALUES (${ids[key]}::uuid, ${tenant.id}::uuid, 'primitive', ${'drive-176 ' + key}, ${text},
                ${text.split(/\s+/).length}, ${text.length}, 'approved', 'manual')
      `;
    }

    // The check itself, run exactly as lib/library/corpus-verbatim.ts runs it.
    const check = async (text: string) => {
      const probe = corpusProbe(text);
      if (!probe) return { probed: false, found: false };
      const [r] = await sql<Array<{ found: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM solicitation_documents d
          WHERE d.extracted_text IS NOT NULL
            AND strpos(lower(regexp_replace(d.extracted_text, '\\s+', ' ', 'g')), ${probe}) > 0
        ) AS "found"`;
      return { probed: true, found: r?.found === true };
    };

    const v = await check(AGENCY_TEXT);
    const o = await check(TENANT_TEXT);
    const h = await check('Technical Volume');

    A('the agency boilerplate IS recognised as the agency\'s words', v.probed && v.found);
    A('the tenant\'s own narrative is NOT flagged', o.probed && !o.found, 'probed and cleared');
    A('a bare heading is not judged at all (too little text to attribute)', !h.probed);

    // Now the consequence: the retrieval predicate must drop the flagged one and keep the other.
    await sql`UPDATE library_atoms SET corpus_verbatim = true WHERE id = ${ids.verbatim}::uuid`;
    const kept = await sql<Array<{ id: string }>>`
      SELECT id FROM library_atoms
      WHERE tenant_id = ${tenant.id}::uuid
        AND id = ANY(${[ids.verbatim, ids.own]}::uuid[])
        AND archived_at IS NULL
        AND status = 'approved'
        AND grain <> 'reference'
        AND corpus_verbatim = false`;
    A('retrieval keeps the tenant\'s atom', kept.some((r) => r.id === ids.own));
    A('retrieval drops the agency boilerplate', !kept.some((r) => r.id === ids.verbatim));

    // And it is a FENCE, not a delete: the atom is still there for a human to insert by hand.
    const [still] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM library_atoms
      WHERE id = ${ids.verbatim}::uuid AND archived_at IS NULL`;
    A('the flagged atom is still in the library, un-archived, insertable by hand', still.n === 1);
  } finally {
    await sql`DELETE FROM library_atoms WHERE id = ANY(${Object.values(ids)}::uuid[])`;
    await sql`DELETE FROM solicitation_documents WHERE id = ${docId}::uuid`;
    console.log('\ncleaned up the seeded document + atoms');
  }

  console.log(ok ? '\n✅ ALL PASS — the check fires, and it fires on the right side.' : '\n❌ FAILURES ABOVE');
  await sql.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
