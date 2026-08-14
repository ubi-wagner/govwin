// Drives the remaining agent cohorts live through the SAME producer/emit paths the app uses,
// so the running pipeline worker fires each archetype and records `agent.invoked` in system_events.
// Covers the 12 archetypes not yet proven-live in this stack:
//   Cohort B (OnProposalCreated): proposal_architect, capture_strategist, cost_estimator, pp_matcher
//   Cohort E (advance→review): compliance_reviewer
//   Collaborator: partner_coordinator
//   Ingest platform: rfp_ingest_manager (ingest.assessment_requested), curation_qa (solicitation.triaged)
//   Triage platform: opportunity_scout (opportunities.detected)
//   Queue producers: scoring_strategist + opportunity_analyst (pin), color_team_reviewer (ai-review), library_seed_mapper (seed_map)
// Run under the govtech_app + emulator env; the worker (listening) does the LLM calls.
import { sql, sqlBypass } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor, systemActor } from '@/lib/events';
import { requestAgentTask } from '@/lib/agent-client';
import { requestAiReview } from '@/lib/proposal-ai-review';

const FND = '17780cad-76c0-4cef-95ec-2a536bcf5c8f'; // Foundation
const SOL = '8e58bc07-1e26-5b3f-9f96-425fcba70c4b'; // DOE SBIR/STTR curated solicitation

// Real entities
const [u] = await sqlBypass<Array<{ id: string; email: string }>>`
  select id, email from users where email = 'kate.ulepic@foundation3dp.com' limit 1`;
const props = await sqlBypass<Array<{ id: string; opportunityId: string | null; title: string }>>`
  select id, opportunity_id, title from proposals where tenant_id = ${FND}::uuid order by created_at asc`;
if (!u || props.length === 0) { console.error('missing user/proposals', { u, n: props.length }); process.exit(1); }
const target = props[0];              // OnProposalCreated / advance / seed-map target
const source = props[props.length - 1]; // seed-map source (a different proposal)
const [reviewable] = await sqlBypass<Array<{ id: string; opportunityId: string | null }>>`
  select p.id, p.opportunity_id from proposals p
  where p.tenant_id = ${FND}::uuid
    and exists (select 1 from proposal_sections s where s.proposal_id = p.id and s.content is not null)
  order by p.created_at asc limit 1`;
const oppId = target.opportunityId;
const [opp] = oppId ? await sqlBypass<Array<Record<string, unknown>>>`
  select title, agency, office, program_type, naics_codes, set_aside_type, description
  from opportunities where id = ${oppId}::uuid limit 1` : [undefined as unknown as Record<string, unknown>];

const admin = userActor(u.id, u.email);
const log = (m: string) => console.log(`  · ${m}`);

// ---------- Platform-scope workflow triggers (tenant_id=null) ----------
console.log('▸ platform workflow triggers');
// opportunity_scout — finder:opportunities.detected (phase=single)
await emitEventSingle({
  namespace: 'finder', type: 'opportunities.detected', actor: systemActor(), tenantId: null,
  payload: { source: 'sam.gov', newSolicitations: 3, newTopics: 5,
    sampleTitles: ['DOE SBIR/STTR Phase I Release 2', 'DoW STTR Direct-to-Phase-II', 'NSF SBIR Phase I'] },
});
log('emitted finder:opportunities.detected → OnOpportunitiesDetected (opportunity_scout)');
// rfp_ingest_manager — finder:ingest.assessment_requested:end
{
  const id = await emitEventStart({ namespace: 'finder', type: 'ingest.assessment_requested', actor: admin, tenantId: null,
    payload: { solicitationId: SOL } });
  await emitEventEnd(id, { result: { solicitationId: SOL } });
  log('emitted finder:ingest.assessment_requested → OnIngestAssessmentRequested (rfp_ingest_manager)');
}
// curation_qa — finder:solicitation.triaged:end (toState=review_requested)
{
  const id = await emitEventStart({ namespace: 'finder', type: 'solicitation.triaged', actor: admin, tenantId: null,
    payload: { solicitationId: SOL, toState: 'review_requested' } });
  await emitEventEnd(id, { result: { solicitationId: SOL, toState: 'review_requested' } });
  log('emitted finder:solicitation.triaged → OnSolicitationReviewRequested (curation_qa)');
}

