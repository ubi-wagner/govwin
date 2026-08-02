/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/package
 *
 * Generate complete proposal package. Supports these output formats:
 *   ?format=json  — (default) structured JSON with text, compliance, docs
 *   ?format=docx  — Word document download (.docx), all sections combined
 *   ?format=pdf   — PDF download (Chromium print), all sections combined, with
 *                   the canvas header/footer + real page numbers, tables and
 *                   inline SVG figures at full fidelity
 *   ?format=zip   — each volume in its NATIVE format (docx/pptx/xlsx), zipped
 *
 * Auth: tenant_user or above with tenant access. Proposal must be locked.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import { getSignedGetUrl } from '@/lib/storage/s3-client';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import { assembleArtifactCanvas, resolveArtifactFormat, renderCanvas } from '@/lib/export/artifact-export';
import JSZip from 'jszip';
import {
  CANVAS_PRESETS,
  sectionsToNodes,
  coalesceGroups,
  type CanvasDocument,
  type CanvasNode,
  type CanvasSection,
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
    // Full CanvasDocument shape (v2 flattens its section layer to a flat node
    // run for this combined-document assembly; section flow is preserved by the
    // per-artifact native export, not the merged package).
    if ((parsed.version === 1 || parsed.version === 2) && parsed.canvas) {
      if (Array.isArray(parsed.sections) && parsed.sections.length) {
        return { nodes: sectionsToNodes(parsed.sections as CanvasSection[]), canvas: parsed.canvas };
      }
      if (Array.isArray(parsed.nodes)) return { nodes: parsed.nodes, canvas: parsed.canvas };
    }
    // Bare section layer without a canvas
    if (Array.isArray(parsed.sections) && parsed.sections.length) {
      return { nodes: sectionsToNodes(parsed.sections as CanvasSection[]), canvas: null };
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
  if (format !== 'json' && format !== 'docx' && format !== 'pdf' && format !== 'zip') {
    return NextResponse.json(
      {
        error: 'Invalid format. Supported: json, docx, pdf, zip',
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

  enterTenant(tenantId);

  // ── ZIP export path (whole proposal, each volume in its NATIVE format) ──
  // A proposal mixes docx/pptx/xlsx volumes, so a single-format download is lossy;
  // the zip assembles each artifact from its sections and renders it natively.
  if (format === 'zip') {
    try {
      // Ownership + the SAME lock/stage download gate the docx/json paths enforce,
      // BEFORE touching artifact data.
      const [prop] = await sql<{ title: string | null; stage: string; isLocked: boolean }[]>`
        SELECT title, stage, is_locked FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid LIMIT 1`;
      if (!prop) return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
      if (!prop.isLocked && prop.stage !== 'submitted' && prop.stage !== 'archived') {
        return NextResponse.json({ error: 'Proposal must be locked or in submitted/archived stage to export package', code: 'FORBIDDEN' }, { status: 403 });
      }

      const artifacts = await sql<{ id: string; artifactType: string; volumeName: string; volumeNumber: number }[]>`
        SELECT id, artifact_type AS "artifactType", volume_name AS "volumeName", volume_number AS "volumeNumber"
        FROM proposal_artifacts WHERE proposal_id = ${proposalId}::uuid
        ORDER BY volume_number, volume_name`;
      const vars = { company_name: (tenant as { name?: string }).name ?? 'Company', topic_number: '' };
      const zip = new JSZip();
      const failed: string[] = [];
      let fileCount = 0;
      for (const a of artifacts) {
        const secs = await sql<{ title: string | null; content: string | null }[]>`
          SELECT title, content FROM proposal_sections WHERE artifact_id = ${a.id}::uuid ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number`;
        if (secs.length === 0) continue;
        const doc = assembleArtifactCanvas(secs, a.artifactType, a.volumeName);
        const fmt = resolveArtifactFormat(a.artifactType, doc.canvas?.format);
        try {
          const buf = await renderCanvas(fmt, doc, vars);
          const safe = `V${a.volumeNumber}_${(a.volumeName || 'volume').replace(/[^a-z0-9]+/gi, '_')}`;
          zip.file(`${safe}.${fmt}`, buf);
          fileCount++;
        } catch (e) {
          console.error('[package/zip] volume render failed', a.volumeName, e);
          failed.push(a.volumeName || `volume ${a.volumeNumber}`);
        }
      }
      // Never ship a silently-incomplete package: if any volume failed to render,
      // fail the whole zip and name the volumes so the user can retry / export singly.
      if (failed.length > 0) {
        return NextResponse.json({ error: `Could not render ${failed.length} volume(s): ${failed.join(', ')}. Export each volume individually or retry.`, code: 'EXPORT_ERROR' }, { status: 500 });
      }
      if (fileCount === 0) {
        return NextResponse.json({ error: 'No volumes with content to export', code: 'NOT_FOUND' }, { status: 404 });
      }
      const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
      const safeName = (prop.title || 'proposal').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      return new Response(new Uint8Array(zipBuf), {
        status: 200,
        headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${safeName}.zip"` },
      });
    } catch (e) {
      console.error('[portal/proposals/package] zip failed:', e);
      return NextResponse.json({ error: 'Package zip failed', code: 'DB_ERROR' }, { status: 500 });
    }
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
        ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number ASC
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

    // ── DOCX / PDF export path (both assemble the same combined CanvasDocument
    //    from all sections, then render to their format) ──────────────
    if (format === 'docx' || format === 'pdf') {
      // Combine all section nodes into one CanvasDocument.
      // Use the first section's canvas rules, or fall back to standard preset.
      const firstCanvas =
        parsedSections.find((s) => s.canvas)?.canvas ??
        CANVAS_PRESETS.letter_standard;

      // One FLOW section per mold — its H1 heading then its content, figures/
      // tables kept together. No forced page breaks between molds: the whole
      // proposal flows continuously (headings mark the sections).
      const docSections: CanvasSection[] = parsedSections.map((section) => {
        const num = (section.sectionNumber ?? '').trim();
        const alreadyTitled = section.nodes[0]?.type === 'heading';
        const headingNode: CanvasNode = {
          id: crypto.randomUUID(),
          type: 'heading',
          content: { level: 1 as const, text: num ? `${num}. ${section.title}` : section.title },
          style: {},
          provenance: { source: 'manual', drafted_at: new Date().toISOString() },
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
        buffer =
          format === 'pdf'
            ? await exportToPdf(combinedDoc, vars)
            : await exportToDocx(combinedDoc, vars);
      } catch (e) {
        console.error(
          `[portal/proposals/package] ${format.toUpperCase()} generation failed:`,
          e,
        );
        await emitEventEnd(startEventId, {
          error: {
            message: `${format.toUpperCase()} generation failed`,
            code: 'EXPORT_ERROR',
          },
        });
        return NextResponse.json(
          { error: `${format.toUpperCase()} generation failed`, code: 'EXPORT_ERROR' },
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
                  ${sql.json({ section_count: parsedSections.length, format })})
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
          format,
          sectionCount: parsedSections.length,
          charCount: totalChars,
        },
      });

      const safeFilename = (proposal.title ?? 'proposal').replace(/[^a-zA-Z0-9-_ ]/g, '') || 'proposal';
      const isPdf = format === 'pdf';
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': isPdf
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${safeFilename}.${isPdf ? 'pdf' : 'docx'}"`,
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
                ${sql.json({ section_count: sectionData.length, format: 'json' })})
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
