/**
 * POST /api/portal/[tenantSlug]/templates/extract
 *
 * Template extraction (docs/CANVAS_GEOMETRY_REDESIGN.md §5d) — when an admin
 * declares an ingested/built proposal "a sound template," extract its SKELETON
 * (frame + section skeleton + muscle slots, content stripped) into a reusable
 * tenant `document_templates` row.
 *
 * Source is EITHER a built proposal volume (`artifactId` → assembled v2 flow
 * canvas) OR a client-supplied `canvas` (e.g. a parsed upload). Body also carries
 * the admin's declaration: name, templateType, agency/program, per-section budgets.
 *
 * Auth: tenant_admin or above (rfp_admin/master_admin via shadow) with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { assembleArtifactCanvas } from '@/lib/export/artifact-export';
import { extractTemplateSkeleton } from '@/lib/templates/extract-skeleton';
import { sectionsToNodes, type CanvasDocument } from '@/lib/types/canvas-document';

const TEMPLATE_TYPES = new Set([
  'technical_volume', 'cost_volume', 'slide_deck', 'past_performance', 'key_personnel',
  'commercialization', 'abstract', 'cover_sheet', 'supporting_docs', 'custom',
]);

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── Auth ───────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Only an admin can save a template', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Body / declaration ─────────────────────────────────────────────
    let body: {
      artifactId?: unknown; proposalId?: unknown; canvas?: unknown;
      name?: unknown; templateType?: unknown; agency?: unknown; program?: unknown;
      description?: unknown; sectionBudgets?: unknown;
    };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'A template name is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    const templateType = typeof body.templateType === 'string' && TEMPLATE_TYPES.has(body.templateType) ? body.templateType : 'custom';
    const sectionBudgets = (body.sectionBudgets && typeof body.sectionBudgets === 'object')
      ? (body.sectionBudgets as Record<number, number>) : undefined;

    // ── Resolve the source canvas ──────────────────────────────────────
    let sourceCanvas: CanvasDocument | null = null;
    if (typeof body.artifactId === 'string') {
      if (!isValidUUID(body.artifactId) || (typeof body.proposalId === 'string' && !isValidUUID(body.proposalId))) {
        return NextResponse.json({ error: 'Invalid artifact/proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      try {
        // The artifact must belong to a proposal in THIS tenant (never trust an id alone).
        const [artifact] = await sql<{ artifactType: string | null; volumeName: string | null }[]>`
          SELECT a.artifact_type AS "artifactType", a.volume_name AS "volumeName"
          FROM proposal_artifacts a JOIN proposals p ON p.id = a.proposal_id
          WHERE a.id = ${body.artifactId}::uuid AND p.tenant_id = ${tenantId}::uuid LIMIT 1`;
        if (!artifact) return NextResponse.json({ error: 'Artifact not found', code: 'NOT_FOUND' }, { status: 404 });
        const sections = await sql<{ title: string | null; content: string | null }[]>`
          SELECT title, content FROM proposal_sections
          WHERE artifact_id = ${body.artifactId}::uuid ORDER BY section_number`;
        sourceCanvas = assembleArtifactCanvas(sections, artifact.artifactType, artifact.volumeName || name);
      } catch (e) {
        console.error('[templates/extract] artifact assemble failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    } else if (body.canvas && typeof body.canvas === 'object') {
      const c = body.canvas as Partial<CanvasDocument>;
      if (!c.canvas || (!Array.isArray(c.nodes) && !Array.isArray(c.sections))) {
        return NextResponse.json({ error: 'canvas must be a CanvasDocument (canvas + nodes/sections)', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      sourceCanvas = c as CanvasDocument;
    } else {
      return NextResponse.json({ error: 'Provide an artifactId or a canvas to extract from', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Extract skeleton + persist ─────────────────────────────────────
    const { skeleton, sections: slots } = extractTemplateSkeleton(sourceCanvas, sectionBudgets ? { sectionBudgets } : {});
    const nodeCount = sectionsToNodes(skeleton.sections ?? []).length;

    let created: { id: string } | undefined;
    try {
      [created] = await sql<{ id: string }[]>`
        INSERT INTO document_templates
          (name, description, template_type, agency, program_type,
           canvas_preset, canvas_document, node_count, is_system, tenant_id, created_by, metadata)
        VALUES (
          ${name},
          ${typeof body.description === 'string' ? body.description : `Extracted skeleton — ${slots.length} sections`},
          ${templateType},
          ${typeof body.agency === 'string' ? body.agency : null},
          ${typeof body.program === 'string' ? body.program : null},
          ${sql.json(skeleton.canvas as unknown as Parameters<typeof sql.json>[0])},
          ${sql.json(skeleton as unknown as Parameters<typeof sql.json>[0])},
          ${nodeCount},
          false,
          ${tenantId}::uuid,
          ${su.id}::uuid,
          ${sql.json({ extracted: true, sections: slots } as unknown as Parameters<typeof sql.json>[0])}
        )
        RETURNING id`;
    } catch (e) {
      console.error('[templates/extract] insert failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'template.extracted',
        actor: userActor(su.id, su.email ?? undefined),
        tenantId,
        payload: { templateId: created!.id, name, templateType, sections: slots.length },
      });
    } catch (e) { console.error('[templates/extract] event emit failed (non-fatal):', e); }

    return NextResponse.json({ data: { templateId: created!.id, sections: slots } }, { status: 201 });
  } catch (e) {
    console.error('[templates/extract] unexpected error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
