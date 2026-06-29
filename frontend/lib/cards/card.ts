/**
 * Opportunity card read-model (R0.3).
 *
 * The card is the carrier that travels the spine (oppStatus:spotlightStatus:
 * projectStatus). It is assembled, never stored whole: a FROZEN origin layer
 * (proposals.origin_card — the L0 opportunity summary + the L1 source bucket,
 * captured at purchase) glued to a LIVE domain projection (proposals.stage,
 * lock state, and the compliance burden computed fresh from
 * proposal_compliance_matrix).
 *
 * The compliance matrix is deliberately NOT part of the frozen origin: an
 * amendment can add requirements, and the section gate enforces the LIVE
 * matrix, so a frozen copy would understate the burden (3-factor review flaw
 * #7 / mig 089). Only truly-immutable fields are frozen.
 *
 * Tenancy: every read is tenant-scoped (CLAUDE.md — portal reads never query by
 * id alone). The caller still verifies tenant access; this is defence in depth.
 */
import { sql } from '@/lib/db';

/** The frozen origin layer — exactly the shape written by the create route. */
export interface OriginCard {
  opportunity?: {
    id?: string;
    title?: string | null;
    agency?: string | null;
    programType?: string | null;
    topicNumber?: string | null;
    solicitationNumber?: string | null;
  };
  bucket?: { key: string; score: number } | null;
  frozenAt?: string;
}

/** The LIVE compliance burden — counts over the current matrix, never frozen. */
export interface ComplianceSummary {
  total: number;
  mandatory: number;
  satisfied: number;
  partial: number;
  notAddressed: number;
  notApplicable: number;
  /** mandatory requirements that are satisfied — the gate-relevant number */
  mandatorySatisfied: number;
  /** mandatory requirements that are applicable (mandatory minus not_applicable) —
   *  the burden DENOMINATOR; percentComplete = mandatorySatisfied / this */
  mandatoryApplicable: number;
  /** 0–100 over mandatory, applicable requirements (the real burden) */
  percentComplete: number;
}

export interface OpportunityCard {
  proposalId: string;
  tenantId: string;
  opportunityId: string;
  title: string;
  /** LIVE build position — owned by the gate machine, read here */
  stage: string;
  isLocked: boolean;
  lockCount: number;
  // TIMESTAMPTZ — postgres.js hydrates these as JS Date (no date-string parser
  // in db.ts), so type them honestly as Date (matches proposals/[proposalId]).
  unlockDeadline: Date | null;
  updatedAt: Date;
  /** lineage: the spotlight bucket the opportunity was bought from (may be null) */
  sourceBucket: string | null;
  /** FROZEN at purchase — never rewritten by a later master edit/amendment */
  origin: OriginCard;
  /** LIVE — recomputed every read from the current matrix */
  compliance: ComplianceSummary;
}

/**
 * Normalise a jsonb column read into a plain object. postgres.js round-trips a
 * value written as `${JSON.stringify(x)}::jsonb` back as a STRING (a value
 * written via `sql.json()` or a DDL default comes back parsed) — so a read-model
 * must tolerate both. The create route writes origin_card via `sql.json()` (it
 * reads back as an object), but legacy/other write paths may yield a string;
 * this keeps the card correct regardless of how the row was written.
 */
export function coerceOriginCard(value: OriginCard | string | null | undefined): OriginCard {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      // a card is a plain object — reject arrays / scalars so the guard means
      // "is it a card", not merely "is it non-null"
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as OriginCard)
        : {};
    } catch {
      return {};
    }
  }
  return Array.isArray(value) ? {} : value;
}

const EMPTY_COMPLIANCE: ComplianceSummary = {
  total: 0,
  mandatory: 0,
  satisfied: 0,
  partial: 0,
  notAddressed: 0,
  notApplicable: 0,
  mandatorySatisfied: 0,
  mandatoryApplicable: 0,
  percentComplete: 0,
};

/**
 * Assemble the card for one proposal, tenant-scoped. Returns null if the
 * proposal does not exist for that tenant. The frozen origin comes straight
 * from the column; the compliance burden is computed live so an amendment is
 * reflected immediately.
 */
