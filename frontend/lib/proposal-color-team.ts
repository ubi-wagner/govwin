/**
 * Color-team review STATUS — what actually happened to the reviews the customer asked for.
 *
 * WHAT WAS BROKEN. `requestAiReview` queues one `color_team_reviewer` task per section and returns
 * `{ enqueued: N }`. The UI says "N reviews queued" and that is the last word the customer ever
 * gets. When a task fails, nothing surfaces it. On this database that is not hypothetical: of 68
 * queued color-team tasks, 32 completed and **36 failed** — every one of them with
 *
 *     "Tenant <id> exceeded the hourly call limit"
 *
 * The guardrail is right to stop the call; the silence is the bug. The customer clicked "AI
 * Review", was told the reviews were queued, and for 36 sections nothing ever appeared — no
 * comment, no error, no retry. From the outside that is indistinguishable from "the reviewer had
 * nothing to say about those sections", which is the worst possible reading: it invites shipping
 * an unreviewed section believing it passed.
 *
 * WHAT THIS IS. The read side of the loop. Per section: did its review run, is it still running,
 * or did it fail and why — plus a rollup the UI can state in one line, and a retry that re-queues
 * ONLY the failed ones (a blanket re-run would double-review the sections that succeeded and burn
 * the same rate limit that caused the failure).
 *
 * The review CONTENT itself already lands correctly: the fabric writes each completed review into
 * `proposal_comments` (recommendation_type='ai_review'), which the section thread renders and
 * `roll_up_review_findings` counts. That half was never broken. This is about the half that
 * wasn't there — telling the customer which reviews never happened.
 */
import { sql } from '@/lib/db';

export type ReviewState = 'completed' | 'failed' | 'running' | 'queued';
export type ReviewScopeLevel = 'node' | 'group' | 'section' | 'pages' | 'document';

export interface SectionReview {
  sectionId: string | null;
  sectionTitle: string;
  state: ReviewState;
  /** Present only for `failed` — the guardrail's own words, shown to the customer verbatim. */
  error: string | null;
  /** Whether a rendered ai_review comment exists for this section (the loop's visible output). */
  comments: number;
  requestedAt: string | null;
  finishedAt: string | null;
  /**
   * WHAT was reviewed (mig 207). A review used to be one-per-section, so the section title said
   * it all; now it can be one figure, one library-derived group, or a page range. NULL in the
   * queue means whole section — the pre-scope default — and is normalised to 'section' here.
   */
  scopeLevel: ReviewScopeLevel;
  scopeRef: Record<string, unknown> | null;
  /** What to show in the list: the scope's own name, falling back to the section's title. */
  scopeLabel: string;
}

export interface ColorTeamStatus {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  /** ai_review comments on this proposal that are still unresolved — the work the review created. */
  openFindings: number;
  /**
   * One line the UI can state without further interpretation. Deliberately leads with the failure
   * when there is one: "38 of 48 sections reviewed" reads as progress, which is not what
   * "10 reviews never ran" means.
   */
  headline: string;
  sections: SectionReview[];
}

const SCOPE_LEVELS: ReadonlySet<string> = new Set(['node', 'group', 'section', 'pages', 'document']);

/**
 * What to call a scoped review in a list of them.
 *
 * A section-scoped review is still named by its section — that is what it is. Anything narrower or
 * wider says so, and says where: "Figure in Technical Approach" tells the customer which review
 * failed; "Technical Approach" three times over does not.
 */
export function scopeLabelOf(
  level: ReviewScopeLevel, ref: Record<string, unknown> | null, sectionTitle: string,
): string {
  if (level === 'section') return sectionTitle;
  if (level === 'document') return 'Whole document';
  if (level === 'pages') {
    const p = ref?.pages as { start?: number; end?: number } | undefined;
    if (p?.start != null && p.end != null) {
      return p.start === p.end ? `Page ${p.start}` : `Pages ${p.start}–${p.end}`;
    }
    return 'Page range';
  }
  return `${level === 'node' ? 'Element' : 'Group'} in ${sectionTitle}`;
}

