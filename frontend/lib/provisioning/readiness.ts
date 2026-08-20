/**
 * Master OPP build-out readiness (docs/PROVISIONING_WORKSPACE_DESIGN.md, PV-1).
 *
 * Computes whether a master OPP (curated_solicitations) is "fully built out" — the advisory bar the
 * provisioning cockpit shows and the "Mark build-out complete" action gates on (owner decision:
 * advisory + confirm, so `ready=false` doesn't BLOCK release, it just requires an explicit confirm).
 * The bar = compliance authored (a solicitation_compliance row with a submission_format — named
 * column OR the curator's custom_variables layer, matching the push gate) + >=1 volume + >=1
 * required item. Scope-agnostic on purpose: the provisioner PREFERS topic overrides
 * (compliance-resolver), so a fully topic-scoped build satisfies the bar exactly like a baseline
 * one — counting only `topic_id IS NULL` made a topic-only build read "below the bar" and forced
 * a spurious confirm. `itemsWithTemplate` is a soft recommendation (the provision cascade has a
 * code-registry fallback, so a missing mold degrades gracefully — it never blocks).
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
  /**
   * Items still needing a human decision: no mold authored AND not marked completed-elsewhere.
   *
   * Ingest only ever derives part of a solicitation's shape. On a DoD annual BAA the spec yields the
   * Volume 1 summaries, Volume 2, Volume 3 and some of Volume 5; the remainder — the cover-sheet
   * webform, the commercialization report, the certifications, the signed forms — is not something a
   * document can hand you. Someone has to either BUILD a mold for it or MARK it as completed outside
   * the workspace.
   *
   * Leaving that decision unmade is not neutral. An undecided item still provisions as an authorable
   * section, and the section drafter then writes several kilobytes of plausible prose into it — which
   * is how a build ends up containing an AI-authored "DD Form 2345" and "Reps & Certifications",
   * where a signed federal form belongs. Empty would have been safer; drafted is a liability. So this
   * count is part of the bar, not a footnote beside it.
   */
  itemsUndecided: number;
  /** The deliberate admin "done" flag (mig 182) — distinct from `ready` (the computed bar). */
  buildComplete: boolean;
  buildCompletedAt: string | null;
}

const EMPTY: BuildReadiness = {
  ready: false, hasCompliance: false, volumeCount: 0, requiredItemCount: 0,
  itemsWithTemplate: 0, itemsUndecided: 0, buildComplete: false, buildCompletedAt: null,
};

export async function getBuildReadiness(solId: string): Promise<BuildReadiness> {
  if (!solId) return EMPTY;
  try {
    const [r] = await sqlBypass<Array<{
      hasCompliance: boolean; volumeCount: number; requiredItemCount: number;
      itemsWithTemplate: number; itemsUndecided: number;
      buildComplete: boolean; buildCompletedAt: Date | null;
    }>>`
      SELECT
        EXISTS(SELECT 1 FROM solicitation_compliance sc
               WHERE sc.solicitation_id = ${solId}::uuid
                 AND ((sc.submission_format IS NOT NULL AND sc.submission_format <> '')
                      OR COALESCE(sc.custom_variables->'submission_format'->>'value', '') <> '')) AS has_compliance,
        (SELECT count(*)::int FROM solicitation_volumes sv
           WHERE sv.solicitation_id = ${solId}::uuid) AS volume_count,
        (SELECT count(*)::int FROM volume_required_items vri
           JOIN solicitation_volumes sv ON sv.id = vri.volume_id
           WHERE sv.solicitation_id = ${solId}::uuid) AS required_item_count,
        (SELECT count(*)::int FROM volume_required_items vri
           JOIN solicitation_volumes sv ON sv.id = vri.volume_id
           WHERE sv.solicitation_id = ${solId}::uuid AND vri.template_id IS NOT NULL) AS items_with_template,
        -- Decided = has a mold, OR is marked completed-elsewhere (metadata.dsipOnly, the flag
        -- provision-proposal already honours when it decides which items become sections). Anything
        -- else is waiting on a person.
        (SELECT count(*)::int FROM volume_required_items vri
           JOIN solicitation_volumes sv ON sv.id = vri.volume_id
           WHERE sv.solicitation_id = ${solId}::uuid
             AND vri.template_id IS NULL
             AND COALESCE((vri.metadata->>'dsipOnly')::boolean, false) = false
             AND COALESCE((sv.metadata->>'dsipOnly')::boolean, false) = false) AS items_undecided,
        cs.build_complete, cs.build_completed_at
      FROM curated_solicitations cs
      WHERE cs.id = ${solId}::uuid`;
    if (!r) return EMPTY;
    return {
      ready: r.hasCompliance && r.volumeCount > 0 && r.requiredItemCount > 0 && r.itemsUndecided === 0,
      hasCompliance: r.hasCompliance,
      volumeCount: r.volumeCount,
      requiredItemCount: r.requiredItemCount,
      itemsWithTemplate: r.itemsWithTemplate,
      itemsUndecided: r.itemsUndecided,
      buildComplete: r.buildComplete,
      buildCompletedAt: r.buildCompletedAt ? new Date(r.buildCompletedAt).toISOString() : null,
    };
  } catch (e) {
    console.error('[build-readiness] failed', e);
    return EMPTY;
  }
}
