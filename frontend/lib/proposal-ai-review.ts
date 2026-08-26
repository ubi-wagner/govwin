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
import { requestVisualReview, type VisualReviewOutcome } from '@/lib/proposal-visual-review';
import { buildScopeDocument, planReviewTargets, scopedId, type ScopeLevel, type Selection } from '@/lib/canvas/scope';

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
  /**
   * Restrict the review to these sections. Used by the RETRY path, which re-queues only the
   * sections whose last review failed: re-running everything would post a second, possibly
   * contradictory review on each section that already succeeded, and would spend the same hourly
   * budget that caused the failure in the first place.
   */
  onlySectionIds?: string[];
  /**
   * Aim the review at ONE scope instead of fanning out over every section.
   *
   * Omitting it takes the untouched section fan-out below — same query, same loop, same row,
   * `scope_level` left NULL. That is deliberate: the fan-out is a live path, and the way to be
   * sure a new feature did not disturb it is to not run its code at all.
   *
   * `sectionId` here is the section the CALLER is looking at, used to disambiguate a raw node id
   * coming from the per-section editor (the fluid surface sends assembled `<sectionId>__<nodeId>`
   * ids; the section editor sends raw ones).
   */
  scope?: Selection & { sectionId?: string };
}

export interface RequestAiReviewResult {
  enqueued: number;
  /** The visual pass that ran alongside the per-section text reviewers. */
  visual?: VisualReviewOutcome;
  /** Present only for a scoped request — what the reviewer was actually pointed at. */
  scope?: { level: ScopeLevel; label: string; sectionId: string; pages: { start: number; end: number } | null };
}

/**
 * The scoped path: ONE reviewer, pointed at one rung of the ladder.
 *
 * Resolution happens against `buildScopeDocument`, NOT `assembleProposalDocument`. The latter
 * flattens every section's nodes into one list because that is what RENDERING a fluid document
 * needs — and flattening destroys exactly what scoping addresses. Measured live before this was
 * corrected: a group scope and a section scope both resolved to `document`, so "review this
 * figure" queued a review of the entire proposal.
 *
 * Node and group ids in the scope document are `<sectionId>__<localId>` — the same convention the
 * fluid canvas already renders, so an id from that surface needs no translation, and one from the
 * per-section editor needs only `scopedId`.
 *
 * Returns null when the scope resolves to nothing reviewable, so the caller can say so instead of
 * reporting a queued review that will never produce a comment.
 */
async function queueScopedReview(
  p: RequestAiReviewParams, reviewType: ReviewType,
): Promise<{ enqueued: number; scope: RequestAiReviewResult['scope'] } | null> {
  // Field names are camelCase to match postgres.js's global `toCamel` transform — a snake_case
  // `sql<typeof rows>` assertion compiles and reads `undefined` at runtime (CLAUDE.md's #1 crash
  // class). The ORDER BY is COPIED from the document route, not re-derived: assembly order decides
  // which section a wide scope files against, and two orderings that "should" agree is exactly how
  // a confident, wrong answer gets built.
  let sections: Array<{
    id: string; title: string | null; content: string | null; volumeName: string | null;
  }> = [];
  try {
    sections = await sql<typeof sections>`
      SELECT ps.id, ps.title, ps.content, ps.volume_name
      FROM proposal_sections ps
      WHERE ps.proposal_id = ${p.proposalId}::uuid
      ORDER BY ps.volume_number ASC NULLS LAST, ps.sort_index ASC NULLS LAST, ps.section_number ASC`;
  } catch (e) {
    console.error('[requestAiReview] scoped section fetch failed', e);
    return null;
  }
  if (!sections.length) return null;

  const doc = buildScopeDocument(sections);

  // The per-section editor sends a RAW node/group id; the fluid surface sends the scoped one. Try
  // the id as given, then as it is keyed inside the section the caller says it is looking at.
  const known = new Set<string>();
  for (const s of doc.sections ?? []) {
    for (const g of s.groups ?? []) {
      known.add(g.id);
      for (const n of g.nodes ?? []) known.add(n.id);
    }
  }
  const sel: Selection = { ...p.scope };
  const sectionHint = p.scope?.sectionId;
  if (sectionHint) {
    if (sel.nodeId && !known.has(sel.nodeId)) sel.nodeId = scopedId(sectionHint, sel.nodeId);
    if (sel.groupId && !known.has(sel.groupId)) sel.groupId = scopedId(sectionHint, sel.groupId);
  }
  // `sectionId` is BOTH the disambiguating hint above and, on its own, a section-level scope. Once
  // it has been used as a hint for a narrower selection it must not also widen the scope to the
  // section — the innermost thing the caller named is what they asked for.
  if (sel.nodeId || sel.groupId) delete sel.sectionId;

  const targets = planReviewTargets(doc, sel, { sectionIdFallback: sectionHint ?? sections[0].id });
  if (!targets.length) return null;

  let enqueued = 0;
  let landed: RequestAiReviewResult['scope'];
  for (const t of targets) {
    const taskId = await requestAgentTask({
      tenantId: p.tenantId,
      agentRole: 'color_team_reviewer',
      taskType: 'review_section',
      proposalId: p.proposalId,
      sectionId: t.sectionId,
      scopeLevel: t.scopeLevel,
      scopeRef: t.scopeRef,
      input: {
        requested_by: p.actorId,
        requestedBy: p.actorId,
        // The reviewer is told WHAT it is looking at, not just its section's name. "Figure 3 in
        // Technical Approach" and "Technical Approach" ask for different reviews.
        section_title: t.label,
        sectionTitle: t.label,
        section_text: t.text,
        sectionText: t.text,
        review_type: reviewType,
        reviewType,
        category: 'review',
        // Echoed into the finding's anchor by the pipeline write-back, so the comment lands
        // pinned to the same thing the reviewer read.
        scope_level: t.scopeLevel,
        scope_ref: t.scopeRef,
        scope_label: t.label,
      },
    });
    if (taskId) {
      enqueued++;
      landed = { level: t.scopeLevel, label: t.label, sectionId: t.sectionId, pages: t.pages };
    }
  }
  return { enqueued, scope: landed };
}

