/**
 * volume.delete — remove a volume and its required items (CASCADE).
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';
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
    let rows: { id: string; solicitationId: string; volumeNumber: number; topicId: string | null }[];
    try {
      rows = await sql<{ id: string; solicitationId: string; volumeNumber: number; topicId: string | null }[]>`
        DELETE FROM solicitation_volumes
        WHERE id = ${input.volumeId}::uuid
        RETURNING id, solicitation_id, volume_number, topic_id
      `;
    } catch (err) {
      console.error('[volume.delete] delete failed:', err);
      throw err;
    }
    if (rows.length === 0) {
      throw new NotFoundError(`volume not found: ${input.volumeId}`);
    }
    await emitEventSingle({
      namespace: 'finder',
      type: 'volume.deleted',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        solicitationId: rows[0].solicitationId,
        volumeId: input.volumeId,
        volumeNumber: rows[0].volumeNumber,
      },
    });
    // volumeCount rides the card snapshot — refresh pushed mirrors (topic-scoped
    // volumes refresh just that topic's card; baseline refreshes the whole set).
    await republishSolicitationCards({
      solicitationId: rows[0].solicitationId, opportunityId: rows[0].topicId, actorId: ctx.actor.id,
    });
    return { deleted: true as const };
  },
});
