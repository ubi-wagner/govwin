/**
 * How much is waiting at each stage of the discovery river (#176).
 *
 * One query, read by every surface that renders `IntakeStageStrip`, so the four intake screens
 * agree about the backlog instead of each counting its own slice. Counts only what a HUMAN still
 * has to act on — a stage with nothing waiting shows no badge, which is what makes a badge mean
 * something when it appears.
 *
 * Admin console read: it spans tenants and touches RLS-forced tables, so it uses the owner pool
 * (docs/RLS_CUTOVER.md). Best-effort — a count that cannot be read must never take down the page
 * it decorates; it degrades to "no badges".
 */
import { sqlBypass as sql } from '@/lib/db';
import type { IntakeStageCounts } from '@/components/admin/intake-stage-strip';

export async function loadIntakeStageCounts(): Promise<IntakeStageCounts> {
  try {
    // camelCase aliases: lib/db applies postgres.toCamel to every column (CLAUDE.md SOP).
    // Status vocabularies verified against the live schema before writing this (CLAUDE.md SOP):
    // scout_findings resolves to 'pursued'/'dismissed'; curated_solicitations walks
    // new → claimed → curation_in_progress → review_requested → approved → pushed_to_pipeline.
    // `curated_solicitations` has NO archived_at column — do not add one to this predicate.
    const [r] = await sql<Array<{ scouts: number; intake: number; curation: number }>>`
      SELECT
        (SELECT count(*)::int FROM scout_findings
           WHERE status NOT IN ('pursued', 'dismissed'))                        AS "scouts",
        -- Staged and UNCLAIMED: nobody has picked it up to read yet.
        (SELECT count(*)::int FROM curated_solicitations
           WHERE status = 'new')                                                AS "intake",
        -- In a curator's hands but not yet pushed. Counting only 'approved' would hide
        -- everything stuck mid-curation, which is exactly the backlog worth seeing.
        (SELECT count(*)::int FROM curated_solicitations
           WHERE status IN ('claimed', 'curation_in_progress',
                            'review_requested', 'approved'))                    AS "curation"
    `;
    return { scouts: r?.scouts ?? 0, intake: r?.intake ?? 0, curation: r?.curation ?? 0 };
  } catch (e) {
    console.error('[intake-stage-counts] failed (non-fatal)', e);
    return {};
  }
}
