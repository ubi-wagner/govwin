/**
 * volume.delete_required_item — remove one artifact from a volume.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
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
    const rows = await sql<{ id: string; volumeId: string }[]>`
      DELETE FROM volume_required_items
      WHERE id = ${input.itemId}::uuid
      RETURNING id, volume_id
    `;
    if (rows.length === 0) {
      throw new NotFoundError(`required item not found: ${input.itemId}`);
    }
    await emitEventSingle({
      namespace: 'finder',
      type: 'required_item.deleted',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: { itemId: input.itemId, volumeId: rows[0].volumeId },
    });
    return { deleted: true as const };
  },
});
