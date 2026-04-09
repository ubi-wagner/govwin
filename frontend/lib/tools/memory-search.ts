/**
 * memory.search — reference tool demonstrating the dual-use pattern.
 *
 * Searches the three memory tables (episodic, semantic, procedural)
 * for rows matching a text query within the caller's tenant scope.
 * Tenant isolation is enforced by the registry + the explicit
 * `WHERE tenant_id = ${ctx.tenantId}` filter in every query.
 *
 * In Phase 0.5b this is a pure text search (ILIKE) so the tool can
 * be tested without requiring an embeddings service. Phase 4 will
 * extend it to accept a `similarity_threshold` input and do a
 * pgvector cosine-distance search using an embedder that hasn't
 * been wired up yet.
 *
 * See docs/TOOL_CONVENTIONS.md §"Worked examples" for the canonical
 * shape of a dual-use tool.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { defineTool } from './base';
import { ToolExecutionError } from './errors';

// ─── Input schema ───────────────────────────────────────────────────

const InputSchema = z.object({
  /** Text to search for — matched against the `content` column. */
  query: z.string().min(1).max(500),
  /** Memory types to include. Defaults to all three. */
  memory_types: z
    .array(z.enum(['episodic', 'semantic', 'procedural']))
    .default(['episodic', 'semantic', 'procedural']),
  /** Optional agent_role filter (only memories for this agent). */
  agent_role: z.string().optional(),
  /** Maximum rows per memory type. Capped to avoid runaway queries. */
  limit: z.number().int().min(1).max(50).default(10),
});

type Input = z.infer<typeof InputSchema>;

// ─── Output shape ───────────────────────────────────────────────────

interface MemoryHit {
  id: string;
  memory_type: 'episodic' | 'semantic' | 'procedural';
  content: string;
  agent_role: string;
  created_at: string;
}

interface Output {
  results: MemoryHit[];
  count_by_type: Record<'episodic' | 'semantic' | 'procedural', number>;
}

// ─── Tool definition ────────────────────────────────────────────────

export const memorySearchTool = defineTool<Input, Output>({
  name: 'memory.search',
  namespace: 'memory',
  description:
    'Search the tenant\u2019s agent memories (episodic, semantic, procedural) for rows matching a text query. Returns up to `limit` hits per memory type, scoped to the caller\u2019s tenant.',
  inputSchema: InputSchema,
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    // ctx.tenantId is guaranteed non-null by the registry because
    // tenantScoped=true, but TypeScript doesn't know that — narrow
    // it explicitly.
    const tenantId = ctx.tenantId;
    if (!tenantId) {
      throw new ToolExecutionError(
        'memory.search: ctx.tenantId is null despite tenantScoped=true',
      );
    }

    const pattern = `%${input.query}%`;
    const hits: MemoryHit[] = [];
    const countByType = { episodic: 0, semantic: 0, procedural: 0 };

    try {
      if (input.memory_types.includes('episodic')) {
        const rows = await sql<
          {
            id: string;
            content: string;
            agentRole: string;
            createdAt: Date;
          }[]
        >`
          SELECT id, content, agent_role, created_at
          FROM episodic_memories
          WHERE tenant_id = ${tenantId}
            AND content ILIKE ${pattern}
            AND is_archived = false
            ${input.agent_role ? sql`AND agent_role = ${input.agent_role}` : sql``}
          ORDER BY created_at DESC
          LIMIT ${input.limit}
        `;
        for (const r of rows) {
          hits.push({
            id: r.id,
            memory_type: 'episodic',
            content: r.content,
            agent_role: r.agentRole,
            created_at: r.createdAt.toISOString(),
          });
        }
        countByType.episodic = rows.length;
      }

      if (input.memory_types.includes('semantic')) {
        const rows = await sql<
          {
            id: string;
            content: string;
            agentRole: string;
            createdAt: Date;
          }[]
        >`
          SELECT id, content, agent_role, created_at
          FROM semantic_memories
          WHERE tenant_id = ${tenantId}
            AND content ILIKE ${pattern}
            AND is_active = true
            ${input.agent_role ? sql`AND agent_role = ${input.agent_role}` : sql``}
          ORDER BY created_at DESC
          LIMIT ${input.limit}
        `;
        for (const r of rows) {
          hits.push({
            id: r.id,
            memory_type: 'semantic',
            content: r.content,
            agent_role: r.agentRole,
            created_at: r.createdAt.toISOString(),
          });
        }
        countByType.semantic = rows.length;
      }

      if (input.memory_types.includes('procedural')) {
        const rows = await sql<
          {
            id: string;
            description: string;
            agentRole: string;
            createdAt: Date;
          }[]
        >`
          SELECT id, description, agent_role, created_at
          FROM procedural_memories
          WHERE tenant_id = ${tenantId}
            AND (description ILIKE ${pattern} OR name ILIKE ${pattern})
            AND is_active = true
            ${input.agent_role ? sql`AND agent_role = ${input.agent_role}` : sql``}
          ORDER BY created_at DESC
          LIMIT ${input.limit}
        `;
        for (const r of rows) {
          hits.push({
            id: r.id,
            memory_type: 'procedural',
            content: r.description,
            agent_role: r.agentRole,
            created_at: r.createdAt.toISOString(),
          });
        }
        countByType.procedural = rows.length;
      }

      ctx.log.info(
        {
          tool: 'memory.search',
          hits: hits.length,
          counts: countByType,
        },
        'memory.search completed',
      );

      return { results: hits, count_by_type: countByType };
    } catch (err) {
      throw new ToolExecutionError(
        err instanceof Error ? err.message : 'memory.search query failed',
        500,
        { originalError: String(err) },
      );
    }
  },
});
