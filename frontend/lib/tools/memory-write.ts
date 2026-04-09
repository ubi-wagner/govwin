/**
 * memory.write — reference tool demonstrating the dual-use pattern.
 *
 * Writes one new memory row to the appropriate memory table (episodic,
 * semantic, or procedural) for the caller's tenant. Tenant isolation
 * is enforced by the registry + the explicit `tenant_id = ${ctx.tenantId}`
 * insert clause.
 *
 * In Phase 0.5b the embedding column is filled with a zero vector to
 * satisfy the NOT NULL constraint. Phase 4 will add a second tool
 * (or an internal hook) that calls the embedder and backfills real
 * vectors — tools written now remain correct because the embedding
 * column is never read by the text-search reference path.
 *
 * See docs/TOOL_CONVENTIONS.md §"Worked examples".
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { defineTool } from './base';
import { ToolExecutionError } from './errors';

// ─── Input schema ───────────────────────────────────────────────────

const EpisodicInput = z.object({
  memory_type: z.literal('episodic'),
  agent_role: z.string().min(1).max(64),
  content: z.string().min(1).max(10_000),
  observation_type: z
    .enum(['observation', 'interaction', 'decision', 'outcome'])
    .default('observation'),
  importance: z.number().min(0).max(1).default(0.5),
  entities: z.array(z.record(z.string(), z.unknown())).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  source: z.string().optional(),
});

const SemanticInput = z.object({
  memory_type: z.literal('semantic'),
  agent_role: z.string().min(1).max(64),
  content: z.string().min(1).max(10_000),
  category: z.string().min(1).max(64),
  subcategory: z.string().max(64).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence_count: z.number().int().min(1).default(1),
});

const ProceduralInput = z.object({
  memory_type: z.literal('procedural'),
  agent_role: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(10_000),
  steps: z.array(z.record(z.string(), z.unknown())).default([]),
  trigger_conditions: z.record(z.string(), z.unknown()).default({}),
});

const InputSchema = z.discriminatedUnion('memory_type', [
  EpisodicInput,
  SemanticInput,
  ProceduralInput,
]);

type Input = z.infer<typeof InputSchema>;

interface Output {
  id: string;
  memory_type: 'episodic' | 'semantic' | 'procedural';
}

// ─── Tool definition ────────────────────────────────────────────────

// Zero vector of length 1536 — matches the vector(1536) column in
// episodic_memories / semantic_memories / procedural_memories. Real
// embeddings are backfilled by the Phase 4 embedder; for Phase 0.5b
// the text-search reference path in memory.search never reads this
// column.
const ZERO_EMBEDDING_1536 = `[${Array(1536).fill(0).join(',')}]`;

export const memoryWriteTool = defineTool<Input, Output>({
  name: 'memory.write',
  namespace: 'memory',
  description:
    'Write a new memory row (episodic, semantic, or procedural) for the caller\u2019s tenant. Embedding is a zero vector placeholder until the Phase 4 embedder runs.',
  inputSchema: InputSchema,
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    const tenantId = ctx.tenantId;
    if (!tenantId) {
      throw new ToolExecutionError(
        'memory.write: ctx.tenantId is null despite tenantScoped=true',
      );
    }

    try {
      if (input.memory_type === 'episodic') {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO episodic_memories (
            tenant_id, agent_role, embedding, content, memory_type,
            importance, entities, metadata, source
          ) VALUES (
            ${tenantId},
            ${input.agent_role},
            ${ZERO_EMBEDDING_1536}::vector,
            ${input.content},
            ${input.observation_type},
            ${input.importance},
            ${JSON.stringify(input.entities)}::jsonb,
            ${JSON.stringify(input.metadata)}::jsonb,
            ${input.source ?? null}
          )
          RETURNING id
        `;
        ctx.log.info(
          { tool: 'memory.write', memory_type: 'episodic', id: row.id },
          'wrote episodic memory',
        );
        return { id: row.id, memory_type: 'episodic' };
      }

      if (input.memory_type === 'semantic') {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO semantic_memories (
            tenant_id, agent_role, embedding, content, category,
            subcategory, confidence, evidence_count
          ) VALUES (
            ${tenantId},
            ${input.agent_role},
            ${ZERO_EMBEDDING_1536}::vector,
            ${input.content},
            ${input.category},
            ${input.subcategory ?? null},
            ${input.confidence},
            ${input.evidence_count}
          )
          RETURNING id
        `;
        ctx.log.info(
          { tool: 'memory.write', memory_type: 'semantic', id: row.id },
          'wrote semantic memory',
        );
        return { id: row.id, memory_type: 'semantic' };
      }

      // procedural
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO procedural_memories (
          tenant_id, agent_role, embedding, name, description,
          steps, trigger_conditions
        ) VALUES (
          ${tenantId},
          ${input.agent_role},
          ${ZERO_EMBEDDING_1536}::vector,
          ${input.name},
          ${input.description},
          ${JSON.stringify(input.steps)}::jsonb,
          ${JSON.stringify(input.trigger_conditions)}::jsonb
        )
        RETURNING id
      `;
      ctx.log.info(
        { tool: 'memory.write', memory_type: 'procedural', id: row.id },
        'wrote procedural memory',
      );
      return { id: row.id, memory_type: 'procedural' };
    } catch (err) {
      throw new ToolExecutionError(
        err instanceof Error ? err.message : 'memory.write insert failed',
        500,
        { originalError: String(err) },
      );
    }
  },
});
