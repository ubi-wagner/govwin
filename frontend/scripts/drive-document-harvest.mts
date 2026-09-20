/**
 * THE SAME SOLICITATION, ON TWO SITES, UNDER TWO NAMES — CAN THE PRODUCT TELL?
 *
 * Until this build, no. `lib/scout/classify.ts` compares source id → solicitation number → exact
 * title → fuzzy title, and nothing had ever fetched the DOCUMENTS behind a finding, so the one
 * signal that settles the question instantly — the bytes — was not collected.
 *
 * This drives the whole harvest path end to end against the committed fixture corpus:
 *
 *     a finding's page  →  the links that are documents  →  fetch each  →  store  →  a row
 *
 * and then asks the question the capability exists for: does the same file, posted by two
 * different hosts under two different filenames, come back as one hash?
 *
 * ── WHY A FIXTURE AND NOT THE INTERNET ─────────────────────────────────────────────────────────
 * Measured on this box: `curl https://sam.gov` → 000, `dodsbirsttr.mil` → 000. The network policy
 * refuses them. A harvester with only a live driver would be code that has never run end to end
 * here, and "it compiles" is the weakest rung this repo recognises. So the fixture corpus stands
 * in for the internet exactly as the :8787 emulator stands in for the Claude API — and EVERY row
 * it produces is stamped `harvest_driver='fixture'`, because a fixture document must never look
 * like one fetched from an agency.
 *
 * ⚠️ NOT READ-ONLY. It creates two throwaway findings and their harvested rows, and removes both
 * in a `finally`. It writes objects to local storage under `scout-harvest/<finding-id>/`.
 *
 * Run:  source scripts/sandbox-env.sh && cd frontend && node --import tsx scripts/drive-document-harvest.mts
 */
import { sqlBypass } from '@/lib/db';
import { harvestFinding } from '@/lib/harvest/harvest';
import { extractDocumentLinks } from '@/lib/harvest/extract-links';
import { judgeFindingByDocuments } from '@/lib/harvest/judge';

let ok = true;
const A = (label: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok = ok && cond;
};
const phase = (t: string) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 74 - t.length))}`);

const GOV = 'https://www.example.gov/opportunities/AF251-D001';
const AGG = 'https://aggregator.example.com/notice/99812';
const made: string[] = [];

/**
 * ⚠️ `scout_findings.source_id` references `scout_sources`, NOT `source_profiles`. Two different
 * tables, similar names, and only one of them satisfies the foreign key — the first version of
 * this drive used the wrong one and died on a 23503. That is exactly what SCHEMA_MAP.md exists to
 * prevent being guessed at, and the FK message said so in one line.
 */
async function seed(url: string, title: string): Promise<string> {
  const [src] = await sqlBypass<Array<{ id: string }>>`
    SELECT id FROM scout_sources ORDER BY created_at LIMIT 1`;
  const [row] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO scout_findings (source_id, purpose, kind, title, url, status, dedup_hash)
    VALUES (${src?.id ?? null}, 'opportunity', 'lead', ${title}, ${url}, 'new',
            ${`zz-harvest-${Math.random().toString(36).slice(2)}`})
    RETURNING id`;
  made.push(row.id);
  return row.id;
}

