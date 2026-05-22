import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

const VALID_STATUSES = ['empty', 'ai_drafted', 'in_progress', 'complete', 'approved'] as const;

/**
 * PUT /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save
 *
 * Saves section content (JSON) and optionally updates status.
 * Auth: tenant member with edit access.
 *
 * Body: { content: object, status?: string }
 */
export async function PUT(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug, proposalId, sectionId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
      return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Input validation ─────────────────────────────────────────────
    let body: { content?: unknown; status?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (body.content === undefined || body.content === null) {
      return NextResponse.json({ error: 'content is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (typeof body.content !== 'object') {
      return NextResponse.json({ error: 'content must be an object', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // 2c. Content size limit
    if (JSON.stringify(body.content).length > 2_000_000) {
      return NextResponse.json({ error: 'Content too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }

    const newStatus = typeof body.status === 'string' &&
      (VALID_STATUSES as readonly string[]).includes(body.status)
      ? body.status
      : null;

    // ── Verify proposal belongs to tenant and is not locked ─────────
    let proposal: { id: string; isLocked: boolean; unlockDeadline: Date | null; stage: string } | undefined;
    try {
      [proposal] = await sql<{ id: string; isLocked: boolean; unlockDeadline: Date | null; stage: string }[]>`
        SELECT id, is_locked, unlock_deadline, stage FROM proposals
        WHERE id = ${proposalId}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/sections/save] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (proposal.isLocked) {
      return NextResponse.json({ error: 'Proposal is locked', code: 'VALIDATION_ERROR' }, { status: 423 });
    }

    // 3a. Unlock deadline enforcement
    if (proposal.unlockDeadline && new Date(proposal.unlockDeadline) < new Date()) {
      return NextResponse.json({ error: 'Edit window expired', code: 'EDIT_WINDOW_EXPIRED' }, { status: 423 });
    }

    // 2a. Edit permission check
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      // Non-admin users: check collaborator edit permission for current stage
      let collabAccess: { permission: string } | undefined;
      try {
        [collabAccess] = await sql<{ permission: string }[]>`
          SELECT csa.permission
          FROM proposal_collaborators pc
          JOIN collaborator_stage_access csa
            ON csa.collaborator_id = pc.id
            AND csa.proposal_id = pc.proposal_id
          WHERE pc.proposal_id = ${proposalId}
            AND pc.user_id = ${sessionUser.id}
            AND csa.stage = ${proposal.stage}
            AND csa.access_revoked_at IS NULL
          LIMIT 1
        `;
      } catch (e) {
        console.error('[portal/proposals/sections/save] collaborator access query failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
      if (!collabAccess || collabAccess.permission !== 'edit') {
        return NextResponse.json({ error: 'Edit permission required', code: 'FORBIDDEN' }, { status: 403 });
      }
    }

    // ── Verify section belongs to this proposal ─────────────────────
    let section: { id: string; version: number; status: string; title: string } | undefined;
    try {
      [section] = await sql<{ id: string; version: number; status: string; title: string }[]>`
        SELECT id, version, status, title FROM proposal_sections
        WHERE id = ${sectionId}
          AND proposal_id = ${proposalId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/sections/save] section query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!section) {
      return NextResponse.json({ error: 'Section not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Update section with optimistic concurrency ─────────────────
    const contentJson = JSON.stringify(body.content);
    const nextVersion = section.version + 1;

    let updateResult;
    try {
      if (newStatus) {
        updateResult = await sql`
          UPDATE proposal_sections
          SET content = ${contentJson},
              status = ${newStatus},
              version = ${nextVersion},
              last_modified_by = ${sessionUser.id}::uuid,
              editing_by = NULL,
              editing_since = NULL,
              updated_at = now()
          WHERE id = ${sectionId}
            AND version = ${section.version}
        `;
      } else {
        updateResult = await sql`
          UPDATE proposal_sections
          SET content = ${contentJson},
              version = ${nextVersion},
              last_modified_by = ${sessionUser.id}::uuid,
              editing_by = NULL,
              editing_since = NULL,
              updated_at = now()
          WHERE id = ${sectionId}
            AND version = ${section.version}
        `;
      }
    } catch (e) {
      console.error('[portal/proposals/sections/save] section update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // 2b. Optimistic concurrency — if 0 rows updated, someone else saved first
    if (updateResult.count === 0) {
      // Re-fetch the current version to tell the client
      let current: { version: number } | undefined;
      try {
        [current] = await sql<{ version: number }[]>`
          SELECT version FROM proposal_sections WHERE id = ${sectionId}
        `;
      } catch (e) {
        console.error('[portal/proposals/sections/save] version re-fetch failed:', e);
      }
      return NextResponse.json(
        { error: 'Section was modified by another user', code: 'CONFLICT', currentVersion: current?.version ?? null },
        { status: 409 },
      );
    }

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'section.saved',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        sectionId,
        sectionTitle: section.title,
        version: nextVersion,
        status: newStatus ?? undefined,
      },
    });

    // ── Activity log ────────────────────────────────────────────────
    try {
      const userRole = role;
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, section_id, section_title, entity_version, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${userRole},
                'section_saved', ${sectionId}::uuid, ${section.title}, ${nextVersion},
                ${JSON.stringify({ previous_version: section.version })}::jsonb)
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/sections/save] activity log failed', logErr);
    }

    return NextResponse.json({
      data: {
        sectionId,
        version: nextVersion,
        status: newStatus ?? section.status,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/sections/save] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
