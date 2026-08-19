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

/** Group the raw queue rows into one state per section, newest attempt wins. */
export function summarize(rows: Array<{
  sectionId: string | null; sectionTitle: string | null; status: string;
  error: string | null; comments: number; createdAt: Date | string | null; completedAt: Date | string | null;
}>): Omit<ColorTeamStatus, 'openFindings'> {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  const sections: SectionReview[] = rows.map((r) => ({
    sectionId: r.sectionId,
    sectionTitle: r.sectionTitle ?? 'Untitled section',
    state: r.status === 'completed' ? 'completed'
      : r.status === 'failed' ? 'failed'
      : r.status === 'running' ? 'running' : 'queued',
    // Only a failure carries an error. Carrying one on a completed row would make a successful
    // review look suspect in the UI.
    error: r.status === 'failed' ? (r.error ?? 'The review did not run, and no reason was recorded.') : null,
    comments: Number(r.comments ?? 0),
    requestedAt: iso(r.createdAt),
    finishedAt: iso(r.completedAt),
  }));

  const completed = sections.filter((s) => s.state === 'completed').length;
  const failed = sections.filter((s) => s.state === 'failed').length;
  const pending = sections.filter((s) => s.state === 'queued' || s.state === 'running').length;
  const total = sections.length;

  let headline: string;
  if (total === 0) headline = 'No color-team review has been requested for this proposal yet.';
  else if (failed > 0) {
    // Name the reason when every failure shares one — a rate limit is worth saying out loud
    // because it is transient and the fix is "retry", not "rewrite the section".
    const reasons = new Set(sections.filter((s) => s.state === 'failed').map((s) => s.error));
    const why = reasons.size === 1 ? ` — ${[...reasons][0]}` : '';
    headline = `${failed} of ${total} section review${failed === 1 ? '' : 's'} did not run${why}. `
      + `${completed} completed${pending ? `, ${pending} still running` : ''}. Retry the failed ones.`;
  } else if (pending > 0) headline = `${completed} of ${total} sections reviewed · ${pending} still running.`;
  else headline = `All ${total} section${total === 1 ? '' : 's'} reviewed.`;

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
    rows = await sql`
      SELECT DISTINCT ON (q.section_id)
             q.section_id            AS "sectionId",
             ps.title                AS "sectionTitle",
             q.status,
             q.error,
             q.created_at            AS "createdAt",
             q.completed_at          AS "completedAt",
             (SELECT count(*) FROM proposal_comments pc
               WHERE pc.section_id = q.section_id
                 AND pc.recommendation_type = 'ai_review')::int AS comments
      FROM agent_task_queue q
      LEFT JOIN proposal_sections ps ON ps.id = q.section_id
      WHERE q.proposal_id = ${proposalId}::uuid
        AND q.agent_role = 'color_team_reviewer'
      ORDER BY q.section_id, q.created_at DESC
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

/**
 * The section ids whose latest review FAILED — the retry set.
 *
 * Only the failures: re-running everything would double-review the sections that succeeded (a
 * second, contradictory comment on each) and spend the same rate limit that caused the failure in
 * the first place, which is how a retry turns into a second outage.
 */
export async function failedReviewSectionIds(proposalId: string): Promise<string[]> {
  try {
    // The LATEST attempt per section decides: a section that failed once and then succeeded on a
    // retry is done, and must not be queued a third time.
    const latest = await sql<Array<{ sectionId: string | null; status: string }>>`
      SELECT DISTINCT ON (q.section_id) q.section_id AS "sectionId", q.status
      FROM agent_task_queue q
      WHERE q.proposal_id = ${proposalId}::uuid AND q.agent_role = 'color_team_reviewer'
      ORDER BY q.section_id, q.created_at DESC`;
    return latest.filter((r) => r.status === 'failed' && r.sectionId).map((r) => r.sectionId as string);
  } catch (e) {
    console.error('[color-team] failed-set read failed', e);
    return [];
  }
}
