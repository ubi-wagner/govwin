/**
 * volume.delete_required_item — remove one artifact from a volume.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';
import { defineTool } from './base';

const InputSchema = z.object({ itemId: z.string().uuid() });
type Input = z.infer<typeof InputSchema>;
interface Output { deleted: true }

export const volumeDeleteRequiredItemTool = defineTool<Input, Output>({
  name: 'volume.delete_required_item',
  namespace: 'volume',
  description: 'Delete a required item from a volume.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    let rows: { id: string; volumeId: string }[];
    try {
      rows = await sql<{ id: string; volumeId: string }[]>`
        DELETE FROM volume_required_items
        WHERE id = ${input.itemId}::uuid
        RETURNING id, volume_id
      `;
    } catch (err) {
      console.error('[volume.delete_required_item] delete failed:', err);
      throw err;
    }
    if (rows.length === 0) {
      throw new NotFoundError(`required item not found: ${input.itemId}`);
    }
    await emitEventSingle({
      namespace: 'finder',
      type: 'required_item.deleted',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: { correlationId: randomUUID(), itemId: input.itemId, volumeId: rows[0].volumeId },
    });
    // Refresh pushed mirrors — the removed item changes the provisioned skeleton.
    try {
      const [vol] = await sql<{ solicitationId: string; topicId: string | null }[]>`
        SELECT solicitation_id, topic_id FROM solicitation_volumes WHERE id = ${rows[0].volumeId}::uuid`;
      if (vol) {
        await republishSolicitationCards({
          solicitationId: vol.solicitationId, opportunityId: vol.topicId, actorId: ctx.actor.id,
        });
      }
    } catch (e) { console.error('[volume.delete_required_item] republish lookup failed (non-fatal)', e); }
    return { deleted: true as const };
  },
});