export async function requestAiReview(p: RequestAiReviewParams): Promise<RequestAiReviewResult> {
  const reviewType: ReviewType = p.reviewType ?? 'red_team';

  // ── SCOPED: one reviewer, one rung ───────────────────────────────────────────────────────────
  // Returns before the fan-out below ever runs. The unscoped path is therefore not merely
  // unchanged in behaviour — it is unchanged code on an unchanged branch, which is a stronger
  // guarantee than "I checked and it still works".
  if (p.scope) {
    const scoped = await queueScopedReview(p, reviewType);
    const enqueued = scoped?.enqueued ?? 0;
    const payload = {
      proposalId: p.proposalId, proposal_id: p.proposalId, tenant_id: p.tenantId,
      reviewType, enqueued, source: p.source,
      scopeLevel: scoped?.scope?.level ?? null, scopeLabel: scoped?.scope?.label ?? null,
    };
    const startId = await emitEventStart({
      namespace: 'proposal', type: 'ai_review.requested',
      actor: userActor(p.actorId, p.actorEmail ?? undefined), tenantId: p.tenantId, payload,
    });
    await emitEventEnd(startId, { result: payload });
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role, activity_type, details)
        VALUES (${p.proposalId}::uuid, ${p.tenantId}::uuid, ${p.actorId}::uuid,
                ${p.actorEmail ?? null}, ${p.role}, 'ai_review_requested',
                ${sql.json({ reviewType, enqueued, source: p.source, scope: scoped?.scope ?? null })})`;
    } catch (logErr) {
      console.error('[requestAiReview] scoped activity log failed', logErr);
    }
    return { enqueued, ...(scoped?.scope ? { scope: scoped.scope } : {}) };
  }

  // Every section with content — a manual review can run pre-lock (unlike on-advance, which
  // reviews the accepted/locked content). Empty canvases are skipped after text extraction.
  let sections: { id: string; title: string | null; content: string | null; sectionType: string | null }[] = [];
  const only = p.onlySectionIds && p.onlySectionIds.length ? p.onlySectionIds : null;
  try {
    sections = only
      ? await sql`
          SELECT id, title, content, section_type
          FROM proposal_sections
          WHERE proposal_id = ${p.proposalId}::uuid AND content IS NOT NULL
            AND id = ANY(${only}::uuid[])
        `
      : await sql`
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

  // ── THE REVIEWER THAT LOOKS ───────────────────────────────────────────────────────────────
  // Everything above queues text reviewers: one color_team_reviewer per section, each reading that
  // section's extracted prose. They are good at the argument and blind to the page. A whole class
  // of defect — a truncated diagram label, an unlabelled chart band, a caption that describes the
  // wrong thing, a volume that renders one page over its cap — is invisible in the model and
  // obvious in the render.
  //
  // So the same button also runs a visual pass over each VOLUME and posts what it sees into the
  // same section threads, as the same `ai_review` recommendation type. One review, two kinds of
  // reviewer.
  //
  // Not enqueued through agent_task_queue like its siblings: the pipeline cannot render a canvas
  // (the exporters and Chromium live here), so this runs inline. Best-effort — a review that cannot
  // run must never fail the request that asked for it, and the per-section reviewers are already
  // queued by the time it starts.
  //
  // Skipped when the caller restricted the review to specific sections: that is the RETRY path,
  // re-running only what failed, and the volumes were already looked at on the first pass.
  let visual: VisualReviewOutcome | undefined;
  if (!p.onlySectionIds?.length) {
    try {
      visual = await requestVisualReview({
        proposalId: p.proposalId,
        tenantId: p.tenantId,
        actorId: p.actorId,
        actorEmail: p.actorEmail,
        source: p.source,
      });
    } catch (e) {
      console.error('[requestAiReview] visual pass failed (non-fatal)', e);
    }
  }

  return { enqueued, ...(visual ? { visual } : {}) };
}
