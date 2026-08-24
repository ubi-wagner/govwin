/**
 * The second tenant, and the in-flight build — the fixture gaps that cap what can be MEASURED.
 *
 * WHY THIS EXISTS. Four separate instruments reported the same thing on the same day, each
 * correctly, each as a note rather than a defect:
 *
 *   check-rls-posture     17 tenant-owned tables empty → "unmeasured, not passing"
 *   verify-db-crud        all 4 Foundation proposals LOCKED — the fixture holds no in-flight
 *                         build, so the primary customer action cannot be demonstrated
 *   verify-surfaces       /portal/[slug]/contracts/[contractId] not driven — `contracts` is empty
 *   mig 212's own proof   canvas_versions / proposal_comments / proposal_stage_history had to be
 *                         seeded BY HAND to measure whether they leaked, because an empty table
 *                         reads 0 in every tenant context and 0 proves nothing
 *
 * A note repeated by four instruments is a finding. The shape of it: every proposal on this box
 * belongs to ONE tenant, and every section of every one is locked. So the entire proposal spine —
 * the eleven tables migs 212/213 just put policies on — has exactly one owner, and "no foreign rows
 * visible" cannot be distinguished from "there was no foreign tenant to see them".
 *
 * That is the weakest possible form of an isolation proof. It is the RLS analogue of B64's rule
 * about rulers: a check that cannot fail is not a check. With one owner, the cross-tenant assertion
 * passes for the wrong reason on a database whose policies could be absent.
 *
 * WHAT IT SEEDS, and why each piece earns its place:
 *
 *   a SECOND tenant's build      the whole point. Two real owners make every proposal-spine
 *                               isolation assertion a two-party test with something to actually
 *                               refuse.
 *   left UNLOCKED, stage=draft   an in-flight build, so section editing — the primary customer
 *                               action — is demonstrable without an admin unlock.
 *   canvas_versions             version history, numbered to the invariant (see below).
 *   proposal_comments           section-anchored review comment.
 *   proposal_stage_history      a real stage transition.
 *   proposal_artifacts,
 *   proposal_compliance_matrix  so the build is shaped like a build rather than a bare row.
 *   contracts                   covers the one portal surface verify-surfaces cannot address.
 *
 * THE canvas_versions INVARIANT IS RESPECTED, and it is easy to get wrong (CLAUDE.md):
 * `proposal_sections.version` must stay STRICTLY GREATER than `MAX(canvas_versions.version_number)`
 * for that section. A version row numbers at the section's CURRENT version and ADVANCES the
 * counter. Numbering at MAX+1 without advancing makes the next human save collide on the slot,
 * where `ON CONFLICT DO NOTHING` silently drops it — undo/history content loss. This seeds v1 and
 * leaves the section at v2. Asserted at the end rather than assumed.
 *
 * IDEMPOTENT. Keyed off a stable title marker, so a re-run updates rather than duplicating — the
 * failure B106 recorded, where a re-run stranded rows because it created before it cleaned.
 *
 * WRITTEN ON THE OWNER POOL. Seeding is bootstrap, one of the sanctioned `sqlBypass` uses: these
 * rows are being created FOR a tenant by the platform, and there is no request context to carry.
 *
 *   cd frontend && npx tsx scripts/seed-isolation-fixture.mts
 *   ... --undo    remove everything this seeds, leaving the box as found
 */
import { sqlBypass } from '@/lib/db';

const UNDO = process.argv.includes('--undo');

/** The marker that makes this idempotent and reversible. Every row this seeds is reachable from it. */
const MARK = '[fixture:isolation]';
const TITLE = `${MARK} AFWERX Open Topic — Autonomous Perception Payload`;
const CONTRACT_TITLE = `${MARK} W911NF-26-C-0042 — Perception Payload Phase II`;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const info = (m: string) => console.log(`    ${m}`);

/** A small but real canvas, so the build measures and exports like a customer's. */
function sectionCanvas(heading: string, body: string) {
  return {
    version: 1,
    canvas: {
      format: 'letter', width: 612, height: 792,
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      font_default: { family: 'Times New Roman', size: 11 },
    },
    metadata: { title: heading },
    nodes: [
      { id: `h-${heading.slice(0, 8)}`, type: 'heading', content: { level: 1, text: heading }, style: {},
        provenance: { source: 'manual' }, history: [], library_eligible: false },
      { id: `p-${heading.slice(0, 8)}`, type: 'text_block', content: { text: body }, style: {},
        provenance: { source: 'manual' }, history: [], library_eligible: false },
    ],
  };
}

