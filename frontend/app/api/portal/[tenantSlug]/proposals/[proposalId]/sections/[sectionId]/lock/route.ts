/**
 * Section accept/lock lifecycle (V1 core feature).
 *
 *   POST   …/sections/[sectionId]/lock   — accept + lock the section.
 *     Sets status='approved', records accepted_by/at + completed_stage (the
 *     stage it was accepted in) + is_locked. A locked section is frozen
 *     (read-only) until unlocked, and is the unit of "approved content" the
 *     stage gate counts (Phase 2) and that gets harvested on advance.
 *
 *   DELETE …/sections/[sectionId]/lock   — unlock (reopen) for further
 *     editing / regeneration.
 *
 * Auth: accept/lock is an admin action in V1 — the customer's tenant_admin
 * (and rfp_admin / master_admin), i.e. resolveUserAccess role === 'admin'.
 * Every transition emits an audited event (who, which section, which stage).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { lockSectionCore } from '@/lib/proposal/lock-section';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

interface Resolved {
  tenantId: string;
  tenantSlug: string;
  role: Role;
  proposalId: string;
  userId: string;
  email: string | undefined;
  proposalStage: string;
  section: {
    id: string;
    title: string | null;
    volumeName: string | null;
    volumeNumber: number | null;
    artifactId: string | null;
    content: string | null;
    version: number;
  };
}

/** Shared auth + admin-access + section-belongs guard. */
async function guard(ctx: RouteContext): Promise<Resolved | NextResponse> {
  const { tenantSlug, proposalId, sectionId } = await ctx.params;
  if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
    return NextResponse.json({ error: 'Invalid id format', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const sessionUser = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
  if (access.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only an admin can accept/lock sections', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  let row: { stage: string; sectionId: string; title: string | null; volumeName: string | null; volumeNumber: number | null; artifactId: string | null; content: string | null; version: number } | undefined;
  try {
    [row] = await sql<{ stage: string; sectionId: string; title: string | null; volumeName: string | null; volumeNumber: number | null; artifactId: string | null; content: string | null; version: number }[]>`
      SELECT p.stage, s.id AS section_id, s.title, s.volume_name, s.volume_number, s.artifact_id, s.content, s.version
      FROM proposal_sections s
      JOIN proposals p ON p.id = s.proposal_id
      WHERE s.id = ${sectionId}::uuid
        AND s.proposal_id = ${proposalId}::uuid
        AND p.tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
  } catch (dbErr) {
    console.error('[sections/lock] guard query failed:', dbErr);
    return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Section not found for this proposal', code: 'NOT_FOUND' }, { status: 404 });
  }

  return {
    tenantId,
    tenantSlug,
    role,
    proposalId,
    userId: sessionUser.id,
    email: sessionUser.email,
    proposalStage: row.stage,
    section: {
      id: row.sectionId,
      title: row.title,
      volumeName: row.volumeName,
      volumeNumber: row.volumeNumber,
      artifactId: row.artifactId,
      content: row.content,
      version: row.version,
    },
  };
}

function isErr(x: Resolved | NextResponse): x is NextResponse {
  return x instanceof NextResponse;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const g = await guard(ctx);
  if (isErr(g)) return g;
  const { section, proposalStage } = g;

  // The per-section lock stricture now lives in lockSectionCore (shared with the
  // hierarchical lock-scope push), so every canvas locked — one-off or via a
  // hierarchical push — runs the identical audited side effects.
  let result;
  try {
    result = await lockSectionCore(g);
  } catch (dbErr) {
    console.error('[sections/lock] lock update failed:', dbErr);
    return NextResponse.json({ error: 'Failed to lock section', code: 'DB_ERROR' }, { status: 500 });
  }

  if (result.alreadyLocked) {
    // Already locked (concurrent/double submit) — end state is correct; the core
    // did NOT re-run the one-time side effects.
    return NextResponse.json({
      data: { sectionId: section.id, isLocked: true, status: 'approved', acceptedStage: proposalStage, alreadyLocked: true },
    });
  }

  return NextResponse.json({
    data: {
      sectionId: section.id, isLocked: true, status: 'approved', acceptedStage: proposalStage,
      ...(result.autoAdvancedTo ? { autoAdvancedTo: result.autoAdvancedTo } : {}),
    },
  });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const g = await guard(ctx);
  if (isErr(g)) return g;
  const { tenantId, proposalId, userId, email, proposalStage, section } = g;

  let unlockedRows: { id: string }[];
  try {
    // Reopen for editing. Clear this-stage acceptance markers; leave acceptance
    // from an earlier (already-advanced) stage intact. Compare-and-swap on
    // is_locked so a double-submit can't re-fire the artifact reopen + event.
    unlockedRows = await sql<{ id: string }[]>`
      UPDATE proposal_sections
      SET is_locked = false,
          locked_at = NULL,
          locked_by = NULL,
          status = 'in_progress',
          accepted_by = NULL,
          accepted_at = NULL,
          completed_stage = CASE WHEN completed_stage = ${proposalStage} THEN NULL ELSE completed_stage END,
          completed_at = CASE WHEN completed_stage = ${proposalStage} THEN NULL ELSE completed_at END
      WHERE id = ${section.id}::uuid AND is_locked = true
      RETURNING id
    `;
  } catch (dbErr) {
    console.error('[sections/unlock] update failed:', dbErr);
    return NextResponse.json({ error: 'Failed to unlock section', code: 'DB_ERROR' }, { status: 500 });
  }
  if (unlockedRows.length === 0) {
    // Already unlocked — idempotent no-op; don't reopen the artifact or emit.
    return NextResponse.json({ data: { sectionId: section.id, isLocked: false, status: 'in_progress', alreadyUnlocked: true } });
  }

  // Artifact roll-up (E1): unlocking a section reopens its (previously locked)
  // artifact — the document is no longer fully accepted.
  if (section.artifactId) {
    try {
      await sql`
        UPDATE proposal_artifacts
        SET is_locked = false, status = 'in_progress', locked_at = NULL, locked_by = NULL
        WHERE id = ${section.artifactId}::uuid AND is_locked = true
      `;
    } catch (e) {
      console.error('[sections/unlock] artifact reopen failed (non-fatal):', e);
    }
  }

  // Compliance matrix: reopening a section makes its requirements unsatisfied
  // again (mirror of the lock path). Best-effort.
  try {
    await sql`
      UPDATE proposal_compliance_matrix
      SET status = 'not_addressed', updated_at = now()
      WHERE section_id = ${section.id}::uuid AND status = 'satisfied'
    `;
  } catch (e) {
    console.error('[sections/unlock] compliance matrix reset failed (non-fatal):', e);
  }

  try {
    await emitEventSingle({
      namespace: 'proposal',
      type: 'section.unlocked',
      actor: userActor(userId, email),
      tenantId,
      payload: {
        proposalId,
        sectionId: section.id,
        stage: proposalStage,
        volumeName: section.volumeName,
        title: section.title,
      },
    });
  } catch (e) {
    console.error('[sections/unlock] event emission failed:', e);
  }

  return NextResponse.json({
    data: { sectionId: section.id, isLocked: false, status: 'in_progress' },
  });
}
