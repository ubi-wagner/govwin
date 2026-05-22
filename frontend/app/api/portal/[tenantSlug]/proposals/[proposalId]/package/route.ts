/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/package
 *
 * Generate complete proposal package as ZIP. Exports each section's canvas
 * document to the appropriate format (DOCX, PPTX, XLSX) and bundles them
 * into a single downloadable ZIP file.
 *
 * Auth: tenant_user or above with tenant access. Proposal must be locked.
 *
 * V1 TODO (P2-15): Implement full proposal package export.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
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
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── 1. Verify proposal belongs to tenant ────────────────────
    let proposal: {
      id: string;
      title: string;
      stage: string;
      gateConfig: unknown;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        title: string;
        stage: string;
        gateConfig: unknown;
      }[]>`
        SELECT id, title, stage, gate_config
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/package] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── 2. Fetch all sections ordered by section_number ──────
    let sections: {
      id: string;
      sectionNumber: string;
      title: string;
      content: string | null;
      status: string;
      pageAllocation: number | null;
    }[];
    try {
      sections = await sql<{
        id: string;
        sectionNumber: string;
        title: string;
        content: string | null;
        status: string;
        pageAllocation: number | null;
      }[]>`
        SELECT id, section_number, title, content, status, page_allocation
        FROM proposal_sections
        WHERE proposal_id = ${proposalId}::uuid
        ORDER BY section_number ASC
      `;
    } catch (e) {
      console.error('[portal/proposals/package] sections query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── 3. Fetch compliance data via solicitation_id ─────────
    let complianceRows: {
      id: string;
      pageLimitTechnical: number | null;
      pageLimitCost: number | null;
      fontFamily: string | null;
      fontSize: string | null;
      margins: string | null;
      lineSpacing: string | null;
      headerRequired: boolean;
      headerFormat: string | null;
      footerRequired: boolean;
      footerFormat: string | null;
      submissionFormat: string | null;
      requiredSections: unknown;
      requiredDocuments: unknown;
      evaluationCriteria: unknown;
      customVariables: unknown;
      verifiedBy: string | null;
      verifiedAt: string | null;
    }[];
    try {
      complianceRows = await sql<typeof complianceRows>`
        SELECT id, page_limit_technical, page_limit_cost,
               font_family, font_size, margins, line_spacing,
               header_required, header_format, footer_required, footer_format,
               submission_format, required_sections, required_documents,
               evaluation_criteria, custom_variables, verified_by, verified_at
        FROM solicitation_compliance
        WHERE solicitation_id = (
          SELECT solicitation_id FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
        )
      `;
    } catch (e) {
      console.error('[portal/proposals/package] compliance query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── 4. Extract readable text from each section's JSON content
    const sectionData = sections.map((s) => {
      let textContent = '';
      if (s.content) {
        try {
          const parsed = JSON.parse(s.content);
          const nodes = parsed.nodes || parsed;
          if (Array.isArray(nodes)) {
            const textParts: string[] = [];
            for (const node of nodes) {
              if (!node.content) continue;
              switch (node.type) {
                case 'heading':
                  textParts.push(node.content.text || '');
                  break;
                case 'text_block':
                  textParts.push(node.content.text || '');
                  break;
                case 'bulleted_list':
                case 'numbered_list':
                  if (Array.isArray(node.content.items)) {
                    for (const item of node.content.items) {
                      textParts.push(item.text || '');
                    }
                  }
                  break;
                case 'table':
                  if (Array.isArray(node.content.rows)) {
                    for (const row of node.content.rows) {
                      if (Array.isArray(row.cells)) {
                        for (const cell of row.cells) {
                          textParts.push(cell.text || cell.content || '');
                        }
                      }
                    }
                  }
                  break;
                case 'caption':
                case 'footnote':
                  textParts.push(node.content.text || '');
                  break;
                case 'url':
                  textParts.push(node.content.display_text || node.content.url || '');
                  break;
                case 'page_break':
                case 'spacer':
                case 'image':
                case 'toc':
                  break;
                default:
                  if (typeof node.content === 'string') {
                    textParts.push(node.content);
                  } else if (node.content.text) {
                    textParts.push(node.content.text);
                  }
              }
            }
            textContent = textParts.filter(Boolean).join('\n\n');
          }
        } catch {
          // Content is plain text, not JSON
          textContent = s.content;
        }
      }
      return {
        number: s.sectionNumber,
        title: s.title,
        text_content: textContent,
        status: s.status,
        page_allocation: s.pageAllocation,
      };
    });

    // ── 5. Build compliance summary ──────────────────────────
    const complianceData = complianceRows[0] ?? null;
    const complianceVariables = complianceData
      ? {
          page_limit_technical: complianceData.pageLimitTechnical,
          page_limit_cost: complianceData.pageLimitCost,
          font_family: complianceData.fontFamily,
          font_size: complianceData.fontSize,
          margins: complianceData.margins,
          line_spacing: complianceData.lineSpacing,
          header_required: complianceData.headerRequired,
          header_format: complianceData.headerFormat,
          footer_required: complianceData.footerRequired,
          footer_format: complianceData.footerFormat,
          submission_format: complianceData.submissionFormat,
          required_sections: complianceData.requiredSections,
          required_documents: complianceData.requiredDocuments,
          evaluation_criteria: complianceData.evaluationCriteria,
          custom_variables: complianceData.customVariables,
          verified_by: complianceData.verifiedBy,
          verified_at: complianceData.verifiedAt,
        }
      : null;

    const verifiedCount = complianceData?.verifiedAt ? 1 : 0;

    // ── 6. Increment download_count ──────────────────────────
    try {
      await sql`
        UPDATE proposals
        SET download_count = COALESCE(download_count, 0) + 1
        WHERE id = ${proposalId}
      `;
    } catch (e) {
      console.error('[portal/proposals/package] download_count update failed:', e);
    }

    // ── 7. Emit event ────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'package.exported',
      actor: userActor(sessionUser.id, (session.user as { email?: string }).email),
      tenantId,
      payload: {
        correlationId: crypto.randomUUID(),
        proposalId,
        sectionCount: sectionData.length,
      },
    });

    // ── Activity log ────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'proposal_exported',
                ${JSON.stringify({ section_count: sectionData.length })}::jsonb)
      `;
    } catch (logErr) {
      console.error('[portal/proposals/package] activity log failed', logErr);
    }

    // ── 8. Build total chars for manifest ────────────────────
    const totalChars = sectionData.reduce((sum, s) => sum + s.text_content.length, 0);

    return NextResponse.json({
      data: {
        proposal: {
          title: proposal.title,
          stage: proposal.stage,
          gate_config: proposal.gateConfig,
        },
        sections: sectionData,
        compliance: {
          variables: complianceVariables,
          summary: {
            total: complianceRows.length,
            verified: verifiedCount,
            unverified: complianceRows.length - verifiedCount,
          },
        },
        manifest: {
          generated_at: new Date().toISOString(),
          section_count: sectionData.length,
          total_chars: totalChars,
        },
      },
    });
  } catch (err) {
    console.error('[portal/proposals/package] error:', err);
    return NextResponse.json(
      { error: 'Package export failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
