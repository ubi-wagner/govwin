/**
 * drive-curate-baa — do the rfp_admin's actual job on a real BAA, and produce the OPP cards.
 *
 * The upload drive put the document in. This is what a curator does with it: read it, mark what
 * governs every bid, segment the topics out, and release. What comes out is not one card — it is
 * the umbrella plus one card per topic, because a small business does not bid on a BAA, it bids on
 * a topic.
 *
 * ── WHAT IS DELIBERATELY LEFT OUT ────────────────────────────────────────────────────────────
 * Most of a solicitation is present because the law requires it, not because a bidder needs it:
 * FAR and DFARS clause citations, CFR and U.S.C. references, certifications and representations,
 * SAM.gov registration mechanics, the Paperwork Reduction Act notice. On this document that is
 * measurable — including a 13,000-character FAR/DFARS clause appendix beginning at character
 * 1,002,276, which is the last four pages.
 *
 * None of it is highlighted. It is not wrong, it is not hidden, and it stays in the tenant's own
 * copy of the document — but it is not what a lens should be matching, and putting it in front of
 * the ranker is how "materials" matches a warranty clause.
 *
 * ⚠️ NOT read-only. Creates topic opportunities, annotations, and one card per topic per tenant.
 * `--cleanup` removes them.
 *
 * Usage:  node --import tsx frontend/scripts/drive-curate-baa.mts [--cleanup]
 */

import postgres from 'postgres';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const CLEANUP = process.argv.includes('--cleanup');
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

let failures = 0;
const ok = (l: string, p: boolean, d = '') => { console.log(`${p ? '  ✓' : '  ✗'} ${l}${d ? ` — ${d}` : ''}`); if (!p) failures++; };
const n = (v: unknown) => Number(v ?? 0).toLocaleString();

/**
 * The passages that govern EVERY bid against this BAA.
 *
 * Chosen the way a curator chooses: the rules a bidder must satisfy or will be judged against.
 * Not the boilerplate, and not the topic-specific text — a topic carries its own.
 */
const GOVERNING = [
  { need: 'Critical Technology Area', why: 'which technologies are in scope at all' },
  { need: 'Phase I awards', why: 'the award size and period' },
  { need: 'evaluation criteria', why: 'how a proposal is scored' },
  { need: 'Direct to Phase II', why: 'the alternative entry route' },
  { need: 'Technology Readiness Level', why: 'the maturity language the evaluation uses' },
  { need: 'page limit', why: 'the hard formatting constraint' },
  { need: 'cost volume', why: 'the pricing artefact required' },
  { need: 'Phase I Proposal Instructions', why: 'the submission rules' },
];

/** Boilerplate markers — counted, reported, and never highlighted. */
const BOILERPLATE: Array<[string, RegExp]> = [
  ['FAR / DFARS clauses', /\b(FAR|DFARS)\s+\d+[.\-]\d+/g],
  ['CFR citations', /\b\d+\s*CFR\s/g],
  ['U.S.C. citations', /\b\d+\s*U\.?\s?S\.?\s?C\.?\s/g],
  ['certification language', /\bcertif(y|ies|ication|ications)\b/gi],
  ['registration mechanics', /(SAM\.gov|System for Award Management|\bUEI\b|CAGE [Cc]ode)/g],
  ['Paperwork / Privacy Act', /(Paperwork Reduction Act|Privacy Act|OMB Control)/gi],
];