// ---------- Tenant-scope workflow triggers + queue producers ----------
await runInTenant(FND, async () => {
  console.log('▸ tenant workflow triggers');
  // Cohort B — proposal.created:end → OnProposalCreated (architect, capture, cost, pp_matcher, research, seed_suggest)
  {
    const id = await emitEventStart({ namespace: 'proposal', type: 'proposal.created', actor: admin, tenantId: FND,
      payload: { tenantId: FND, topicId: oppId, source: 'portal' } });
    await emitEventEnd(id, { result: { tenantId: FND, proposalId: target.id, opportunityId: oppId, title: target.title } });
    log('emitted proposal:proposal.created → OnProposalCreated (proposal_architect, capture_strategist, cost_estimator, pp_matcher)');
  }
  // Cohort E — proposal.advanced:end (targetStage=review) → OnProposalAdvancedToReview (compliance_reviewer)
  {
    const id = await emitEventStart({ namespace: 'proposal', type: 'proposal.advanced', actor: admin, tenantId: FND,
      payload: { proposalId: target.id, targetStage: 'review' } });
    await emitEventEnd(id, { result: { proposalId: target.id, targetStage: 'review', tenantId: FND } });
    log('emitted proposal:proposal.advanced(review) → OnProposalAdvancedToReview (compliance_reviewer)');
  }
  // partner_coordinator — collaborator.invited:end → OnCollaboratorInvited
  {
    const id = await emitEventStart({ namespace: 'proposal', type: 'collaborator.invited', actor: admin, tenantId: FND,
      payload: { proposalId: target.id } });
    await emitEventEnd(id, { result: { proposalId: target.id, tenantId: FND,
      name: 'Jordan Vega', email: 'jordan.vega@partner.example', role: 'partner_user' } });
    log('emitted proposal:collaborator.invited → OnCollaboratorInvited (partner_coordinator)');
  }

  console.log('▸ tenant queue producers');
  // scoring_strategist + opportunity_analyst — the pin fan-out
  const pinInput = { opportunityId: oppId, opportunity: opp ?? {}, base_score: 0 };
  await requestAgentTask({ tenantId: FND, agentRole: 'scoring_strategist', taskType: 'score_adjustment', input: pinInput });
  await requestAgentTask({ tenantId: FND, agentRole: 'opportunity_analyst', taskType: 'analyze_fit', input: pinInput });
  log('enqueued scoring_strategist(score_adjustment) + opportunity_analyst(analyze_fit)');

  // color_team_reviewer — the canonical AI-review helper (per-section review_section tasks)
  if (reviewable) {
    const { enqueued } = await requestAiReview({ proposalId: reviewable.id, tenantId: FND,
      actorId: u.id, actorEmail: u.email, role: 'tenant_admin', source: 'portal' });
    log(`requestAiReview → ${enqueued} color_team_reviewer(review_section) task(s) on proposal ${reviewable.id}`);
  } else {
    log('!! no reviewable proposal with section content — color_team_reviewer skipped');
  }

  // library_seed_mapper — seed_map (create a seed job, then enqueue like the select route)
  const [job] = await sql<Array<{ id: string }>>`
    insert into library_seed_jobs (tenant_id, proposal_id, status, source_proposal_id)
    values (${FND}::uuid, ${target.id}::uuid, 'mapping', ${source.id}::uuid)
    returning id`;
  await requestAgentTask({ tenantId: FND, agentRole: 'library_seed_mapper', taskType: 'seed_map',
    input: { proposal_id: target.id, tenant_id: FND, seed_job_id: job.id, source_proposal_id: source.id }, proposalId: target.id });
  log(`enqueued library_seed_mapper(seed_map) on seed job ${job.id}`);
});

console.log('\n✅ all remaining cohorts emitted/enqueued. Worker polls every ~10s — check system_events agent.invoked.');
process.exit(0);
