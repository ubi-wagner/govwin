/** Live end-to-end proof for the SCOUT-INTAKE candidate review→release queue (#176).
 *  Exercises the REAL lib (classifyFinding / releaseAsNew / releaseAsUpdate / dismissCandidate)
 *  against the sandbox DB, then verifies DB state + emitted events. No happy-path shortcuts:
 *  it seeds a genuinely-NEW finding, an UPDATE finding (matches the live TVSF R45 opp), and a
 *  noise finding, and drives all three paths to their terminal RFP-river landing.
 *  cd frontend && DATABASE_URL=… node --import tsx scripts/drive-scout-intake.mts */
import postgres from 'postgres';
import { randomUUID, createHash } from 'crypto';
import {
  classifyFinding, releaseAsNew, releaseAsUpdate, dismissCandidate, listCandidates,
} from '@/lib/scout/candidates';

const DB = process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 4 });
let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

/**
 * A real admin actor, RESOLVED — not pinned.
 *
 * This uuid used to be hardcoded. A pinned id is correct exactly until the database is rebuilt,
 * and then the drive fails on an FK violation that reads like a product bug rather than a moved
 * fixture (docs/E2E_SWEEP_2026-08-23.md §3). Resolved from the role the drive actually needs; if
 * there is no such user the drive exits 2 — CANNOT RUN — which the suite reports as uncovered
 * rather than as a finding.
 */
async function resolveActor() {
  const [u] = await sql<{ id: string; email: string }[]>`
    SELECT id, email FROM users
    WHERE role IN ('master_admin', 'rfp_admin') AND is_active
    ORDER BY (role = 'master_admin') DESC, created_at ASC LIMIT 1`;
  if (!u) {
    console.error('CANNOT RUN\n  no active master_admin/rfp_admin exists — this drive needs one as '
      + 'the FK target for reviewed_by/built_by. Seed an admin and re-run.');
    await sql.end();
    process.exit(2);
  }
  return { actorId: u.id, actorEmail: u.email, role: 'master_admin' as const };
}

const UPDATE_SOL_NUMBER = 'TVSF-R45-818079'; // the live opp we expect the UPDATE finding to match

/**
 * A RUN-UNIQUE solicitation number for the "genuinely new" finding.
 *
 * THE BUG THIS FIXES, and it was in the drive rather than the product. The NEW finding used a fixed
 * `DARPA-QTUN-27`. The first run released it, creating an opportunity with that number — so every
 * run after that, the classifier correctly answered **update** ("same solicitation number") and
 * `stageIntake` correctly refused the duplicate content hash. The drive then failed two assertions
 * and reported the scout-intake flow broken, when the flow had worked perfectly and the drive had
 * destroyed its own precondition by succeeding.
 *
 * A NEW finding has to actually be new. Anything else is asserting that a solicitation you already
 * hold should be treated as unseen, which is the opposite of what this queue is for.
 */
const RUN = randomUUID().slice(0, 8).toUpperCase();
const NEW_SOL_NUMBER = `DARPA-QTUN-${RUN}`;

function seedFinding(title: string, raw: Record<string, unknown>, tag: string) {
  const id = randomUUID();
  const dedup = createHash('sha256').update(`drive176:${tag}:${title}`).digest('hex');
  return sql`
    INSERT INTO scout_findings (id, source_id, purpose, kind, title, url, snippet, status, dedup_hash, raw)
    VALUES (${id}::uuid, NULL, 'opportunity', 'update', ${title}, ${(raw.url as string) ?? null},
            ${(raw.description as string)?.slice(0, 500) ?? null}, 'new', ${dedup},
            ${sql.json(raw)})
    ON CONFLICT (dedup_hash) WHERE dedup_hash IS NOT NULL DO UPDATE SET status='new', match_opportunity_id=NULL,
      classification='unknown', released_kind=NULL, released_ref=NULL, reviewed_at=NULL
    RETURNING id
  `.then((r) => r[0].id as string);
}

async function eventsFor(findingId: string): Promise<string[]> {
  const rows = await sql<{ type: string }[]>`
    SELECT namespace || ':' || type AS type FROM system_events
    WHERE payload->>'findingId' = ${findingId} ORDER BY created_at`;
  return rows.map((r) => r.type);
}

const ACTOR = await resolveActor();

/**
 * Everything THIS RUN created, so the finally block can put the fixture back.
 *
 * Only ids the run produced go in here. A drive that deletes by predicate ("all DARPA findings")
 * eventually deletes something a person seeded — the discipline `verify-db-crud` uses, applied to
 * a drive that writes into the admin triage queue and logs an amendment on a live opportunity.
 */
