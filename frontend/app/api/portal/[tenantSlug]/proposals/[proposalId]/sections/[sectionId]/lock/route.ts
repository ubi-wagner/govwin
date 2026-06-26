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
import { harvestSectionToLibrary } from '@/lib/proposal-harvest';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

interface Resolved {
  tenantId: string;
  proposalId: string;
  userId: string;
  email: string | undefined;
  proposalStage: string;
  section: {
    id: string;
    title: string | null;
    volumeName: string | null;
    volumeNumber: number | null;
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

  let row: { stage: string; sectionId: string; title: string | null; volumeName: string | null; volumeNumber: number | null; content: string | null; version: number } | undefined;
  try {
    [row] = await sql<{ stage: string; sectionId: string; title: string | null; volumeName: string | null; volumeNumber: number | null; content: string | null; version: number }[]>`
      SELECT p.stage, s.id AS section_id, s.title, s.volume_name, s.volume_number, s.content, s.version
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
    proposalId,
    userId: sessionUser.id,
    email: sessionUser.email,
    proposalStage: row.stage,
    section: {
      id: row.sectionId,
      title: row.title,
      volumeName: row.volumeName,
      volumeNumber: row.volumeNumber,
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
  const { tenantId, proposalId, userId, email, proposalStage, section } = g;

  try {
    await sql`
      UPDATE proposal_sections
      SET status = 'approved',
          accepted_by = ${userId}::uuid,
          accepted_at = now(),
          completed_stage = ${proposalStage},
          completed_at = now(),
          is_locked = true,
          locked_at = now(),
          locked_by = ${userId}::uuid,
          editing_by = NULL,
          editing_since = NULL
      WHERE id = ${section.id}::uuid
    `;
  } catch (dbErr) {
    console.error('[sections/lock] lock update failed:', dbErr);
    return NextResponse.json({ error: 'Failed to lock section', code: 'DB_ERROR' }, { status: 500 });
  }

  try {
    await emitEventSingle({
      namespace: 'proposal',
      type: 'section.locked',
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
    console.error('[sections/lock] event emission failed:', e);
  }

  // ── Capture approved content + close-state signals (all best-effort: a
  //    failure here must not fail the lock the user just performed) ──────────
  // 1. Snapshot the accepted canvas version (preserves the approved version).
  if (section.content) {
    try {
      await sql`
        INSERT INTO canvas_versions (section_id, version_number, content, snapshot_reason, source, created_by)
        VALUES (${section.id}::uuid, ${section.version}, ${section.content}::jsonb,
                ${'section_accepted:' + proposalStage}, 'system', ${userId}::uuid)
        ON CONFLICT (section_id, version_number) DO NOTHING
      `;
    } catch (e) {
      console.error('[sections/lock] canvas snapshot failed:', e);
    }
  }

  // 2. Harvest the accepted section into the tenant library (Option 1).
  try {
    await harvestSectionToLibrary(tenantId, proposalId, section.id, userId);
  } catch (e) {
    console.error('[sections/lock] section harvest failed:', e);
  }

  // 3. Document-close + proposal-ready signals (future automation: notify team,
  //    "get ready" emails, auto-advance). A document closes when every section
  //    of its volume is locked; the proposal is ready when all are.
  try {
    const [doc] = await sql<{ total: number; locked: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_locked)::int AS locked
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid
        AND volume_number IS NOT DISTINCT FROM ${section.volumeNumber}
    `;
    if (doc && doc.total > 0 && doc.total === doc.locked) {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'document.locked',
        actor: userActor(userId, email),
        tenantId,
        payload: {
          proposalId,
          volumeName: section.volumeName,
          volumeNumber: section.volumeNumber,
          sectionCount: doc.total,
          stage: proposalStage,
        },
      });
    }

    const [all] = await sql<{ total: number; locked: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_locked)::int AS locked
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid
    `;
    if (all && all.total > 0 && all.total === all.locked) {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'proposal.advance_ready',
        actor: userActor(userId, email),
        tenantId,
        payload: { proposalId, stage: proposalStage, sectionCount: all.total },
      });
    }
  } catch (e) {
    console.error('[sections/lock] close-state signals failed:', e);
  }

  return NextResponse.json({
    data: { sectionId: section.id, isLocked: true, status: 'approved', acceptedStage: proposalStage },
  });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const g = await guard(ctx);
  if (isErr(g)) return g;
  const { tenantId, proposalId, userId, email, proposalStage, section } = g;

  try {
    // Reopen for editing. Clear this-stage acceptance markers; leave acceptance
    // from an earlier (already-advanced) stage intact.
    await sql`
      UPDATE proposal_sections
      SET is_locked = false,
          locked_at = NULL,
          locked_by = NULL,
          status = 'in_progress',
          accepted_by = NULL,
          accepted_at = NULL,
          completed_stage = CASE WHEN completed_stage = ${proposalStage} THEN NULL ELSE completed_stage END,
          completed_at = CASE WHEN completed_stage = ${proposalStage} THEN NULL ELSE completed_at END
      WHERE id = ${section.id}::uuid
    `;
  } catch (dbErr) {
    console.error('[sections/unlock] update failed:', dbErr);
    return NextResponse.json({ error: 'Failed to unlock section', code: 'DB_ERROR' }, { status: 500 });
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
