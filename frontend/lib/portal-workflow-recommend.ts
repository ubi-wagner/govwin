/**
 * History-aware workflow recommendation (docs/TENANT_WORKFLOW_SETUP_DESIGN.md §3½.3, TW-1).
 *
 * The required "Accept & Start" setup opens pre-filled from the tenant's OWN prior accepted portals of the
 * same agency + program/phase family (USAF Phase I, Army D2P2, Ohio TVSF) — carrying forward the stages,
 * per-stage gate closer, who was assigned to AI vs a human, and the nudge protocol — re-anchored to this
 * opportunity's close date. Falls back to the static `recommendedGuardrails()` when there's no history.
 *
 * PRIVACY (copy-inward invariant): matches ONLY this tenant's own portals (scoped via withTenant), never
 * another tenant's private config. The platform-wide fallback is the STATIC default (a shared, non-tenant
 * artifact), not a cross-tenant copy.
 */
import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { recommendedGuardrails } from '@/lib/guardrail-defaults';
import type { GuardrailConfig, Stage, StageTodo } from '@/lib/portal-workflow';

export interface WorkflowRecommendation {
  config: GuardrailConfig;
  source: 'history' | 'default';
  /** When source==='history': the prior opportunity the pattern came from (for the UI: "from your …"). */
  basis?: string | null;
}

/** Shift a prior config's absolute dates onto the new timeline; keep relative dueDays as-is. */
function reanchor(config: GuardrailConfig, priorCloseIso: string | null, newCloseIso: string | null): GuardrailConfig {
  const clone = JSON.parse(JSON.stringify(config)) as GuardrailConfig;
  delete clone._setup; // a new proposal starts unaccepted regardless of the source
  const pc = priorCloseIso ? new Date(priorCloseIso).getTime() : NaN;
  const nc = newCloseIso ? new Date(newCloseIso).getTime() : NaN;
  const shiftMs = (!Number.isNaN(pc) && !Number.isNaN(nc)) ? nc - pc : null;
  const shift = (iso: string | null | undefined): string | null | undefined => {
    if (iso == null) return iso;               // absent stays absent (falls back to dueDays)
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || shiftMs == null) return null; // can't re-anchor → drop the absolute (use dueDays)
    return new Date(t + shiftMs).toISOString();
  };
  for (const s of (clone.stages ?? []) as Stage[]) {
    if (s.dueDate !== undefined) s.dueDate = shift(s.dueDate);
    for (const t of (s.todos ?? []) as StageTodo[]) {
      if (t.dueDate !== undefined) t.dueDate = shift(t.dueDate);
    }
  }
  return clone;
}

export async function recommendWorkflowConfig(tenantId: string, opportunityId: string): Promise<WorkflowRecommendation> {
  // 1. This opportunity's agency + program + close date (opportunities is not RLS-forced → plain sql).
  let opp: { agency: string | null; programType: string | null; closeDate: Date | null } | undefined;
  try {
    [opp] = await sql<Array<{ agency: string | null; programType: string | null; closeDate: Date | null }>>`
      SELECT agency, program_type AS "programType", close_date AS "closeDate"
      FROM opportunities WHERE id = ${opportunityId}::uuid LIMIT 1`;
  } catch (e) {
    console.error('[recommend-workflow] opp load failed', e);
  }
  const newCloseIso = opp?.closeDate ? new Date(opp.closeDate).toISOString() : null;

  // 2. Best prior config of the SAME tenant, matching agency and/or program (own history only).
  if (opp && (opp.agency || opp.programType)) {
    try {
      const prior = await withTenant(tenantId, async (tx) => {
        const rows = await tx<Array<{ guardrailConfig: GuardrailConfig; title: string | null; closeDate: Date | null }>>`
          SELECT pp.guardrail_config AS "guardrailConfig", o.title, o.close_date AS "closeDate"
          FROM proposal_portals pp
          JOIN opportunities o ON o.id = pp.opportunity_id
          WHERE pp.tenant_id = ${tenantId}::uuid
            AND pp.opportunity_id <> ${opportunityId}::uuid
            AND jsonb_array_length(COALESCE(pp.guardrail_config->'stages', '[]'::jsonb)) > 0
            AND pp.status IN ('launched','executing','closeout','archived')
            AND ( (${opp.agency}::text IS NOT NULL AND o.agency = ${opp.agency})
               OR (${opp.programType}::text IS NOT NULL AND o.program_type = ${opp.programType}) )
          ORDER BY
            (CASE WHEN ${opp.agency}::text IS NOT NULL AND o.agency = ${opp.agency}
                    AND ${opp.programType}::text IS NOT NULL AND o.program_type = ${opp.programType} THEN 2
                  ELSE 1 END) DESC,
            pp.launched_at DESC NULLS LAST, pp.created_at DESC
          LIMIT 1`;
        return rows[0] ?? null;
      });
      if (prior?.guardrailConfig?.stages?.length) {
        const priorCloseIso = prior.closeDate ? new Date(prior.closeDate).toISOString() : null;
        return { config: reanchor(prior.guardrailConfig, priorCloseIso, newCloseIso), source: 'history', basis: prior.title };
      }
    } catch (e) {
      console.error('[recommend-workflow] history match failed (falling back to default)', e);
    }
  }

  // 3. Fallback — the static recommended default, anchored to this close date.
  return { config: recommendedGuardrails({ closeDate: newCloseIso }) as unknown as GuardrailConfig, source: 'default' };
}
