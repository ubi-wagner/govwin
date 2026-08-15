/**
 * Complete a master OPP's build-out and broadcast it (docs/PROVISIONING_WORKSPACE_DESIGN.md, PV-2).
 *
 * Marks the solicitation fully built out (mig 182 build_complete) and RE-PUBLISHES every activated
 * opportunity of it as 'updated', so the forward-only bridge fan-out refreshes each tenant's mirror
 * card — its complianceSummary populates and the provisionReady badge flips on. This is the "release
 * as an OPP update to ALL tenants" half of the two-outcome completion; the purchaser-portal provision
 * is layered on top by the cockpit (PV-3), keeping segregation (shared master vs private portal).
 *
 * The broadcast is an automation PROCESS → bracketed finder:opportunity.build_completed (start/end),
 * per the events doctrine. Idempotent (flag + re-publish are safe to re-run). `readiness` is advisory —
 * the CALLER decides whether to require a confirm when it's below the bar (owner decision: advisory+confirm).
 * Master tables are cross-tenant/admin → sqlBypass.
 */
import { sqlBypass } from '@/lib/db';
import { publishAndFanOut } from '@/lib/opportunity-bridge';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { getBuildReadiness, type BuildReadiness } from '@/lib/provisioning/readiness';

export interface CompleteBuildOutResult {
  ok: boolean;
  readiness: BuildReadiness;
  opportunitiesRepublished: number;
  /** Total tenant mirror cards refreshed by the fan-out (the true broadcast reach — one opp fans to N holders). */
  cardsRefreshed: number;
}

export async function completeBuildOut(
  solId: string,
  actor: { id: string; email?: string | null },
): Promise<CompleteBuildOutResult> {
  const readiness = await getBuildReadiness(solId);

  // The deliberate "done" flag (idempotent).
  await sqlBypass`
    UPDATE curated_solicitations
    SET build_complete = true, build_completed_at = now(), build_completed_by = ${actor.id}::uuid
    WHERE id = ${solId}::uuid`;

  // Every activated opp of the solicitation — the umbrella (cs.opportunity_id) + its topics
  // (o.solicitation_id = cs.id). Re-publishing each broadcasts its refreshed card to all tenants.
  const opps = await sqlBypass<Array<{ id: string }>>`
    SELECT DISTINCT o.id FROM curated_solicitations cs
    JOIN opportunities o ON (o.solicitation_id = cs.id OR o.id = cs.opportunity_id)
    WHERE cs.id = ${solId}::uuid AND o.is_active = true`;

  // Bracket the broadcast fan-out (finally-safe pairing → never an orphan start).
  let startId = '';
  try {
    startId = await emitEventStart({
      namespace: 'finder', type: 'opportunity.build_completed',
      actor: userActor(actor.id, actor.email ?? undefined), tenantId: null,
      payload: { solicitationId: solId, opportunities: opps.length, ready: readiness.ready },
    });
  } catch (e) { console.error('[completeBuildOut] start emit failed (non-fatal)', e); }

  let republished = 0;
  let cardsRefreshed = 0;
  const now = new Date().toISOString();
  for (const o of opps) {
    try {
      const r = await publishAndFanOut(o.id, 'updated', actor.id, now);
      republished++;
      cardsRefreshed += r?.tenantsApplied ?? 0;
    } catch (e) { console.error('[completeBuildOut] republish failed', o.id, e); }
  }

  if (startId) {
    try { await emitEventEnd(startId, { result: { solicitationId: solId, opportunitiesRepublished: republished, cardsRefreshed } }); }
    catch (e) { console.error('[completeBuildOut] end emit failed (non-fatal)', e); }
  }

  return { ok: true, readiness, opportunitiesRepublished: republished, cardsRefreshed };
}
