import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import { resolveUserAccess } from '@/lib/proposal-access';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

// 'approved' is intentionally NOT client-settable here — it is written ONLY by the
// section lock route (accept + lock). Lock is the single source of truth for
// "accepted"; status is a softer pre-lock drafting signal. See PROPOSAL_LIFECYCLE_V1 §9.
const VALID_STATUSES = ['empty', 'ai_drafted', 'in_progress', 'complete'] as const;

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
    let body: { content?: unknown; status?: unknown; source?: unknown; aiInstruction?: unknown; aiModel?: unknown; editSummary?: unknown; baseVersion?: unknown };
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

    // Revision tracking metadata (optional, set by AI revision panel)
    const VALID_SOURCES = ['ai_draft', 'human_edit', 'ai_revision', 'library_import', 'template', 'system'] as const;
    const source = typeof body.source === 'string' &&
      (VALID_SOURCES as readonly string[]).includes(body.source)
      ? body.source
      : 'human_edit';
    const aiInstruction = typeof body.aiInstruction === 'string' ? body.aiInstruction.slice(0, 2000) : null;
    const aiModel = typeof body.aiModel === 'string' ? body.aiModel.slice(0, 100) : null;
    const editSummary = typeof body.editSummary === 'string' ? body.editSummary.slice(0, 500) : null;

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

    // 2a. Edit permission — require this SECTION to be in the user's editable set.
    // resolveUserAccess returns every section for an admin, and only the
    // assigned + edit-permission sections for a collaborator. The prior check
    // validated stage-level edit only, so any stage-edit collaborator could PUT
    // ANY section (not just their assignments) — this closes that hole and also
    // covers the accepted_at check inside resolveUserAccess.
    let access;
    try {
      access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
    } catch (e) {
      console.error('[portal/proposals/sections/save] access resolve failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!access.editableSections.includes(sectionId)) {
      return NextResponse.json({ error: 'You do not have edit access to this section', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Verify section belongs to this proposal ─────────────────────
    let section: { id: string; version: number; status: string; title: string; content: string | null; completedStage: string | null; completedAt: Date | null; isLocked: boolean } | undefined;
    try {
      [section] = await sql<{ id: string; version: number; status: string; title: string; content: string | null; completedStage: string | null; completedAt: Date | null; isLocked: boolean }[]>`
        SELECT id, version, status, title, content, completed_stage, completed_at, is_locked FROM proposal_sections
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

    // A locked (accepted) section is read-only through the API. The editor UI
    // hides itself for locked sections, but the API is the real enforcement —
    // without this, a section locked in the CURRENT stage (is_locked=true,
    // completed_stage===stage) slips past the cross-stage guard below and its
    // accepted content gets overwritten. Reject regardless of stage.
    if (section.isLocked) {
      return NextResponse.json({
        error: 'This section is locked and cannot be edited. Unlock it first.',
        code: 'SECTION_LOCKED',
      }, { status: 423 });
    }

    // Block edits on sections completed in a previous stage
    if (section.completedStage && section.completedStage !== proposal.stage) {
      return NextResponse.json({
        error: `This section was completed in the "${section.completedStage}" stage and is now read-only`,
        code: 'STAGE_LOCKED',
        completedStage: section.completedStage,
        completedAt: section.completedAt,
      }, { status: 423 });
    }

    // ── Save current version to canvas_versions before overwriting ──
    // Archive the PREVIOUS content with source='human_edit' (safe default for what was there before).
    // The body's source/aiInstruction describe the INCOMING change, not the archived snapshot.
    {
      const currentContent = section.content;
      // Compute char/word counts from extracted text, not raw JSON
      let archiveCharCount = 0;
      let archiveWordCount = 0;
      if (currentContent) {
        try {
          const parsed = JSON.parse(currentContent);
          const nodes: Array<{ type?: string; content?: Record<string, unknown> }> = parsed.nodes ?? (Array.isArray(parsed) ? parsed : []);
          const textParts: string[] = [];
          for (const node of nodes) {
            if (!node.content) continue;
            const t = (node.content as Record<string, unknown>).text;
            if (typeof t === 'string') textParts.push(t);
            const items = (node.content as Record<string, unknown>).items;
            if (Array.isArray(items)) {
              for (const item of items) {
                if (typeof item === 'string') textParts.push(item);
                else if (item && typeof item.text === 'string') textParts.push(item.text);
              }
            }
          }
          const extractedText = textParts.join(' ');
          archiveCharCount = extractedText.length;
          archiveWordCount = extractedText.split(/\s+/).filter(Boolean).length;
        } catch {
          // If JSON parse fails, fall back to raw length
          archiveCharCount = currentContent.length;
          archiveWordCount = currentContent.split(/\s+/).filter(Boolean).length;
        }
      }

      // Archive even on first save (null content) to record the empty state
      const contentToArchive = currentContent ?? '{}';
      try {
        await sql`
          INSERT INTO canvas_versions
            (section_id, version_number, content, snapshot_reason, source, created_by,
             char_count, word_count, ai_instruction, ai_model, edit_summary)
          VALUES (
            ${sectionId}::uuid,
            ${section.version},
            ${contentToArchive}::jsonb,
            'save',
            'human_edit',
            ${sessionUser.id}::uuid,
            ${archiveCharCount},
            ${archiveWordCount},
            ${null},
            ${null},
            ${null}
          )
          ON CONFLICT (section_id, version_number) DO NOTHING
        `;
      } catch (e) {
        console.error('[section-save] canvas_versions insert failed:', e);
        // Non-fatal — continue with the save
      }
    }

    // ── Strip __revisionMeta before persisting ─────────────────────
    if (typeof body.content === 'object' && body.content !== null && '__revisionMeta' in body.content) {
      const cleaned = { ...body.content } as Record<string, unknown>;
      delete cleaned.__revisionMeta;
      body.content = cleaned;
    }

    // ── Update section with optimistic concurrency ─────────────────
    const contentJson = JSON.stringify(body.content);
    // Real optimistic lock: compare-and-swap against the version the CLIENT loaded
    // (baseVersion), not the version re-read in this request. Without this, two
    // users who both opened v5 and save minutes apart BOTH succeed (each request
    // re-reads the current version and matches it) — last write silently wins.
    // Falls back to the server-read version for older clients that omit baseVersion.
    const base = typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion)
      ? body.baseVersion
      : section.version;
    const nextVersion = base + 1;

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
            AND version = ${base}
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
            AND version = ${base}
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
    try {
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
    } catch (evtErr) {
      console.error('[api/portal/proposals/sections/save] event emission failed:', evtErr);
    }

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
                ${sql.json({ previous_version: section.version })})
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