/** Group the raw queue rows into one state per SCOPE, newest attempt wins. */
export function summarize(rows: Array<{
  sectionId: string | null; sectionTitle: string | null; status: string;
  error: string | null; comments: number; createdAt: Date | string | null; completedAt: Date | string | null;
  scopeLevel?: string | null; scopeRef?: Record<string, unknown> | null;
}>): Omit<ColorTeamStatus, 'openFindings'> {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  const sections: SectionReview[] = rows.map((r) => {
    const sectionTitle = r.sectionTitle ?? 'Untitled section';
    // NULL is the pre-scope default and MEANS whole section — the unscoped fan-out deliberately
    // writes neither column, so its rows stay byte-identical to pre-migration ones. Anything
    // outside the vocabulary is treated the same way rather than shown to a customer raw.
    const scopeLevel = (SCOPE_LEVELS.has(String(r.scopeLevel)) ? r.scopeLevel : 'section') as ReviewScopeLevel;
    const scopeRef = (r.scopeRef ?? null) as Record<string, unknown> | null;
    return {
      sectionId: r.sectionId,
      sectionTitle,
      state: r.status === 'completed' ? 'completed'
        : r.status === 'failed' ? 'failed'
        : r.status === 'running' ? 'running' : 'queued',
      // Only a failure carries an error. Carrying one on a completed row would make a successful
      // review look suspect in the UI.
      error: r.status === 'failed' ? (r.error ?? 'The review did not run, and no reason was recorded.') : null,
      comments: Number(r.comments ?? 0),
      requestedAt: iso(r.createdAt),
      finishedAt: iso(r.completedAt),
      scopeLevel,
      scopeRef,
      scopeLabel: scopeLabelOf(scopeLevel, scopeRef, sectionTitle),
    };
  });

  const completed = sections.filter((s) => s.state === 'completed').length;
  const failed = sections.filter((s) => s.state === 'failed').length;
  const pending = sections.filter((s) => s.state === 'queued' || s.state === 'running').length;
  const total = sections.length;

  // "section" is no longer true of every review — one can be aimed at a figure or a page range —
  // so the wording follows the data: it still says "section" when they all are, and "review"
  // otherwise, rather than telling a customer their figure review was a section review.
  const allSections = sections.every((s) => s.scopeLevel === 'section');
  const unit = allSections ? 'section' : 'review';
  const units = allSections ? 'sections' : 'reviews';

  let headline: string;
  if (total === 0) headline = 'No color-team review has been requested for this proposal yet.';
  else if (failed > 0) {
    // Name the reason when every failure shares one — a rate limit is worth saying out loud
    // because it is transient and the fix is "retry", not "rewrite the section".
    const reasons = new Set(sections.filter((s) => s.state === 'failed').map((s) => s.error));
    const why = reasons.size === 1 ? ` — ${[...reasons][0]}` : '';
    headline = `${failed} of ${total} ${allSections ? 'section review' : 'review'}${failed === 1 ? '' : 's'} did not run${why}. `
      + `${completed} completed${pending ? `, ${pending} still running` : ''}. Retry the failed ones.`;
  } else if (pending > 0) headline = `${completed} of ${total} ${units} reviewed · ${pending} still running.`;
  else headline = `All ${total} ${total === 1 ? unit : units} reviewed.`;

  return { total, completed, failed, pending, headline, sections };
}

/**
 * Read the color-team review state for one proposal. Tenant-scoped through the request's RLS
 * context; callers must already have verified access to the proposal.
 */
