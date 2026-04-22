/**
 * solicitation.get_detail (Phase 1 §E2).
 *
 * Fetches the full curation workspace view for a single solicitation:
 * the curated_solicitations row, its joined opportunity, the
 * solicitation_compliance row, all annotations, and the full triage
 * history (every claim / release / dismiss / approval action).
 *
 * Required role: `rfp_admin`. No tenant filter (admin-scoped).
 *
 * Throws `NotFoundError` if the solicitation doesn't exist.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { defineTool } from './base';

// ─── Input schema ───────────────────────────────────────────────────

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

// ─── Output shape ───────────────────────────────────────────────────

interface SolicitationRow {
  id: string;
  opportunityId: string;
  status: string;
  namespace: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  curatedBy: string | null;
  approvedBy: string | null;
  reviewRequestedFor: string | null;
  phaseLike: string | null;
  aiExtracted: unknown;
  aiConfidence: number | null;
  fullText: string | null;
  annotationsInline: unknown;
  pushedAt: string | null;
  dismissedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OpportunityRow {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  agency: string | null;
  office: string | null;
  programType: string | null;
  solicitationNumber: string | null;
  naicsCodes: string[] | null;
  setAsideType: string | null;
  closeDate: string | null;
  postedDate: string | null;
  description: string | null;
}

interface ComplianceRow {
  id: string;
  solicitationId: string;
  pageLimitTechnical: number | null;
  pageLimitCost: number | null;
  fontFamily: string | null;
  fontSize: string | null;
  margins: string | null;
  submissionFormat: string | null;
  slidesAllowed: boolean | null;
  slideLimit: number | null;
  tabaAllowed: boolean | null;
  piMustBeEmployee: boolean | null;
  customVariables: Record<string, unknown> | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

interface Annotation {
  id: string;
  kind: string;
  complianceVariableName: string | null;
  sourceLocation: unknown;
  payload: unknown;
  createdBy: string;
  createdAt: string;
}

interface TriageAction {
  id: string;
  action: string;
  actorId: string;
  notes: string | null;
  createdAt: string;
}

interface Output {
  solicitation: SolicitationRow;
  opportunity: OpportunityRow;
  compliance: ComplianceRow | null;
  annotations: Annotation[];
  triageHistory: TriageAction[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function toIsoOrNull(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

// ─── Tool definition ────────────────────────────────────────────────

export const solicitationGetDetailTool = defineTool<Input, Output>({
  name: 'solicitation.get_detail',
  namespace: 'solicitation',
  description:
    'Fetch the full curation workspace view for one solicitation: curated_solicitations + opportunity + compliance + annotations + triage history.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId } = input;

    // 1. curated_solicitations + JOIN opportunity (one query — both are required)
    const solRows = await sql`
      SELECT
        cs.id, cs.opportunity_id, cs.status, cs.namespace,
        cs.claimed_by, cs.claimed_at, cs.curated_by, cs.approved_by,
        cs.review_requested_for, cs.phase_like, cs.ai_extracted,
        cs.ai_confidence, cs.full_text, cs.annotations AS annotations_inline,
        cs.pushed_at, cs.dismissed_reason, cs.created_at, cs.updated_at,
        o.id AS opp_id, o.source, o.source_id, o.title,
        o.agency, o.office, o.program_type, o.solicitation_number,
        o.naics_codes, o.set_aside_type, o.close_date, o.posted_date,
        o.description
      FROM curated_solicitations cs
      JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.id = ${solicitationId}::uuid
    `;

    if (solRows.length === 0) {
      throw new NotFoundError(`solicitation not found: ${solicitationId}`);
    }
    const r = solRows[0];

    const solicitation: SolicitationRow = {
      id: r.id,
      opportunityId: r.opportunityId,
      status: r.status,
      namespace: r.namespace ?? null,
      claimedBy: r.claimedBy ?? null,
      claimedAt: toIsoOrNull(r.claimedAt),
      curatedBy: r.curatedBy ?? null,
      approvedBy: r.approvedBy ?? null,
      reviewRequestedFor: r.reviewRequestedFor ?? null,
      phaseLike: r.phaseLike ?? null,
      aiExtracted: r.aiExtracted ?? null,
      aiConfidence: r.aiConfidence ?? null,
      fullText: r.fullText ?? null,
      annotationsInline: r.annotationsInline ?? null,
      pushedAt: toIsoOrNull(r.pushedAt),
      dismissedReason: r.dismissedReason ?? null,
      createdAt: toIsoOrNull(r.createdAt)!,
      updatedAt: toIsoOrNull(r.updatedAt)!,
    };

    const opportunity: OpportunityRow = {
      id: r.oppId,
      source: r.source,
      sourceId: r.sourceId,
      title: r.title,
      agency: r.agency ?? null,
      office: r.office ?? null,
      programType: r.programType ?? null,
      solicitationNumber: r.solicitationNumber ?? null,
      naicsCodes: r.naicsCodes ?? null,
      setAsideType: r.setAsideType ?? null,
      closeDate: toIsoOrNull(r.closeDate),
      postedDate: toIsoOrNull(r.postedDate),
      description: r.description ?? null,
    };

    // 2. compliance (separate because it may not exist yet)
    const compRows = await sql`
      SELECT id, solicitation_id, page_limit_technical, page_limit_cost,
             font_family, font_size, margins, submission_format,
             slides_allowed, slide_limit, taba_allowed, pi_must_be_employee,
             custom_variables, verified_by, verified_at
      FROM solicitation_compliance
      WHERE solicitation_id = ${solicitationId}::uuid
    `;
    const compliance: ComplianceRow | null =
      compRows.length === 0
        ? null
        : {
            id: compRows[0].id,
            solicitationId: compRows[0].solicitationId,
            pageLimitTechnical: compRows[0].pageLimitTechnical ?? null,
            pageLimitCost: compRows[0].pageLimitCost ?? null,
            fontFamily: compRows[0].fontFamily ?? null,
            fontSize: compRows[0].fontSize ?? null,
            margins: compRows[0].margins ?? null,
            submissionFormat: compRows[0].submissionFormat ?? null,
            slidesAllowed: compRows[0].slidesAllowed ?? null,
            slideLimit: compRows[0].slideLimit ?? null,
            tabaAllowed: compRows[0].tabaAllowed ?? null,
            piMustBeEmployee: compRows[0].piMustBeEmployee ?? null,
            customVariables: compRows[0].customVariables ?? null,
            verifiedBy: compRows[0].verifiedBy ?? null,
            verifiedAt: toIsoOrNull(compRows[0].verifiedAt),
          };

    // 3. annotations
    const annRows = await sql`
      SELECT id, kind, compliance_variable_name,
             source_location, payload, created_by, created_at
      FROM solicitation_annotations
      WHERE solicitation_id = ${solicitationId}::uuid
      ORDER BY created_at ASC
    `;
    const annotations: Annotation[] = annRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      complianceVariableName: a.complianceVariableName ?? null,
      sourceLocation: a.sourceLocation,
      payload: a.payload,
      createdBy: a.createdBy,
      createdAt: toIsoOrNull(a.createdAt)!,
    }));

    // 4. triage history
    const triageRows = await sql`
      SELECT id, action, actor_id, notes, created_at
      FROM triage_actions
      WHERE solicitation_id = ${solicitationId}::uuid
      ORDER BY created_at ASC
    `;
    const triageHistory: TriageAction[] = triageRows.map((t) => ({
      id: t.id,
      action: t.action,
      actorId: t.actorId,
      notes: t.notes ?? null,
      createdAt: toIsoOrNull(t.createdAt)!,
    }));

    ctx.log?.info?.({
      msg: 'solicitation.get_detail resolved',
      solicitationId,
      status: solicitation.status,
      annotationsCount: annotations.length,
      triageActionsCount: triageHistory.length,
      hasCompliance: compliance !== null,
    });

    return { solicitation, opportunity, compliance, annotations, triageHistory };
  },
});
