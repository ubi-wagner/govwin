/**
 * volume.delete — remove a volume and its required items (CASCADE).
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({ volumeId: z.string().uuid() });
type Input = z.infer<typeof InputSchema>;
interface Output { deleted: true }

export const volumeDeleteTool = defineTool<Input, Output>({
  name: 'volume.delete',
  namespace: 'volume',
  description: 'Delete a volume and its required items.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const rows = await sql<{ id: string; solicitationId: string; volumeNumber: number }[]>`
      DELETE FROM solicitation_volumes
      WHERE id = ${input.volumeId}::uuid
      RETURNING id, solicitation_id, volume_number
    `;
    if (rows.length === 0) {
      throw new NotFoundError(`volume not found: ${input.volumeId}`);
    }
    await emitEventSingle({
      namespace: 'finder',
      type: 'volume.deleted',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: {
        solicitationId: rows[0].solicitationId,
        volumeId: input.volumeId,
        volumeNumber: rows[0].volumeNumber,
      },
    });
    return { deleted: true as const };
  },
});
