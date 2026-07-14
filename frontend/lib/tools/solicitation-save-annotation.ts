/**
 * solicitation.save_annotation (Phase 1 §E10).
 *
 * Saves a curator's highlight / text box / compliance tag annotation
 * on the PDF viewer. Annotations become the "show me where you got
 * that" provenance for every compliance value — the UI renders them
 * as overlays on the source document.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const SourceLocation = z.object({
  page: z.number().int().min(1),
  offset: z.number().int().min(0),
  length: z.number().int().min(0),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  kind: z.enum(['highlight', 'text_box', 'compliance_tag']),
  sourceLocation: SourceLocation,
  payload: z.record(z.string(), z.unknown()).default({}),
  /** If the annotation is anchored to a specific compliance variable
   *  (e.g. highlighting the sentence where the page limit is stated),
   *  pass the variable name here. */
  complianceVariableName: z.string().max(128).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  id: string;
  solicitationId: string;
  kind: string;
  createdAt: string;
}

export const solicitationSaveAnnotationTool = defineTool<Input, Output>({
  name: 'solicitation.save_annotation',
  namespace: 'solicitation',
  description:
    'Save a highlight / text box / compliance tag annotation on a solicitation PDF. Used by the curation workspace to anchor compliance values to source text.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const actorId = ctx.actor.id;
    const { solicitationId, kind, sourceLocation, payload, complianceVariableName } = input;

    // Verify solicitation exists (FK will catch it at INSERT, but a
    // pre-check gives a cleaner error).
    let exists: { id: string }[];
    try {
      exists = await sql<{ id: string }[]>`
        SELECT id FROM curated_solicitations WHERE id = ${solicitationId}::uuid
      `;
    } catch (err) {
      console.error('[solicitation.save_annotation] existence check failed:', err);
      throw err;
    }
    if (exists.length === 0) {
      throw new NotFoundError(`solicitation not found: ${solicitationId}`);
    }

    let rows: { id: string; createdAt: Date }[];
    try {
      rows = await sql<{ id: string; createdAt: Date }[]>`
        INSERT INTO solicitation_annotations
          (solicitation_id, actor_id, kind, compliance_variable_name,
           source_location, payload)
        VALUES
          (${solicitationId}::uuid, ${actorId}::uuid, ${kind},
           ${complianceVariableName ?? null},
           ${sql.json(sourceLocation)},
           ${sql.json((payload) as Parameters<typeof sql.json>[0])})
        RETURNING id, created_at
      `;
    } catch (err) {
      console.error('[solicitation.save_annotation] insert failed:', err);
      throw err;
    }

    // ── Curation revision tracking ──────────────────────────────────
    try {
      await sql`
        INSERT INTO curation_revisions
          (solicitation_id, actor_id, actor_email, revision_type, field_name, new_value, metadata)
        VALUES (
          ${solicitationId}::uuid,
          ${actorId}::uuid,
          ${ctx.actor.email ?? null},
          'annotation_added',
          ${complianceVariableName ?? null},
          ${kind},
          ${sql.json(({ annotationId: rows[0].id, sourceLocation, payload }) as Parameters<typeof sql.json>[0])}
        )
      `;
    } catch (revErr) {
      console.error('[solicitation.save_annotation] curation_revisions insert failed:', revErr);
      // Non-fatal — continue
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'annotation.saved',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        solicitationId,
        annotationId: rows[0].id,
        kind,
        complianceVariableName: complianceVariableName ?? null,
      },
    });

    ctx.log?.info?.({
      msg: 'solicitation.save_annotation succeeded',
      solicitationId,
      annotationId: rows[0].id,
      kind,
    });

    return {
      id: rows[0].id,
      solicitationId,
      kind,
      createdAt: rows[0].createdAt.toISOString(),
    };
  },
});
