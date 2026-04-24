/**
 * volume.update_required_item — edit compliance fields on an existing item.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  itemId: z.string().uuid(),
  itemName: z.string().min(1).max(200).optional(),
  required: z.boolean().optional(),
  pageLimit: z.number().int().min(0).max(10000).nullable().optional(),
  slideLimit: z.number().int().min(0).max(1000).nullable().optional(),
  fontFamily: z.string().max(100).nullable().optional(),
  fontSize: z.string().max(20).nullable().optional(),
  margins: z.string().max(100).nullable().optional(),
  lineSpacing: z.string().max(50).nullable().optional(),
  headerFormat: z.string().max(500).nullable().optional(),
  footerFormat: z.string().max(500).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  appliesToPhase: z.array(z.string().max(100)).nullable().optional(),
});

type Input = z.infer<typeof InputSchema>;
interface Output { itemId: string; updated: true }

export const volumeUpdateRequiredItemTool = defineTool<Input, Output>({
  name: 'volume.update_required_item',
  namespace: 'volume',
  description: 'Update compliance fields on a required item.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    // Build a dynamic UPDATE using COALESCE to only touch fields the
    // caller supplied. Other fields stay unchanged.
    const setParts: string[] = [];
    const values: unknown[] = [input.itemId];
    let idx = 2;

    function add(col: string, value: unknown, cast?: string) {
      setParts.push(`${col} = $${idx}${cast ? '::' + cast : ''}`);
      values.push(value);
      idx++;
    }

    if (input.itemName !== undefined) add('item_name', input.itemName);
    if (input.required !== undefined) add('required', input.required);
    if (input.pageLimit !== undefined) add('page_limit', input.pageLimit);
    if (input.slideLimit !== undefined) add('slide_limit', input.slideLimit);
    if (input.fontFamily !== undefined) add('font_family', input.fontFamily);
    if (input.fontSize !== undefined) add('font_size', input.fontSize);
    if (input.margins !== undefined) add('margins', input.margins);
    if (input.lineSpacing !== undefined) add('line_spacing', input.lineSpacing);
    if (input.headerFormat !== undefined) add('header_format', input.headerFormat);
    if (input.footerFormat !== undefined) add('footer_format', input.footerFormat);
    if (input.customFields !== undefined) {
      add('custom_fields', JSON.stringify(input.customFields), 'jsonb');
    }
    if (input.appliesToPhase !== undefined) {
      add('applies_to_phase', input.appliesToPhase, 'text[]');
    }

    add('verified_by', ctx.actor.id, 'uuid');
    add('verified_at', 'now()');
    // "verified_at" above is handled by now() expression — the setParts
    // won't work generically. Do it separately below with sql`NOW()`.
    // Reset the last entry.
    setParts.pop(); values.pop(); idx--;
    const verifiedAtIdx = idx;
    setParts.push('verified_at = now()');

    if (setParts.length === 2) {
      // Only verified_by + verified_at — nothing to actually update
      throw new NotFoundError('no fields provided to update');
    }

    const updateSql = `
      UPDATE volume_required_items
      SET ${setParts.join(', ')}
      WHERE id = $1::uuid
      RETURNING id, volume_id
    `;
    // Use sql.unsafe-like pattern via template — but postgres.js doesn't
    // expose unsafe cleanly, so fall back to a manual loop construction.
    // Simpler: run a cascade of fixed templates covering the common subset.
    // To keep this file focused, build as a tagged-template with only the
    // critical fields + customFields. Any field not listed here can use
    // a dedicated narrow tool later.

    const rows = await sql<{ id: string; volumeId: string }[]>`
      UPDATE volume_required_items
      SET
        item_name = COALESCE(${input.itemName ?? null}, item_name),
        required = COALESCE(${input.required ?? null}, required),
        page_limit = CASE WHEN ${input.pageLimit !== undefined ? 't' : 'f'}::bool
                          THEN ${input.pageLimit ?? null} ELSE page_limit END,
        slide_limit = CASE WHEN ${input.slideLimit !== undefined ? 't' : 'f'}::bool
                           THEN ${input.slideLimit ?? null} ELSE slide_limit END,
        font_family = CASE WHEN ${input.fontFamily !== undefined ? 't' : 'f'}::bool
                           THEN ${input.fontFamily ?? null} ELSE font_family END,
        font_size = CASE WHEN ${input.fontSize !== undefined ? 't' : 'f'}::bool
                         THEN ${input.fontSize ?? null} ELSE font_size END,
        margins = CASE WHEN ${input.margins !== undefined ? 't' : 'f'}::bool
                       THEN ${input.margins ?? null} ELSE margins END,
        line_spacing = CASE WHEN ${input.lineSpacing !== undefined ? 't' : 'f'}::bool
                            THEN ${input.lineSpacing ?? null} ELSE line_spacing END,
        header_format = CASE WHEN ${input.headerFormat !== undefined ? 't' : 'f'}::bool
                             THEN ${input.headerFormat ?? null} ELSE header_format END,
        footer_format = CASE WHEN ${input.footerFormat !== undefined ? 't' : 'f'}::bool
                             THEN ${input.footerFormat ?? null} ELSE footer_format END,
        custom_fields = CASE WHEN ${input.customFields !== undefined ? 't' : 'f'}::bool
                             THEN ${input.customFields ? JSON.stringify(input.customFields) : '{}'}::jsonb
                             ELSE custom_fields END,
        applies_to_phase = CASE WHEN ${input.appliesToPhase !== undefined ? 't' : 'f'}::bool
                                THEN ${input.appliesToPhase ?? null}::text[]
                                ELSE applies_to_phase END,
        verified_by = ${ctx.actor.id}::uuid,
        verified_at = now(),
        updated_at = now()
      WHERE id = ${input.itemId}::uuid
      RETURNING id, volume_id
    `;

    if (rows.length === 0) {
      throw new NotFoundError(`required item not found: ${input.itemId}`);
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'required_item.updated',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: { itemId: input.itemId, volumeId: rows[0].volumeId },
    });

    return { itemId: input.itemId, updated: true as const };
  },
});
