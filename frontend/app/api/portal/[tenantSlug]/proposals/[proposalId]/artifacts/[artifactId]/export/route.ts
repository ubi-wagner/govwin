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
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import { resolveArtifactFormat, assembleArtifactCanvas, renderCanvas, CONTENT_TYPE } from '@/lib/export/artifact-export';
import { validateCanvasAgainstSpec, type ComplianceSpec } from '@/lib/types/canvas-document';

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
    let artifact: { id: string; artifactType: string | null; volumeName: string | null; isLocked: boolean; complianceSpec: ComplianceSpec | null } | undefined;
    let sections: { id: string; title: string | null; content: string | null; pageAllocation: number | null }[] = [];
    try {
      [artifact] = await sql<{ id: string; artifactType: string | null; volumeName: string | null; isLocked: boolean; complianceSpec: ComplianceSpec | null }[]>`
        SELECT id, artifact_type, volume_name, is_locked, compliance_spec FROM proposal_artifacts
        WHERE id = ${artifactId}::uuid AND proposal_id = ${proposalId}::uuid LIMIT 1
      `;
      if (artifact) {
        sections = await sql<{ id: string; title: string | null; content: string | null; pageAllocation: number | null }[]>`
          SELECT id, title, content, page_allocation AS "pageAllocation" FROM proposal_sections
          WHERE proposal_id = ${proposalId}::uuid AND artifact_id = ${artifactId}::uuid
          ORDER BY volume_number ASC NULLS LAST, sort_index ASC NULLS LAST, section_number ASC
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

    // ── Section-level scope (mirrors the per-section export route) ──────
    //    verifyProposalAccess is the COARSE gate — tenant-wide-true for any
    //    accepted collaborator (incl. a stage-scoped partner_user). A whole-volume
    //    export assembles EVERY section, so a collaborator scoped to a subset must
    //    NOT pull the rest. Tenant-wide members (tenant_admin+/tenant_user) get all
    //    sections from resolveUserAccess; a scoped collaborator only their grant.
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      const access = await resolveUserAccess(su.id, proposalId, tenantId);
      const granted = new Set<string>([
        ...access.viewableSections,
        ...access.commentableSections,
        ...access.editableSections,
      ]);
      if (!sections.every((s) => granted.has(s.id))) {
        return NextResponse.json(
          { error: 'You do not have access to all sections of this artifact', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
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

    // Deterministic compliance floor (E4): record whether the exported artifact
    // satisfies the ComplianceSpec frozen at purchase. Advisory — surfaced via the
    // audit event + a response header, never a hard block (the page count is an
    // estimate, so blocking a locked download on a heuristic would false-positive).
    const violations = artifact.complianceSpec
      ? validateCanvasAgainstSpec(assembled, artifact.complianceSpec)
      : [];
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
        payload: {
          proposalId, artifactId, format, title,
          compliant: violations.length === 0,
          complianceViolations: violations.map((v) => v.code),
        },
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
        'X-Compliance-Violations': String(violations.length),
      },
    });
  } catch (err) {
    console.error('[artifacts/export] error:', err);
    return NextResponse.json({ error: 'Export failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
