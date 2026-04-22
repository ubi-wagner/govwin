/**
 * solicitation.delete_annotation (Phase 1 §E11).
 *
 * Deletes one annotation. Scoped to the target solicitation to guard
 * against cross-solicitation deletion with a mismatched id.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { defineTool } from './base';

const InputSchema = z.object({
  annotationId: z.string().uuid(),
  solicitationId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  deleted: true;
}

export const solicitationDeleteAnnotationTool = defineTool<Input, Output>({
  name: 'solicitation.delete_annotation',
  namespace: 'solicitation',
  description:
    'Delete one annotation. Scoped by both annotation id and solicitation id to prevent cross-solicitation deletion.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { annotationId, solicitationId } = input;

    const rows = await sql<{ id: string }[]>`
      DELETE FROM solicitation_annotations
      WHERE id = ${annotationId}::uuid
        AND solicitation_id = ${solicitationId}::uuid
      RETURNING id
    `;

    if (rows.length === 0) {
      throw new NotFoundError(
        `annotation not found or not owned by this solicitation`,
      );
    }

    ctx.log?.info?.({
      msg: 'solicitation.delete_annotation succeeded',
      annotationId,
      solicitationId,
    });

    return { deleted: true as const };
  },
});
