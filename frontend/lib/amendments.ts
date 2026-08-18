/**
 * Amendment fan-out engine (M3) — the canonical helpers for the amendment state machine.
 *
 * detected → confirmed → (per affected proposal) acknowledged, or dismissed. Detection is advisory
 * (admin-logged, or the amendment_monitor agent); confirmation fans the amendment out to every
 * proposal built from the solicitation as a flag the tenant must acknowledge. Every transition posts
 * a start/end (or single) system_event so the whole chain is auditable + automatable:
 *   finder:amendment.detected   (admin logs one)          tenantId=null
 *   finder:amendment.confirmed  (admin confirms → fan-out) tenantId=null
 *   capture:amendment.flagged   (one per affected tenant)  tenantId=<tenant>
 *   finder:amendment.dismissed  (admin dismisses)          tenantId=null
 *   proposal:amendment.acknowledged (tenant acks a flag)   tenantId=<tenant>
 */
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';
import type { Role } from '@/lib/rbac';

export type AmendmentSeverity = 'critical' | 'major' | 'minor' | 'info';
export interface ComplianceDeltaItem {
  change: 'added' | 'removed' | 'changed';
  requirement: string;
  detail: string;
}

export interface AmendmentRecord {
  id: string;
  solicitationId: string;
  label: string;
  summary: string;
  complianceDelta: ComplianceDeltaItem[];
  severity: AmendmentSeverity;
  source: string;
  status: 'detected' | 'confirmed' | 'dismissed';
  detectedAt: string;
  reviewedAt: string | null;
}

interface Actor {
  actorId: string;
  actorEmail: string | null;
  role: Role;
}

/** Admin logs a detected amendment (status='detected'). Advisory — no fan-out yet.
 *  `documentId` (mig 190) links the announcing document so tenants can OPEN the
 *  amendment they are told about, not just read a prose summary of it. */
