/**
 * volume.add_required_item — adds a proposer-produced artifact
 * (Word doc, slide deck, spreadsheet, form) with per-item compliance.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';
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
  // Character cap, for an item the agency measures in characters rather than pages (an SBIR
  // cover-sheet abstract, an NSF project summary). The agency's form field truncates at the cap.
  characterLimit: z.number().int().min(1).max(100000).optional(),
  // DSIP-ONLY: this item is completed inside the agency's submission portal — a webform, a
  // report pulled from SBIR.gov, training taken there. The company never authors a document for
  // it, so provision must track it as a checklist entry and NOT stand up an authoring artifact
  // that can never be filled (which would block submission readiness forever). Set per ITEM
  // because a volume can mix the two: the DoW Volume 1 is a DSIP cover-sheet webform PLUS two
  // authored narrative documents.
  dsipOnly: z.boolean().optional(),
  fontFamily: z.string().max(100).optional(),
  fontSize: z.string().max(20).optional(),
  margins: z.string().max(100).optional(),
  lineSpacing: z.string().max(50).optional(),
  headerFormat: z.string().max(500).optional(),
  footerFormat: z.string().max(500).optional(),
  appliesToPhase: z.array(z.string().max(100)).optional(),
  // Link an authored canvas template + a per-item grounding note. Provisioning
  // consumes these (provision-proposal.ts / create-route: SELECT canvas_document by
  // template_id → interpolate into the section mold; expert_notes → section.meta).
  templateId: z.string().uuid().nullable().optional(),
  expertNotes: z.string().max(5000).nullable().optional(),
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
    let vol: { solicitationId: string; topicId: string | null }[];
    try {
      vol = await sql<{ solicitationId: string; topicId: string | null }[]>`
        SELECT solicitation_id, topic_id FROM solicitation_volumes WHERE id = ${input.volumeId}::uuid
      `;
    } catch (err) {
      console.error('[volume.add_required_item] volume lookup failed:', err);
      throw err;
    }
    if (vol.length === 0) throw new NotFoundError(`volume not found: ${input.volumeId}`);

    // FK-before-write (CLAUDE.md §Data Layer): a dangling templateId must be a clean
    // validation refusal, not a raw 23503 constraint throw from the INSERT. Also refuse an
    // EMPTY mold ({} default body): it passes the cockpit readiness bar yet provisions
    // nothing — author the canvas first, then link. (Run under platform context, the RLS
    // SELECT policy also hides tenant-owned molds here, so a master item can only ever
    // link a platform mold every buyer can load at release.)
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

    let rows;
    try {
      rows = await sql<{ id: string }[]>`
        INSERT INTO volume_required_items
          (volume_id, item_number, item_name, item_type, required,
           page_limit, slide_limit, character_limit, font_family, font_size, margins,
           line_spacing, header_format, footer_format, applies_to_phase,
           template_id, expert_notes, metadata)
        VALUES
          (${input.volumeId}::uuid,
           ${input.itemNumber},
           ${input.itemName},
           ${input.itemType},
           ${input.required},
           ${input.pageLimit ?? null},
           ${input.slideLimit ?? null},
           ${input.characterLimit ?? null},
           ${input.fontFamily ?? null},
           ${input.fontSize ?? null},
           ${input.margins ?? null},
           ${input.lineSpacing ?? null},
           ${input.headerFormat ?? null},
           ${input.footerFormat ?? null},
           ${input.appliesToPhase ?? null}::text[],
           ${input.templateId ?? null}::uuid,
           ${input.expertNotes ?? null},
           ${sql.json(input.dsipOnly === true ? { dsipOnly: true } : {})})
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
        correlationId: randomUUID(),
        solicitationId: vol[0].solicitationId,
        volumeId: input.volumeId,
        itemId: rows[0].id,
        itemName: input.itemName,
      },
    });

    // Required-item structure drives build readiness + the provisioned skeleton —
    // refresh pushed mirrors so provisionReady truth doesn't silently diverge.
    await republishSolicitationCards({
      solicitationId: vol[0].solicitationId, opportunityId: vol[0].topicId, actorId: ctx.actor.id,
    });

    return { itemId: rows[0].id, volumeId: input.volumeId };
  },
});
