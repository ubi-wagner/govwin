/**
 * Master OPP build-out readiness (docs/PROVISIONING_WORKSPACE_DESIGN.md, PV-1).
 *
 * Computes whether a master OPP (curated_solicitations) is "fully built out" — the advisory bar the
 * provisioning cockpit shows and the "Mark build-out complete" action gates on (owner decision:
 * advisory + confirm, so `ready=false` doesn't BLOCK release, it just requires an explicit confirm).
 * The bar = compliance authored (a baseline solicitation_compliance row with a submission_format) +
 * >=1 baseline volume + >=1 required item. `itemsWithTemplate` is a soft recommendation (the provision
 * cascade has a code-registry fallback, so a missing mold degrades gracefully — it never blocks).
 *
 * Master tables (solicitation_compliance / solicitation_volumes / volume_required_items / curated_
 * solicitations) are platform/admin-scoped and cross-tenant → read via sqlBypass. camelCase off toCamel.
 */
import { sqlBypass } from '@/lib/db';

export interface BuildReadiness {
  /** Meets the bar: compliance + >=1 volume + >=1 required item. */
  ready: boolean;
  hasCompliance: boolean;
  volumeCount: number;
  requiredItemCount: number;
  /** Advisory: how many required items have a template mold linked (the rest fall back to the registry). */
  itemsWithTemplate: number;
  /** The deliberate admin "done" flag (mig 182) — distinct from `ready` (the computed bar). */
  buildComplete: boolean;
  buildCompletedAt: string | null;
}

const EMPTY: BuildReadiness = {
  ready: false, hasCompliance: false, volumeCount: 0, requiredItemCount: 0,
  itemsWithTemplate: 0, buildComplete: false, buildCompletedAt: null,
};

export async function getBuildReadiness(solId: string): Promise<BuildReadiness> {
  if (!solId) return EMPTY;
  try {
    const [r] = await sqlBypass<Array<{
      hasCompliance: boolean; volumeCount: number; requiredItemCount: number;
      itemsWithTemplate: number; buildComplete: boolean; buildCompletedAt: Date | null;
    }>>`
      SELECT
        EXISTS(SELECT 1 FROM solicitation_compliance sc
               WHERE sc.solicitation_id = ${solId}::uuid AND sc.topic_id IS NULL
                 AND sc.submission_format IS NOT NULL AND sc.submission_format <> '') AS has_compliance,
        (SELECT count(*)::int FROM solicitation_volumes sv
           WHERE sv.solicitation_id = ${solId}::uuid AND sv.topic_id IS NULL) AS volume_count,
        (SELECT count(*)::int FROM volume_required_items vri
           JOIN solicitation_volumes sv ON sv.id = vri.volume_id
           WHERE sv.solicitation_id = ${solId}::uuid) AS required_item_count,
        (SELECT count(*)::int FROM volume_required_items vri
           JOIN solicitation_volumes sv ON sv.id = vri.volume_id
           WHERE sv.solicitation_id = ${solId}::uuid AND vri.template_id IS NOT NULL) AS items_with_template,
        cs.build_complete, cs.build_completed_at
      FROM curated_solicitations cs
      WHERE cs.id = ${solId}::uuid`;
    if (!r) return EMPTY;
    return {
      ready: r.hasCompliance && r.volumeCount > 0 && r.requiredItemCount > 0,
      hasCompliance: r.hasCompliance,
      volumeCount: r.volumeCount,
      requiredItemCount: r.requiredItemCount,
      itemsWithTemplate: r.itemsWithTemplate,
      buildComplete: r.buildComplete,
      buildCompletedAt: r.buildCompletedAt ? new Date(r.buildCompletedAt).toISOString() : null,
    };
  } catch (e) {
    console.error('[build-readiness] failed', e);
    return EMPTY;
  }
}
