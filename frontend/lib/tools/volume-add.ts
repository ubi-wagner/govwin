/**
 * volume.add (Phase 1 §E extension, post-migration 012).
 *
 * Creates a volume under a solicitation. Volumes describe the
 * response structure the proposer must produce (typically DSIP 1-5:
 * Cover, Technical, Cost, Commercialization, Supporting Docs).
 *
 * Required role: rfp_admin
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  volumeNumber: z.number().int().min(1).max(20),
  volumeName: z.string().min(1).max(200),
  volumeFormat: z.enum(['dsip_standard', 'l_and_m', 'custom']).default('custom'),
  description: z.string().max(2000).optional(),
  specialRequirements: z.array(z.string().max(200)).default([]),
  appliesToPhase: z.array(z.string().max(100)).optional(),
});

type Input = z.infer<typeof InputSchema>;
interface Output { volumeId: string; volumeNumber: number; volumeName: string }

export const volumeAddTool = defineTool<Input, Output>({
  name: 'volume.add',
  namespace: 'volume',
  description: 'Create a volume under a solicitation. Volumes define the response structure (DSIP 1-5 or custom).',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const exists = await sql<{ id: string }[]>`
      SELECT id FROM curated_solicitations WHERE id = ${input.solicitationId}::uuid
    `;
    if (exists.length === 0) {
      throw new NotFoundError(`solicitation not found: ${input.solicitationId}`);
    }

    let rows;
    try {
      rows = await sql<{ id: string }[]>`
        INSERT INTO solicitation_volumes
          (solicitation_id, volume_number, volume_name, volume_format,
           description, special_requirements, applies_to_phase, created_by)
        VALUES
          (${input.solicitationId}::uuid,
           ${input.volumeNumber},
           ${input.volumeName},
           ${input.volumeFormat},
           ${input.description ?? null},
           ${input.specialRequirements}::text[],
           ${input.appliesToPhase ?? null}::text[],
           ${ctx.actor.id}::uuid)
        RETURNING id
      `;
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictError(
          `volume ${input.volumeNumber} already exists on this solicitation`,
          { solicitationId: input.solicitationId, volumeNumber: input.volumeNumber },
        );
      }
      throw err;
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'volume.added',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: {
        solicitationId: input.solicitationId,
        volumeId: rows[0].id,
        volumeNumber: input.volumeNumber,
        volumeName: input.volumeName,
      },
    });

    return {
      volumeId: rows[0].id,
      volumeNumber: input.volumeNumber,
      volumeName: input.volumeName,
    };
  },
});
