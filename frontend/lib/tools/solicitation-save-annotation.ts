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

/**
 * ⚠️ `.passthrough()` is load-bearing, not laziness.
 *
 * Callers build this from a `SourceAnchor`, which carries `excerpt`, `method`, `document_id` and
 * `document_name` alongside the flat page/offset/length. A strict object STRIPS those before the
 * handler runs — so the excerpt the curation workspace has always sent would be discarded on the
 * way in, and `excerptOf`'s fallback would read a key that zod had already deleted.
 */
const SourceLocation = z.object({
  page: z.number().int().min(1),
  offset: z.number().int().min(0),
  length: z.number().int().min(0),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
}).passthrough();

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  kind: z.enum(['highlight', 'text_box', 'compliance_tag']),
  sourceLocation: SourceLocation,
  /**
   * The SELECTED TEXT, not just where it was.
   *
   * An anchor alone is useless anywhere the document is not open. A tenant who has not pinned the
   * solicitation has no local copy for `{page, offset, length}` to resolve against, so a highlight
   * carried as an anchor renders empty for exactly the customer it exists to inform — and it cannot
   * be matched by a ranker at all, since there is nothing to match.
   *
   * Capped at 2,000: a highlight is a passage a curator marked, not a chapter. The anchor stays
   * alongside it and becomes live once a tenant pins, resolving against their own copy.
   */
  text: z.string().max(2000).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** If the annotation is anchored to a specific compliance variable
   *  (e.g. highlighting the sentence where the page limit is stated),
   *  pass the variable name here. */
  complianceVariableName: z.string().max(128).optional(),
});

type Input = z.infer<typeof InputSchema>;

/**
 * The excerpt to store — from `text`, or from the ANCHOR the caller already sends.
 *
 * ── WHY THE FALLBACK IS THE LOAD-BEARING HALF ────────────────────────────────────────────────
 * Adding `text` to the schema was not enough, and shipping it that way would have been a feature
 * that is plumbed and dry. The curation workspace has had the selected string all along — it calls
 * this tool with `sourceLocation` built from a `SourceAnchor`, whose `excerpt` field IS the
 * selection. It simply does not pass a top-level `text`, because until now nothing read one.
 *
 * So a `text`-only implementation writes NULL for every annotation the product actually creates,
 * the bridge's `excerpt <> ''` filter drops all of them, and no highlight ever reaches a card —
 * while every test written against the new field passes.
 *
 * Reading the anchor makes the capability work for the caller that exists rather than the caller
 * the schema imagined. `text` stays as the explicit path for callers with no anchor.
 */
function excerptOf(text: string | undefined, sourceLocation: Record<string, unknown> | Input['sourceLocation']): string | null {
  const explicit = text?.trim();
  if (explicit) return explicit.slice(0, 2000);
  const fromAnchor = (sourceLocation as Record<string, unknown>)?.excerpt;
  if (typeof fromAnchor === 'string' && fromAnchor.trim()) return fromAnchor.trim().slice(0, 2000);
  return null;
}

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
    const { solicitationId, kind, sourceLocation, text, payload, complianceVariableName } = input;

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
           source_location, excerpt, payload)
        VALUES
          (${solicitationId}::uuid, ${actorId}::uuid, ${kind},
           ${complianceVariableName ?? null},
           ${sql.json(sourceLocation as Parameters<typeof sql.json>[0])},
           ${excerptOf(text, sourceLocation)},
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
