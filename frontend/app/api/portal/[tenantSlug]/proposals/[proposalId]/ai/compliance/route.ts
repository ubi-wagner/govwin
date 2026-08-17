/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance
 *
 * Check section content against solicitation compliance variables.
 * More targeted than full AI review — returns pass/fail per variable
 * with excerpts showing where each requirement is addressed.
 *
 * Body: { sectionId?: string } — check specific section or all if omitted.
 *
 * Auth: tenant_user or above with tenant access.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { resolveUserAccess, hasProposalVisibility } from '@/lib/proposal-access';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { isAppError } from '@/lib/errors';
import { assertAgentBudget, recordAgentSpend } from '@/lib/ai/agent-guard';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

interface ComplianceVariable {
  id: string;
  label: string;
  description: string;
  value: string;
}

interface ComplianceCheck {
  variable_id: string;
  status: 'pass' | 'fail' | 'partial' | 'not_applicable';
  excerpt: string;
  suggestion?: string;
}

/**
 * Extract plain text from canvas JSON content (CanvasDocument format).
 * Canvas content is stored as a JSON string with a `nodes` array.
 */
function extractTextFromCanvas(content: string | null): string {
  if (!content) return '';

  try {
    const doc = JSON.parse(content);
    const nodes = doc.nodes || doc;
    if (!Array.isArray(nodes)) return content;

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
              if (Array.isArray(row)) {
                for (const cell of row) {
                  if (typeof cell === 'string') textParts.push(cell);
                  else if (cell?.text) textParts.push(cell.text);
                  else if (cell?.content) textParts.push(String(cell.content));
                }
              }
            }
          }
          break;
        default:
          if (typeof node.content === 'string') {
            textParts.push(node.content);
          } else if (node.content.text) {
            textParts.push(node.content.text);
          }
      }
    }
    return textParts.filter(Boolean).join('\n\n');
  } catch {
    // If not valid JSON, treat as plain text
    return content;
  }
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

    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal id', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Input validation ─────────────────────────────────────────
    let body: { sectionId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (body.sectionId !== undefined && (typeof body.sectionId !== 'string' || !isValidUUID(body.sectionId))) {
      return NextResponse.json(
        { error: 'Invalid section id', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Check ANTHROPIC_API_KEY ──────────────────────────────────
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'AI service not configured', code: 'AI_ERROR' },
        { status: 503 },
      );
    }

    // ── Enforce the unified per-tenant AI rate limit + monthly budget ──
    // Same counter as the pipeline agents (agent_task_log). Block BEFORE
    // any spend so a "crazy reprompt" customer is capped here too.
    try {
      await assertAgentBudget(tenantId);
    } catch (guardErr) {
      if (isAppError(guardErr)) {
        return NextResponse.json(guardErr.toResponseBody(), { status: guardErr.httpStatus });
      }
      console.error('[portal/proposals/ai/compliance] budget guard error:', guardErr);
      return NextResponse.json(
        { error: 'AI budget check failed', code: 'AI_ERROR' },
        { status: 500 },
      );
    }

    // ── Start event for compliance check ────────────────────────
    const startId = await emitEventStart({
      namespace: 'proposal',
      type: 'compliance.checked',
      actor: userActor(sessionUser.id),
      tenantId,
      payload: { proposalId, sectionId: body.sectionId ?? null },
    });

    // ── Verify proposal belongs to tenant ────────────────────────
    let proposalRows: { id: string; solicitationId: string | null }[];
    try {
      proposalRows = await sql<{ id: string; solicitationId: string | null }[]>`
        SELECT id, solicitation_id as "solicitationId"
        FROM proposals
        WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
      `;
    } catch (err) {
      console.error('[portal/proposals/ai/compliance] proposal query failed:', err);
      await emitEventEnd(startId, { error: { message: 'Failed to fetch proposal', code: 'DB_ERROR' } });
      return NextResponse.json(
        { error: 'Failed to fetch proposal', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (proposalRows.length === 0) {
      await emitEventEnd(startId, { error: { message: 'Proposal not found', code: 'NOT_FOUND' } });
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // CAP-3: verifyTenantAccess ignores membership.scope; gate on resolveUserAccess so a proposal-scoped
    // tenant_user can't run compliance over (and read verbatim excerpts of) an out-of-scope proposal.
    if (!hasProposalVisibility(await resolveUserAccess(sessionUser.id, proposalId, tenantId))) {
      await emitEventEnd(startId, { error: { message: 'Forbidden', code: 'FORBIDDEN' } });
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const solicitationId = proposalRows[0].solicitationId;
    if (!solicitationId) {
      await emitEventEnd(startId, { error: { message: 'Proposal has no linked solicitation', code: 'VALIDATION_ERROR' } });
      return NextResponse.json(
        { error: 'Proposal has no linked solicitation', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Fetch section content ────────────────────────────────────
    let sectionText = '';
    let sectionId = body.sectionId;

    try {
      if (sectionId) {
        const sectionRows = await sql<{ id: string; title: string; content: string | null }[]>`
          SELECT id, title, content
          FROM proposal_sections
          WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid
        `;
        if (sectionRows.length === 0) {
          return NextResponse.json(
            { error: 'Section not found', code: 'NOT_FOUND' },
            { status: 404 },
          );
        }
        sectionText = extractTextFromCanvas(sectionRows[0].content);
      } else {
        // Check all sections
        const allSections = await sql<{ id: string; title: string; content: string | null }[]>`
          SELECT id, title, content
          FROM proposal_sections
          WHERE proposal_id = ${proposalId}::uuid
          ORDER BY section_number ASC
        `;
        const parts: string[] = [];
        for (const sec of allSections) {
          const text = extractTextFromCanvas(sec.content);
          if (text) {
            parts.push(`## ${sec.title}\n${text}`);
          }
        }
        sectionText = parts.join('\n\n');
        sectionId = undefined;
      }
    } catch (err) {
      console.error('[portal/proposals/ai/compliance] section query failed:', err);
      return NextResponse.json(
        { error: 'Failed to fetch sections', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (!sectionText.trim()) {
      return NextResponse.json(
        { error: 'No content to check — section is empty', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Fetch compliance variables for this solicitation ─────────
    // solicitation_compliance has per-variable columns (not EAV).
    // We also fetch the compliance_variables master list for labels.
    let complianceVariables: ComplianceVariable[];
    try {
      const complianceRows = await sql<Record<string, unknown>[]>`
        SELECT
          page_limit_technical, page_limit_cost, page_limit_other,
          font_family, font_size, margins, line_spacing,
          header_required, header_format, footer_required, footer_format,
          submission_format, images_tables_allowed, slides_allowed, slide_limit,
          required_sections, required_documents, evaluation_criteria,
          taba_allowed, indirect_rate_cap, partner_max_pct,
          cost_sharing_required, cost_volume_format,
          pi_must_be_employee, pi_university_allowed,
          clearance_required, itar_required, custom_variables
        FROM solicitation_compliance
        WHERE solicitation_id = ${solicitationId}::uuid
        LIMIT 1
      `;

      if (complianceRows.length === 0) {
        return NextResponse.json(
          { error: 'No compliance data for this solicitation', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      const row = complianceRows[0];

      // Fetch master variable list for labels/descriptions
      const masterVars = await sql<{ name: string; label: string; category: string; dataType: string }[]>`
        SELECT name, label, category, data_type as "dataType"
        FROM compliance_variables
        ORDER BY category, name
      `;

      const masterMap = new Map(masterVars.map(v => [v.name, v]));

      // Build compliance variables array from the row columns
      complianceVariables = [];
      const columnMap: Record<string, string> = {
        page_limit_technical: 'pageLimitTechnical',
        page_limit_cost: 'pageLimitCost',
        font_family: 'fontFamily',
        font_size: 'fontSize',
        margins: 'margins',
        line_spacing: 'lineSpacing',
        header_required: 'headerRequired',
        header_format: 'headerFormat',
        footer_required: 'footerRequired',
        footer_format: 'footerFormat',
        submission_format: 'submissionFormat',
        images_tables_allowed: 'imagesTablesAllowed',
        slides_allowed: 'slidesAllowed',
        slide_limit: 'slideLimit',
        taba_allowed: 'tabaAllowed',
        indirect_rate_cap: 'indirectRateCap',
        partner_max_pct: 'partnerMaxPct',
        cost_sharing_required: 'costSharingRequired',
        cost_volume_format: 'costVolumeFormat',
        pi_must_be_employee: 'piMustBeEmployee',
        pi_university_allowed: 'piUniversityAllowed',
        clearance_required: 'clearanceRequired',
        itar_required: 'itarRequired',
      };

      for (const [dbCol, camelCol] of Object.entries(columnMap)) {
        const value = row[camelCol];
        if (value === null || value === undefined) continue;

        const master = masterMap.get(dbCol);
        complianceVariables.push({
          id: dbCol,
          label: master?.label || dbCol.replace(/_/g, ' '),
          description: master ? `${master.category}: ${master.label}` : dbCol,
          value: String(value),
        });
      }

      // Add JSONB fields as compliance context
      const requiredSections = row['requiredSections'] as unknown[];
      if (Array.isArray(requiredSections) && requiredSections.length > 0) {
        complianceVariables.push({
          id: 'required_sections',
          label: 'Required Sections',
          description: 'Sections that must be included in the proposal',
          value: JSON.stringify(requiredSections),
        });
      }

      const evalCriteria = row['evaluationCriteria'] as unknown[];
      if (Array.isArray(evalCriteria) && evalCriteria.length > 0) {
        complianceVariables.push({
          id: 'evaluation_criteria',
          label: 'Evaluation Criteria',
          description: 'Criteria used to evaluate the proposal',
          value: JSON.stringify(evalCriteria),
        });
      }

      // Add custom variables from the JSONB column
      const customVars = row['customVariables'] as Record<string, unknown> | null;
      if (customVars && typeof customVars === 'object') {
        for (const [key, val] of Object.entries(customVars)) {
          if (val === null || val === undefined) continue;
          const actualValue = typeof val === 'object' && val !== null ? (val as Record<string, unknown>).value ?? JSON.stringify(val) : String(val);
          complianceVariables.push({
            id: `custom_${key}`,
            label: key.replace(/_/g, ' '),
            description: `Custom compliance variable: ${key}`,
            value: actualValue as string,
          });
        }
      }
    } catch (err) {
      console.error('[portal/proposals/ai/compliance] compliance query failed:', err);
      return NextResponse.json(
        { error: 'Failed to fetch compliance data', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (complianceVariables.length === 0) {
      return NextResponse.json({
        data: {
          sectionId: sectionId || null,
          totalVariables: 0,
          passed: 0,
          failed: 0,
          partial: 0,
          notApplicable: 0,
          checks: [],
        },
      });
    }

    // ── Call Claude Haiku ─────────────────────────────────────────
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are a proposal compliance reviewer for government contracts (SBIR/STTR/BAA/OTA).
For each compliance variable, determine if the section text addresses the requirement.
Return a JSON array. Be precise and thorough in your assessment.
If a requirement is clearly not relevant to the section type (e.g., cost requirements for a technical section), mark it as "not_applicable".`;

    const userMessage = `<compliance_variables>
${JSON.stringify(complianceVariables, null, 2)}
</compliance_variables>

<section_text>
${sectionText.slice(0, 50000)}
</section_text>

For each variable, return:
[{
  "variable_id": "the id from above",
  "status": "pass" | "fail" | "partial" | "not_applicable",
  "excerpt": "relevant text excerpt from section (max 200 chars)",
  "suggestion": "what to fix (only if fail/partial, otherwise omit)"
}]

Return ONLY the JSON array. No markdown fences, no explanation.`;

    let checks: ComplianceCheck[];
    let aiInputTokens = 0;
    let aiOutputTokens = 0;
    let aiModel = 'claude-haiku-4-5-20251001';
    const aiStartedAt = Date.now();
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      aiInputTokens = response.usage.input_tokens;
      aiOutputTokens = response.usage.output_tokens;
      aiModel = response.model ?? aiModel;

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json(
          { error: 'AI returned no response', code: 'AI_ERROR' },
          { status: 500 },
        );
      }

      // Parse response, stripping markdown fences if present
      const rawJson = textBlock.text.trim()
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '');

      checks = JSON.parse(rawJson);
      if (!Array.isArray(checks)) {
        return NextResponse.json(
          { error: 'AI returned unexpected format', code: 'AI_ERROR' },
          { status: 500 },
        );
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error('[portal/proposals/ai/compliance] Failed to parse AI response');
        return NextResponse.json(
          { error: 'AI returned unparseable response', code: 'AI_ERROR' },
          { status: 500 },
        );
      }
      console.error('[portal/proposals/ai/compliance] Claude API error:', err);
      return NextResponse.json(
        { error: 'AI service unavailable', code: 'AI_ERROR' },
        { status: 502 },
      );
    }

    // ── Record AI spend in the unified ledger ────────────────────
    // Reaching here means the Haiku call + parse succeeded. Bills cost
    // to the monthly budget and counts toward the hourly rate limit.
    await recordAgentSpend({
      tenantId,
      agentRole: 'compliance_reviewer',
      taskType: 'proposal.compliance_check',
      model: aiModel,
      inputTokens: aiInputTokens,
      outputTokens: aiOutputTokens,
      durationMs: Date.now() - aiStartedAt,
      proposalId,
      sectionId: sectionId ?? null,
    });

    // ── Build structured result ──────────────────────────────────
    const variableMap = new Map(complianceVariables.map(v => [v.id, v]));
    let passed = 0;
    let failed = 0;
    let partial = 0;
    let notApplicable = 0;

    const structuredChecks = checks.map((check) => {
      const variable = variableMap.get(check.variable_id);
      switch (check.status) {
        case 'pass': passed++; break;
        case 'fail': failed++; break;
        case 'partial': partial++; break;
        case 'not_applicable': notApplicable++; break;
      }
      return {
        variableId: check.variable_id,
        variableName: variable?.label || check.variable_id,
        status: check.status,
        excerpt: check.excerpt || null,
        suggestion: check.suggestion || null,
      };
    });

    // ── End event for compliance check ─────────────────────────────
    await emitEventEnd(startId, {
      result: {
        proposalId,
        sectionId: sectionId || null,
        totalVariables: complianceVariables.length,
        passed,
        failed,
        partial,
        notApplicable,
      },
    });

    return NextResponse.json({
      data: {
        sectionId: sectionId || null,
        totalVariables: complianceVariables.length,
        passed,
        failed,
        partial,
        notApplicable,
        checks: structuredChecks,
      },
    });
  } catch (err) {
    console.error('[portal/proposals/ai/compliance] error:', err);
    return NextResponse.json(
      { error: 'Compliance check failed', code: 'AI_ERROR' },
      { status: 500 },
    );
  }
}
