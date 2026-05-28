/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/package
 *
 * Generate complete proposal package. Supports two output formats:
 *   ?format=json  — (default) structured JSON with text, compliance, docs
 *   ?format=docx  — Word document download (.docx) with all sections
 *
 * Auth: tenant_user or above with tenant access. Proposal must be locked.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import { getSignedGetUrl } from '@/lib/storage/s3-client';
import { exportToDocx } from '@/lib/export/docx-exporter';
import {
  CANVAS_PRESETS,
  type CanvasDocument,
  type CanvasNode,
  type HeadingContent,
  type TextBlockContent,
  type ListContent,
  type TableContent,
  type CaptionContent,
  type FootnoteContent,
  type UrlContent,
} from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * Parse a section's content column into a list of CanvasNodes.
 * The column may contain a full CanvasDocument JSON, just a nodes array,
 * or plain text. Returns the nodes array and canvas rules if present.
 */
function parseSectionContent(raw: string | null): {
  nodes: CanvasNode[];
  canvas: CanvasDocument['canvas'] | null;
} {
  if (!raw) return { nodes: [], canvas: null };
  try {
    const parsed = JSON.parse(raw);
    // Full CanvasDocument shape
    if (parsed.version === 1 && Array.isArray(parsed.nodes) && parsed.canvas) {
      return { nodes: parsed.nodes, canvas: parsed.canvas };
    }
    // Object with a nodes array
    if (parsed.nodes && Array.isArray(parsed.nodes)) {
      return { nodes: parsed.nodes, canvas: null };
    }
    // Bare array of nodes
    if (Array.isArray(parsed)) {
      return { nodes: parsed, canvas: null };
    }
    return { nodes: [], canvas: null };
  } catch {
    return { nodes: [], canvas: null };
  }
}

/**
 * Extract plain text from a list of CanvasNodes (for JSON export and char count).
 */
function extractTextFromNodes(nodes: CanvasNode[]): string {
  const textParts: string[] = [];
  for (const node of nodes) {
    if (!node.content) continue;
    switch (node.type) {
      case 'heading':
        textParts.push((node.content as HeadingContent).text || '');
        break;
      case 'text_block':
        textParts.push((node.content as TextBlockContent).text || '');
        break;
      case 'bulleted_list':
      case 'numbered_list': {
        const listContent = node.content as ListContent;
        if (Array.isArray(listContent.items)) {
          for (const item of listContent.items) {
            textParts.push(item.text || '');
          }
        }
        break;
      }
      case 'table': {
        const tableContent = node.content as TableContent;
        if (Array.isArray(tableContent.rows)) {
          for (const row of tableContent.rows) {
            if (Array.isArray(row)) {
              for (const cell of row) {
                if (typeof cell === 'string') textParts.push(cell);
                else if (cell?.text) textParts.push(cell.text);
              }
            }
          }
        }
        break;
      }
      case 'caption':
      case 'footnote':
        textParts.push(
          (node.content as CaptionContent | FootnoteContent).text || '',
        );
        break;
      case 'url':
        textParts.push(
          (node.content as UrlContent).display_text ||
            (node.content as UrlContent).href ||
            '',
        );
        break;
      case 'page_break':
      case 'spacer':
      case 'image':
      case 'toc':
        break;
      default:
        if (typeof node.content === 'string') {
          textParts.push(node.content);
        } else if ((node.content as TextBlockContent).text) {
          textParts.push((node.content as TextBlockContent).text);
        }
    }
  }
  return textParts.filter(Boolean).join('\n\n');
}

