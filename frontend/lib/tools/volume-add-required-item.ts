/**
 * volume.add_required_item — adds a proposer-produced artifact
 * (Word doc, slide deck, spreadsheet, form) with per-item compliance.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  volumeId: z.string().uuid(),
  itemNumber: z.number().int().min(1).max(100),
  itemName: z.string().min(1).max(200),
  itemType: z.enum([
    'word_doc','slide_deck','spreadsheet','pdf','text',
    'form_sf424','form_sbir_certs','form_other','other',
  ]).default('word_doc'),
  required: z.boolean().default(true),
  pageLimit: z.number().int().min(1).max(10000).optional(),
  slideLimit: z.number().int().min(1).max(1000).optional(),
  fontFamily: z.string().max(100).optional(),
  fontSize: z.string().max(20).optional(),
  margins: z.string().max(100).optional(),
  lineSpacing: z.string().max(50).optional(),
  headerFormat: z.string().max(500).optional(),
  footerFormat: z.string().max(500).optional(),
  appliesToPhase: z.array(z.string().max(100)).optional(),
});

type Input = z.infer<typeof InputSchema>;
interface Output { itemId: string; volumeId: string }

export const volumeAddRequiredItemTool = defineTool<Input, Output>({
  name: 'volume.add_required_item',
  namespace: 'volume',
  description: 'Add a required item (word doc, slide deck, spreadsheet, form) inside a volume, with per-item compliance.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const vol = await sql<{ solicitationId: string }[]>`
      SELECT solicitation_id FROM solicitation_volumes WHERE id = ${input.volumeId}::uuid
    `;
    if (vol.length === 0) throw new NotFoundError(`volume not found: ${input.volumeId}`);

    let rows;
    try {
      rows = await sql<{ id: string }[]>`
        INSERT INTO volume_required_items
          (volume_id, item_number, item_name, item_type, required,
           page_limit, slide_limit, font_family, font_size, margins,
           line_spacing, header_format, footer_format, applies_to_phase)
        VALUES
          (${input.volumeId}::uuid,
           ${input.itemNumber},
           ${input.itemName},
           ${input.itemType},
           ${input.required},
           ${input.pageLimit ?? null},
           ${input.slideLimit ?? null},
           ${input.fontFamily ?? null},
           ${input.fontSize ?? null},
           ${input.margins ?? null},
           ${input.lineSpacing ?? null},
           ${input.headerFormat ?? null},
           ${input.footerFormat ?? null},
           ${input.appliesToPhase ?? null}::text[])
        RETURNING id
      `;
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictError(
          `item ${input.itemNumber} already exists in this volume`,
          { volumeId: input.volumeId, itemNumber: input.itemNumber },
        );
      }
      throw err;
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'required_item.added',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: {
        solicitationId: vol[0].solicitationId,
        volumeId: input.volumeId,
        itemId: rows[0].id,
        itemName: input.itemName,
      },
    });

    return { itemId: rows[0].id, volumeId: input.volumeId };
  },
});
