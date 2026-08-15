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

import { sql, sqlBypass } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { coarseStatus, isSubmissionStage, type SubmissionStage, type BridgeEventType } from '@/lib/lifecycle';
import { emitEventSingle, systemActor } from '@/lib/events';
import { scoreCardForTenant } from '@/lib/bucket-ranking';

// Re-exported so existing `import { BridgeEventType } from '@/lib/opportunity-bridge'` keeps working.
export type { BridgeEventType };

/** The customer-visible face of the card (the only part that reaches a tenant). */
export interface OppCard {
  opportunityId: string;
  title: string | null;
  agency: string | null;
  office: string | null;
  orgUnit: string | null;
  solicitationNumber: string | null;
  naicsCodes: string[] | null;
  setAsideType: string | null;
  programType: string | null;
  classificationCode: string | null;
  postedDate: string | null;
  preReleaseDate: string | null;
  openDate: string | null;
  closeDate: string | null;
  awardDate: string | null;
  awardAmount: number | null;
  awardee: string | null;
  estimatedValueMin: number | null;
  estimatedValueMax: number | null;
  description: string | null;
  spotlightSummary: string | null;
  expertNotes: string | null;
  lifecycleStatus: string | null;
  submissionStage: SubmissionStage;
  namespace: string | null;
  builtBy: string | null;
  builtByEmail: string | null;
  releasedBy: string | null;
  releasedByEmail: string | null;
  releasedAt: string | null;
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
      SELECT o.title, o.agency, o.office, o.org_unit, o.solicitation_number, o.naics_codes,
             o.set_aside_type, o.program_type, o.classification_code, o.posted_date,
             o.pre_release_date, o.open_date, o.close_date, o.award_date, o.award_amount, o.awardee,
             o.estimated_value_min, o.estimated_value_max, o.description, o.expert_notes,
             o.lifecycle_status, o.submission_stage,
             o.built_by, o.released_by, o.released_at,
             ub.email AS built_by_email, ur.email AS released_by_email,
             cs.namespace, cs.spotlight_summary,
             sc.page_limit_technical, sc.page_limit_cost, sc.submission_format,
             (SELECT count(*)::int FROM solicitation_volumes sv
                WHERE sv.solicitation_id = cs.id AND sv.topic_id IS NULL) AS volume_count
      FROM opportunities o
      -- Resolve the solicitation for BOTH the umbrella (cs.opportunity_id = o.id)
      -- and its topics (o.solicitation_id = cs.id). Without the topic arm, a topic
      -- card came out with null namespace/compliance/volume_count once multi-topic
      -- fan-out started publishing topics as cards.
      LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id OR cs.opportunity_id = o.id
      LEFT JOIN solicitation_compliance sc ON sc.solicitation_id = cs.id AND sc.topic_id IS NULL
      LEFT JOIN users ub ON ub.id = o.built_by
      LEFT JOIN users ur ON ur.id = o.released_by
      WHERE o.id = ${opportunityId}::uuid
      -- Deterministic tiebreak if an opportunity matches TWO curated_solicitations (one via each
      -- join arm): prefer the direct solicitation_id (topic) arm, then stable by cs.id, so the
      -- snapshot's namespace/compliance/volume_count can't flip between runs (sweep F6).
      ORDER BY (cs.id = o.solicitation_id) DESC NULLS LAST, cs.id
      LIMIT 1
    `;
    if (!o) return null;
    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    const str = (v: unknown): string | null => (v == null ? null : String(v));
    const hasMatrix = o.pageLimitTechnical != null || o.pageLimitCost != null || (num(o.volumeCount) ?? 0) > 0;
    return {
      opportunityId,
      title: (o.title as string) ?? null,
      agency: (o.agency as string) ?? null,
      office: (o.office as string) ?? null,
      orgUnit: (o.orgUnit as string) ?? null,
      solicitationNumber: (o.solicitationNumber as string) ?? null,
      naicsCodes: (o.naicsCodes as string[]) ?? null,
      setAsideType: (o.setAsideType as string) ?? null,
      programType: (o.programType as string) ?? null,
      classificationCode: (o.classificationCode as string) ?? null,
      postedDate: str(o.postedDate),
      preReleaseDate: str(o.preReleaseDate),
      openDate: str(o.openDate),
      closeDate: str(o.closeDate),
      awardDate: str(o.awardDate),
      awardAmount: num(o.awardAmount),
      awardee: (o.awardee as string) ?? null,
      estimatedValueMin: num(o.estimatedValueMin),
      estimatedValueMax: num(o.estimatedValueMax),
      description: (o.description as string) ?? null,
      spotlightSummary: (o.spotlightSummary as string) ?? null,
      expertNotes: (o.expertNotes as string) ?? null,
      lifecycleStatus: (o.lifecycleStatus as string) ?? null,
      submissionStage: isSubmissionStage(o.submissionStage) ? o.submissionStage : 'open',
      namespace: (o.namespace as string) ?? null,
      builtBy: str(o.builtBy),
      builtByEmail: (o.builtByEmail as string) ?? null,
      releasedBy: str(o.releasedBy),
      releasedByEmail: (o.releasedByEmail as string) ?? null,
      releasedAt: str(o.releasedAt),
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
  // Race-safe version allocation. Two concurrent publishes for the SAME opportunity can both
  // read max(version)=N and compute N+1; the UNIQUE(opportunity_id,version) index lets exactly
  // one win. `ON CONFLICT DO NOTHING` turns the loser into a no-op (empty RETURNING) instead of
  // a duplicate-key throw — so we recompute the now-higher max and retry, rather than nulling
  // out (and never fanning out) a real lifecycle transition. Bounded so a pathological hot opp
  // can't spin forever.
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const [row] = await sql<Array<{ id: string; version: number }>>`
        INSERT INTO opportunity_bridge (opportunity_id, version, event_type, card, posted_by)
        SELECT ${opportunityId}::uuid,
               COALESCE((SELECT max(version) FROM opportunity_bridge WHERE opportunity_id = ${opportunityId}::uuid), 0) + 1,
               ${eventType}, ${jsonParam(card)}, ${postedBy}
        ON CONFLICT (opportunity_id, version) DO NOTHING
        RETURNING id, version
      `;
      if (row) return { id: row.id, opportunityId, version: row.version, eventType, card };
    }
    console.error('[bridge] publishToBridge exhausted version-allocation retries', opportunityId);
    return null;
  } catch (e) {
    console.error('[bridge] publishToBridge failed', e);
    return null;
  }
}

/** Upsert one tenant's denormalized card from a bridge event (tenant-scoped via RLS GUC).
 *  `watched` (RANK-8) = this master opp is admin-pinned for updates, so a newer version landing on an
 *  EXISTING mirror card fans an elevated update notification to this holder (pre-purchase reach). */
async function applyToTenant(tenantId: string, ev: BridgeEvent, watched = false): Promise<void> {
  // Canonical stage from the card drives the coarse lifecycle_status the feed uses.
  // Fall back to the event type / coarse lifecycleStatus for LEGACY cards whose JSON
  // predates submission_stage — otherwise a re-fanned/backfilled closed or archived
  // opp would resurface as 'open' in the customer feed.
  const stage: SubmissionStage = isSubmissionStage(ev.card.submissionStage)
    ? ev.card.submissionStage
    : ev.eventType === 'closed' ? 'closed'
    : ev.eventType === 'archived' ? 'archived'
    : ev.eventType === 'reopened' ? 'open'
    : ev.card.lifecycleStatus === 'archived' ? 'archived'
    : ev.card.lifecycleStatus === 'closed' ? 'closed'
    : 'open';
  const lifecycle = coarseStatus(stage);
  // Forward-only apply. A stale (lower-or-equal bridge_version) event must NOT overwrite a
  // newer card — otherwise an out-of-order fan-out (v_N applied after v_{N+1}, e.g. two
  // overlapping lifecycle changes) would resurface a closed opp as 'open' in the customer
  // feed. The `WHERE EXCLUDED.bridge_version > current` makes a stale apply a no-op; RETURNING
  // tells us whether the card actually advanced, so we skip the cursor bump AND the rescore
  // emit for a no-op (the mirror already holds newer state).
  const { applied, existedBefore } = await withTenant(tenantId, async (tx) => {
    // Was the card already in this tenant's mirror? Distinguishes a first-sight apply (a new/backfilled
    // holder) from a genuine UPDATE — only the latter fans a watched-opp update notification (RANK-8).
    const [prior] = await tx<Array<{ bridgeVersion: number }>>`
      SELECT bridge_version FROM tenant_opportunity_cards
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${ev.opportunityId}::uuid`;
    const rows = await tx`
      INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage)
      VALUES (${tenantId}::uuid, ${ev.opportunityId}::uuid, ${jsonParam(ev.card)}, ${ev.version}, ${lifecycle}, ${stage})
      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
        card = EXCLUDED.card,
        bridge_version = EXCLUDED.bridge_version,
        lifecycle_status = EXCLUDED.lifecycle_status,
        submission_stage = EXCLUDED.submission_stage,
        pin_update_available = CASE
          WHEN tenant_opportunity_cards.is_pinned AND EXCLUDED.bridge_version > tenant_opportunity_cards.bridge_version
          THEN true ELSE tenant_opportunity_cards.pin_update_available END,
        updated_at = now()
      WHERE EXCLUDED.bridge_version > tenant_opportunity_cards.bridge_version
      RETURNING tenant_id
    `;
    return { applied: rows.length > 0, existedBefore: !!prior };
  });
  if (!applied) return;
  // System cursor (not tenant-RLS'd) — records forward-only progress. Only advances when the
  // card advanced above, so a stale apply can't regress last_event_id either.
  await sql`
    INSERT INTO tenant_bridge_cursor (tenant_id, last_posted_at, last_event_id, last_applied_at)
    VALUES (${tenantId}::uuid, now(), ${ev.id}::uuid, now())
    ON CONFLICT (tenant_id) DO UPDATE SET last_event_id = EXCLUDED.last_event_id, last_applied_at = now()
  `;
  // Scoring is TENANT-SIDE + EVENT-DRIVEN now — NOT baked into this admin-push fan-out.
  // Announce the card landed/updated in the tenant's mirror; the pipeline OnCardApplied
  // workflow deterministically rescores it against the tenant's buckets (the
  // scoring_strategist agent overlays this later, with memory + pin/purchase levers).
  // "One brain, two spines, a bridge": the bridge DELIVERS, the tenant spine SCORES.
  // Best-effort — an emit failure must not fail the fan-out (the rescore can be re-driven).
  try {
    await emitEventSingle({
      namespace: 'capture',
      type: 'card.applied',
      actor: systemActor('bridge'),
      tenantId,
      payload: { tenantId, opportunityId: ev.opportunityId, version: ev.version },
    });
  } catch (emitErr) {
    console.error('[bridge] card.applied emit failed (non-fatal)', tenantId, emitErr);
  }
  // Synchronous scoring FALLBACK (RANK-6): rank the just-applied card against all active buckets HERE,
  // so it ranks the instant it lands even if the pipeline OnCardApplied worker is down. Idempotent with
  // that async path (same upsert), closing the one gap provisioning + bucket-create already cover inline.
  // Best-effort — a scoring failure must never fail the fan-out (the async rescore still re-drives it).
  try {
    await scoreCardForTenant(tenantId, ev.opportunityId, Date.now());
  } catch (scoreErr) {
    console.error('[bridge] sync score fallback failed (non-fatal)', tenantId, scoreErr);
  }
  // Admin pin-for-updates (RANK-8): a WATCHED master opp getting a newer version on an EXISTING mirror
  // card is an update the holder should hear about NOW — pre-purchase (today's amendment engine only
  // reaches opps that already have a proposal). Elevated notification the customer bell + CC surface.
  // Best-effort; first-sight applies (existedBefore=false) are skipped so a new holder isn't "updated".
  if (watched && existedBefore) {
    const title = (ev.card as unknown as { title?: unknown }).title;
    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'opportunity.updated',
        actor: systemActor('bridge'),
        tenantId,
        payload: { tenantId, opportunityId: ev.opportunityId, version: ev.version, title: typeof title === 'string' ? title : null },
      });
    } catch (e) {
      console.error('[bridge] opportunity.updated emit failed (non-fatal)', tenantId, e);
    }
  }
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
  // Admin pin-for-updates (RANK-8): is this master opp watched? If so, each holder that already had the
  // card gets an elevated update notification. opportunities is the platform catalog (RLS-off) → sqlBypass;
  // one lookup for the whole fan-out. Best-effort — a miss just means no elevated notification this round.
  let watched = false;
  try {
    const [w] = await sqlBypass<Array<{ updateWatch: boolean }>>`
      SELECT update_watch FROM opportunities WHERE id = ${ev.opportunityId}::uuid`;
    watched = w?.updateWatch === true;
  } catch (e) {
    console.error('[bridge] watch lookup failed (non-fatal)', ev.opportunityId, e);
  }
  let applied = 0;
  for (const t of tenants) {
    try {
      await applyToTenant(t.id, ev, watched);
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

/**
 * Re-publish a RELEASED opportunity to the bridge + re-fan-out — the propagation
 * path for lifecycle transitions and card content edits (Tranche 1). No-op if the
 * opp was never released (no bridge version yet): pre-release/NOFO stage changes
 * don't reach customers until the first publish.
 */
export async function republishIfReleased(
  opportunityId: string,
  eventType: BridgeEventType,
  postedBy: string | null,
  now: string,
): Promise<{ event: BridgeEvent; tenantsApplied: number } | null> {
  let released = false;
  try {
    const [row] = await sql<Array<{ v: number | null }>>`
      SELECT max(version) AS v FROM opportunity_bridge WHERE opportunity_id = ${opportunityId}::uuid
    `;
    released = !!row && row.v != null;
  } catch (e) {
    console.error('[bridge] republishIfReleased head check failed', e);
    return null;
  }
  if (!released) return null;
  return publishAndFanOut(opportunityId, eventType, postedBy, now);
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

/**
 * Forward-only CATCH-UP: apply only the bridge heads this tenant is BEHIND on — i.e. an opp with
 * no card yet, or a card older than the opp's current bridge version. This is the self-healing
 * consumer the forward-only bridge was missing: a tenant that missed a push (created after it, was
 * suspended, or whose creation-time backfill silently failed) can never be permanently stale/empty
 * — its mirror reconciles to the bridge head. Idempotent + cheap (usually zero missed heads → a
 * near-no-op), and it reuses applyToTenant so scoring re-fires via capture:card.applied.
 * Returns the number of cards advanced.
 */
export async function reconcileTenant(tenantId: string): Promise<number> {
  let behind: Array<{ id: string; opportunityId: string; version: number; eventType: BridgeEventType; card: OppCard }> = [];
  try {
    // Per opp, the head bridge version — kept only when the tenant has no card or a stale one.
    // WHERE runs before DISTINCT ON, so this narrows to opps the tenant is behind on, then picks
    // each opp's newest missed version.
    // Run the behind-detection under the tenant's OWN RLS scope so it reads real state regardless of
    // the caller's ambient context (the /cards read-repair calls this before its own withTenant block;
    // the admin sweep on the bypass pool). Under govtech_app a context-less read of the force-RLS
    // tenant_opportunity_cards would DENY-ALL → the LEFT JOIN would treat every bridge head as "behind"
    // and re-apply on every call (self-correcting via the forward-only guard, but wasteful). Self-scope.
    behind = await withTenant(tenantId, async (tx) => tx`
      SELECT DISTINCT ON (b.opportunity_id)
             b.id, b.opportunity_id AS "opportunityId", b.version, b.event_type AS "eventType", b.card
      FROM opportunity_bridge b
      LEFT JOIN tenant_opportunity_cards c
        ON c.tenant_id = ${tenantId}::uuid AND c.opportunity_id = b.opportunity_id
      WHERE c.opportunity_id IS NULL OR b.version > c.bridge_version
      ORDER BY b.opportunity_id, b.version DESC
    `) as typeof behind;
  } catch (e) {
    console.error('[bridge] reconcile head query failed', tenantId, e);
    return 0;
  }
  let applied = 0;
  for (const h of behind) {
    try {
      await applyToTenant(tenantId, { id: h.id, opportunityId: h.opportunityId, version: h.version, eventType: h.eventType, card: h.card });
      applied++;
    } catch (e) {
      console.error('[bridge] reconcile apply failed', h.opportunityId, e);
    }
  }
  if (applied > 0) console.info('[bridge] reconciled tenant %s: %d card(s) caught up to head', tenantId, applied);
  return applied;
}

/**
 * Reconcile EVERY active/trial tenant to the bridge head — the scheduled/manual sweep that heals
 * tenants which never load their feed (so the digest + admin views are accurate too). Same set the
 * fan-out targets. Returns per-tenant applied counts.
 */
export async function reconcileActiveTenants(): Promise<{ tenantId: string; applied: number }[]> {
  let tenants: Array<{ id: string }> = [];
  try {
    tenants = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE status IN ('active','trial')`;
  } catch (e) {
    console.error('[bridge] reconcileActiveTenants tenant list failed', e);
    return [];
  }
  const out: { tenantId: string; applied: number }[] = [];
  for (const t of tenants) {
    out.push({ tenantId: t.id, applied: await reconcileTenant(t.id) });
  }
  return out;
}