const SECTIONS = [
  { n: '1.0', title: 'Technical Volume — Approach',
    body: 'The payload performs on-board detection and track association at 30 Hz with no uplink '
        + 'dependency, degrading to operator hand-off when track confidence falls below threshold. '
        + 'Sensor fusion spans EO/IR and passive RF, with all inference resident on the airframe.' },
  { n: '2.0', title: 'Technical Volume — Milestones',
    body: 'M1 delivers a flight-representative payload integrated to the host airframe. M2 is a '
        + 'contested-environment field trial against the government threat library. M3 delivers the '
        + 'transition package, including the interface control document and sustainment plan.' },
  { n: '3.0', title: 'Cost Volume — Basis of Estimate',
    body: 'Labour is estimated from the incumbent programme actuals at a fully burdened composite '
        + 'rate. Materials reflect quoted unit pricing for the sensor stack. No subcontract work '
        + 'exceeds the solicitation work-split ceiling.' },
];

async function undo() {
  const [{ n: contracts }] = await sqlBypass<Array<{ n: number }>>`
    WITH gone AS (DELETE FROM contracts WHERE title LIKE ${MARK + '%'} RETURNING 1)
    SELECT count(*)::int AS n FROM gone`;

  // The incumbent tenant's version rows live on sections this seed does NOT own, so they are found
  // by their marked `snapshot_reason` rather than by proposal. Rolling the section version back as
  // the row is removed keeps the numbering invariant true in BOTH directions — an undo that
  // deleted the row and left the counter advanced would leave a gap that the next save fills,
  // which is a different silent-collision shape than the one the seed avoids.
  const stray = await sqlBypass<Array<{ sectionId: string }>>`
    SELECT section_id AS "sectionId" FROM canvas_versions WHERE snapshot_reason = ${'seed:' + MARK}`;
  for (const s of stray) {
    await sqlBypass.begin(async (tx) => {
      await tx`DELETE FROM canvas_versions WHERE section_id = ${s.sectionId}::uuid AND snapshot_reason = ${'seed:' + MARK}`;
      await tx`UPDATE proposal_sections SET version = GREATEST(1, version - 1) WHERE id = ${s.sectionId}::uuid`;
    });
  }
  // Children first: the spine tables FK to proposals, and deleting the parent first would either
  // cascade silently or throw depending on the constraint — neither is a thing to leave to chance.
  const [prop] = await sqlBypass<Array<{ id: string }>>`
    SELECT id FROM proposals WHERE title LIKE ${MARK + '%'} LIMIT 1`;
  let rows = 0;
  if (prop) {
    for (const t of ['canvas_versions'] as const) {
      const [{ n }] = await sqlBypass<Array<{ n: number }>>`
        WITH gone AS (
          DELETE FROM ${sqlBypass(t)} WHERE section_id IN (
            SELECT id FROM proposal_sections WHERE proposal_id = ${prop.id}::uuid) RETURNING 1)
        SELECT count(*)::int AS n FROM gone`;
      rows += n;
    }
    for (const t of ['proposal_comments', 'proposal_stage_history', 'proposal_compliance_matrix',
                     'proposal_sections', 'proposal_artifacts'] as const) {
      const [{ n }] = await sqlBypass<Array<{ n: number }>>`
        WITH gone AS (DELETE FROM ${sqlBypass(t)} WHERE proposal_id = ${prop.id}::uuid RETURNING 1)
        SELECT count(*)::int AS n FROM gone`;
      rows += n;
    }
    await sqlBypass`DELETE FROM proposals WHERE id = ${prop.id}::uuid`;
    rows += 1;
  }
  console.log(`\n✓ undo: ${rows} spine row(s) and ${contracts} contract(s) removed — box as found\n`);
}

