/**
 * library.save_atom — saves an accepted canvas node to the customer's
 * library as a reusable atom.
 *
 * This is the write-side of the library feedback loop. When a user
 * accepts a node in the canvas editor, the node's content + metadata
 * + provenance becomes a library_units row tagged for future retrieval
 * by the Librarian agent.
 *
 * The original node in the canvas is IMMUTABLE after acceptance —
 * the library atom is a COPY. Future proposals pull the copy and
 * create new nodes with provenance.source='library'.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';
import { ToolAuthorizationError, ToolExecutionError } from './errors';

const InputSchema = z.object({
  tenantId: z.string().uuid(),
  proposalId: z.string().uuid(),
  nodeId: z.string(),
  nodeType: z.string(),
  content: z.record(z.string(), z.unknown()),
  category: z.string().max(100),
  tags: z.array(z.string().max(200)).default([]),
  sourceAnchor: z.record(z.string(), z.unknown()).optional(),
  atomHash: z.string().max(128).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  libraryUnitId: string;
  category: string;
  isNew: boolean;
}

export const librarySaveAtomTool = defineTool<Input, Output>({
  name: 'library.save_atom',
  namespace: 'library',
  description:
    'Save an accepted canvas node to the customer library as a reusable atom. Dedupes by atom_hash.',
  inputSchema: InputSchema,
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new ToolAuthorizationError('tenant context required');

    // Dedupe: if an atom with the same hash already exists for this
    // tenant, skip (don't create duplicates of the same paragraph).
    if (input.atomHash) {
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM library_units
        WHERE tenant_id = ${tenantId}::uuid
          AND atom_hash = ${input.atomHash}
        LIMIT 1
      `;
      if (existing.length > 0) {
        return { libraryUnitId: existing[0].id, category: input.category, isNew: false };
      }
    }

    const contentJson = JSON.stringify(input.content);

    const rows = await sql<{ id: string }[]>`
      INSERT INTO library_units
        (tenant_id, content, content_type, category, tags, status,
         original_proposal_id, original_node_id, atom_hash, metadata)
      VALUES
        (${tenantId}::uuid,
         ${contentJson},
         ${input.nodeType},
         ${input.category},
         ${input.tags}::text[],
         'approved',
         ${input.proposalId}::uuid,
         ${input.nodeId},
         ${input.atomHash ?? null},
         ${JSON.stringify({
           source_anchor: input.sourceAnchor ?? null,
           saved_by: ctx.actor.id,
           saved_at: new Date().toISOString(),
         })}::jsonb)
      RETURNING id
    `;
    if (!rows.length) {
      throw new ToolExecutionError('Failed to save library atom — INSERT returned no rows');
    }
    const id = rows[0].id;

    await emitEventSingle({
      namespace: 'library',
      type: 'atom.saved',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      tenantId,
      payload: {
        libraryUnitId: id,
        proposalId: input.proposalId,
        nodeType: input.nodeType,
        category: input.category,
        tags: input.tags,
      },
    });

    return { libraryUnitId: id, category: input.category, isNew: true };
  },
});
