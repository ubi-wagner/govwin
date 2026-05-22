import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';

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
