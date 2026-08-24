// SPINE-T4 live drive — build-out correctness on a REAL provision. Proves:
//   • every REQUIRED volume/artifact ends up with ≥1 section (no invisible zero-item no-op volume)
//   • required SUPPORTING DOCUMENTS are seeded (so the missing_document submission blocker can fire)
// Provisions a throwaway proposal for a real opportunity, asserts, then tears it down.
// Run: DATABASE_URL=<govtech_app> DATABASE_URL_OWNER=<owner> node --import tsx scripts/drive-spine-t4-buildout.mts
import { sqlBypass } from '@/lib/db';
import { provisionProposalForPortal } from '@/lib/provision-proposal';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const OPP = '74afe7dc-5ea8-4bcd-a01f-d6e0b9920b3f';           // DoW 2026 SBIR Navy Phase I (6 volumes)
const KATE = 'bd101904-582d-44db-ac2e-ce63eb341979';

let pass = 0, fail = 0;
const check = (label: string, b: boolean) => { if (b) pass++; else fail++; console.log(`${b ? '✅' : '❌'} ${label}`); };

let proposalId = '';
try {
  const res = await provisionProposalForPortal({
    tenantId: FND, tenantName: 'Foundation', tenantSlug: 'foundation',
    opportunityId: OPP, label: 't4-buildout-probe', actorId: KATE, actorEmail: 'kate.ulepic@foundation3dp.com',
  });
  check('provision ok', !('error' in res));
  if ('error' in res) { console.log('  provision error:', res.error); }
  else {
    proposalId = res.proposalId;
    check(`  …created sections (${res.sectionCount})`, res.sectionCount > 0);

    // Zero-item no-op fix: NO required artifact may have 0 sections.
    const emptyArts = await sqlBypass<Array<{ id: string; volumeName: string | null }>>`
      SELECT a.id, a.volume_name AS "volumeName" FROM proposal_artifacts a
      WHERE a.proposal_id = ${proposalId}::uuid AND a.is_required = true
        AND NOT EXISTS (SELECT 1 FROM proposal_sections s WHERE s.artifact_id = a.id)`;
    check(`no required volume is an empty no-op (0 sectionless required artifacts, saw ${emptyArts.length})`, emptyArts.length === 0);
    const [{ vols, secs }] = await sqlBypass<Array<{ vols: number; secs: number }>>`
      SELECT (SELECT count(*)::int FROM proposal_artifacts WHERE proposal_id=${proposalId}::uuid) AS vols,
             (SELECT count(*)::int FROM proposal_sections WHERE proposal_id=${proposalId}::uuid) AS secs`;
    check(`  …every volume covered (${vols} volumes, ${secs} sections)`, secs >= vols && vols >= 1);

    // Supporting-docs fix: the placeholder categories + any required docs are seeded (blocker can fire).
    const docs = await sqlBypass<Array<{ requirementLabel: string; category: string; isRequired: boolean }>>`
      SELECT requirement_label AS "requirementLabel", category, is_required AS "isRequired"
      FROM proposal_supporting_docs WHERE proposal_id = ${proposalId}::uuid`;
    check(`supporting docs seeded (${docs.length} rows)`, docs.length >= 2);
    check('  …the "Proposal Input Materials" placeholder is present', docs.some((d) => d.category === 'proposal_input'));
    check('  …missing_document blocker CAN now fire (a required-doc/placeholder row exists)', docs.some((d) => d.isRequired) || docs.length >= 2);
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : `❌ ${fail} FAIL`} — SPINE-T4 build-out correctness (${pass} checks)`);
} finally {
  if (proposalId) {
    await sqlBypass`DELETE FROM agent_task_queue WHERE proposal_id=${proposalId}::uuid`;
    await sqlBypass`DELETE FROM canvas_versions WHERE section_id IN (SELECT id FROM proposal_sections WHERE proposal_id=${proposalId}::uuid)`;
    await sqlBypass`DELETE FROM proposal_compliance_matrix WHERE proposal_id=${proposalId}::uuid`;
    await sqlBypass`DELETE FROM proposal_supporting_docs WHERE proposal_id=${proposalId}::uuid`;
    await sqlBypass`DELETE FROM proposal_sections WHERE proposal_id=${proposalId}::uuid`;
    await sqlBypass`DELETE FROM proposal_artifacts WHERE proposal_id=${proposalId}::uuid`;
    await sqlBypass`DELETE FROM tasks WHERE entity_id=${proposalId}::uuid`;
    await sqlBypass`DELETE FROM library_seed_jobs WHERE proposal_id=${proposalId}::uuid`;
    // WHAT THE ENGINE MADE OF THEM, before the events themselves.
    //
    // This drive emits real events, and on a box with a live worker the engine CONSUMES them: a
    // `process_instances` row is created carrying `trigger_event_id`. Deleting the event then
    // fails on the foreign key —
    //     Key (id)=(953c0a67…) is still referenced from table "process_instances"
    // — and the whole teardown aborts, leaving the proposal and everything under it behind. The
    // drive had been passing only because the worker had not gotten to the event in time; that is
    // a race, and it resolves the wrong way as often as the right one.
    //
    // Scoped through `trigger_event_id` rather than by proposal or by time: an instance is removed
    // only if the event that CAUSED it is one this run is deleting. A tidier-looking predicate
    // (everything recent, everything for this opportunity) would reach instances the drive never
    // caused — and this is the workflow engine's own table.
    //
    // Same class as B119: a teardown that removes what it INSERTED rather than what it CAUSED.
    await sqlBypass`
      DELETE FROM process_instance_transitions WHERE instance_id IN (
        SELECT id FROM process_instances WHERE trigger_event_id IN (
          SELECT id FROM system_events WHERE payload->>'proposalId' = ${proposalId}))`;
    await sqlBypass`
      DELETE FROM process_instances WHERE trigger_event_id IN (
        SELECT id FROM system_events WHERE payload->>'proposalId' = ${proposalId})`;
    await sqlBypass`DELETE FROM system_events WHERE payload->>'proposalId'=${proposalId}`;
    await sqlBypass`DELETE FROM proposals WHERE id=${proposalId}::uuid`;
  }
  await sqlBypass.end();
}
process.exit(fail === 0 ? 0 : 1);
