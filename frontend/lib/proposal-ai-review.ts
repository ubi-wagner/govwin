/**
 * Manual AI (color-team) review — the ONE canonical path for an admin-triggered proposal review.
 *
 * Mirrors the on-advance AI-review enqueue (lib/proposal-advance.ts): for each section that has
 * content, it queues a `color_team_reviewer` `review_section` task. When the pipeline worker runs it,
 * the review lands as a `proposal_comments` row (recommendation_type='ai_review'), which the section
 * context-box thread renders (components/canvas/collaboration.tsx). Advisory — it posts
 * recommendations into the thread; it never edits a section, advances a stage, locks, or submits.
 *
 * Audit: emits `proposal:ai_review.requested` (start/end). This type is deliberately NOT
 * `review_requested` — the agent fabric dispatches that exact type to color_team_reviewer as a
 * one-shot with no per-section write-back (processor.py:786), which would double-invoke the agent
 * AND produce no comment. We enqueue per-section ourselves (the only path that writes the rendered
 * comments) and audit under a type no archetype handles.
 */
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { requestAgentTask } from '@/lib/agent-client';
import { extractCanvasText } from '@/lib/proposal-advance';
import type { Role } from '@/lib/rbac';

export type AiReviewSource = 'portal' | 'admin_doorbell';
export type ReviewType = 'red_team' | 'pink_team' | 'gold_team';

export interface RequestAiReviewParams {
  proposalId: string;
  tenantId: string;
  actorId: string;
  actorEmail: string | null;
  role: Role;
  source: AiReviewSource;
  reviewType?: ReviewType;
}

export interface RequestAiReviewResult {
  enqueued: number;
}

export async function requestAiReview(p: RequestAiReviewParams): Promise<RequestAiReviewResult> {
  const reviewType: ReviewType = p.reviewType ?? 'red_team';

  // Every section with content — a manual review can run pre-lock (unlike on-advance, which
  // reviews the accepted/locked content). Empty canvases are skipped after text extraction.
  let sections: { id: string; title: string | null; content: string | null; sectionType: string | null }[] = [];
  try {
    sections = await sql`
      SELECT id, title, content, section_type
      FROM proposal_sections
      WHERE proposal_id = ${p.proposalId}::uuid AND content IS NOT NULL
    `;
  } catch (e) {
    console.error('[requestAiReview] section fetch failed', e);
    sections = [];
  }

  let enqueued = 0;
  for (const s of sections) {
    const sectionText = extractCanvasText(s.content);
    if (!sectionText) continue;
    const taskId = await requestAgentTask({
      tenantId: p.tenantId,
      agentRole: 'color_team_reviewer',
      taskType: 'review_section',
      proposalId: p.proposalId,
      sectionId: s.id,
      input: {
        // snake_case is what color_team_reviewer.build_messages reads (section_text/section_title/
        // review_type); requested_by is the comment author (_post_section_recommendation). camelCase
        // mirrors are kept so the input reads identically to the advance path.
        requested_by: p.actorId,
        requestedBy: p.actorId,
        section_title: s.title ?? '',
        sectionTitle: s.title ?? '',
        section_text: sectionText.slice(0, 20000),
        sectionText: sectionText.slice(0, 20000),
        review_type: reviewType,
        reviewType,
        category: s.sectionType ?? 'review',
      },
    });
    if (taskId) enqueued++;
  }

  // Canonical audit trail (system_events start/end).
  const payload = {
    proposalId: p.proposalId,
    proposal_id: p.proposalId,
    tenant_id: p.tenantId,
    reviewType,
    enqueued,
    source: p.source,
  };
  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'ai_review.requested',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload,
  });
  await emitEventEnd(startId, { result: payload });

  // Activity log (secondary; 'ai_review_requested' is an allowed CHECK literal — mig 044).
  try {
    await sql`
      INSERT INTO proposal_activity_log
        (proposal_id, tenant_id, actor_id, actor_email, actor_role, activity_type, details)
      VALUES (${p.proposalId}::uuid, ${p.tenantId}::uuid, ${p.actorId}::uuid,
              ${p.actorEmail ?? null}, ${p.role}, 'ai_review_requested',
              ${sql.json({ reviewType, enqueued, source: p.source })})
    `;
  } catch (logErr) {
    console.error('[requestAiReview] activity log failed', logErr);
  }

  return { enqueued };
}