export async function getColorTeamStatus(proposalId: string): Promise<ColorTeamStatus> {
  let rows: Parameters<typeof summarize>[0] = [];
  try {
    // One row per section: its LATEST color-team attempt, plus how many rendered ai_review
    // comments that section carries. DISTINCT ON keeps a retried section from appearing twice.
    // One row per SCOPE — not per section. Since mig 207 several reviews can share a section_id
    // (one per figure, say), and `DISTINCT ON (section_id)` would show the newest and hide the
    // rest: the customer would be told a section was reviewed while three of its four scoped
    // reviews sat invisible, which is the same class of silence this whole file exists to end.
    //
    // The scope key is (level, ref) with NULL normalised to 'section', so pre-scope rows land in
    // exactly the group they always did.
    //
    // The comment count is matched on the SAME key. Counting every ai_review comment in the
    // section would credit a node-scoped review with findings written by a different review.
    rows = await sql`
      WITH t AS (
        SELECT q.*,
               COALESCE(q.scope_level, 'section') AS lvl,
               COALESCE(q.scope_ref->>'nodeId', q.scope_ref->>'groupId',
                        (q.scope_ref->'pages'->>'start') || '-' || (q.scope_ref->'pages'->>'end'),
                        '') AS ref_key
        FROM agent_task_queue q
        WHERE q.proposal_id = ${proposalId}::uuid
          AND q.agent_role = 'color_team_reviewer'
      ), c AS (
        SELECT pc.section_id,
               COALESCE(pc.anchor->>'scopeLevel', 'section') AS lvl,
               COALESCE(pc.anchor->>'nodeId', pc.anchor->>'groupId',
                        (pc.anchor->'pages'->>'start') || '-' || (pc.anchor->'pages'->>'end'),
                        '') AS ref_key
        FROM proposal_comments pc
        WHERE pc.proposal_id = ${proposalId}::uuid
          AND pc.recommendation_type = 'ai_review'
      )
      SELECT DISTINCT ON (t.section_id, t.lvl, t.ref_key)
             t.section_id            AS "sectionId",
             ps.title                AS "sectionTitle",
             t.status,
             t.error,
             t.created_at            AS "createdAt",
             t.completed_at          AS "completedAt",
             t.scope_level           AS "scopeLevel",
             t.scope_ref             AS "scopeRef",
             (SELECT count(*) FROM c
               WHERE c.section_id IS NOT DISTINCT FROM t.section_id
                 AND c.lvl = t.lvl AND c.ref_key = t.ref_key)::int AS comments
      FROM t
      LEFT JOIN proposal_sections ps ON ps.id = t.section_id
      ORDER BY t.section_id, t.lvl, t.ref_key, t.created_at DESC
    `;
  } catch (e) {
    console.error('[color-team] status read failed', e);
    return {
      total: 0, completed: 0, failed: 0, pending: 0, openFindings: 0,
      headline: 'Could not read the review status.', sections: [],
    };
  }

  let openFindings = 0;
  try {
    const [f] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM proposal_comments
      WHERE proposal_id = ${proposalId}::uuid
        AND recommendation_type = 'ai_review' AND resolved = false`;
    openFindings = f?.n ?? 0;
  } catch (e) {
    console.error('[color-team] finding count failed', e);
  }

  return { ...summarize(rows), openFindings };
}

/** A failed review, described precisely enough to re-run exactly what failed. */
export interface FailedReviewTarget {
  sectionId: string;
  scopeLevel: ReviewScopeLevel;
  scopeRef: Record<string, unknown> | null;
}

/**
 * The reviews whose latest attempt FAILED — the retry set.
 *
 * Only the failures: re-running everything would double-review what already succeeded (a second,
 * possibly contradictory comment on each) and spend the same rate limit that caused the failure in
 * the first place, which is how a retry turns into a second outage.
 *
 * Keyed on the SCOPE, not the section. Retrying a failed figure review as a whole-section review
 * would quietly answer a different question than the one that was asked — and the customer would
 * have no way to tell, because the retry would report success.
 */
export async function failedReviewTargets(proposalId: string): Promise<FailedReviewTarget[]> {
  try {
    // The LATEST attempt per scope decides: a scope that failed once and then succeeded on a retry
    // is done, and must not be queued a third time.
    const latest = await sql<Array<{
      sectionId: string | null; status: string;
      scopeLevel: string | null; scopeRef: Record<string, unknown> | null;
    }>>`
      WITH t AS (
        SELECT q.*,
               COALESCE(q.scope_level, 'section') AS lvl,
               COALESCE(q.scope_ref->>'nodeId', q.scope_ref->>'groupId',
                        (q.scope_ref->'pages'->>'start') || '-' || (q.scope_ref->'pages'->>'end'),
                        '') AS ref_key
        FROM agent_task_queue q
        WHERE q.proposal_id = ${proposalId}::uuid AND q.agent_role = 'color_team_reviewer'
      )
      SELECT DISTINCT ON (t.section_id, t.lvl, t.ref_key)
             t.section_id AS "sectionId", t.status,
             t.scope_level AS "scopeLevel", t.scope_ref AS "scopeRef"
      FROM t
      ORDER BY t.section_id, t.lvl, t.ref_key, t.created_at DESC`;
    return latest
      .filter((r) => r.status === 'failed' && r.sectionId)
      .map((r) => ({
        sectionId: r.sectionId as string,
        scopeLevel: (SCOPE_LEVELS.has(String(r.scopeLevel)) ? r.scopeLevel : 'section') as ReviewScopeLevel,
        scopeRef: r.scopeRef ?? null,
      }));
  } catch (e) {
    console.error('[color-team] failed-set read failed', e);
    return [];
  }
}

