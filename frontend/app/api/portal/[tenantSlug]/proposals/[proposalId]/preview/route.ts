/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/preview
 *
 * Returns the WHOLE proposal assembled into one page-framed HTML document — "see it as it
 * will download." Same assembly the .docx package uses (numbered H1 per section, content
 * flows continuously), rendered via the shared renderCanvasPreviewHtml so it matches the
 * PDF/print layout. Read-only; no mutation.
 *
 * Access: floored at tenant_user (internal team + admin) — identical to the package/download
 * route. External collaborators (partner_user) preview only the sections they're granted, via
 * the client-side section preview; they cannot pull the whole assembled proposal here.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { resolveUserAccess, hasProposalVisibility } from '@/lib/proposal-access';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { coerceJsonb } from '@/lib/jsonb';
import { renderCanvasPreviewHtml } from '@/lib/export/canvas-html';
import {
  CANVAS_PRESETS,
  coalesceGroups,
  sectionsToNodes,
  type CanvasDocument,
  type CanvasNode,
  type CanvasSection,
  type CanvasRules,
} from '@/lib/types/canvas-document';

export const dynamic = 'force-dynamic';

interface RouteContext { params: Promise<{ tenantSlug: string; proposalId: string }> }

/** Parse a section's TEXT content column into nodes (+ its canvas rules, if any). */
function parseSectionContent(content: string | null): { nodes: CanvasNode[]; canvas: CanvasRules | null } {
  const parsed = coerceJsonb<{ sections?: CanvasSection[]; nodes?: CanvasNode[]; canvas?: CanvasRules } | CanvasNode[] | null>(content, null);
  if (!parsed) return { nodes: [], canvas: null };
  if (Array.isArray(parsed)) return { nodes: parsed, canvas: null };
  if (Array.isArray(parsed.sections) && parsed.sections.length) {
    return { nodes: sectionsToNodes(parsed.sections), canvas: parsed.canvas ?? null };
  }
  if (Array.isArray(parsed.nodes)) return { nodes: parsed.nodes, canvas: parsed.canvas ?? null };
  return { nodes: [], canvas: null };
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    // Full-document assembly is a tenant-member action (matches the package/download floor).
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug).catch(() => null);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    const [proposal] = await sql<{ title: string; createdAt: string }[]>`
      SELECT title, created_at AS "createdAt" FROM proposals
      WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // CAP-3: verifyTenantAccess ignores membership.scope, so a proposal-scoped tenant_user could pull
    // this proposal's whole assembled body as HTML. Gate on the scope-aware resolveUserAccess.
    if (!hasProposalVisibility(await resolveUserAccess(sessionUser.id, proposalId, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const sections = await sql<{ sectionNumber: string; title: string; content: string | null }[]>`
      SELECT section_number AS "sectionNumber", title, content
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid
      ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number ASC
    `;

    // Assemble one continuous document. Each section is prefaced by a clean numbered H1 —
    // "N. Title" (no number for an unnumbered section like the Abstract) — UNLESS the section's
    // own content already leads with a heading (then we don't double it). Order is by the
    // integer sort_index so sections never string-sort 1,10,2.
    const parsedSections = sections.map((s) => ({ ...s, ...parseSectionContent(s.content) }));
    const firstCanvas = parsedSections.find((s) => s.canvas)?.canvas ?? CANVAS_PRESETS.letter_standard;
    const now = new Date().toISOString();
    const docSections: CanvasSection[] = parsedSections.map((section) => {
      const num = (section.sectionNumber ?? '').trim();
      const alreadyTitled = section.nodes[0]?.type === 'heading';
      const headingNode: CanvasNode = {
        id: crypto.randomUUID(),
        type: 'heading',
        content: { level: 1 as const, text: num ? `${num}. ${section.title}` : section.title },
        style: {},
        provenance: { source: 'manual', drafted_at: now },
        history: [],
        library_eligible: false,
      };
      return {
        id: crypto.randomUUID(),
        title: section.title,
        layout: { mode: 'flow' as const },
        groups: coalesceGroups(alreadyTitled ? section.nodes : [headingNode, ...section.nodes]),
      };
    });

    const combinedDoc: CanvasDocument = {
      version: 2,
      document_id: crypto.randomUUID(),
      canvas: firstCanvas,
      nodes: [],
      sections: docSections,
      metadata: {
        title: proposal.title, volume_id: '', required_item_id: '', proposal_id: proposalId,
        solicitation_id: '', created_at: proposal.createdAt, last_modified_at: now,
        last_modified_by: sessionUser.id, version_number: 1, status: 'accepted',
      },
    };

    const vars: Record<string, string> = {
      company_name: (tenant as { name?: string }).name ?? 'Your Company',
      topic_number: proposal.title ?? 'TBD',
    };

    const html = renderCanvasPreviewHtml(combinedDoc, vars);
    return NextResponse.json({ data: { html, sectionCount: docSections.length } });
  } catch (e) {
    console.error('[api/portal/proposals/preview] failed:', e);
    return NextResponse.json({ error: 'Preview failed', code: 'PREVIEW_ERROR' }, { status: 500 });
  }
}
