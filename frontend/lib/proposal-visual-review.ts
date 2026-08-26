/**
 * Visual page review, as part of the color-team review.
 *
 * `requestAiReview` queues one `color_team_reviewer` task per section; the agent reads that
 * section's TEXT and posts its recommendation into the section thread. It is a good reviewer and
 * it is blind — it has never seen the page. Every defect this codebase shipped in the last two
 * days was visible only on the rendered page and invisible in the model: diagram labels truncated
 * mid-word, cost bands drawn as unlabelled slivers, a caption borrowed from alt text, a footer
 * printing the literal string "Page {page}", a volume that cleared "10 of 10" and laid out as 11.
 *
 * This is the reviewer that looks. It runs alongside the text reviewers, on the same trigger, and
 * lands in the same place — `proposal_comments` with `recommendation_type='ai_review'` — so its
 * findings appear in the section thread the builder already reads, are already rendered by
 * `components/canvas/collaboration.tsx`, and already count toward the unresolved-review gate in
 * `portal_stage_actions`. No new surface, no new inbox.
 *
 * WHY IT LIVES IN THE FRONTEND rather than as a pipeline archetype: it has to RENDER the document,
 * and the exporters, the canvas model and Chromium are all here. The pipeline reaches the frontend
 * through `agent_task_queue` in one direction only — a Python archetype cannot render a canvas. So
 * the honest shape is a frontend reviewer invoked on the same trigger, not an archetype that
 * pretends to see.
 *
 * Advisory, per the reviewer contract: it posts recommendations and never edits a section, advances
 * a stage, locks, or submits. Best-effort throughout — a review that cannot run must not fail the
 * action that asked for it.
 */
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { assembleFittedArtifactCanvas } from '@/lib/export/artifact-export';
import { loadVolumeFacts } from '@/lib/proposal/volume-facts';
import { reviewArtifactVisually, type VisualFinding } from '@/lib/review/visual-review';

export interface VisualReviewRequest {
  proposalId: string;
  tenantId: string;
  actorId: string;
  actorEmail: string | null;
  /** 'portal' (the AI-review button) | 'admin_doorbell' — carried into the audit event. */
  source: string;
}

export interface VisualReviewOutcome {
  artifactsReviewed: number;
  findings: number;
  commentsPosted: number;
  /** Volumes whose RENDERED page count exceeds their cap — the measurement that is not an estimate. */
  overCap: number;
  engine: 'vision' | 'none';
}

/** How many volumes one review pass will render. A proposal has a handful; a runaway has none. */
const MAX_ARTIFACTS = 8;

/**
 * Look at every volume of a proposal and post what is visibly wrong into the section threads.
 */