const created = { findingIds: [] as string[], opportunityIds: [] as string[], amendmentIds: [] as string[] };

try {
  console.log('\n── SCOUT-INTAKE #176 · live end-to-end ──\n');
  console.log(`actor=${ACTOR.actorEmail} · new-finding solicitation=${NEW_SOL_NUMBER}\n`);

  // ── Seed three findings ──────────────────────────────────────────────
  const newId = await seedFinding(
    `Quantum Timing for GPS-Denied Undersea Navigation (${RUN})`,
    { agency: 'DARPA', solicitation_number: NEW_SOL_NUMBER, source: 'sam_gov', source_id: NEW_SOL_NUMBER,
      description: 'DARPA seeks chip-scale atomic clocks for undersea PNT.',
      url: `https://sam.gov/opp/qtun-${RUN.toLowerCase()}` },
    `new-${RUN}`);
  const updId = await seedFinding(
    'TVSF Round 45 — Amendment 2: submission deadline extended 30 days',
    { agency: 'Ohio Third Frontier', solicitation_number: UPDATE_SOL_NUMBER,
      description: 'Deadline moved; budget cap raised to $150k. Re-check compliance.', url: 'https://ohiotvsf.org/r45-amend2' },
    'update');
  const noiseId = await seedFinding(
    'Agency newsletter — quarterly program highlights',
    { agency: '', description: 'General program news, no actionable solicitation.', url: 'https://example.gov/news' },
    'noise');
  A('seeded 3 findings (new / update / noise)', !!(newId && updId && noiseId));
  created.findingIds.push(newId, updId, noiseId);

  // ── Classify all three ───────────────────────────────────────────────
  const rNew = await classifyFinding(newId, ACTOR);
  const rUpd = await classifyFinding(updId, ACTOR);
  const rNoise = await classifyFinding(noiseId, ACTOR);
  A('NEW finding classified new', !('error' in rNew) && rNew.classification === 'new', JSON.stringify(rNew));
  A('UPDATE finding classified update + matched an opp', !('error' in rUpd) && rUpd.classification === 'update' && !!rUpd.matchOpportunityId,
    !('error' in rUpd) ? `${rUpd.reason} (${rUpd.score})` : rUpd.error);

  // The matched opp must be the TVSF R45 one.
  if (!('error' in rUpd) && rUpd.matchOpportunityId) {
    const [m] = await sql<{ solicitationNumber: string }[]>`SELECT solicitation_number AS "solicitationNumber" FROM opportunities WHERE id=${rUpd.matchOpportunityId}::uuid`;
    A('UPDATE matched the correct live opportunity', m?.solicitationNumber === UPDATE_SOL_NUMBER, m?.solicitationNumber);
  }
  A('NOISE finding did not falsely match', !('error' in rNoise) && rNoise.classification !== 'update', !('error' in rNoise) ? rNoise.classification : rNoise.error);

  // ── Release the NEW one → RFP intake/curation ────────────────────────
  const relNew = await releaseAsNew(newId, ACTOR);
  A('releaseAsNew succeeded', !('error' in relNew), 'error' in relNew ? relNew.error : `opp=${relNew.opportunityId}`);
  if (!('error' in relNew)) {
    created.opportunityIds.push(relNew.opportunityId);
    const [cs] = await sql<{ status: string }[]>`SELECT status FROM curated_solicitations WHERE opportunity_id=${relNew.opportunityId}::uuid`;
    A('  → a curated_solicitation (status=new) landed in the RFP Triage Queue', cs?.status === 'new', cs?.status);
    const [opp] = await sql<{ isActive: boolean; source: string }[]>`SELECT is_active AS "isActive", source FROM opportunities WHERE id=${relNew.opportunityId}::uuid`;
    A('  → staged opportunity is inactive (not yet released to the bridge)', opp?.isActive === false, `is_active=${opp?.isActive} source=${opp?.source}`);
    const [f] = await sql<{ status: string; releasedKind: string; releasedRef: string }[]>`SELECT status, released_kind AS "releasedKind", released_ref AS "releasedRef" FROM scout_findings WHERE id=${newId}::uuid`;
    A('  → finding marked pursued/released_kind=new', f?.status === 'pursued' && f?.releasedKind === 'new' && f?.releasedRef === relNew.opportunityId);
  }

  // ── Release the UPDATE one → amendment on the matched opp ─────────────
  const relUpd = await releaseAsUpdate(updId, ACTOR, {});
  A('releaseAsUpdate succeeded', !('error' in relUpd), 'error' in relUpd ? relUpd.error : `amendment=${relUpd.amendmentId}`);
  if (!('error' in relUpd)) {
    created.amendmentIds.push(relUpd.amendmentId);
    const [am] = await sql<{ status: string; label: string; solicitationId: string }[]>`SELECT status, label, solicitation_id AS "solicitationId" FROM solicitation_amendments WHERE id=${relUpd.amendmentId}::uuid`;
    A('  → a solicitation_amendment (status=detected) logged on the matched solicitation', am?.status === 'detected' && am?.solicitationId === relUpd.solicitationId, am?.label);
    const [f] = await sql<{ status: string; releasedKind: string }[]>`SELECT status, released_kind AS "releasedKind" FROM scout_findings WHERE id=${updId}::uuid`;
    A('  → finding marked pursued/released_kind=update', f?.status === 'pursued' && f?.releasedKind === 'update');
  }

  // ── Dismiss the noise one ────────────────────────────────────────────
  const dis = await dismissCandidate(noiseId, ACTOR, 'not an actionable solicitation');
  A('dismissCandidate succeeded', dis.dismissed === true);
  const [nf] = await sql<{ status: string }[]>`SELECT status FROM scout_findings WHERE id=${noiseId}::uuid`;
  A('  → noise finding marked dismissed', nf?.status === 'dismissed');

  // ── Idempotency: re-release an already-resolved finding is refused ────
  const reRel = await releaseAsNew(newId, ACTOR);
  A('re-releasing a resolved finding is refused (idempotent)', 'error' in reRel, 'error' in reRel ? reRel.error : 'UNEXPECTED SUCCESS');

  // ── Audit trail ──────────────────────────────────────────────────────
  const evNew = await eventsFor(newId);
  const evUpd = await eventsFor(updId);
  A('NEW finding audit chain has classify + release', evNew.includes('finder:candidate.classified') && evNew.includes('finder:candidate.released'), evNew.join(', '));
  A('UPDATE finding audit chain has classify + release', evUpd.includes('finder:candidate.classified') && evUpd.includes('finder:candidate.released'), evUpd.join(', '));

  // ── Queue read: resolved rows drop from the default queue ────────────
  const pending = await listCandidates();
  const pendingIds = new Set(pending.map((c) => c.id));
  A('resolved findings dropped from the default review queue', !pendingIds.has(newId) && !pendingIds.has(updId) && !pendingIds.has(noiseId));

  console.log(`\n${ok ? '✅ ALL PASS' : '❌ FAILURES ABOVE'}\n`);
} catch (e) {
  console.error('DRIVE ERROR', e);
  ok = false;
} finally {
  // ── PUT THE FIXTURE BACK ────────────────────────────────────────────────────────────────────
  //
  // BY ID, never by predicate, and only ids this run produced. Left alone, each run added a
  // staged opportunity to the admin triage queue and another amendment to a live opportunity —
  // residue that the next drive, and the next screenshot, then reads as real state.
  //
  // In the `finally` so a failed assertion cleans up too: a drive that only tidies on success
  // leaves its worst mess exactly when something went wrong.
  try {
    let removed = 0;
    for (const id of created.amendmentIds) {
      removed += (await sql`DELETE FROM proposal_amendment_flags WHERE amendment_id = ${id}::uuid`).count;
      removed += (await sql`DELETE FROM solicitation_amendments WHERE id = ${id}::uuid`).count;
    }
    for (const id of created.opportunityIds) {
      removed += (await sql`DELETE FROM curated_solicitations WHERE opportunity_id = ${id}::uuid`).count;
      removed += (await sql`DELETE FROM opportunities WHERE id = ${id}::uuid`).count;
    }
    for (const id of created.findingIds) {
      removed += (await sql`DELETE FROM scout_findings WHERE id = ${id}::uuid`).count;
    }
    console.log(`cleanup: ${removed} row(s) this run created removed — fixture restored`);
  } catch (e) {
    // Reported, not swallowed: residue left behind is a fact the next run needs to know.
    console.error(`cleanup FAILED — this run left rows behind: ${String(e).slice(0, 200)}`);
    console.error(`  findings=${created.findingIds.join(',')} opportunities=${created.opportunityIds.join(',')} amendments=${created.amendmentIds.join(',')}`);
  }
  await sql.end();
  process.exit(ok ? 0 : 1);
}
