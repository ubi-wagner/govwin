/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/artifacts/[artifactId]/export?format=<auto|docx|pptx|xlsx|pdf>
 *
 * Server-authoritative per-artifact export. Assembles the artifact's ordered
 * section canvases from the DB and renders the artifact's NATIVE format
 * (narrative→docx, slides→pptx, cost→xlsx) or an explicit override (incl. pdf).
 * Returns the file as a binary attachment.
 *
 * Auth: proposal access (tenant member or accepted collaborator). Download gate:
 * the proposal must have been locked at least once (or be submitted/archived) —
 * consistent with the section export route. PDF needs Chromium (infra dep); a
 * 503 with a clear message is returned when it is unavailable.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import { resolveArtifactFormat, assembleArtifactCanvas, renderCanvas, CONTENT_TYPE } from '@/lib/export/artifact-export';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; artifactId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId, artifactId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(artifactId)) {
      return NextResponse.json({ error: 'Invalid id format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyProposalAccess(su.id, role, su.tenantId, tenantId, proposalId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    enterTenant(tenantId);

    // ── Proposal + download gate ───────────────────────────────────────
    let proposal: { id: string; lockCount: number; stage: string } | undefined;
    try {
      [proposal] = await sql<{ id: string; lockCount: number; stage: string }[]>`
        SELECT id, lock_count, stage FROM proposals
        WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
      `;
    } catch (e) {
      console.error('[artifacts/export] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Artifact + its sections ────────────────────────────────────────
    let artifact: { id: string; artifactType: string | null; volumeName: string | null; isLocked: boolean } | undefined;
    let sections: { title: string | null; content: string | null }[] = [];
    try {
      [artifact] = await sql<{ id: string; artifactType: string | null; volumeName: string | null; isLocked: boolean }[]>`
        SELECT id, artifact_type, volume_name, is_locked FROM proposal_artifacts
        WHERE id = ${artifactId}::uuid AND proposal_id = ${proposalId}::uuid LIMIT 1
      `;
      if (artifact) {
        sections = await sql<{ title: string | null; content: string | null }[]>`
          SELECT title, content FROM proposal_sections
          WHERE proposal_id = ${proposalId}::uuid AND artifact_id = ${artifactId}::uuid
          ORDER BY section_number
        `;
      }
    } catch (e) {
      console.error('[artifacts/export] artifact query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!artifact) {
      return NextResponse.json({ error: 'Artifact not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (sections.length === 0) {
      return NextResponse.json({ error: 'Artifact has no sections to export', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Download gate: the artifact is locked, OR the proposal has advanced a
    //    stage (lock_count ≥ 1) / is submitted / archived. Prevents downloading
    //    half-drafted artifacts while allowing a finished (locked) one. ────────
    if (!artifact.isLocked && proposal.lockCount < 1 && proposal.stage !== 'submitted' && proposal.stage !== 'archived') {
      return NextResponse.json({ error: 'Download available once this artifact (or the proposal) is locked', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Assemble + resolve format + render ─────────────────────────────
    const title = artifact.volumeName || 'artifact';
    const assembled = assembleArtifactCanvas(sections, artifact.artifactType, title);
    const requested = new URL(request.url).searchParams.get('format');
    const format = resolveArtifactFormat(artifact.artifactType, assembled.canvas?.format, requested);
    const vars: Record<string, string> = {
      company_name: (tenant as { name?: string }).name ?? 'Your Company',
      topic_number: title,
    };

    let buffer: Buffer;
    try {
      buffer = await renderCanvas(format, assembled, vars);
    } catch (e) {
      if (format === 'pdf') {
        console.error('[artifacts/export] PDF render failed (Chromium unavailable?):', e);
        return NextResponse.json(
          { error: 'PDF export requires Chromium and is unavailable here. Use docx, pptx, or xlsx.', code: 'PDF_UNAVAILABLE' },
          { status: 503 },
        );
      }
      console.error('[artifacts/export] render failed:', e);
      return NextResponse.json({ error: 'Export failed', code: 'EXPORT_ERROR' }, { status: 500 });
    }

    try {
      await sql`UPDATE proposals SET download_count = download_count + 1 WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid`;
    } catch (e) {
      console.error('[artifacts/export] download_count increment failed (non-fatal):', e);
    }
    try {
      await emitEventSingle({
        namespace: 'proposal', type: 'artifact.exported',
        actor: userActor(su.id, su.email ?? undefined), tenantId,
        payload: { proposalId, artifactId, format, title },
      });
    } catch (e) {
      console.error('[artifacts/export] event emission failed (non-fatal):', e);
    }

    const safe = title.replace(/[^a-z0-9._-]+/gi, '_');
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPE[format],
        'Content-Disposition': `attachment; filename="${safe}.${format}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[artifacts/export] error:', err);
    return NextResponse.json({ error: 'Export failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
