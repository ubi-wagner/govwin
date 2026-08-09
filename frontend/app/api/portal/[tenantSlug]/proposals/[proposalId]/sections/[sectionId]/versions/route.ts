import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { sectionLockReason } from '@/lib/proposal/section-writable';
import { isValidUUID } from '@/lib/validation';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/versions
 *
 * Returns version history for a proposal section from canvas_versions.
 *
 * Query params:
 *   ?limit=50       — max versions to return (default 50, max 200)
 *   ?version=N      — return full content for a specific version number
 *
 * Without ?version: returns metadata only (no content — too large).
 * With ?version=N: returns full content for that specific version.
 */
export async function GET(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { tenantSlug, proposalId, sectionId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
      return NextResponse.json(
        { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Tenant access denied', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    enterTenant(tenantId); // RLS choke point: pin tenant context in the handler's own frame

    // ── Verify proposal belongs to tenant ────────────────────────────
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[versions] proposal query failed:', e);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Section-level access — a collaborator scoped to one section must not
    //    read another section's history (its content is returned on ?version=N).
    //    resolveUserAccess returns EVERY section for an admin/tenant-wide member
    //    and only the GRANTED sections for a collaborator, so this enforces both
    //    proposal membership AND per-section scope in one check.
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      let access;
      try {
        access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
      } catch (e) {
        console.error('[versions] access check failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
      const canView = access.viewableSections.includes(sectionId)
        || access.commentableSections.includes(sectionId)
        || access.editableSections.includes(sectionId);
      if (!canView) {
        return NextResponse.json(
          { error: 'You do not have access to this section', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
    }

    // ── Verify section belongs to this proposal ──────────────────────
    let section: { id: string } | undefined;
    try {
      [section] = await sql<{ id: string }[]>`
        SELECT id FROM proposal_sections
        WHERE id = ${sectionId} AND proposal_id = ${proposalId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[versions] section query failed:', e);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (!section) {
      return NextResponse.json(
        { error: 'Section not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Parse query params ───────────────────────────────────────────
    const url = new URL(request.url);
    const versionParam = url.searchParams.get('version');
    const limitParam = url.searchParams.get('limit');

    // ── Specific version request (includes full content) ─────────────
    if (versionParam !== null) {
      const versionNumber = parseInt(versionParam, 10);
      if (isNaN(versionNumber) || versionNumber < 1) {
        return NextResponse.json(
          { error: 'Invalid version number', code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }

      let version: {
        versionNumber: number;
        content: unknown;
        snapshotReason: string | null;
        source: string;
        createdBy: string | null;
        createdAt: Date;
        charCount: number | null;
        wordCount: number | null;
        aiInstruction: string | null;
        aiModel: string | null;
        editSummary: string | null;
        parentVersionId: string | null;
      } | undefined;

      try {
        [version] = await sql<typeof version[]>`
          SELECT cv.version_number, cv.content, cv.snapshot_reason, cv.source,
                 cv.created_by, cv.created_at, cv.char_count, cv.word_count,
                 cv.ai_instruction, cv.ai_model, cv.edit_summary, cv.parent_version_id
          FROM canvas_versions cv
          WHERE cv.section_id = ${sectionId}::uuid
            AND cv.version_number = ${versionNumber}
          LIMIT 1
        `;
      } catch (e) {
        console.error('[versions] version query failed:', e);
        return NextResponse.json(
          { error: 'Internal error', code: 'DB_ERROR' },
          { status: 500 },
        );
      }

      if (!version) {
        return NextResponse.json(
          { error: 'Version not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      return NextResponse.json({
        data: {
          version_number: version.versionNumber,
          content: version.content,
          snapshot_reason: version.snapshotReason,
          source: version.source,
          created_by: version.createdBy,
          created_at: version.createdAt,
          char_count: version.charCount,
          word_count: version.wordCount,
          ai_instruction: version.aiInstruction,
          ai_model: version.aiModel,
          edit_summary: version.editSummary,
          parent_version_id: version.parentVersionId,
        },
      });
    }

    // ── Version history list (metadata only, no content) ─────────────
    const limit = Math.min(
      Math.max(parseInt(limitParam ?? '50', 10) || 50, 1),
      200,
    );

    let versions: {
      versionNumber: number;
      snapshotReason: string | null;
      source: string;
      createdBy: string | null;
      createdByEmail: string | null;
      createdAt: Date;
      charCount: number | null;
      wordCount: number | null;
      aiInstruction: string | null;
      editSummary: string | null;
    }[];

    try {
      versions = await sql<typeof versions>`
        SELECT cv.version_number, cv.snapshot_reason, cv.source,
               cv.created_by, u.email AS created_by_email, cv.created_at,
               cv.char_count, cv.word_count, cv.ai_instruction, cv.edit_summary
        FROM canvas_versions cv
        LEFT JOIN users u ON u.id = cv.created_by
        WHERE cv.section_id = ${sectionId}::uuid
        ORDER BY cv.version_number DESC
        LIMIT ${limit}
      `;
    } catch (e) {
      console.error('[versions] version list query failed:', e);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        versions: versions.map((v) => ({
          version_number: v.versionNumber,
          snapshot_reason: v.snapshotReason,
          source: v.source,
          created_by: v.createdBy,
          created_by_email: v.createdByEmail,
          created_at: v.createdAt,
          char_count: v.charCount,
          word_count: v.wordCount,
          ai_instruction: v.aiInstruction,
          edit_summary: v.editSummary,
        })),
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/sections/versions] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

// Extract char/word counts from a section's JSON content string (mirrors the save route).
function extractCounts(content: string | null): { chars: number; words: number } {
  if (!content) return { chars: 0, words: 0 };
  try {
    const parsed = JSON.parse(content);
    const nodes: Array<{ content?: Record<string, unknown> }> = parsed.nodes ?? (Array.isArray(parsed) ? parsed : []);
    const parts: string[] = [];
    for (const node of nodes) {
      if (!node.content) continue;
      const t = (node.content as Record<string, unknown>).text;
      if (typeof t === 'string') parts.push(t);
      const items = (node.content as Record<string, unknown>).items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (typeof item === 'string') parts.push(item);
          else if (item && typeof (item as { text?: unknown }).text === 'string') parts.push((item as { text: string }).text);
        }
      }
    }
    const text = parts.join(' ');
    return { chars: text.length, words: text.split(/\s+/).filter(Boolean).length };
  } catch {
    return { chars: content.length, words: content.split(/\s+/).filter(Boolean).length };
  }
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/versions
 *
 * Restore a prior version's content as the new live content. Body: { versionNumber: N }.
 *
 * The write follows the canvas_versions CAS invariant EXACTLY like the save route: it archives
 * the CURRENT content at the live version (so the restore is itself undoable), then writes the
 * target version's content and ADVANCES proposal_sections.version by one under a compare-and-swap.
 * This keeps proposal_sections.version > MAX(canvas_versions.version_number) and never collides
 * with a later human save. Auth: edit access (tenant_admin, or a collaborator with this section
 * editable). Non-destructive: the pre-restore snapshot means the previous content is recoverable.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, proposalId, sectionId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
      return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { versionNumber?: unknown };
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const versionNumber = typeof body.versionNumber === 'number' && Number.isInteger(body.versionNumber) ? body.versionNumber : NaN;
    if (isNaN(versionNumber) || versionNumber < 1) {
      return NextResponse.json({ error: 'Invalid version number', code: 'VALIDATION_ERROR' }, { status: 400 });
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
    enterTenant(tenantId);

    let proposal: { id: string; stage: string | null } | undefined;
    try { [proposal] = await sql<{ id: string; stage: string | null }[]>`SELECT id, stage FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId} LIMIT 1`; }
    catch (e) { console.error('[versions/restore] proposal query failed:', e); return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 }); }
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Restore is a WRITE — require edit access (admin, or a collaborator with this section editable).
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      let access;
      try { access = await resolveUserAccess(sessionUser.id, proposalId, tenantId); }
      catch (e) { console.error('[versions/restore] access check failed:', e); return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 }); }
      if (!access.editableSections.includes(sectionId)) {
        return NextResponse.json({ error: 'You do not have edit access to this section', code: 'FORBIDDEN' }, { status: 403 });
      }
    }

    let section: { id: string; title: string | null; version: number; content: string | null; isLocked: boolean; contentSource: string | null; completedStage: string | null } | undefined;
    try {
      [section] = await sql<typeof section[]>`
        SELECT id, title, version, content, is_locked AS "isLocked", content_source AS "contentSource", completed_stage AS "completedStage"
        FROM proposal_sections WHERE id = ${sectionId} AND proposal_id = ${proposalId} LIMIT 1`;
    } catch (e) { console.error('[versions/restore] section query failed:', e); return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 }); }
    if (!section) {
      return NextResponse.json({ error: 'Section not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    // Restore is a WRITE — enforce the same immutability contract as PUT …/save: a locked section,
    // or one frozen by a prior stage (completed_stage !== current stage), is read-only. Without the
    // stage check an admin could restore over a stage-frozen section that save itself refuses.
    const lockReason = sectionLockReason(section, proposal.stage);
    if (lockReason) {
      return NextResponse.json(
        { error: lockReason.message, code: lockReason.code, ...(lockReason.code === 'STAGE_LOCKED' ? { completedStage: section.completedStage } : {}) },
        { status: 423 },
      );
    }
    if (versionNumber === section.version) {
      return NextResponse.json({ error: 'That version is already current', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let target: { content: unknown; source: string } | undefined;
    try { [target] = await sql<typeof target[]>`SELECT content, source FROM canvas_versions WHERE section_id = ${sectionId}::uuid AND version_number = ${versionNumber} LIMIT 1`; }
    catch (e) { console.error('[versions/restore] target query failed:', e); return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 }); }
    if (!target) {
      return NextResponse.json({ error: 'Version not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // 1) Archive the CURRENT content at the live version (so restore is undoable), tagged with the
    //    current content's provenance. jsonb: parse then sql.json (CLIFFNOTES §4b jsonb bug-class).
    const currentContent = section.content ?? '{}';
    let archiveJson: Parameters<typeof sql.json>[0];
    try { archiveJson = JSON.parse(currentContent); } catch { archiveJson = currentContent; }
    const counts = extractCounts(section.content);
    try {
      await sql`
        INSERT INTO canvas_versions
          (section_id, version_number, content, snapshot_reason, source, created_by, char_count, word_count)
        VALUES (${sectionId}::uuid, ${section.version}, ${sql.json(archiveJson)}, 'pre_restore',
                ${section.contentSource ?? 'human_edit'}, ${sessionUser.id}::uuid, ${counts.chars}, ${counts.words})
        ON CONFLICT (section_id, version_number) DO NOTHING`;
    } catch (e) { console.error('[versions/restore] archive failed (non-fatal):', e); }

    // 2) Write the target content as the new live content, advancing the counter under a CAS on the
    //    live version. content_source carries the restored version's provenance forward.
    const restoredJson = JSON.stringify(target.content);
    const nextVersion = section.version + 1;
    let updateResult;
    try {
      updateResult = await sql`
        UPDATE proposal_sections
        SET content = ${restoredJson}, version = ${nextVersion}, content_source = ${target.source},
            last_modified_by = ${sessionUser.id}::uuid, editing_by = NULL, editing_since = NULL, updated_at = now()
        WHERE id = ${sectionId} AND version = ${section.version}`;
    } catch (e) { console.error('[versions/restore] update failed:', e); return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 }); }
    if (updateResult.count === 0) {
      let current: { version: number } | undefined;
      try { [current] = await sql<{ version: number }[]>`SELECT version FROM proposal_sections WHERE id = ${sectionId}`; } catch { /* best-effort */ }
      return NextResponse.json({ error: 'Section was modified by another user', code: 'CONFLICT', currentVersion: current?.version ?? null }, { status: 409 });
    }

    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'section.saved',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: { correlationId: randomUUID(), tenantId, tenantSlug, proposalId, sectionId, sectionTitle: section.title, version: nextVersion, restoredFromVersion: versionNumber },
      });
    } catch (evtErr) { console.error('[versions/restore] event emission failed:', evtErr); }

    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role, activity_type, section_id, section_title, entity_version, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid, ${sessionUser.email ?? null}, ${role},
                'section_saved', ${sectionId}::uuid, ${section.title}, ${nextVersion},
                ${sql.json({ restored_from: versionNumber, previous_version: section.version })})`;
    } catch (logErr) { console.error('[versions/restore] activity log failed', logErr); }

    return NextResponse.json({ data: { sectionId, version: nextVersion, restoredFrom: versionNumber } });
  } catch (e) {
    console.error('[api/portal/proposals/sections/versions POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