/**
 * Package Export — supports JSON and DOCX formats.
 *
 * JSON response shape (format=json, default):
 * {
 *   data: {
 *     proposal: { title, stage, gateConfig, createdAt },
 *     sections: [{ number, title, textContent, status, pageAllocation, completedStage }],
 *     compliance: { variables: [...], summary: { total, verified } } | null,
 *     supportingDocs: [{ label, category, filename, downloadUrl, status }],
 *     manifest: { generatedAt, sectionCount, totalChars, supportingDocCount }
 *   }
 * }
 *
 * DOCX response (format=docx):
 * Binary .docx file with Content-Disposition attachment header.
 *
 * Increments proposals.download_count.
 * Emits proposal:package.export_started (start) and proposal:package.exported (end) events.
 * Logs proposal_exported activity.
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { tenantSlug, proposalId } = await ctx.params;

  // ── Parse format from query string ──────────────────────────────
  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'json';
  if (format !== 'json' && format !== 'docx') {
    return NextResponse.json(
      {
        error: 'Invalid format. Supported: json, docx',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  if (!isValidUUID(proposalId)) {
    return NextResponse.json(
      { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

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

  // ── Emit start event ────────────────────────────────────────────
  const actor = userActor(
    sessionUser.id,
    (session.user as { email?: string }).email,
  );
  const startEventId = await emitEventStart({
    namespace: 'proposal',
    type: 'package.export_started',
    actor,
    tenantId,
    payload: { proposalId, format, userId: sessionUser.id },
  });

  try {
    // ── 1. Verify proposal belongs to tenant ────────────────────
    let proposal:
      | {
          id: string;
          title: string;
          stage: string;
          isLocked: boolean;
          gateConfig: unknown;
          createdAt: string;
        }
      | undefined;
    try {
      [proposal] = await sql<
        {
          id: string;
          title: string;
          stage: string;
          isLocked: boolean;
          gateConfig: unknown;
          createdAt: string;
        }[]
      >`
        SELECT id, title, stage, is_locked, gate_config, created_at
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/package] proposal query failed:', e);
      await emitEventEnd(startEventId, {
        error: { message: 'Proposal query failed', code: 'DB_ERROR' },
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (!proposal) {
      await emitEventEnd(startEventId, {
        error: { message: 'Proposal not found', code: 'NOT_FOUND' },
      });
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Lock check: reject if not locked and not in submitted/archived stage ──
    if (
      !proposal.isLocked &&
      proposal.stage !== 'submitted' &&
      proposal.stage !== 'archived'
    ) {
      await emitEventEnd(startEventId, {
        error: {
          message: 'Proposal not locked or in exportable stage',
          code: 'FORBIDDEN',
        },
      });
      return NextResponse.json(
        {
          error:
            'Proposal must be locked or in submitted/archived stage to export package',
          code: 'FORBIDDEN',
        },
        { status: 403 },
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
      completedStage: string | null;
    }[];
    try {
      sections = await sql<
        {
          id: string;
          sectionNumber: string;
          title: string;
          content: string | null;
          status: string;
          pageAllocation: number | null;
          completedStage: string | null;
        }[]
      >`
        SELECT id, section_number, title, content, status, page_allocation, completed_stage
        FROM proposal_sections
        WHERE proposal_id = ${proposalId}::uuid
        ORDER BY section_number ASC
      `;
    } catch (e) {
      console.error('[portal/proposals/package] sections query failed:', e);
      await emitEventEnd(startEventId, {
        error: { message: 'Sections query failed', code: 'DB_ERROR' },
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    // ── 3. Parse section content ─────────────────────────────────
    const parsedSections = sections.map((s) => {
      const { nodes, canvas } = parseSectionContent(s.content);
      const textContent = extractTextFromNodes(nodes);
      return {
        id: s.id,
        sectionNumber: s.sectionNumber,
        title: s.title,
        nodes,
        canvas,
        textContent,
        status: s.status,
        pageAllocation: s.pageAllocation,
        completedStage: s.completedStage,
      };
    });

    // ── DOCX export path ─────────────────────────────────────────
    if (format === 'docx') {
      // Combine all section nodes into one CanvasDocument.
      // Use the first section's canvas rules, or fall back to standard preset.
      const firstCanvas =
        parsedSections.find((s) => s.canvas)?.canvas ??
        CANVAS_PRESETS.letter_standard;

      const allNodes: CanvasNode[] = [];
      for (const section of parsedSections) {
        // Add a heading node for each section
        allNodes.push({
          id: crypto.randomUUID(),
          type: 'heading',
          content: {
            level: 1 as const,
            text: `${section.sectionNumber}. ${section.title}`,
          },
          style: {},
          provenance: {
            source: 'manual',
            drafted_at: new Date().toISOString(),
          },
          history: [],
          library_eligible: false,
        });
        // Append the section's canvas nodes
        allNodes.push(...section.nodes);
        // Add a page break between sections (except after the last)
        if (section !== parsedSections[parsedSections.length - 1]) {
          allNodes.push({
            id: crypto.randomUUID(),
            type: 'page_break',
            content: null,
            style: {},
            provenance: {
              source: 'manual',
              drafted_at: new Date().toISOString(),
            },
            history: [],
            library_eligible: false,
          });
        }
      }

      const combinedDoc: CanvasDocument = {
        version: 1,
        document_id: crypto.randomUUID(),
        canvas: firstCanvas,
        nodes: allNodes,
        metadata: {
          title: proposal.title,
          volume_id: '',
          required_item_id: '',
          proposal_id: proposalId,
          solicitation_id: '',
          created_at: proposal.createdAt,
          last_modified_at: new Date().toISOString(),
          last_modified_by: sessionUser.id,
          version_number: 1,
          status: 'accepted',
        },
      };

      const vars: Record<string, string> = {
        company_name:
          (tenant as { name?: string }).name ?? 'Your Company',
        topic_number: proposal.title ?? 'TBD',
      };

      let buffer: Buffer;
      try {
        buffer = await exportToDocx(combinedDoc, vars);
      } catch (e) {
        console.error('[portal/proposals/package] DOCX generation failed:', e);
        await emitEventEnd(startEventId, {
          error: { message: 'DOCX generation failed', code: 'EXPORT_ERROR' },
        });
        return NextResponse.json(
          { error: 'DOCX generation failed', code: 'EXPORT_ERROR' },
          { status: 500 },
        );
      }

      // ── Increment download_count ──────────────────────────────
      try {
        await sql`
          UPDATE proposals
          SET download_count = COALESCE(download_count, 0) + 1
          WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
        `;
      } catch (e) {
        console.error(
          '[portal/proposals/package] download_count update failed:',
          e,
        );
      }

      // ── Activity log ──────────────────────────────────────────
      try {
        await sql`
          INSERT INTO proposal_activity_log
            (proposal_id, tenant_id, actor_id, actor_email, actor_role,
             activity_type, details)
          VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                  ${sessionUser.email ?? null}, ${role},
                  'proposal_exported',
                  ${JSON.stringify({ section_count: parsedSections.length, format: 'docx' })}::jsonb)
        `;
      } catch (logErr) {
        console.error('[portal/proposals/package] activity log failed', logErr);
      }

      const totalChars = parsedSections.reduce(
        (sum, s) => sum + s.textContent.length,
        0,
      );

      // ── Emit end event ──────────────────────────────────────────
      await emitEventEnd(startEventId, {
        result: {
          proposalId,
          format: 'docx',
          sectionCount: parsedSections.length,
          charCount: totalChars,
        },
      });

      const safeFilename = proposal.title.replace(/[^a-zA-Z0-9-_ ]/g, '');
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safeFilename}.docx"`,
          'Content-Length': String(buffer.length),
        },
      });
    }

    // ── JSON export path (default) ───────────────────────────────

    // ── 4. Fetch compliance data via solicitation_id ─────────
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
      await emitEventEnd(startEventId, {
        error: { message: 'Compliance query failed', code: 'DB_ERROR' },
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    // ── 5. Build section data for JSON response ──────────────────
    const sectionData = parsedSections.map((s) => ({
      number: s.sectionNumber,
      title: s.title,
      text_content: s.textContent,
      status: s.status,
      page_allocation: s.pageAllocation,
      completed_stage: s.completedStage,
    }));

    // ── 6. Build compliance summary ──────────────────────────
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

    // ── 7. Fetch supporting docs with signed URLs ────────────
    let supportingDocsData: {
      id: string;
      requirementLabel: string;
      category: string;
      isRequired: boolean;
      status: string;
      storageKey: string | null;
      originalFilename: string | null;
      fileSize: number | null;
      contentType: string | null;
    }[] = [];
    try {
      supportingDocsData = await sql<typeof supportingDocsData>`
        SELECT id, requirement_label, category, is_required, status,
               storage_key, original_filename, file_size, content_type
        FROM proposal_supporting_docs
        WHERE proposal_id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
        AND storage_key IS NOT NULL
        ORDER BY category, requirement_label
      `;
    } catch (e) {
      console.error(
        '[portal/proposals/package] supporting docs query failed (non-fatal):',
        e,
      );
    }

    // Generate signed URLs for each uploaded doc
    const supportingDocsWithUrls = await Promise.all(
      supportingDocsData.map(async (doc) => ({
        id: doc.id,
        requirementLabel: doc.requirementLabel,
        category: doc.category,
        isRequired: doc.isRequired,
        status: doc.status,
        originalFilename: doc.originalFilename,
        fileSize: doc.fileSize,
        contentType: doc.contentType,
        downloadUrl: doc.storageKey
          ? await getSignedGetUrl(doc.storageKey).catch(() => null)
          : null,
      })),
    );

    // ── 8. Increment download_count ──────────────────────────
    try {
      await sql`
        UPDATE proposals
        SET download_count = COALESCE(download_count, 0) + 1
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
      `;
    } catch (e) {
      console.error(
        '[portal/proposals/package] download_count update failed:',
        e,
      );
    }

    // ── 9. Activity log ───────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'proposal_exported',
                ${JSON.stringify({ section_count: sectionData.length, format: 'json' })}::jsonb)
      `;
    } catch (logErr) {
      console.error('[portal/proposals/package] activity log failed', logErr);
    }

    // ── 10. Build total chars for manifest ────────────────────
    const totalChars = sectionData.reduce(
      (sum, s) => sum + s.text_content.length,
      0,
    );

    // ── 11. Emit end event ────────────────────────────────────
    await emitEventEnd(startEventId, {
      result: {
        proposalId,
        format: 'json',
        sectionCount: sectionData.length,
        charCount: totalChars,
      },
    });

    return NextResponse.json({
      data: {
        proposal: {
          title: proposal.title,
          stage: proposal.stage,
          gate_config: proposal.gateConfig,
          created_at: proposal.createdAt,
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
        supportingDocs: supportingDocsWithUrls,
        manifest: {
          generated_at: new Date().toISOString(),
          section_count: sectionData.length,
          supporting_doc_count: supportingDocsWithUrls.length,
          total_chars: totalChars,
        },
      },
    });
  } catch (err) {
    console.error('[portal/proposals/package] error:', err);
    await emitEventEnd(startEventId, {
      error: {
        message: err instanceof Error ? err.message : 'Package export failed',
        code: 'DB_ERROR',
      },
    });
    return NextResponse.json(
      { error: 'Package export failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