async function main() {
  console.log('\ndrive-curate-baa — the curator\'s pass, and the cards that come out of it\n');

  const [sol] = await owner<Array<{ id: string; oppId: string }>>`
    SELECT cs.id, cs.opportunity_id AS opp_id
    FROM curated_solicitations cs JOIN opportunities o ON o.id = cs.opportunity_id
    WHERE o.solicitation_number = ${'DoW-2026-SBIR-R1'} ORDER BY cs.created_at DESC LIMIT 1`;
  if (!sol) { console.error('HARNESS CANNOT RUN: upload it first (drive-real-solicitation)\n'); process.exit(2); }

  if (CLEANUP) {
    const topics = await owner<Array<{ id: string }>>`
      SELECT id FROM opportunities WHERE solicitation_id = ${sol.id}::uuid AND topic_number IS NOT NULL`;
    const ids = topics.map((t) => t.id);
    if (ids.length) {
      await owner`DELETE FROM tenant_bucket_scores WHERE opportunity_id = ANY(${ids}::uuid[])`;
      await owner`DELETE FROM tenant_opportunity_cards WHERE opportunity_id = ANY(${ids}::uuid[])`;
      await owner`DELETE FROM opportunity_bridge WHERE opportunity_id = ANY(${ids}::uuid[])`;
      await owner`DELETE FROM opportunities WHERE id = ANY(${ids}::uuid[])`;
    }
    await owner`DELETE FROM solicitation_annotations WHERE solicitation_id = ${sol.id}::uuid`;
    console.log(`  removed ${ids.length} topic opportunit${ids.length === 1 ? 'y' : 'ies'} and every annotation\n`);
    await owner.end(); return;
  }

  const [{ fullText: body }] = await owner<Array<{ fullText: string }>>`
    SELECT COALESCE(full_text, '') AS full_text FROM curated_solicitations WHERE id = ${sol.id}::uuid`;
  console.log(`  document: ${n(body.length)} chars\n`);

  // ── 1 · What is here because the law says so ───────────────────────────────────────────────
  console.log('1 · WHAT IS BOILERPLATE — required by law, not by a bidder');
  for (const [label, re] of BOILERPLATE) {
    console.log(`     ${label.padEnd(26)} ${String((body.match(re) ?? []).length).padStart(4)} occurrences`);
  }
  /**
   * Locate the FAR appendix the same careful way as everything else.
   *
   * A bare indexOf found it at char 9,706 — the CONTENTS ENTRY. That wrong offset then fed the
   * "never mark inside the appendix" guard below, which rejected the entire document and reported
   * every governing passage as "only in the contents listing". One contents-page hit silently
   * disabled the function written to avoid contents-page hits, and the failure message was
   * plausible enough to read as a finding about the document.
   *
   * Take the LAST occurrence: an appendix is at the end, and its contents entry is at the front.
   */
  const farAt = body.lastIndexOf('POTENTIAL APPLICABLE FEDERAL ACQUISITION REGULATION');
  if (farAt > 0) {
    console.log(`     FAR/DFARS clause appendix  starts at char ${n(farAt)} (p.${Math.round(farAt / body.length * 330)})`);
    console.log(`                                ${n(body.length - farAt)} chars — the last four pages, none of it highlighted`);
  }

  // ── 2 · Highlight what governs every bid ───────────────────────────────────────────────────
  console.log('\n2 · HIGHLIGHT — the passages that govern every bid against this BAA');
  const { solicitationSaveAnnotationTool } = await import('../lib/tools/solicitation-save-annotation.ts');
  const [actor] = await owner<Array<{ id: string; email: string }>>`
    SELECT id, email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
    ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;
  await owner`DELETE FROM solicitation_annotations WHERE solicitation_id = ${sol.id}::uuid`;

  /** Skip the contents listing: the first hit for any heading is where it is LISTED. */
  const findProse = (needle: string): number => {
    const low = body.toLowerCase(), nl = needle.toLowerCase();
    for (let at = low.indexOf(nl); at >= 0; at = low.indexOf(nl, at + 1)) {
      const w = body.slice(at, at + 160);
      if (/\.{4,}/.test(w)) continue;
      if (/\.\s*\d{1,3}\s*$/.test((w.split('\n')[0] ?? ''))) continue;
      if (farAt > 0 && at > farAt) continue;              // never mark inside the FAR appendix
      return at;
    }
    return -1;
  };
  let marked = 0;
  for (const { need, why } of GOVERNING) {
    const at = findProse(need);
    if (at < 0) { console.log(`     – "${need}" — only in the contents listing, not marked`); continue; }
    const passage = body.slice(at, at + 340).replace(/\s+/g, ' ').trim();
    const page = Math.max(1, Math.round((at / body.length) * 330));
    await solicitationSaveAnnotationTool.handler(
      { solicitationId: sol.id, kind: 'highlight', payload: { why },
        sourceLocation: { page, offset: at, length: passage.length, excerpt: passage, method: 'manual_selection' } } as never,
      { actor: { id: actor.id, role: 'rfp_admin', email: actor.email } } as never);
    marked++;
    console.log(`     ✓ p.${String(page).padStart(3)}  ${why}`);
    console.log(`             "${passage.slice(0, 84)}…"`);
  }
  ok('governing passages marked', marked >= 6, `${marked} of ${GOVERNING.length}`);

  // ── 3 · Segment the topics ─────────────────────────────────────────────────────────────────
  console.log('\n3 · SEGMENT — each topic becomes its own opportunity');
  const { extractTopicsForSolicitation } = await import('../lib/extract-topics.ts');
  const ex = await extractTopicsForSolicitation(sol.id);
  // `totalFound` is what the DOCUMENT contains; `topics` is what is NEW. On a second run every
  // topic already exists, so asserting on `topics` turns correct idempotence into a red.
  ok('topics found in the document', ex.totalFound > 0,
    `${ex.totalFound} found · ${ex.topics.length} new · ${ex.skippedExisting} already present`);

  const [parent] = await owner<Array<{ agency: string; closeDate: Date | null; programType: string }>>`
    SELECT agency, close_date, program_type FROM opportunities WHERE id = ${sol.oppId}::uuid`;
  let created = 0;
  for (const t of ex.topics) {
    const isD2P2 = /-DV\d/i.test(t.topicNumber) || /direct to phase ii/i.test(t.title);
    const [row] = await owner<Array<{ id: string }>>`
      INSERT INTO opportunities
        (source, source_id, title, agency, office, solicitation_number, solicitation_id,
         program_type, phase_type, close_date, description, topic_number, topic_branch,
         topic_status, lifecycle_status, submission_stage, is_active)
      VALUES (
        'manual_upload', ${`topic-${t.topicNumber}`}, ${t.title}, ${parent.agency},
        ${t.branch}, ${'DoW-2026-SBIR-R1'}, ${sol.id}::uuid,
        ${parent.programType}, ${isD2P2 ? 'direct_to_phase_2' : 'phase_1'},
        ${parent.closeDate}, ${t.description}, ${t.topicNumber}, ${t.branch},
        'open', 'open', 'open', true)
      /*
       * ⚠️ RE-HOME ON CONFLICT, not just re-title.
       *
       * This drive creates a NEW curated_solicitation each run and then upserts the 66 topics by
       * (source, source_id) — which is stable across runs. Updating only the title left
       * solicitation_id pointing at the PREVIOUS run's solicitation, so the very next assertion
       * ("each topic is its own opportunity", counted against the current sol.id) found 0 of 66
       * while the insert loop happily reported "66 created this run".
       *
       * It therefore passed exactly once, on a virgin box, and failed every run after — the
       * B146/B147 family: a drive that reports the order it was run in rather than the state of
       * the product. Re-homing is also what a real re-ingest of the same instrument does.
       */
      ON CONFLICT (source, source_id) DO UPDATE SET
        title = EXCLUDED.title,
        solicitation_id = EXCLUDED.solicitation_id,
        topic_status = EXCLUDED.topic_status,
        lifecycle_status = EXCLUDED.lifecycle_status,
        submission_stage = EXCLUDED.submission_stage,
        is_active = EXCLUDED.is_active
      RETURNING id`;
    if (row) created++;
  }
  const [have] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM opportunities
    WHERE solicitation_id = ${sol.id}::uuid AND topic_number IS NOT NULL`;
  ok('each topic is its own opportunity', Number(have.n) === ex.totalFound,
    `${have.n} of ${ex.totalFound}${created ? ` (${created} created this run)` : ' (already present)'}`);

  const byBranch = await owner<Array<{ branch: string; n: number; d2p2: number }>>`
    SELECT COALESCE(topic_branch, '(none)') AS branch, count(*)::int AS n,
           count(*) FILTER (WHERE phase_type = 'direct_to_phase_2')::int AS d2p2
    FROM opportunities WHERE solicitation_id = ${sol.id}::uuid AND topic_number IS NOT NULL
    GROUP BY 1 ORDER BY n DESC`;
  console.log();
  for (const b of byBranch) console.log(`     ${b.branch.padEnd(12)} ${String(b.n).padStart(3)} topics${b.d2p2 ? `  (${b.d2p2} Direct-to-Phase-II)` : ''}`);

  // ── 4 · Release — the umbrella AND every topic ─────────────────────────────────────────────
  console.log('\n4 · RELEASE — the umbrella and every topic onto every tenant mirror');
  const { publishAndFanOut } = await import('../lib/opportunity-bridge.ts');
  const all = await owner<Array<{ id: string }>>`
    SELECT id FROM opportunities WHERE solicitation_id = ${sol.id}::uuid AND topic_number IS NOT NULL`;
  let fanned = 0;
  for (const o of [{ id: sol.oppId }, ...all]) {
    const r = await publishAndFanOut(o.id, 'published', actor.id, new Date().toISOString());
    if (r) fanned++;
  }
  ok('every opportunity fanned out', fanned === all.length + 1, `${fanned} of ${all.length + 1}`);

  // ── 5 · What the tenant now holds ──────────────────────────────────────────────────────────
  console.log('\n5 · WHAT A TENANT NOW HOLDS from this one document');
  const [cards] = await owner<Array<{ cards: number; tenants: number; lex: number; hl: number; bytes: number }>>`
    SELECT count(*)::int AS cards, count(DISTINCT tenant_id)::int AS tenants,
           round(avg(length(card_tsv)))::int AS lex,
           sum(jsonb_array_length(COALESCE(card->'highlights','[]'::jsonb)))::int AS hl,
           sum(pg_column_size(card))::int AS bytes
    FROM tenant_opportunity_cards
    WHERE opportunity_id IN (SELECT id FROM opportunities WHERE solicitation_id = ${sol.id}::uuid OR id = ${sol.oppId}::uuid)
      AND archived_at IS NULL`;
  console.log(`     cards                ${n(cards.cards)} across ${cards.tenants} tenant(s)`);
  console.log(`     mean lexemes/card    ${n(cards.lex)}`);
  console.log(`     highlights carried   ${n(cards.hl)}`);
  const perCard = Math.round(Number(cards.bytes) / Math.max(1, Number(cards.cards)));
  console.log(`     bytes per card       ${n(perCard)}  ·  ${(Number(body.length) / perCard).toFixed(0)}x smaller than the document`);
  ok('the whole document produced many cards, not one', Number(cards.cards) > 60, `${cards.cards} cards`);
  // PER CARD, not in total. The first version compared the SUM across 469 cards against one
  // document's length and failed — 469 small things weigh more than one big thing, which says
  // nothing about whether any of them contains it. The claim is about a single card.
  ok('and no single card contains the document', perCard < Number(body.length) / 100,
    `${n(perCard)} bytes vs ${n(body.length)} chars`);

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  await owner.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await owner.end(); process.exit(1); });