export async function logAmendment(
  p: Actor & {
    solicitationId: string;
    label: string;
    summary: string;
    complianceDelta: ComplianceDeltaItem[];
    severity: AmendmentSeverity;
    source?: 'manual' | 'amendment_monitor';
    documentId?: string | null;
  },
): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO solicitation_amendments
      (solicitation_id, label, summary, compliance_delta, severity, source, status, detected_by, document_id)
    VALUES (${p.solicitationId}::uuid, ${p.label}, ${p.summary},
            ${sql.json(p.complianceDelta as unknown as Parameters<typeof sql.json>[0])}, ${p.severity}, ${p.source ?? 'manual'}, 'detected', ${p.actorId}::uuid,
            ${p.documentId ?? null}::uuid)
    RETURNING id
  `;
  const payload = { amendmentId: row.id, solicitationId: p.solicitationId, severity: p.severity, label: p.label };
  const startId = await emitEventStart({
    namespace: 'finder',
    type: 'amendment.detected',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    payload,
  });
  await emitEventEnd(startId, { result: payload });
  return { id: row.id };
}

/**
 * Admin confirms an amendment → fan it out to every proposal built from the solicitation.
 * Idempotent per (amendment, proposal). Returns the number of proposals flagged + tenants notified.
 */
export async function confirmAmendment(
  p: Actor & { amendmentId: string; solicitationId: string },
): Promise<{ confirmed: boolean; flagged: number; tenants: number }> {
  // Compare-and-swap: only a 'detected' amendment can be confirmed. A no-op (unknown id or
  // already confirmed/dismissed) returns confirmed:false so the caller can 409, distinct from a
  // genuine confirmation that simply had zero proposals to fan out (confirmed:true, flagged:0).
  const updated = await sql<{ id: string }[]>`
    UPDATE solicitation_amendments
    SET status = 'confirmed', reviewed_by = ${p.actorId}::uuid, reviewed_at = now()
    WHERE id = ${p.amendmentId}::uuid AND solicitation_id = ${p.solicitationId}::uuid AND status = 'detected'
    RETURNING id
  `;
  if (updated.length === 0) return { confirmed: false, flagged: 0, tenants: 0 };

  // Fan out to every ACTIVE proposal built from this solicitation (skip already-flagged + archived).
  const flagged = await sql<{ tenantId: string }[]>`
    INSERT INTO proposal_amendment_flags (amendment_id, proposal_id, tenant_id)
    SELECT ${p.amendmentId}::uuid, pr.id, pr.tenant_id
    FROM proposals pr
    WHERE pr.solicitation_id = ${p.solicitationId}::uuid AND pr.stage <> 'archived'
    ON CONFLICT (amendment_id, proposal_id) DO NOTHING
    RETURNING tenant_id AS "tenantId"
  `;
  const tenantIds = Array.from(new Set(flagged.map((r) => r.tenantId)));

  // Admin audit (start/end around the fan-out).
  const adminPayload = { amendmentId: p.amendmentId, solicitationId: p.solicitationId, flagged: flagged.length, tenants: tenantIds.length };
  const startId = await emitEventStart({
    namespace: 'finder',
    type: 'amendment.confirmed',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    payload: adminPayload,
  });
  await emitEventEnd(startId, { result: adminPayload });

  // One customer-facing event per affected tenant (surfaces in their notification bell).
  for (const tid of tenantIds) {
    const count = flagged.filter((r) => r.tenantId === tid).length;
    await emitEventSingle({
      namespace: 'capture',
      type: 'amendment.flagged',
      actor: userActor(p.actorId, p.actorEmail ?? undefined),
      tenantId: tid,
      payload: { amendmentId: p.amendmentId, solicitationId: p.solicitationId, proposalCount: count },
    });
  }

  // Mirror-card reach: the proposal flags above only land for tenants who already HAVE a
  // provisioned proposal — the pre-purchase/mid-window audience (pinned holders, pending
  // buyers) hears about it through a bridge republish (pin_update_available + the watched-opp
  // notification). Pre-release amendments for a not-yet-provisioned buyer are additionally
  // REPLAYED at provision time (replayConfirmedAmendments, called by release-portal).
  await republishSolicitationCards({ solicitationId: p.solicitationId, actorId: p.actorId });

  return { confirmed: true, flagged: flagged.length, tenants: tenantIds.length };
}

/**
 * Provision-time replay (the mid-window hole, mig 190 cycle): amendments confirmed BETWEEN
 * purchase and release fanned out to zero flags for that buyer — no proposals row existed
 * yet. Called after a proposal is created so the fresh portal opens with every confirmed
 * amendment flagged + a bell notification, exactly as if it had been provisioned first.
 * Idempotent per (amendment, proposal); best-effort by contract (a replay failure must not
 * fail the release — the banner reconciles on the next confirm).
 */
export async function replayConfirmedAmendments(p: {
  solicitationId: string;
  proposalId: string;
  tenantId: string;
  actorId: string;
  actorEmail?: string | null;
}): Promise<{ replayed: number }> {
  try {
    const flagged = await sql<{ amendmentId: string }[]>`
      INSERT INTO proposal_amendment_flags (amendment_id, proposal_id, tenant_id)
      SELECT a.id, ${p.proposalId}::uuid, ${p.tenantId}::uuid
      FROM solicitation_amendments a
      WHERE a.solicitation_id = ${p.solicitationId}::uuid AND a.status = 'confirmed'
      ON CONFLICT (amendment_id, proposal_id) DO NOTHING
      RETURNING amendment_id AS "amendmentId"
    `;
    if (flagged.length > 0) {
      await emitEventSingle({
        namespace: 'capture',
        type: 'amendment.flagged',
        actor: userActor(p.actorId, p.actorEmail ?? undefined),
        tenantId: p.tenantId,
        payload: {
          solicitationId: p.solicitationId, proposalId: p.proposalId,
          proposalCount: 1, replayedAtProvision: true, amendmentCount: flagged.length,
        },
      });
    }
    return { replayed: flagged.length };
  } catch (e) {
    console.error('[amendments] provision replay failed (non-fatal)', p.proposalId, e);
    return { replayed: 0 };
  }
}

/** Admin dismisses a false-positive amendment (status='dismissed'). No fan-out. */
export async function dismissAmendment(
  p: Actor & { amendmentId: string; solicitationId: string },
): Promise<{ dismissed: boolean }> {
  const updated = await sql<{ id: string }[]>`
    UPDATE solicitation_amendments
    SET status = 'dismissed', reviewed_by = ${p.actorId}::uuid, reviewed_at = now()
    WHERE id = ${p.amendmentId}::uuid AND solicitation_id = ${p.solicitationId}::uuid AND status = 'detected'
    RETURNING id
  `;
  if (updated.length === 0) return { dismissed: false };
  const payload = { amendmentId: p.amendmentId, solicitationId: p.solicitationId };
  const startId = await emitEventStart({
    namespace: 'finder',
    type: 'amendment.dismissed',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    payload,
  });
  await emitEventEnd(startId, { result: payload });
  return { dismissed: true };
}

/** Tenant acknowledges an amendment flag on one of their proposals. */
export async function acknowledgeAmendmentFlag(
  p: Actor & { flagId: string; proposalId: string; tenantId: string },
): Promise<{ acknowledged: boolean }> {
  const updated = await sql<{ amendmentId: string }[]>`
    UPDATE proposal_amendment_flags
    SET acknowledged_by = ${p.actorId}::uuid, acknowledged_at = now()
    WHERE id = ${p.flagId}::uuid AND proposal_id = ${p.proposalId}::uuid
      AND tenant_id = ${p.tenantId}::uuid AND acknowledged_at IS NULL
    RETURNING amendment_id AS "amendmentId"
  `;
  if (updated.length === 0) return { acknowledged: false };
  await emitEventSingle({
    namespace: 'proposal',
    type: 'amendment.acknowledged',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload: { flagId: p.flagId, proposalId: p.proposalId, amendmentId: updated[0].amendmentId },
  });
  return { acknowledged: true };
}