try {
  if (process.env.HARVEST_DRIVER === 'live') {
    console.error('✗ HARNESS DEFECT — HARVEST_DRIVER=live. This drive asserts against the committed');
    console.error('  fixture corpus; against the real internet its expectations are meaningless.');
    process.exit(2);
  }

  // ── 1 · the extractor, on the page a curator would be looking at ──────────────────────────
  phase('1 · precision — what a real agency page offers, and what is noise');

  const govHtml = (await import('node:fs')).readFileSync(
    `${process.cwd()}/scripts/fixtures/harvest/www.example.gov/opportunities/AF251-D001`, 'utf8');
  const links = extractDocumentLinks(govHtml, GOV);
  A('the three real documents are kept', links.length === 3,
    links.map((l) => l.url.split('/').pop()).join(', '));
  A('…including the extensionless one, on its LABEL',
    links.some((l) => l.reason === 'link-text' && /download/.test(l.url)));
  A('and the privacy policy, FOIA, mailto, javascript and the Acrobat link are all dropped',
    !links.some((l) => /privacy|foia|mailto|javascript|adobe|usa\.gov/i.test(l.url)));

  // ── 2 · harvest the issuing component's page ──────────────────────────────────────────────
  phase('2 · harvest — fetch, hash, store, record');

  const govFinding = await seed(GOV, 'AF251-D001 — Autonomous Counter-UAS Sensing');
  const gov = await harvestFinding(govFinding);
  A('the page was read and harvested', gov.ok, gov.error ?? `${gov.documents.length} document(s)`);
  A('every document produced a row', gov.documents.length === 3, `${gov.documents.length}`);
  A('each one carries a filename, a size and a sha256',
    gov.documents.every((d) => !!d.filename && (d.size ?? 0) > 0 && (d.hash ?? '').length === 64));

  const rows = await sqlBypass<Array<{ n: number; drivers: string[] }>>`
    SELECT count(*)::int AS n, array_agg(DISTINCT harvest_driver) AS drivers
      FROM scout_finding_documents WHERE finding_id = ${govFinding}::uuid`;
  A('the rows landed in the database', (rows[0]?.n ?? 0) === 3, `${rows[0]?.n} row(s)`);
  A('and every one is stamped as a FIXTURE, not as a fetch from an agency',
    (rows[0]?.drivers ?? []).length === 1 && rows[0].drivers[0] === 'fixture',
    (rows[0]?.drivers ?? []).join(','));

  // ── 3 · the point of the whole capability ─────────────────────────────────────────────────
  phase('3 · the same document, two sites, two filenames');

  const aggFinding = await seed(AGG, 'USAF SBIR D2P2: Counter-UAS Sensing (AF251D001)');
  const agg = await harvestFinding(aggFinding);
  A('the aggregator page harvested too', agg.ok && agg.documents.length === 1,
    `${agg.documents.length} document(s)`);

  const shared = await sqlBypass<Array<{ hash: string; names: string[]; findings: number }>>`
    SELECT content_hash AS hash,
           array_agg(DISTINCT original_filename) AS names,
           count(DISTINCT finding_id)::int AS findings
      FROM scout_finding_documents
     WHERE finding_id = ANY(${[govFinding, aggFinding]}::uuid[]) AND content_hash IS NOT NULL
     GROUP BY content_hash HAVING count(DISTINCT finding_id) > 1`;

  A('ONE hash is carried by BOTH findings', shared.length === 1,
    shared.length ? `${shared[0].hash.slice(0, 16)}…` : 'none — the capability found nothing');
  A('…under two DIFFERENT filenames, which is why a title matcher cannot see it',
    (shared[0]?.names ?? []).length === 2, (shared[0]?.names ?? []).join('  ≠  '));

  // The control. If every document collided, the check above would pass for the wrong reason.
  const distinct = await sqlBypass<Array<{ n: number }>>`
    SELECT count(DISTINCT content_hash)::int AS n FROM scout_finding_documents
     WHERE finding_id = ANY(${[govFinding, aggFinding]}::uuid[]) AND content_hash IS NOT NULL`;
  A('and the OTHER documents did not collide — 3 distinct hashes across 4 rows',
    (distinct[0]?.n ?? 0) === 3, `${distinct[0]?.n} distinct`);

  // ── 4 · a failure is a row, not a silence ─────────────────────────────────────────────────
  phase('4 · a document that could not be fetched');

  const deadFinding = await seed('https://www.example.gov/opportunities/AF251-D001', 'dead-link probe');
  // A page whose links point at fixtures that do not exist: the corpus answers 404, as the
  // internet would, and the harvester must RECORD that rather than drop the document.
  await sqlBypass`UPDATE scout_findings SET url = ${'https://www.example.gov/opportunities/ZZ-missing'}
                   WHERE id = ${deadFinding}::uuid`;
  const dead = await harvestFinding(deadFinding);
  A('a page with no fixture is refused, and says why',
    !dead.ok && dead.code === 'PAGE_UNREADABLE', `${dead.code}: ${dead.error?.slice(0, 60)}`);
  A('…and it did NOT invent documents for a page it could not read', dead.documents.length === 0);

  // ── 5 · re-harvesting converges ───────────────────────────────────────────────────────────
  phase('5 · harvesting the same finding twice');

  const again = await harvestFinding(govFinding);
  A('the second run succeeds', again.ok);
  const after = await sqlBypass<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM scout_finding_documents WHERE finding_id = ${govFinding}::uuid`;
  A('and the row count is UNCHANGED — an upsert, not an accumulation',
    (after[0]?.n ?? 0) === 3, `${after[0]?.n} row(s) after two harvests`);

  // ── 6 · the judgement — annotate the call, never invent a state ───────────────────────────
  phase('6 · what the documents say about the classification');

  const judged = await judgeFindingByDocuments(aggFinding);
  A('the aggregator finding was judged by its documents', judged.ok, judged.error ?? judged.evidence.verdict);
  A('and the evidence names a counterpart FINDING, since the gov page is not yet curated',
    judged.evidence.matches.some((m) => m.ownerKind === 'finding' && m.verdict === 'certain'),
    judged.evidence.matches.map((m) => `${m.ownerKind}:${m.verdict}`).join(' '));
  A('the finding row now carries the evidence',
    (await sqlBypass<Array<{ v: string | null }>>`
      SELECT document_evidence->>'verdict' AS v FROM scout_findings WHERE id = ${aggFinding}::uuid`
    )[0]?.v === 'certain');

  // A finding with nothing harvested must say "nothing to ask", not "no match" — recording a
  // verdict for a check that never ran is the same lie as a green test that never executed.
  const unharvested = await seed('https://www.example.gov/opportunities/AF251-D001', 'never harvested');
  const noDocs = await judgeFindingByDocuments(unharvested);
  A('a finding with no harvested documents is refused, not judged',
    !noDocs.ok && noDocs.code === 'NOT_HARVESTED', `${noDocs.code}`);
  A('…and its evidence column stays NULL — never checked is not the same as nothing found',
    (await sqlBypass<Array<{ v: unknown }>>`
      SELECT document_evidence AS v FROM scout_findings WHERE id = ${unharvested}::uuid`
    )[0]?.v === null);

  // ── 7 · THE BOILERPLATE GUARD, against the real corpus ────────────────────────────────────
  phase('7 · the umbrella BAA — an exact hash that identifies nothing');

  const [boiler] = await sqlBypass<Array<{ hash: string; name: string; sols: number; size: string | null }>>`
    SELECT content_hash AS hash, min(original_filename) AS name,
           count(DISTINCT solicitation_id)::int AS sols, min(file_size)::text AS size
      FROM solicitation_documents WHERE content_hash IS NOT NULL
     GROUP BY content_hash HAVING count(DISTINCT solicitation_id) > 1
     ORDER BY 3 DESC LIMIT 1`;

  if (!boiler) {
    A('a shared attachment exists to test the guard against — UNMEASURED', false,
      'no hash on this box spans two solicitations, so the guard is untested here');
  } else {
    const shim = await seed('https://www.example.gov/opportunities/AF251-D001', 'boilerplate probe');
    await sqlBypass`
      INSERT INTO scout_finding_documents
        (finding_id, page_url, document_url, original_filename, file_size, content_hash, harvest_driver)
      VALUES (${shim}::uuid, 'https://www.example.gov/x', 'https://www.example.gov/x/baa.pdf',
              ${boiler.name}, ${boiler.size ? Number(boiler.size) : null}, ${boiler.hash}, 'fixture')`;
    const b = await judgeFindingByDocuments(shim);
    A(`the shared attachment is found — "${boiler.name.slice(0, 40)}" spans ${boiler.sols} solicitations`,
      b.ok && b.evidence.matches.length > 0, `${b.evidence.matches.length} match(es)`);
    A('its verdict is BOILERPLATE, not certain — an exact hash under many opportunities identifies none',
      b.evidence.verdict === 'boilerplate', b.evidence.verdict);
    A('and it did NOT move the classification',
      b.reclassifiedTo === undefined
      && (await sqlBypass<Array<{ c: string }>>`
           SELECT classification AS c FROM scout_findings WHERE id = ${shim}::uuid`)[0]?.c === 'unknown');
  }

  phase('verdict');
  console.log(`  MUTATED: ${made.length} throwaway finding(s) + their harvested rows, removed below.`);
  console.log('  Objects written under scout-harvest/<finding-id>/ in local storage.');
} catch (err) {
  console.error('\n✗ the drive threw:', err);
  ok = false;
} finally {
  for (const id of made) {
    await sqlBypass`DELETE FROM scout_findings WHERE id = ${id}::uuid`.catch(() => {});
  }
  await sqlBypass.end().catch(() => {});
}

console.log(ok
  ? '\n✅ the same document on two sites comes back as one hash — cross-source matching has something to match on.'
  : '\n✗ harvest does not hold — see the ✗ rows above.');
process.exit(ok ? 0 : 1);