export async function getProposalCard(
  proposalId: string,
  tenantId: string,
): Promise<OpportunityCard | null> {
  let head:
    | {
        id: string;
        tenantId: string;
        opportunityId: string;
        title: string;
        stage: string;
        isLocked: boolean;
        lockCount: number;
        unlockDeadline: Date | null;
        updatedAt: Date;
        sourceBucket: string | null;
        originCard: OriginCard | string | null;
      }
    | undefined;
  try {
    [head] = await sql<
      {
        id: string;
        tenantId: string;
        opportunityId: string;
        title: string;
        stage: string;
        isLocked: boolean;
        lockCount: number;
        unlockDeadline: Date | null;
        updatedAt: Date;
        sourceBucket: string | null;
        originCard: OriginCard | string | null;
      }[]
    >`
      SELECT id, tenant_id, opportunity_id, title, stage, is_locked, lock_count,
             unlock_deadline, updated_at, source_bucket, origin_card
      FROM proposals
      WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
  } catch (e) {
    // Deliberate split: the proposal head is the PRIMARY read — fail loud so the
    // caller's try/catch (every server component wraps DB reads) surfaces it,
    // rather than returning a misleading half-card. The compliance summary below
    // is SECONDARY and degrades to empty instead (a card with a known-zero burden
    // is better than no card). Two reads, two deliberate policies.
    console.error('[lib/cards] proposal head query failed:', e);
    throw e;
  }

  if (!head) return null;

  const compliance = await getComplianceSummary(proposalId);

  return {
    proposalId: head.id,
    tenantId: head.tenantId,
    opportunityId: head.opportunityId,
    title: head.title,
    stage: head.stage,
    isLocked: head.isLocked,
    lockCount: head.lockCount,
    unlockDeadline: head.unlockDeadline,
    updatedAt: head.updatedAt,
    sourceBucket: head.sourceBucket,
    origin: coerceOriginCard(head.originCard),
    compliance,
  };
}

/**
 * The LIVE compliance burden for a proposal — a single grouped count over the
 * current matrix. percentComplete is over mandatory + applicable requirements
 * (not_applicable is excluded from the denominator: it cannot be "burden").
 */
export async function getComplianceSummary(proposalId: string): Promise<ComplianceSummary> {
  let row:
    | {
        total: number;
        mandatory: number;
        satisfied: number;
        partial: number;
        notAddressed: number;
        notApplicable: number;
        mandatorySatisfied: number;
        mandatoryApplicable: number;
      }
    | undefined;
  try {
    [row] = await sql<
      {
        total: number;
        mandatory: number;
        satisfied: number;
        partial: number;
        notAddressed: number;
        notApplicable: number;
        mandatorySatisfied: number;
        mandatoryApplicable: number;
      }[]
    >`
      SELECT
        count(*)::int                                                                AS total,
        count(*) FILTER (WHERE is_mandatory)::int                                    AS mandatory,
        count(*) FILTER (WHERE status = 'satisfied')::int                            AS satisfied,
        count(*) FILTER (WHERE status = 'partial')::int                              AS partial,
        count(*) FILTER (WHERE status = 'not_addressed')::int                        AS not_addressed,
        count(*) FILTER (WHERE status = 'not_applicable')::int                       AS not_applicable,
        count(*) FILTER (WHERE is_mandatory AND status = 'satisfied')::int           AS mandatory_satisfied,
        count(*) FILTER (WHERE is_mandatory AND status <> 'not_applicable')::int     AS mandatory_applicable
      FROM proposal_compliance_matrix
      WHERE proposal_id = ${proposalId}::uuid
    `;
  } catch (e) {
    console.error('[lib/cards] compliance summary query failed:', e);
    return EMPTY_COMPLIANCE;
  }

  if (!row) return EMPTY_COMPLIANCE;

  const percentComplete =
    row.mandatoryApplicable > 0
      ? Math.round((row.mandatorySatisfied / row.mandatoryApplicable) * 100)
      : 0;

  return {
    total: row.total,
    mandatory: row.mandatory,
    satisfied: row.satisfied,
    partial: row.partial,
    notAddressed: row.notAddressed,
    notApplicable: row.notApplicable,
    mandatorySatisfied: row.mandatorySatisfied,
    mandatoryApplicable: row.mandatoryApplicable,
    percentComplete,
  };
}