async function main() {
  if (UNDO) { await undo(); await sqlBypass.end(); return; }

  console.log(`\n── seeding the second-owner fixture ──\n`);

  // CLEAR BEFORE RESOLVING, not after. This originally resolved the owner first and then called
  // undo(), so a proposal left behind by a failed run still counted against its own tenant at
  // resolve time and the seed silently moved to a different one — a re-run that lands somewhere
  // else than the run before it is not idempotent, it just looks like it.
  await undo();

  // The second owner must be a tenant that does NOT already hold a proposal, or this seeds nothing
  // new. Resolved by that property rather than pinned by slug — the fixture-rot lesson from
  // drive-provisioning-cockpit, where a hardcoded tenant id stopped existing on a rehydrate.
  const [owner] = await sqlBypass<Array<{ id: string; slug: string; name: string }>>`
    SELECT t.id, t.slug, t.name FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM proposals p WHERE p.tenant_id = t.id)
      AND EXISTS (SELECT 1 FROM user_memberships m WHERE m.tenant_id = t.id)
    ORDER BY (t.slug = 'immobileyes') DESC, t.slug
    LIMIT 1`;
  if (!owner) {
    console.error('CANT-RUN every tenant already owns a proposal, or none has a member — nothing to seed.');
    process.exit(1);
  }

  // An opportunity to hang it from. proposals.opportunity_id is NOT NULL with a real FK.
  const [opp] = await sqlBypass<Array<{ id: string }>>`SELECT id FROM opportunities ORDER BY created_at LIMIT 1`;
  if (!opp) { console.error('CANT-RUN no opportunity exists to attach a build to.'); process.exit(1); }
  const [author] = await sqlBypass<Array<{ id: string }>>`
    SELECT u.id FROM users u JOIN user_memberships m ON m.user_id = u.id
    WHERE m.tenant_id = ${owner.id}::uuid AND u.is_active ORDER BY u.created_at LIMIT 1`;

  info(`owner: ${owner.slug} (${owner.name})`);

  const [proposal] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposals (tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${owner.id}::uuid, ${opp.id}::uuid, ${TITLE}, 'draft', false)
    RETURNING id`;
  ok(`proposal created — stage=draft, is_locked=false (an IN-FLIGHT build)`);

  // EVERY literal below was read off the live CHECK constraints before it was written, which is a
  // house rule (CLAUDE.md) that this script broke on its first run: `artifact_type = 'document'` is
  // not in the vocabulary and the insert threw. The accepted sets are
  //   proposal_artifacts.artifact_type  narrative | cost | form | matrix | other
  //   proposal_compliance_matrix.status not_addressed | partial | satisfied | not_applicable
  //   canvas_versions.source            ai_draft | human_edit | ai_revision | library_import
  //                                     | template | system
  //   proposal_comments.recommendation_type  human | ai_review | ai_suggestion
  //   contracts.status                  active | closed | terminated
  const [artifact] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO proposal_artifacts (proposal_id, artifact_type, volume_name, volume_number)
    VALUES (${proposal.id}::uuid, 'narrative', 'Technical Volume', 1)
    RETURNING id`;
  ok('artifact created');

  let sectionIds: string[] = [];
  for (const [i, s] of SECTIONS.entries()) {
    const [row] = await sqlBypass<Array<{ id: string }>>`
      INSERT INTO proposal_sections
        (proposal_id, artifact_id, section_number, title, content, status, is_locked,
         volume_name, volume_number, sort_index, version)
      VALUES (${proposal.id}::uuid, ${artifact.id}::uuid, ${s.n}, ${s.title},
              ${JSON.stringify(sectionCanvas(s.title, s.body))}, 'in_progress', false,
              'Technical Volume', 1, ${i + 1}, 2)
      RETURNING id`;
    sectionIds.push(row.id);
  }
  ok(`${sectionIds.length} section(s) — UNLOCKED, status=in_progress, each with a real canvas`);

  // canvas_versions at v1 with the section left at v2 — the invariant, seeded correctly and
  // asserted below rather than trusted.
  for (const [i, sid] of sectionIds.entries()) {
    await sqlBypass`
      INSERT INTO canvas_versions (section_id, version_number, content, snapshot_reason, source, edit_summary)
      VALUES (${sid}::uuid, 1, ${JSON.stringify(sectionCanvas(SECTIONS[i].title, SECTIONS[i].body))}::jsonb,
              'seed', 'human_edit', 'initial draft')
      ON CONFLICT (section_id, version_number) DO NOTHING`;
  }
  ok(`${sectionIds.length} canvas_version(s) at v1, sections at v2`);

  // ── make canvas_versions a TWO-SIDED test ────────────────────────────────────────────────────
  //
  // Seeding only the new tenant's build leaves `canvas_versions`, `proposal_comments` and
  // `proposal_stage_history` owned by one party. That still proves the leak direction — the other
  // tenant must see none of them — but it cannot show the table is readable BY its owner, so a
  // deny-all policy would pass it. On the table that holds the actual proposal text, the stronger
  // assertion is worth having.
  //
  // It is also more realistic. Sixty-four sections on this box are LOCKED with zero version
  // history, which cannot happen in the product: a section is locked because someone edited and
  // then locked it, and the lock path itself writes a version row. A fixture that omits the
  // history is modelling a state the application never produces.
  //
  // The invariant is the delicate part (CLAUDE.md): a version row numbers at the section's CURRENT
  // version and ADVANCES the counter. Both happen in one statement below so a section can never be
  // left with a version row at or above its own version, which is the shape that makes the next
  // save collide and be silently dropped.
  const incumbent = await sqlBypass<Array<{ id: string; version: number; content: string | null }>>`
    SELECT s.id, s.version, s.content
    FROM proposal_sections s
    JOIN proposals p ON p.id = s.proposal_id
    WHERE p.tenant_id <> ${owner.id}::uuid AND s.content IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM canvas_versions cv WHERE cv.section_id = s.id)
    ORDER BY s.created_at
    LIMIT 3`;
  for (const s of incumbent) {
    await sqlBypass.begin(async (tx) => {
      await tx`
        INSERT INTO canvas_versions (section_id, version_number, content, snapshot_reason, source, edit_summary)
        VALUES (${s.id}::uuid, ${s.version}, ${s.content}::jsonb, ${'seed:' + MARK}, 'human_edit',
                'history restored by the isolation fixture')
        ON CONFLICT (section_id, version_number) DO NOTHING`;
      await tx`UPDATE proposal_sections SET version = version + 1 WHERE id = ${s.id}::uuid`;
    });
  }
  if (incumbent.length) {
    ok(`${incumbent.length} version row(s) for the INCUMBENT tenant — canvas_versions is now two-sided`);
  }

  if (author) {
    await sqlBypass`
      INSERT INTO proposal_comments (proposal_id, section_id, user_id, content, recommendation_type)
      VALUES (${proposal.id}::uuid, ${sectionIds[0]}::uuid, ${author.id}::uuid,
              'Tie the 30 Hz claim to the bench data in the appendix before this goes to review.', 'human')`;
    ok('review comment anchored to a section');
  }

  await sqlBypass`
    INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, notes)
    VALUES (${proposal.id}::uuid, NULL, 'draft', 'provisioned from the opportunity card')`;
  ok('stage history recorded');

  const reqs = [
    'The technical volume shall not exceed 20 pages including figures.',
    'The offeror shall identify all subcontracted work as a percentage of total effort.',
    'The proposal shall include a transition plan addressing sustainment.',
  ];
  for (const [i, r] of reqs.entries()) {
    await sqlBypass`
      INSERT INTO proposal_compliance_matrix (proposal_id, section_id, requirement_text, status)
      VALUES (${proposal.id}::uuid, ${sectionIds[i % sectionIds.length]}::uuid, ${r}, 'not_addressed')`;
  }
  ok(`${reqs.length} compliance requirement(s)`);

  await sqlBypass`
    INSERT INTO contracts (tenant_id, opportunity_id, title, status)
    VALUES (${owner.id}::uuid, ${opp.id}::uuid, ${CONTRACT_TITLE}, 'active')`;
  ok('contract created — covers the portal surface verify-surfaces could not address');

  // ── assert what was actually produced, rather than trusting the inserts ────────────────────
  console.log(`\n── what the box now holds ──`);
  const [counts] = await sqlBypass<Array<{
    owners: number; unlocked: number; versions: number; comments: number; history: number; contracts: number;
  }>>`
    SELECT
      (SELECT count(DISTINCT tenant_id)::int FROM proposals)                    AS owners,
      (SELECT count(*)::int FROM proposal_sections WHERE is_locked = false)     AS unlocked,
      (SELECT count(*)::int FROM canvas_versions)                               AS versions,
      (SELECT count(*)::int FROM proposal_comments)                             AS comments,
      (SELECT count(*)::int FROM proposal_stage_history)                        AS history,
      (SELECT count(*)::int FROM contracts)                                     AS contracts`;
  info(`tenants owning proposals : ${counts.owners}   (was 1 — isolation now has two parties)`);
  info(`unlocked sections        : ${counts.unlocked}   (was 0 — an in-flight build exists)`);
  info(`canvas_versions          : ${counts.versions}`);
  info(`proposal_comments        : ${counts.comments}`);
  info(`proposal_stage_history   : ${counts.history}`);
  info(`contracts                : ${counts.contracts}`);

  const [{ bad }] = await sqlBypass<Array<{ bad: number }>>`
    SELECT count(*)::int AS bad FROM proposal_sections s
    WHERE s.version <= COALESCE((SELECT max(version_number) FROM canvas_versions cv WHERE cv.section_id = s.id), -1)`;
  if (bad > 0) {
    console.error(`\n❌ ${bad} section(s) violate version > max(canvas_versions.version_number) — `
      + `the next save would collide on the slot and be silently dropped.`);
    await sqlBypass.end();
    process.exit(1);
  }
  ok('the canvas_versions numbering invariant holds across every section on the box');

  if (counts.owners < 2) {
    console.error('\n❌ still one owner — the cross-tenant assertions remain unfalsifiable.');
    await sqlBypass.end();
    process.exit(1);
  }

  console.log(`\n✅ seeded. Re-run with --undo to remove it.\n`);
  await sqlBypass.end();
}

main().catch(async (e) => {
  console.error('SEED ERROR', e);
  await sqlBypass.end().catch(() => {});
  process.exit(1);
});
