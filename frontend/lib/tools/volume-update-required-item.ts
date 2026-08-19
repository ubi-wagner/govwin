/**
 * volume.update_required_item — edit compliance fields on an existing item.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';
import { defineTool } from './base';

const InputSchema = z.object({
  itemId: z.string().uuid(),
  itemName: z.string().min(1).max(200).optional(),
  required: z.boolean().optional(),
  pageLimit: z.number().int().min(0).max(10000).nullable().optional(),
  slideLimit: z.number().int().min(0).max(1000).nullable().optional(),
  // Character cap for an item the agency measures in characters rather than pages (a cover-sheet
  // abstract, a project summary) — its form field truncates at the cap. null clears it.
  characterLimit: z.number().int().min(0).max(100000).nullable().optional(),
  // DSIP-ONLY: completed in the agency's submission portal, so provision tracks it as a checklist
  // entry and stands up no authoring artifact for it. See volume.add_required_item.
  dsipOnly: z.boolean().optional(),
  fontFamily: z.string().max(100).nullable().optional(),
  fontSize: z.string().max(20).nullable().optional(),
  margins: z.string().max(100).nullable().optional(),
  lineSpacing: z.string().max(50).nullable().optional(),
  headerFormat: z.string().max(500).nullable().optional(),
  footerFormat: z.string().max(500).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  appliesToPhase: z.array(z.string().max(100)).nullable().optional(),
  // Link an authored canvas template + a per-item grounding note (consumed by
  // provisioning: template_id → interpolated section mold; expert_notes → section.meta).
  templateId: z.string().uuid().nullable().optional(),
  expertNotes: z.string().max(5000).nullable().optional(),
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
    // FK-before-write: refuse a dangling templateId cleanly (not a raw 23503 from the UPDATE),
    // and refuse an EMPTY mold — it passes the readiness bar yet provisions nothing. Platform
    // context means the RLS SELECT policy also hides tenant-owned molds here, so master items
    // only ever link platform molds every buyer can load at release.
    if (input.templateId) {
      const tpl = await sql<{ id: string; contentNodes: number }[]>`
        SELECT id,
          (CASE WHEN jsonb_typeof(canvas_document->'nodes') = 'array'
                THEN jsonb_array_length(canvas_document->'nodes') ELSE 0 END
           + CASE WHEN jsonb_typeof(canvas_document->'sections') = 'array'
                THEN jsonb_array_length(canvas_document->'sections') ELSE 0 END)::int AS content_nodes
        FROM document_templates WHERE id = ${input.templateId}::uuid LIMIT 1`;
      if (tpl.length === 0) {
        throw new ValidationError(`templateId does not exist: ${input.templateId}`);
      }
      if (tpl[0].contentNodes === 0) {
        throw new ValidationError('template has no canvas content — author the mold before linking it to an item');
      }
    }
    let rows: { id: string; volumeId: string }[];
    try {
      rows = await sql<{ id: string; volumeId: string }[]>`
        UPDATE volume_required_items
        SET
        item_name = COALESCE(${input.itemName ?? null}, item_name),
        required = COALESCE(${input.required ?? null}, required),
        page_limit = CASE WHEN ${input.pageLimit !== undefined}
                          THEN ${input.pageLimit ?? null} ELSE page_limit END,
        slide_limit = CASE WHEN ${input.slideLimit !== undefined}
                           THEN ${input.slideLimit ?? null} ELSE slide_limit END,
        character_limit = CASE WHEN ${input.characterLimit !== undefined}
                               THEN ${input.characterLimit ?? null} ELSE character_limit END,
        metadata = CASE WHEN ${input.dsipOnly !== undefined}
                        THEN jsonb_set(coalesce(metadata, '{}'::jsonb), '{dsipOnly}', ${input.dsipOnly === true}::text::jsonb)
                        ELSE metadata END,
        font_family = CASE WHEN ${input.fontFamily !== undefined}
                           THEN ${input.fontFamily ?? null} ELSE font_family END,
        font_size = CASE WHEN ${input.fontSize !== undefined}
                         THEN ${input.fontSize ?? null} ELSE font_size END,
        margins = CASE WHEN ${input.margins !== undefined}
                       THEN ${input.margins ?? null} ELSE margins END,
        line_spacing = CASE WHEN ${input.lineSpacing !== undefined}
                            THEN ${input.lineSpacing ?? null} ELSE line_spacing END,
        header_format = CASE WHEN ${input.headerFormat !== undefined}
                             THEN ${input.headerFormat ?? null} ELSE header_format END,
        footer_format = CASE WHEN ${input.footerFormat !== undefined}
                             THEN ${input.footerFormat ?? null} ELSE footer_format END,
        custom_fields = CASE WHEN ${input.customFields !== undefined}
                             THEN ${sql.json((input.customFields ?? {}) as Parameters<typeof sql.json>[0])}
                             ELSE custom_fields END,
        applies_to_phase = CASE WHEN ${input.appliesToPhase !== undefined}
                                THEN ${input.appliesToPhase ?? null}::text[]
                                ELSE applies_to_phase END,
        template_id = CASE WHEN ${input.templateId !== undefined}
                           THEN ${input.templateId ?? null}::uuid ELSE template_id END,
        expert_notes = CASE WHEN ${input.expertNotes !== undefined}
                            THEN ${input.expertNotes ?? null} ELSE expert_notes END,
        verified_by = ${ctx.actor.id}::uuid,
        verified_at = now(),
        updated_at = now()
      WHERE id = ${input.itemId}::uuid
      RETURNING id, volume_id
    `;
    } catch (err) {
      console.error('[volume.update_required_item] update failed:', err);
      throw err;
    }

    if (rows.length === 0) {
      throw new NotFoundError(`required item not found: ${input.itemId}`);
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'required_item.updated',
      actor: { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      payload: { correlationId: randomUUID(), itemId: input.itemId, volumeId: rows[0].volumeId },
    });

    // Refresh pushed mirrors — item compliance (limits/molds/notes) is provision truth.
    try {
      const [vol] = await sql<{ solicitationId: string; topicId: string | null }[]>`
        SELECT solicitation_id, topic_id FROM solicitation_volumes WHERE id = ${rows[0].volumeId}::uuid`;
      if (vol) {
        await republishSolicitationCards({
          solicitationId: vol.solicitationId, opportunityId: vol.topicId, actorId: ctx.actor.id,
        });
      }
    } catch (e) { console.error('[volume.update_required_item] republish lookup failed (non-fatal)', e); }

    return { itemId: input.itemId, updated: true as const };
  },
});
