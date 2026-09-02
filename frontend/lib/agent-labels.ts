/**
 * ONE map from an agent role to the name a PERSON reads. A zero-import leaf.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────
 * There were two maps. `app/api/portal/[tenantSlug]/agents/usage/route.ts` carried ten entries and
 * fell through to `?? row.agentRole`; `components/admin/agent-workforce.tsx` carried thirty-six as
 * part of a richer roster. The registry has thirty-nine. So a customer opening their own Agents
 * panel read:
 *
 *     outcome_analyst · continuity_manager · library_seed_suggester · redaction_guard
 *
 * — twenty-nine of them, in a table headed "Agent". Nothing was broken and nothing looked broken:
 * the fallback returns a perfectly good string. It just was not a name.
 *
 * Found by `scripts/probe-customer-finish.mts`, which reads prose off the rendered page and asks
 * whether a customer is being shown a system identifier.
 *
 * ── THE FALLBACK IS THE POINT ────────────────────────────────────────────────────────────────
 * A curated map is always one archetype behind the registry — this one was four behind, twice. So
 * the fallback TITLE-CASES rather than returning the token: archetype forty reads "Some New Agent"
 * on the day it registers, and the curated entry upgrades it to a better name later. A map is an
 * improvement over the fallback, never a prerequisite for correctness.
 *
 * `__tests__/agent-labels.test.ts` asserts the two halves stay in step and that nothing this
 * function returns can ever contain an underscore.
 */

// The humanizer lives in `lib/humanize.ts` — the opportunity card and the process monitor need
// the same rule, and a second copy is how `sbir_phase_1` and `workflow_manager` both reached a
// customer from two different files. Re-exported here so existing importers keep one name for it.
import { titleizeIdentifier } from '@/lib/humanize';
export { titleizeIdentifier } from '@/lib/humanize';

/** Curated names, keyed by the archetype's `role_name`. Source: the admin Agent Workforce roster. */
export const AGENT_LABELS: Record<string, string> = {
  advisory_manager: 'Advisory Manager',
  amendment_monitor: 'Amendment Monitor',
  capture_strategist: 'Capture Strategist',
  color_team_reviewer: 'Color Team Reviewer',
  compliance_reviewer: 'Compliance Reviewer',
  content_curator: 'Content Curator',
  content_generator: 'Content Generator',
  continuity_manager: 'Continuity Manager',
  cost_estimator: 'Cost Estimator',
  curation_qa: 'Curation QA',
  formatter: 'Formatter',
  ingest_analyst: 'Ingest Analyst',
  librarian: 'Librarian',
  library_seed_mapper: 'Library Seed Mapper',
  library_seed_suggester: 'Library Seed Suggester',
  market_analyst: 'Market Analyst',
  matrix_stager: 'Matrix Stager',
  onboarding_agent: 'Onboarding Concierge',
  opportunity_analyst: 'Opportunity Analyst',
  opportunity_scout: 'Opportunity Scout',
  ops_companion: 'Ops Companion',
  ops_digest: 'Ops Digest',
  outcome_analyst: 'Outcome Analyst',
  packaging_specialist: 'Packaging Specialist',
  partner_coordinator: 'Partner Coordinator',
  pp_matcher: 'Past-Performance Matcher',
  project_manager: 'Project Manager',
  proposal_architect: 'Proposal Architect',
  proposal_manager: 'Proposal Draft Manager',
  redaction_guard: 'Redaction Guard',
  research_scout: 'Research Scout',
  rfp_ingest_manager: 'RFP Ingest Manager',
  scoring_strategist: 'Scoring Strategist',
  section_drafter: 'Section Drafter',
  skeleton_architect: 'Skeleton Architect',
  social_scheduler: 'Social Scheduler',
  status_narrator: 'Status Narrator',
  stylist: 'Stylist',
  traceability_auditor: 'Traceability Auditor',
};

/**
 * The name to render for an agent role. NEVER returns the raw identifier.
 *
 * An empty or missing role is "Agent" rather than an empty cell — a blank where a name belongs is
 * the same failure by a quieter route.
 */
export function agentDisplayName(role: string | null | undefined): string {
  if (!role) return 'Agent';
  return AGENT_LABELS[role] ?? titleizeIdentifier(role);
}