export async function requestVisualReview(p: VisualReviewRequest): Promise<VisualReviewOutcome> {
  const out: VisualReviewOutcome = {
    artifactsReviewed: 0, findings: 0, commentsPosted: 0, overCap: 0, engine: 'none',
  };

  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'visual_review.requested',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload: { proposalId: p.proposalId, source: p.source },
  });

  try {
    const facts = await loadVolumeFacts(p.proposalId, p.tenantId);

    // camelCase field names: lib/db applies postgres.toCamel to every column (CLAUDE.md SOP).
    const artifacts = await sql<Array<{
      id: string; artifactType: string | null; volumeName: string | null; cap: number | null;
    }>>`
      SELECT a.id,
             a.artifact_type                          AS "artifactType",
             a.volume_name                            AS "volumeName",
             (a.compliance_spec ->> 'max_pages')::int AS "cap"
      FROM proposal_artifacts a
      JOIN proposals p ON p.id = a.proposal_id
      WHERE a.proposal_id = ${p.proposalId}::uuid AND p.tenant_id = ${p.tenantId}::uuid
      ORDER BY a.volume_number NULLS LAST, a.volume_name
      LIMIT ${MAX_ARTIFACTS}
    `;

    for (const a of artifacts) {
      const sections = await sql<Array<{
        id: string; title: string | null; content: string | null;
        pageAllocation: number | null; characterAllocation: number | null;
      }>>`
        SELECT id, title, content,
               page_allocation      AS "pageAllocation",
               character_allocation AS "characterAllocation"
        FROM proposal_sections
        WHERE proposal_id = ${p.proposalId}::uuid AND artifact_id = ${a.id}::uuid
        ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number
      `;
      if (sections.length === 0) continue;

      const volumeName = a.volumeName ?? 'Volume';
      const variables = { company_name: facts.companyName ?? '', topic_number: facts.solicitationNumber ?? '' };
      // The FITTED assembly — the same one the download produces, not the plain one.
      //
      // Caught by running this reviewer end to end: it reported the Technical Volume at 11 pages
      // against a 10-page cap while the file the customer actually downloads is 10, because the
      // download path fits by rendering and this path did not. A reviewer looking at a document
      // nobody receives is worse than no reviewer — it manufactures a blocker against a compliant
      // submission, which is exactly the false alarm that teaches a builder to ignore reviews.
      const doc = await assembleFittedArtifactCanvas(
        sections, a.artifactType, volumeName, { ...facts, volumeName }, variables,
      );
      const review = await reviewArtifactVisually({
        doc,
        variables,
        context: { companyName: facts.companyName, solicitationNumber: facts.solicitationNumber, volumeName },
        pageCap: a.cap,
      });

      out.artifactsReviewed += 1;
      out.findings += review.findings.length;
      if (review.engine === 'vision') out.engine = 'vision';
      if (review.findings.some((f) => f.severity === 'blocker' && /renders as \d+ pages/.test(f.finding))) {
        out.overCap += 1;
      }
      if (review.findings.length === 0) continue;

      // Anchored to the volume's FIRST section. A finding is per-PAGE and a page spans sections, so
      // there is no section it belongs to — but a comment needs one, and the volume's opening
      // section is where a builder starts reading. The finding names its own page number.
      const posted = await postFindings(p, a.id, sections[0].id, volumeName, review.pagesReviewed, review.findings);
      out.commentsPosted += posted;
    }

    await emitEventEnd(startId, { result: { proposalId: p.proposalId, ...out } });
    return out;
  } catch (e) {
    console.error('[visual-review] pass failed (non-fatal):', e instanceof Error ? e.message : e);
    await emitEventEnd(startId, {
      result: { proposalId: p.proposalId, ...out },
      error: { message: e instanceof Error ? e.message : 'visual review failed' },
    });
    return out;
  }
}

/**
 * One comment per volume, listing its findings.
 *
 * One comment rather than one per finding: a builder opening a section thread wants the volume's
 * verdict, not fifteen separate notes to dismiss individually. `recommendation_type='ai_review'`
 * is what the thread renders and what the stage gate counts.
 */
async function postFindings(
  p: VisualReviewRequest,
  artifactId: string,
  sectionId: string,
  volumeName: string,
  pagesReviewed: number,
  findings: VisualFinding[],
): Promise<number> {
  const lines = findings.map((f) => `- **p${f.page}** _(${f.severity})_ — ${f.finding}`).join('\n');
  const body = [
    `**Visual review — ${volumeName}** (${pagesReviewed} rendered page${pagesReviewed === 1 ? '' : 's'})`,
    '',
    'Read from the rendered pages, as an evaluator sees them.',
    '',
    lines,
  ].join('\n');

  try {
    await sql`
      INSERT INTO proposal_comments
        (proposal_id, section_id, user_id, content, recommendation_type, category)
      VALUES
        (${p.proposalId}::uuid, ${sectionId}::uuid, ${p.actorId}::uuid, ${body}, 'ai_review', 'visual')
    `;
    return 1;
  } catch (e) {
    console.error('[visual-review] comment insert failed (non-fatal):', e, { artifactId });
    return 0;
  }
}
