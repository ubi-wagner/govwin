/**
 * Mid-window propagation — the missing half of "edit the master after push".
 *
 * The bridge already has the whole delivery machine (publish → fan-out → conditional
 * pin_update_available → tenant-side rescore → watched-holder notification), and
 * `republishIfReleased` already carries the one rule that matters — a never-released opp
 * is a silent no-op. What was missing is CALLERS: every curation-workspace edit after
 * `solicitation.push` (summary, compliance, volumes, items, attachments, amendments,
 * topics) wrote the master and stopped, so tenant mirror cards stayed frozen at the
 * push-time snapshot (docs/MASTER_MIRROR_OPP_DESIGN.md §1 "Update propagation").
 *
 * `republishSolicitationCards` is the one shared tail those edit paths call. It is
 * best-effort by contract: propagation failure must never fail the admin's edit — the
 * edit is already committed; the mirror can be re-driven (reconcile, broadcast button).
 *
 * `activateLateTopicIfReady` covers the ADDITION case: a topic added to an
 * already-pushed solicitation has no bridge version, so republish would no-op forever.
 * It releases the late topic exactly the way `solicitation.push` W2 would have
 * (is_active + submission_stage + released_by/at), honoring the same date guard —
 * no close_date, no customer visibility — then publishes its first bridge version.
 */
import { sql } from '@/lib/db';
import type { BridgeEventType } from '@/lib/lifecycle';
import { publishAndFanOut, republishIfReleased } from '@/lib/opportunity-bridge';
import { emitEventSingle, userActor } from '@/lib/events';

export interface RepublishResult {
  /** Opportunities that got a new bridge version fanned out. */
  republished: number;
  /** Activated opps skipped because they were never released (no bridge head). */
  skipped: number;
  /** Total tenant-card applies across all republished opps. */
  cardsRefreshed: number;
}

/**
 * Re-publish every RELEASED opportunity of a solicitation (umbrella + activated topics)
 * as a new bridge version, refreshing every tenant's mirror card. Scope to a single
 * opportunity (a topic-level edit) via `opportunityId`. Never throws.
 */
export async function republishSolicitationCards(opts: {
  solicitationId: string;
  actorId?: string | null;
  eventType?: BridgeEventType;
  opportunityId?: string | null;
}): Promise<RepublishResult> {
  const out: RepublishResult = { republished: 0, skipped: 0, cardsRefreshed: 0 };
  // The WHOLE body is fenced: this tail rides on business writes that already committed,
  // so no failure here (including a mocked/absent sql in unit tests) may surface as a
  // tool/route error — the mirror can always be re-driven (reconcile, broadcast button).
  try {
    const eventType = opts.eventType ?? 'updated';
    const nowIso = new Date().toISOString();
    let opps: Array<{ id: string }> = [];
    if (opts.opportunityId) {
      opps = [{ id: opts.opportunityId }];
    } else {
      // The activation set, exactly as solicitation.push flips it: the landing opp
      // plus every topic of the solicitation. Only active (customer-visible) opps —
      // an unactivated late topic is activateLateTopicIfReady's job, not this one's.
      const rows = await sql<Array<{ id: string }>>`
        SELECT o.id FROM opportunities o
        WHERE o.is_active = true
          AND (o.solicitation_id = ${opts.solicitationId}::uuid
               OR o.id = (SELECT opportunity_id FROM curated_solicitations
                          WHERE id = ${opts.solicitationId}::uuid))
      `;
      opps = Array.isArray(rows) ? rows : [];
    }
    for (const o of opps) {
      try {
        const res = await republishIfReleased(o.id, eventType, opts.actorId ?? null, nowIso);
        if (res) {
          out.republished++;
          out.cardsRefreshed += res.tenantsApplied;
        } else {
          out.skipped++;
        }
      } catch (e) {
        console.error('[republish] republish failed (non-fatal)', o.id, e);
        out.skipped++;
      }
    }
  } catch (e) {
    console.error('[republish] propagation failed (non-fatal)', opts.solicitationId, e);
  }
  return out;
}

export interface LateTopicResult {
  released: boolean;
  reason?: 'not_pushed' | 'already_released' | 'needs_close_date' | 'not_found' | 'error';
  cardsRefreshed?: number;
}

/**
 * Release a topic that arrived AFTER its solicitation was pushed. The tell is the
 * BRIDGE, not `is_active` (add_topic inserts active regardless): a topic of a
 * pushed solicitation with no bridge version has never reached a tenant. Mirrors
 * the push tool's W2 activation write and honors the mig-128 date guard — a topic
 * with no close_date stays off the bridge (customers never see an opp without an
 * expected close); the caller surfaces `needs_close_date` so the admin sets one,
 * at which point the next topic edit re-calls this and the topic goes live.
 */
export async function activateLateTopicIfReady(
  opportunityId: string,
  actor: { id: string; email?: string | null },
): Promise<LateTopicResult> {
  try {
    const [row] = await sql<Array<{
      closeDate: Date | null; solStatus: string | null; solicitationId: string | null;
      bridgeHead: number | null;
    }>>`
      SELECT o.close_date AS "closeDate",
             cs.status AS "solStatus", cs.id AS "solicitationId",
             (SELECT max(version) FROM opportunity_bridge b WHERE b.opportunity_id = o.id) AS "bridgeHead"
      FROM opportunities o
      LEFT JOIN curated_solicitations cs
        ON cs.id = o.solicitation_id OR cs.opportunity_id = o.id
      WHERE o.id = ${opportunityId}::uuid
      LIMIT 1
    `;
    if (!row) return { released: false, reason: 'not_found' };
    if (row.solStatus !== 'pushed_to_pipeline') return { released: false, reason: 'not_pushed' };
    if (row.bridgeHead != null) return { released: false, reason: 'already_released' };
    if (!row.closeDate) return { released: false, reason: 'needs_close_date' };

    // Same shape as solicitation.push W2 (solicitation-push.ts:203-213), one opp.
    // Idempotent for an already-active row; the bridge publish below is the real
    // release (publishToBridge's UNIQUE(version) makes a concurrent double harmless).
    await sql`
      UPDATE opportunities
      SET is_active = true, updated_at = now(),
          submission_stage = 'open',
          open_date   = COALESCE(open_date, now()),
          released_by = COALESCE(released_by, ${actor.id}::uuid),
          released_at = COALESCE(released_at, now())
      WHERE id = ${opportunityId}::uuid
    `;

    // First bridge version for this topic → every tenant's mirror gets the card.
    const pub = await publishAndFanOut(opportunityId, 'published', actor.id, new Date().toISOString());
    try {
      await emitEventSingle({
        namespace: 'finder', type: 'topic.released',
        actor: userActor(actor.id, actor.email ?? undefined), tenantId: null,
        payload: {
          opportunityId, solicitationId: row.solicitationId,
          lateRelease: true, cardsRefreshed: pub?.tenantsApplied ?? 0,
        },
      });
    } catch (e) { console.error('[republish] topic.released emit failed (non-fatal)', e); }
    return { released: true, cardsRefreshed: pub?.tenantsApplied ?? 0 };
  } catch (e) {
    console.error('[republish] late-topic activation failed (non-fatal)', opportunityId, e);
    return { released: false, reason: 'error' };
  }
}
