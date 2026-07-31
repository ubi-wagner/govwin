/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/lock-scope
 *
 * Hierarchical PUSH — lock every lockable canvas within a scope in one call,
 * still auditing PER canvas. It loops lockSectionCore over the target sections,
 * so each canvas runs the identical stricture (section.locked event, matrix →
 * satisfied, snapshot, harvest, artifact roll-up) and the volume (document.locked)
 * / proposal (advance_ready + optional auto-advance) roll-ups fire naturally as
 * the last section in each scope locks. This is the "close + move" push at the
 * artifact / volume / proposal level.
 *
 * Body: { scope: 'artifact' | 'volume' | 'proposal', artifactId?: uuid, volumeNumber?: int }
 * Auth: admin (resolveUserAccess role === 'admin' — same as per-section lock).
 * Response: { data: { scope, targetCount, lockedCount, alreadyLockedCount, autoAdvancedTo } }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { isValidUUID } from '@/lib/validation';
import { lockSectionCore, type LockSectionCtx } from '@/lib/proposal/lock-section';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

type Target = {
  id: string;
  title: string | null;
  volumeName: string | null;
  volumeNumber: number | null;
  artifactId: string | null;
  content: string | null;
  version: number;
  stage: string;
};

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Auth: admin only (same gate as the per-section lock) ──────────────
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
    if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    const access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
    if (access.role !== 'admin') {
      return NextResponse.json({ error: 'Only an admin can lock/push', code: 'FORBIDDEN' }, { status: 403 });
    }

    enterTenant(tenantId);

    // ── Input ─────────────────────────────────────────────────────────────
    let body: { scope?: unknown; artifactId?: unknown; volumeNumber?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const scope = body.scope;
    if (scope !== 'artifact' && scope !== 'volume' && scope !== 'proposal') {
      return NextResponse.json({ error: "scope must be 'artifact' | 'volume' | 'proposal'", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Resolve the target canvases. Only LOCKABLE ones: not already locked,
    //    not empty, and with real content (mirrors the client "Accept & Lock All"
    //    filter). Ordered so the roll-ups fire in a stable sequence. ─────────
    let targets: Target[];
    try {
      if (scope === 'artifact') {
        if (typeof body.artifactId !== 'string' || !isValidUUID(body.artifactId)) {
          return NextResponse.json({ error: 'artifactId (uuid) required for scope=artifact', code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        targets = await sql<Target[]>`
          SELECT s.id, s.title, s.volume_name, s.volume_number, s.artifact_id, s.content, s.version, p.stage
          FROM proposal_sections s JOIN proposals p ON p.id = s.proposal_id
          WHERE s.proposal_id = ${proposalId}::uuid AND p.tenant_id = ${tenantId}::uuid
            AND s.artifact_id = ${body.artifactId}::uuid
            AND s.is_locked = false AND s.status <> 'empty' AND s.content IS NOT NULL
          ORDER BY s.section_number
        `;
      } else if (scope === 'volume') {
        if (!Number.isInteger(body.volumeNumber)) {
          return NextResponse.json({ error: 'volumeNumber (int) required for scope=volume', code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        targets = await sql<Target[]>`
          SELECT s.id, s.title, s.volume_name, s.volume_number, s.artifact_id, s.content, s.version, p.stage
          FROM proposal_sections s JOIN proposals p ON p.id = s.proposal_id
          WHERE s.proposal_id = ${proposalId}::uuid AND p.tenant_id = ${tenantId}::uuid
            AND s.volume_number IS NOT DISTINCT FROM ${body.volumeNumber as number}
            AND s.is_locked = false AND s.status <> 'empty' AND s.content IS NOT NULL
          ORDER BY s.section_number
        `;
      } else {
        targets = await sql<Target[]>`
          SELECT s.id, s.title, s.volume_name, s.volume_number, s.artifact_id, s.content, s.version, p.stage
          FROM proposal_sections s JOIN proposals p ON p.id = s.proposal_id
          WHERE s.proposal_id = ${proposalId}::uuid AND p.tenant_id = ${tenantId}::uuid
            AND s.is_locked = false AND s.status <> 'empty' AND s.content IS NOT NULL
          ORDER BY s.volume_number, s.section_number
        `;
      }
    } catch (e) {
      console.error('[lock-scope] target query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── Push: lock each target canvas through the shared, audited core ──────
    let lockedCount = 0;
    let alreadyLockedCount = 0;
    let failedCount = 0;
    let autoAdvancedTo: string | null = null;
    for (const t of targets) {
      const g: LockSectionCtx = {
        tenantId,
        tenantSlug,
        role,
        proposalId,
        userId: sessionUser.id,
        email: sessionUser.email,
        proposalStage: t.stage,
        section: {
          id: t.id,
          title: t.title,
          volumeName: t.volumeName,
          volumeNumber: t.volumeNumber,
          artifactId: t.artifactId,
          content: t.content,
          version: t.version,
        },
      };
      try {
        const r = await lockSectionCore(g);
        if (r.locked) lockedCount++;
        else alreadyLockedCount++;
        if (r.autoAdvancedTo) autoAdvancedTo = r.autoAdvancedTo;
      } catch (e) {
        console.error('[lock-scope] section lock failed (continuing):', t.id, e);
        failedCount++;
      }
    }

    return NextResponse.json({
      data: { scope, targetCount: targets.length, lockedCount, alreadyLockedCount, failedCount, autoAdvancedTo },
    });
  } catch (e) {
    console.error('[lock-scope] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
