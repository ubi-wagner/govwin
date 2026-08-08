/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/land-revisions
 *
 * The full-draft LAND-OR-REVIEW consumer (read-on-review). The fabric never lands
 * agent output itself, and the workflow engine's invariants forbid a pipeline
 * ACTION from consuming an agent step's result (docs/FULL_DRAFT_LANDING_DESIGN.md).
 * So the landing lives HERE, human-triggered: read the proposal's latest
 * OnFullDraftRequested% process_instance, scan its step_results for the drafting
 * cohort's review-staged section canvases (source='ai_revision', persisted:false),
 * and land each as a PROPOSED canvas_versions row (source='ai_revision') that the
 * builder reviews + restores in the section's version history.
 *
 * Proposed-only: never touches live proposal_sections.content. Idempotent: skips a
 * section whose latest full-draft ai_revision already matches the staged canvas.
 *
 * Auth: tenant_admin+ (the admin who ran the full draft reviews it).
 * Returns: { data: { landed, sections, scanned } } | { error, code }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { emitEventSingle, userActor } from '@/lib/events';

/** Recursively collect review-staged section canvases from the nested agent
 *  step_results; last-seen per section wins (later agents = more refined). */
function collectStaged(obj: unknown, out: Map<string, unknown>): void {
  if (Array.isArray(obj)) {
    for (const v of obj) collectStaged(v, out);
    return;
  }
  if (obj && typeof obj === 'object') {
    const d = obj as Record<string, unknown>;
    const sectionId = d.section_id ?? d.sectionId;
    const canvas = d.canvas;
    const staged =
      d.source === 'ai_revision' || d.persisted === false || d.staged_for_review === true || d.stagedForReview === true;
    if (typeof sectionId === 'string' && canvas != null && staged) {
      out.set(sectionId, canvas);
    }
    for (const v of Object.values(d)) collectStaged(v, out);
  }
}

function counts(canvas: unknown): { chars: number; words: number } {
  const text = typeof canvas === 'string' ? canvas : JSON.stringify(canvas ?? {});
  return { chars: text.length, words: text.split(/\s+/).filter(Boolean).length };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string; proposalId: string }> },
) {
  try {
    const { tenantSlug, proposalId } = await params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Auth: tenant_admin+ ──────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyProposalAccess(u.id, role, u.tenantId, tenantId, proposalId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    // ── Find the proposal's latest full-draft run + its step_results ──
    let instance: { stepResults: Record<string, unknown> | null } | undefined;
    try {
      [instance] = await sql<{ stepResults: Record<string, unknown> | null }[]>`
        SELECT step_results
        FROM process_instances
        WHERE tenant_id = ${tenantId}::uuid
          AND workflow_name LIKE 'OnFullDraftRequested%'
          AND payload->>'proposal_id' = ${proposalId}
        ORDER BY started_at DESC NULLS LAST
        LIMIT 1
      `;
    } catch (e) {
      console.error('[land-revisions] instance query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!instance) {
      return NextResponse.json({ data: { landed: 0, sections: [], scanned: false, reason: 'no_full_draft_run' } });
    }

    // ── Extract the staged section canvases ──────────────────────────
    const staged = new Map<string, unknown>();
    collectStaged(coerceJsonb<Record<string, unknown>>(instance.stepResults, {}), staged);
    if (staged.size === 0) {
      return NextResponse.json({ data: { landed: 0, sections: [], scanned: true, reason: 'no_staged_revisions' } });
    }

    // ── Land each as a PROPOSED ai_revision version (tenant-scoped, idempotent) ──
    const landed: string[] = [];
    for (const [sectionId, canvas] of staged) {
      if (!isValidUUID(sectionId)) continue;
      try {
        // Ownership + the section's CURRENT version. The landing must number by the same
        // counter every canvas_versions writer uses (proposal_sections.version), then ADVANCE
        // it — so a later human-save's archive (which snapshots at proposal_sections.version)
        // never collides with this proposed row. Numbering at MAX(version_number)+1 WITHOUT
        // advancing breaks the invariant `proposal_sections.version > MAX(version_number)` and
        // silently drops the next save's archive (an undo/history content-loss risk — found via
        // a live staging scenario, not the mocked unit tests).
        const [owned] = await sql<{ id: string; version: number }[]>`
          SELECT id, version FROM proposal_sections WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid LIMIT 1
        `;
        if (!owned) continue;

        // Idempotency: skip if the latest full-draft ai_revision already matches.
        const [prior] = await sql<{ content: unknown }[]>`
          SELECT content FROM canvas_versions
          WHERE section_id = ${sectionId}::uuid AND source = 'ai_revision' AND snapshot_reason = 'full_draft'
          ORDER BY version_number DESC LIMIT 1
        `;
        if (prior && JSON.stringify(coerceJsonb(prior.content, null)) === JSON.stringify(canvas)) continue;

        const v = owned.version;
        const { chars, words } = counts(canvas);
        const ins = await sql<{ versionNumber: number }[]>`
          INSERT INTO canvas_versions
            (section_id, version_number, content, snapshot_reason, source, created_by, char_count, word_count, edit_summary)
          VALUES (${sectionId}::uuid, ${v}, ${sql.json(canvas as never)}, 'full_draft', 'ai_revision',
                  ${u.id}::uuid, ${chars}, ${words}, 'AI-proposed revision (full draft)')
          ON CONFLICT (section_id, version_number) DO NOTHING
          RETURNING version_number
        `;
        if (ins.length === 0) continue; // version slot already taken (race) — skip, don't advance
        // Advance the section's version counter past the proposed row (compare-and-swap), so the
        // next save archives into a free slot and the invariant holds. Content is untouched.
        await sql`UPDATE proposal_sections SET version = version + 1 WHERE id = ${sectionId}::uuid AND version = ${v}`;
        landed.push(sectionId);
      } catch (e) {
        console.error('[land-revisions] landing section failed (skipped):', sectionId, e);
      }
    }

    if (landed.length > 0) {
      try {
        await emitEventSingle({
          namespace: 'proposal',
          type: 'full_draft.landed',
          actor: userActor(u.id, u.email ?? undefined),
          tenantId,
          payload: { proposalId, sections: landed, count: landed.length },
        });
      } catch (e) {
        console.error('[land-revisions] event emit failed (non-fatal):', e);
      }
    }

    return NextResponse.json({ data: { landed: landed.length, sections: landed, scanned: true } });
  } catch (err) {
    console.error('[land-revisions] error:', err);
    return NextResponse.json({ error: 'Landing failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
