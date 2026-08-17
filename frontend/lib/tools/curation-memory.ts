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

import { sql, sqlBypass } from '@/lib/db';
import type { ToolContext } from './base';
import { ToolExecutionError } from './errors';

/**
 * The house/platform org. Admin curation is platform work, not any customer's, but
 * episodic_memories.tenant_id carries a NOT-NULL FK to tenants — so platform-scope memory has to be
 * filed under a real tenant row. This is the same identity the workflow monitor labels
 * "platform (rfp-pipeline)". Change this slug to relocate where platform curation memory lives.
 */
export const PLATFORM_TENANT_SLUG = 'rfp-pipeline';

/** Cached platform tenant id — the slug→id lookup is stable for the process lifetime. */
let _platformTenantId: string | null | undefined;

async function resolvePlatformTenantId(): Promise<string | null> {
  if (_platformTenantId !== undefined) return _platformTenantId;
  try {
    // sqlBypass: `tenants` is read here with no tenant context (platform scope, by definition).
    const [row] = await sqlBypass<Array<{ id: string }>>`
      SELECT id FROM tenants WHERE slug = ${PLATFORM_TENANT_SLUG} LIMIT 1`;
    _platformTenantId = row?.id ?? null;
  } catch {
    _platformTenantId = null; // memory is best-effort; never let this throw into the business action
  }
  return _platformTenantId;
}

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

  // Resolve the owning tenant. Admin curation is PLATFORM scope (ctx.tenantId is null for the
  // rfp_admin curation tools), and this row used to be written with the nil UUID — which
  // episodic_memories.tenant_id's FK to tenants can never accept, so EVERY platform curation memory
  // died on a foreign-key violation that the catch below swallowed. Proven: zero 'curator' rows have
  // ever existed. Platform scope lives under the house org (the same identity the workflow monitor
  // labels "platform (rfp-pipeline)"); change PLATFORM_TENANT_SLUG to relocate it.
  const tenantId = ctx.tenantId ?? (await resolvePlatformTenantId());
  if (!tenantId) {
    ctx.log?.error?.({
      msg: 'curation memory skipped: no platform tenant to file it under',
      solicitationId: input.solicitationId,
      platformTenantSlug: PLATFORM_TENANT_SLUG,
    });
    return;
  }

  try {
    // sqlBypass (NOT the context-aware `sql`): episodic_memories is force-RLS with a
    // `tenant_id = app.tenant_id` policy, and these curation tools run with NO tenant context (they
    // are platform/admin tools). Under the prod govtech_app role the context-aware client threw an
    // RLS violation that this catch swallowed. The tenant_id is supplied EXPLICITLY below, and the
    // bypass is scoped to this single INSERT (no ambient-context mutation).
    await sqlBypass`
      INSERT INTO episodic_memories
        (tenant_id, agent_role, embedding, content, memory_type,
         importance, metadata, source, namespace)
      VALUES
        (${tenantId}::uuid,
         'curator',
         ${zeroVector}::vector,
         ${content},
         'decision',
         ${importance},
         ${sql.json((metadata) as Parameters<typeof sql.json>[0])},
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
  try {
    const rows = await sql<{ namespace: string | null }[]>`
      SELECT namespace FROM curated_solicitations WHERE id = ${solicitationId}::uuid
    `;
    if (rows.length === 0) return undefined;
    return rows[0].namespace;
  } catch (err) {
    console.error('[curation-memory] getSolicitationNamespace failed:', err);
    return undefined;
  }
}
