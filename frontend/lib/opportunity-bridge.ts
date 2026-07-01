/**
 * Opportunity-card bridge — the L0→L1 spine (mig 094).
 *
 * The bridge is the SOLE admin→customer coupling: admin approval publishes a
 * forward-only card VERSION to `opportunity_bridge` (global, append-only); the
 * consumer fans that version out to a denormalized `tenant_opportunity_cards` row
 * for every subscribed tenant (all-opps replication). Tenant cards carry no FK to
 * global opportunities, so a tenant's pipeline is self-sufficient (shard-ready).
 *
 * Design: docs/OPPORTUNITY_CARD_LIFECYCLE_AND_BRIDGE_DESIGN_2026-07-01.md.
 */

import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';

export type BridgeEventType = 'published' | 'updated' | 'closed' | 'reopened' | 'awarded';

/** The customer-visible face of the card (the only part that reaches a tenant). */
export interface OppCard {
  opportunityId: string;
  title: string | null;
  agency: string | null;
  office: string | null;
  solicitationNumber: string | null;
  naicsCodes: string[] | null;
  setAsideType: string | null;
  programType: string | null;
  classificationCode: string | null;
  postedDate: string | null;
  closeDate: string | null;
  awardDate: string | null;
  awardAmount: number | null;
  awardee: string | null;
  estimatedValueMin: number | null;
  estimatedValueMax: number | null;
  description: string | null;
  lifecycleStatus: string | null;
  namespace: string | null;
  complianceSummary: {
    pageLimitTechnical: number | null;
    pageLimitCost: number | null;
    submissionFormat: string | null;
    volumeCount: number;
  } | null;
  frozenAt: string;
}

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

/** Build the customer-visible card snapshot from the master (opportunity + curation + matrix summary). */
export async function buildCardSnapshot(opportunityId: string, frozenAt: string): Promise<OppCard | null> {
  try {
    const [o] = await sql<Array<Record<string, unknown>>>`
      SELECT o.title, o.agency, o.office, o.solicitation_number, o.naics_codes,
             o.set_aside_type, o.program_type, o.classification_code, o.posted_date,
             o.close_date, o.award_date, o.award_amount, o.awardee,
             o.estimated_value_min, o.estimated_value_max, o.description, o.lifecycle_status,
             cs.namespace,
             sc.page_limit_technical, sc.page_limit_cost, sc.submission_format,
             (SELECT count(*)::int FROM solicitation_volumes sv
                WHERE sv.solicitation_id = cs.id AND sv.topic_id IS NULL) AS volume_count
      FROM opportunities o
      LEFT JOIN curated_solicitations cs ON cs.opportunity_id = o.id
      LEFT JOIN solicitation_compliance sc ON sc.solicitation_id = cs.id AND sc.topic_id IS NULL
      WHERE o.id = ${opportunityId}::uuid
      LIMIT 1
    `;
    if (!o) return null;
    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    const hasMatrix = o.pageLimitTechnical != null || o.pageLimitCost != null || (num(o.volumeCount) ?? 0) > 0;
    return {
      opportunityId,
      title: (o.title as string) ?? null,
      agency: (o.agency as string) ?? null,
      office: (o.office as string) ?? null,
      solicitationNumber: (o.solicitationNumber as string) ?? null,
      naicsCodes: (o.naicsCodes as string[]) ?? null,
      setAsideType: (o.setAsideType as string) ?? null,
      programType: (o.programType as string) ?? null,
      classificationCode: (o.classificationCode as string) ?? null,
      postedDate: o.postedDate ? String(o.postedDate) : null,
      closeDate: o.closeDate ? String(o.closeDate) : null,
      awardDate: o.awardDate ? String(o.awardDate) : null,
      awardAmount: num(o.awardAmount),
      awardee: (o.awardee as string) ?? null,
      estimatedValueMin: num(o.estimatedValueMin),
      estimatedValueMax: num(o.estimatedValueMax),
      description: (o.description as string) ?? null,
      lifecycleStatus: (o.lifecycleStatus as string) ?? null,
      namespace: (o.namespace as string) ?? null,
      frozenAt,
      complianceSummary: hasMatrix
        ? {
            pageLimitTechnical: num(o.pageLimitTechnical),
            pageLimitCost: num(o.pageLimitCost),
            submissionFormat: (o.submissionFormat as string) ?? null,
            volumeCount: num(o.volumeCount) ?? 0,
          }
        : null,
    };
  } catch (e) {
    console.error('[bridge] buildCardSnapshot failed', e);
    return null;
  }
}

export interface BridgeEvent {
  id: string;
  opportunityId: string;
  version: number;
  eventType: BridgeEventType;
  card: OppCard;
}

