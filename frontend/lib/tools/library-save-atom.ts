/**
 * library.save_atom — saves an accepted canvas node to the customer's
 * library as a reusable atom.
 *
 * This is the write-side of the library feedback loop. When a user
 * accepts a node in the canvas editor, the node's content + metadata
 * + provenance becomes a library_atoms row tagged for future retrieval
 * by the Librarian agent.
 *
 * The original node in the canvas is IMMUTABLE after acceptance —
 * the library atom is a COPY. Future proposals pull the copy and
 * create new nodes with provenance.source='library'.
 */

import { z } from 'zod';
import { createAtom } from '@/lib/atoms';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';
import { ToolAuthorizationError } from './errors';

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

    // Repointed to the canonical library (library_atoms). The accepted node becomes
    // one primitive atom; the source document/objects it was cut from are recorded
    // in source_anchor. NOTE: the legacy atom_hash dedupe is dropped — library_atoms
    // has no atom_hash column — so this tool now always crystallizes a fresh atom
    // (isNew is always true). Tool schema + return shape are unchanged.
    const contentJson = JSON.stringify(input.content);

    let id: string;
    try {
      const { atomId } = await createAtom(
        tenantId,
        {
          grain: 'primitive',
          content: contentJson,
          source: 'harvest',
          creatorKind: 'ai',
          status: 'approved',
          originProposalId: input.proposalId,
          sourceAnchor: input.sourceAnchor ?? null,
        },
        { id: ctx.actor.id, kind: 'ai' },
      );
      id = atomId;
    } catch (err) {
      console.error('[library.save_atom] atom creation failed:', err);
      throw err;
    }

    await emitEventSingle({
      namespace: 'library',
      type: 'atom.saved',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      tenantId,
      payload: {
        correlationId: randomUUID(),
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
