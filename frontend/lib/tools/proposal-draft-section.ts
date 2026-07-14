/**
 * proposal.draft_section — AI-powered section drafting tool.
 *
 * Given a section's compliance requirements, the customer's library
 * atoms, and the RFP context, this tool calls Claude to generate
 * CanvasNode[] JSON that populates the canvas.
 *
 * Operates in two modes:
 *   1. If ANTHROPIC_API_KEY is set: calls Claude Sonnet directly via
 *      the @anthropic-ai/sdk package to generate real content.
 *   2. If not: generates placeholder nodes with provenance.source =
 *      'template' so the UI works for testing without an API key.
 */

import { z } from 'zod';
import { defineTool } from './base';
import { createNode } from '@/lib/types/canvas-document';
import type { CanvasNode, HeadingContent, TextBlockContent, ListContent } from '@/lib/types/canvas-document';
import { ToolAuthorizationError, ToolExecutionError, ToolExternalError } from './errors';
import { assertAgentBudget, recordAgentSpend } from '@/lib/ai/agent-guard';
import { computeSectionBudget, evaluateFit, type SectionBudget, type FitResult } from '@/lib/section-budget';

// ─── Input schema ──────────────────────────────────────────────────

const InputSchema = z.object({
  proposalId: z.string().uuid(),
  sectionTitle: z.string().min(1).max(500),
  // Compliance constraints that bound the AI's output (the section "mold")
  pageLimit: z.number().int().min(1).max(100).optional(),
  fontFamily: z.string().max(100).optional(),
  fontSize: z.number().optional(),
  lineSpacing: z.number().optional(),
  imagesAllowed: z.boolean().optional(),
  requiredSubsections: z.array(z.string()).optional(),
  evaluationCriteria: z.array(z.string()).optional(),
  // Context for the AI
  rfpExcerpt: z.string().max(50000).optional(),
  libraryAtoms: z.array(z.object({
    id: z.string(),
    content: z.string(),
    category: z.string(),
    tags: z.array(z.string()).optional(),
  })).optional(),
  // Optional revision instruction
  instruction: z.string().max(2000).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  nodes: CanvasNode[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  fit?: FitResult;
  error?: string;
}

// ─── System prompt construction ────────────────────────────────────

function buildSystemPrompt(input: Input, budget: SectionBudget | null): string {
  const lines: string[] = [
    'You are a senior government proposal writer. Your task is to draft a section of a federal proposal.',
    'You must output ONLY a valid JSON array of CanvasNode objects. Do not include any text outside the JSON array.',
    '',
    'Each node in the array must have this exact shape:',
    '{',
    '  "type": "heading" | "text_block" | "bulleted_list" | "numbered_list",',
    '  "content": { ... type-specific payload ... }',
    '}',
    '',
    'Content payloads by type:',
    '- heading: { "level": 1|2|3, "text": "string", "numbering": "optional string" }',
    '- text_block: { "text": "string" }',
    '- bulleted_list: { "items": [{ "text": "string", "indent_level": 0 }] }',
    '- numbered_list: { "items": [{ "text": "string", "indent_level": 0 }] }',
    '',
    'Guidelines:',
    '- Start with a level-1 heading for the section title.',
    '- Use level-2 headings for subsections.',
    '- Write in clear, concise, technical government proposal language.',
    '- Be specific and substantive — avoid generic filler text.',
    '- Use active voice and direct statements.',
    '- Address evaluation criteria directly when provided.',
  ];

  // Compliance constraints — the section "mold" that bounds the fill.
  if (budget) {
    lines.push(
      `- HARD LENGTH BUDGET: this section is limited to ${input.pageLimit} page(s) ≈ ${budget.targetWords} words. Aim for about ${budget.targetWords} words and DO NOT exceed ${budget.maxWords} words total. Exceeding a federal page limit disqualifies the proposal, so prioritize the required subsections and evaluation criteria within the budget and cut all filler.`,
    );
  }
  if (input.fontFamily || input.fontSize) {
    const font = [input.fontFamily, input.fontSize ? `${input.fontSize}pt` : ''].filter(Boolean).join(' ');
    lines.push(`- Target font: ${font}. Adjust content density accordingly.`);
  }
  if (input.imagesAllowed === false) {
    lines.push('- Images and figures are NOT permitted in this section. Do not reference figures, images, or graphics — convey everything in prose, lists, and tables.');
  } else if (input.imagesAllowed === true) {
    lines.push('- Figures are permitted. Where a graphic materially strengthens the argument you may insert a "[Figure N: <caption>]" placeholder, but never fabricate image data.');
  }

  // Required subsections
  if (input.requiredSubsections && input.requiredSubsections.length > 0) {
    lines.push('', 'REQUIRED SUBSECTIONS (you must include all of these):');
    for (const sub of input.requiredSubsections) {
      lines.push(`  - ${sub}`);
    }
  }

  // Evaluation criteria
  if (input.evaluationCriteria && input.evaluationCriteria.length > 0) {
    lines.push('', 'EVALUATION CRITERIA (address each one explicitly):');
    for (const crit of input.evaluationCriteria) {
      lines.push(`  - ${crit}`);
    }
  }

  return lines.join('\n');
}

function buildUserMessage(input: Input): string {
  const parts: string[] = [];

  parts.push(`Draft the "${input.sectionTitle}" section.`);

  if (input.instruction) {
    parts.push('', `Additional instruction: ${input.instruction}`);
  }

  // RFP excerpt as delimited context
  if (input.rfpExcerpt) {
    parts.push(
      '',
      '<rfp_excerpt>',
      input.rfpExcerpt,
      '</rfp_excerpt>',
    );
  }

  // Library atoms as reusable content
  if (input.libraryAtoms && input.libraryAtoms.length > 0) {
    parts.push(
      '',
      '<library_atoms>',
      'The following are approved content atoms from the customer library. Incorporate them when relevant, adapting language to fit the section context:',
      '',
    );
    for (const atom of input.libraryAtoms) {
      parts.push(`[Atom ${atom.id} | category: ${atom.category}${atom.tags?.length ? ` | tags: ${atom.tags.join(', ')}` : ''}]`);
      parts.push(atom.content);
      parts.push('');
    }
    parts.push('</library_atoms>');
  }

  parts.push('', 'Respond with ONLY the JSON array. No markdown fences, no explanation.');

  return parts.join('\n');
}

// ─── AI drafting (real Claude call) ────────────────────────────────

async function draftWithClaude(input: Input, actorId: string, actorName: string): Promise<Output> {
  // Dynamic import to avoid loading the SDK when not needed
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const budget = computeSectionBudget({ pageLimit: input.pageLimit, fontSize: input.fontSize, lineSpacing: input.lineSpacing });
  // Cap generation to the budget (~1.6 tokens/word) + headroom for JSON structure.
  const maxTokens = budget ? Math.min(8192, Math.ceil(budget.maxWords * 1.6) + 1024) : 8192;
  const systemPrompt = buildSystemPrompt(input, budget);

  // One Claude round-trip → parsed CanvasNode[] + usage.
  const gen = async (userMessage: string): Promise<{ nodes: CanvasNode[]; inputTokens: number; outputTokens: number; model: string }> => {
    let response;
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Anthropic API call failed';
      throw new ToolExternalError(`Claude API error: ${message}`, { originalError: message });
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new ToolExecutionError('Claude returned no text content');
    }
    const rawJson = textBlock.text.trim();
    let parsedNodes: Array<{ type: string; content: unknown }>;
    try {
      const cleaned = rawJson.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      parsedNodes = JSON.parse(cleaned);
    } catch {
      throw new ToolExecutionError('Failed to parse Claude response as JSON', 422, { rawResponse: rawJson.slice(0, 500) });
    }
    if (!Array.isArray(parsedNodes)) {
      throw new ToolExecutionError('Claude response is not a JSON array', 422);
    }
    const nodes: CanvasNode[] = parsedNodes.map((raw) => createNode({
      type: raw.type as CanvasNode['type'],
      content: raw.content as CanvasNode['content'],
      source: 'ai_draft',
      actorId,
      actorName,
    }));
    return { nodes, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model };
  };

  const userMessage = buildUserMessage(input);
  const first = await gen(userMessage);
  let nodes = first.nodes;
  let inputTokens = first.inputTokens;
  let outputTokens = first.outputTokens;
  let model = first.model;
  let fit = evaluateFit(nodes, budget);

  // The mold defines what fits: if the draft overflows the section's hard ceiling,
  // do exactly ONE tighten-regenerate pass before handing it back.
  if (budget && !fit.withinBudget) {
    const tightenMsg = [
      userMessage,
      '',
      `Your previous draft was ${fit.words} words — OVER the ${budget.maxWords}-word ceiling for this ${input.pageLimit}-page section.`,
      `Produce a TIGHTER version of the same content — keep every required subsection and evaluation-criteria response — under ${budget.maxWords} words. Cut redundancy and filler. Respond with ONLY the JSON array.`,
    ].join('\n');
    try {
      const second = await gen(tightenMsg);
      nodes = second.nodes;
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      model = second.model;
      fit = evaluateFit(nodes, budget);
    } catch {
      // Keep the first (over-budget) draft; fit.withinBudget=false flags it for the user.
    }
  }

  return { nodes, inputTokens, outputTokens, model, fit };
}

// ─── Placeholder drafting (no API key) ─────────────────────────────

function draftPlaceholder(input: Input, actorId: string, actorName: string): Output {
  const nodes: CanvasNode[] = [];

  // Section heading
  nodes.push(createNode({
    type: 'heading',
    content: { level: 1, text: input.sectionTitle } satisfies HeadingContent,
    source: 'template',
    actorId,
    actorName,
  }));

  // Intro paragraph placeholder
  nodes.push(createNode({
    type: 'text_block',
    content: {
      text: `[AI will draft: ${input.sectionTitle} — provide an executive overview of the proposed approach, establishing context and relevance to the stated objectives.]`,
    } satisfies TextBlockContent,
    source: 'template',
    actorId,
    actorName,
  }));

  // Required subsections
  if (input.requiredSubsections && input.requiredSubsections.length > 0) {
    for (const sub of input.requiredSubsections) {
      nodes.push(createNode({
        type: 'heading',
        content: { level: 2, text: sub } satisfies HeadingContent,
        source: 'template',
        actorId,
        actorName,
      }));
      nodes.push(createNode({
        type: 'text_block',
        content: {
          text: `[AI will draft: ${sub} — describe your methodology for achieving the stated objectives in this area.]`,
        } satisfies TextBlockContent,
        source: 'template',
        actorId,
        actorName,
      }));
    }
  } else {
    // Default subsections when none specified
    const defaultSubs = ['Technical Approach', 'Management Approach', 'Key Personnel'];
    for (const sub of defaultSubs) {
      nodes.push(createNode({
        type: 'heading',
        content: { level: 2, text: sub } satisfies HeadingContent,
        source: 'template',
        actorId,
        actorName,
      }));
      nodes.push(createNode({
        type: 'text_block',
        content: {
          text: `[AI will draft: ${sub} — describe your methodology for achieving the stated objectives in this area.]`,
        } satisfies TextBlockContent,
        source: 'template',
        actorId,
        actorName,
      }));
    }
  }

  // Evaluation criteria callout
  if (input.evaluationCriteria && input.evaluationCriteria.length > 0) {
    nodes.push(createNode({
      type: 'heading',
      content: { level: 2, text: 'Evaluation Criteria Alignment' } satisfies HeadingContent,
      source: 'template',
      actorId,
      actorName,
    }));
    nodes.push(createNode({
      type: 'bulleted_list',
      content: {
        items: input.evaluationCriteria.map((crit) => ({
          text: `[Address criterion: ${crit}]`,
          indent_level: 0,
        })),
      } satisfies ListContent,
      source: 'template',
      actorId,
      actorName,
    }));
  }

  const budget = computeSectionBudget({ pageLimit: input.pageLimit, fontSize: input.fontSize, lineSpacing: input.lineSpacing });
  return {
    nodes,
    inputTokens: 0,
    outputTokens: 0,
    model: 'placeholder',
    fit: evaluateFit(nodes, budget),
  };
}

// ─── Tool definition ───────────────────────────────────────────────

export const proposalDraftSectionTool = defineTool<Input, Output>({
  name: 'proposal.draft_section',
  namespace: 'proposal',
  description:
    'Draft a proposal section using AI. Given compliance constraints, library atoms, and RFP context, generates CanvasNode[] JSON for the canvas editor. Falls back to template placeholders when no API key is configured.',
  inputSchema: InputSchema,
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    const actorId = ctx.actor.id;
    const actorName = ctx.actor.email ?? actorId;

    if (process.env.ANTHROPIC_API_KEY) {
      // Tenant scope is guaranteed by the registry (tenantScoped: true);
      // assert for type-narrowing + defense in depth.
      const tenantId = ctx.tenantId;
      if (!tenantId) {
        throw new ToolAuthorizationError('proposal.draft_section requires tenant scope');
      }

      // Enforce the unified per-tenant AI rate limit + monthly budget
      // BEFORE spending. Throws AiRateLimitError (429) / AiBudgetExceededError
      // (402); the registry re-raises AppError subclasses as-is.
      await assertAgentBudget(tenantId);

      ctx.log.info({ proposalId: input.proposalId, section: input.sectionTitle }, 'Drafting section with Claude');

      const startedAt = Date.now();
      let out: Output | undefined;
      let draftErr: unknown;
      try {
        out = await draftWithClaude(input, actorId, actorName);
        return out;
      } catch (err) {
        draftErr = err;
        throw err;
      } finally {
        // Record the attempt in the unified ledger: bills cost_usd to the
        // monthly budget and counts as one call toward the hourly limit.
        await recordAgentSpend({
          tenantId,
          agentRole: 'section_drafter',
          taskType: 'proposal.draft_section',
          model: out?.model ?? 'claude-sonnet-4-20250514',
          inputTokens: out?.inputTokens ?? 0,
          outputTokens: out?.outputTokens ?? 0,
          durationMs: Date.now() - startedAt,
          proposalId: input.proposalId,
          error: draftErr
            ? (draftErr instanceof Error ? draftErr.message : String(draftErr)).slice(0, 500)
            : null,
        });
      }
    }

    ctx.log.warn({ proposalId: input.proposalId, section: input.sectionTitle }, 'No ANTHROPIC_API_KEY — returning error');
    return {
      nodes: [],
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      error: 'AI drafting unavailable — ANTHROPIC_API_KEY not configured. Please contact your administrator.',
    };
  },
});
