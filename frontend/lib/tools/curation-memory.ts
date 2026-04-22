/**
 * Curation memory writer — the HITL learning-loop write side.
 *
 * Every admin action that VERIFIES or CORRECTS a compliance value
 * (or approves a cure / pushes a solicitation) writes an episodic
 * memory row tagged with the solicitation's namespace key. §H's
 * `memory.search_namespace` tool reads these rows to pre-fill future
 * cycles of the same program, turning each curator decision into a
 * compounding product asset.
 *
 * Design decision D-Phase1-14 (captured in docs/DECISIONS.md):
 * curation memories are written at the TOOL layer, not the API
 * layer, so every path that mutates compliance state (frontend
 * route, future agent dispatch, direct pipeline call) records the
 * fact identically without duplicating the write site.
 *
 * See:
 *   - docs/NAMESPACES.md §"Memory namespace keys" for key format
 *   - docs/phase-1/H-namespace-memory.md for the read side
 *   - pipeline/src/shredder/namespace.py for the Python parallel
 */

import { sql } from '@/lib/db';
import type { ToolContext } from './base';
import { ToolExecutionError } from './errors';

/**
 * Supported HITL actions. The action classifies WHY this memory was
 * written so §H's read side can weight corrections above verifications.
 */
export type CurationAction =
  /** Admin confirmed a Claude suggestion or prior-cycle value. */
  | 'verify'
  /** Admin changed a Claude suggestion to a different value. */
  | 'correct'
  /** Admin manually entered a value (no AI involvement). */
  | 'manual_entry'
  /** Admin approved a solicitation for push to the pipeline. */
  | 'approve'
  /** Admin pushed an approved solicitation (final curation act). */
  | 'push';

export interface CurationMemoryInput {
  /** The curated_solicitations.id this decision pertains to. */
  solicitationId: string;
  /** The memory namespace key computed by pipeline/src/shredder/namespace.py
   *  and stamped on curated_solicitations.namespace at ingest time. */
  namespace: string;
  /** What the admin did. */
  action: CurationAction;
  /**
   * Compliance variable name if the memory is about a specific value
   * (e.g. 'page_limit_technical'). Omit for whole-solicitation acts
   * like 'approve' or 'push'.
   */
  variableName?: string;
  /** The value the admin committed (typed whatever — stringified into content). */
  value?: unknown;
  /** The source excerpt the admin pointed at (highlighted text from the PDF). */
  sourceExcerpt?: string;
  /** Free-form notes the admin attached, if any. */
  notes?: string;
}

/**
 * Write one episodic_memories row capturing a curator's decision.
 *
 * The write is fire-and-forget from the caller's perspective: it
 * runs inside the calling tool's transaction (so it rolls back with
 * the underlying compliance write on error), but a failure to write
 * memory does NOT block the business action. If the memory INSERT
 * fails (e.g. embedding service unavailable — not a concern at 0.5b
 * with zero-vector placeholder), we log and continue.
 *
 * Why episodic_memories and not semantic_memories: a specific admin's
 * decision on a specific solicitation is an EVENT (observation with
 * time + actor), not a GENERALIZED fact. Semantic consolidation (e.g.
 * "DoD SBIR BAAs consistently require 10pt font across all cycles")
 * is Phase 4 agent-fabric territory.
 */
export async function writeCurationMemory(
  ctx: ToolContext,
  input: CurationMemoryInput,
): Promise<void> {
  // Every curation memory needs a namespace key. If the caller didn't
  // supply one, the solicitation isn't classified yet and we can't
  // file the memory for cross-cycle lookup. Not fatal — just skip.
  if (!input.namespace) {
    ctx.log?.warn?.({
      msg: 'curation memory skipped: no namespace key on solicitation',
      solicitationId: input.solicitationId,
      action: input.action,
    });
    return;
  }

  // Build a human-readable content string so the episodic memory is
  // browsable without decoding metadata. Example output:
  //   "curator verified page_limit_technical=15 on solicitation abc123"
  //   "curator approved solicitation abc123"
  const valueStr =
    input.value === undefined
      ? ''
      : `=${JSON.stringify(input.value)}`;
  const content =
    input.variableName !== undefined
      ? `curator ${input.action}ed ${input.variableName}${valueStr} on solicitation ${input.solicitationId}`
      : `curator ${input.action}ed solicitation ${input.solicitationId}`;

  // Curator decisions are HIGH importance (1.0) — they're the ground
  // truth that future agents and cross-cycle pre-fill will lean on.
  // AI-only suggestions (no human verify) would land as lower-importance
  // observations written by the shredder, not by this helper.
  const importance = 1.0;

  // Zero-vector embedding placeholder (matches memory-write.ts's pattern
  // at 0.5b — Phase 4 will backfill real embeddings via an agent hook).
  // The pgvector column is `vector(1536)` so we need 1536 zeros.
  const zeroVector = '[' + new Array(1536).fill('0').join(',') + ']';

  const metadata = {
    action: input.action,
    solicitation_id: input.solicitationId,
    variable_name: input.variableName ?? null,
    value: input.value ?? null,
    source_excerpt: input.sourceExcerpt ?? null,
    notes: input.notes ?? null,
    actor_id: ctx.actor.id,
    actor_email: ctx.actor.email ?? null,
  };

  try {
    await sql`
      INSERT INTO episodic_memories
        (tenant_id, agent_role, embedding, content, memory_type,
         importance, metadata, source, namespace)
      VALUES
        (${ctx.tenantId ?? '00000000-0000-0000-0000-000000000000'}::uuid,
         'curator',
         ${zeroVector}::vector,
         ${content},
         'decision',
         ${importance},
         ${JSON.stringify(metadata)}::jsonb,
         ${input.solicitationId},
         ${input.namespace})
    `;
  } catch (err) {
    // Memory write failure MUST NOT kill the business action —
    // log and continue. The underlying tool already committed the
    // compliance value; losing one memory row is annoying but not
    // corrupting.
    ctx.log?.error?.({
      msg: 'curation memory write failed',
      solicitationId: input.solicitationId,
      namespace: input.namespace,
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Convenience: fetch a solicitation's namespace so a caller doesn't
 * have to re-read it just to pass it to writeCurationMemory. Returns
 * null if the solicitation exists but has no namespace yet (e.g. it
 * was just ingested and hasn't been shredded). Returns undefined if
 * the solicitation doesn't exist (caller should error out).
 */
export async function getSolicitationNamespace(
  solicitationId: string,
): Promise<string | null | undefined> {
  const rows = await sql<{ namespace: string | null }[]>`
    SELECT namespace FROM curated_solicitations WHERE id = ${solicitationId}::uuid
  `;
  if (rows.length === 0) return undefined;
  return rows[0].namespace;
}