/** Publish a forward-only card version to the bridge (admin approve / update / close). */
export async function publishToBridge(
  opportunityId: string,
  eventType: BridgeEventType,
  postedBy: string | null,
  now: string,
): Promise<BridgeEvent | null> {
  const card = await buildCardSnapshot(opportunityId, now);
  if (!card) return null;
  try {
    const [row] = await sql<Array<{ id: string; version: number }>>`
      INSERT INTO opportunity_bridge (opportunity_id, version, event_type, card, posted_by)
      SELECT ${opportunityId}::uuid,
             COALESCE((SELECT max(version) FROM opportunity_bridge WHERE opportunity_id = ${opportunityId}::uuid), 0) + 1,
             ${eventType}, ${jsonParam(card)}, ${postedBy}
      RETURNING id, version
    `;
    return { id: row.id, opportunityId, version: row.version, eventType, card };
  } catch (e) {
    console.error('[bridge] publishToBridge failed', e);
    return null;
  }
}

/** Upsert one tenant's denormalized card from a bridge event (tenant-scoped via RLS GUC). */
async function applyToTenant(tenantId: string, ev: BridgeEvent): Promise<void> {
  const lifecycle = ev.eventType === 'closed' ? 'closed' : ev.eventType === 'reopened' ? 'open' : ev.card.lifecycleStatus === 'archived' ? 'archived' : ev.card.lifecycleStatus === 'closed' ? 'closed' : 'open';
  await withTenant(tenantId, async (tx) => {
    await tx`
      INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status)
      VALUES (${tenantId}::uuid, ${ev.opportunityId}::uuid, ${jsonParam(ev.card)}, ${ev.version}, ${lifecycle})
      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
        card = EXCLUDED.card,
        bridge_version = EXCLUDED.bridge_version,
        lifecycle_status = EXCLUDED.lifecycle_status,
        pin_update_available = CASE
          WHEN tenant_opportunity_cards.is_pinned AND EXCLUDED.bridge_version > tenant_opportunity_cards.bridge_version
          THEN true ELSE tenant_opportunity_cards.pin_update_available END,
        updated_at = now()
    `;
  });
  // System cursor (not tenant-RLS'd) — records forward-only progress.
  await sql`
    INSERT INTO tenant_bridge_cursor (tenant_id, last_posted_at, last_event_id, last_applied_at)
    VALUES (${tenantId}::uuid, now(), ${ev.id}::uuid, now())
    ON CONFLICT (tenant_id) DO UPDATE SET last_event_id = EXCLUDED.last_event_id, last_applied_at = now()
  `;
}

/** Fan a published card version out to every subscribed tenant (all-opps replication). */
export async function fanOutBridgeEvent(ev: BridgeEvent): Promise<number> {
  let tenants: Array<{ id: string }> = [];
  try {
    tenants = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE status IN ('active','trial')`;
  } catch (e) {
    console.error('[bridge] fan-out tenant list failed', e);
    return 0;
  }
  let applied = 0;
  for (const t of tenants) {
    try {
      await applyToTenant(t.id, ev);
      applied++;
    } catch (e) {
      console.error('[bridge] fan-out to tenant failed', t.id, e);
    }
  }
  return applied;
}

/** Publish + fan out in one call (the approve→publish→replicate path). */
export async function publishAndFanOut(
  opportunityId: string,
  eventType: BridgeEventType,
  postedBy: string | null,
  now: string,
): Promise<{ event: BridgeEvent; tenantsApplied: number } | null> {
  const event = await publishToBridge(opportunityId, eventType, postedBy, now);
  if (!event) return null;
  const tenantsApplied = await fanOutBridgeEvent(event);
  return { event, tenantsApplied };
}

/** New-customer backfill: apply the latest bridge version of every opportunity to a tenant. */
export async function backfillTenant(tenantId: string): Promise<number> {
  let heads: Array<{ id: string; opportunityId: string; version: number; eventType: BridgeEventType; card: OppCard }> = [];
  try {
    heads = await sql`
      SELECT DISTINCT ON (opportunity_id)
             id, opportunity_id, version, event_type, card
      FROM opportunity_bridge
      ORDER BY opportunity_id, version DESC
    ` as typeof heads;
  } catch (e) {
    console.error('[bridge] backfill head query failed', e);
    return 0;
  }
  let applied = 0;
  for (const h of heads) {
    try {
      await applyToTenant(tenantId, { id: h.id, opportunityId: h.opportunityId, version: h.version, eventType: h.eventType, card: h.card });
      applied++;
    } catch (e) {
      console.error('[bridge] backfill apply failed', h.opportunityId, e);
    }
  }
  return applied;
}
