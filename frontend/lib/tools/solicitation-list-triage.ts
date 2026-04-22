/**
 * solicitation.list_triage (Phase 1 §E1).
 *
 * Primary reader for the admin triage queue. Returns curated
 * solicitations filtered by status + claim state, joined with their
 * opportunity rows for display (agency, title, program_type, etc.).
 *
 * Required role: `rfp_admin` (admin-scoped; no tenant filter). The
 * registry rejects non-admin callers before the handler runs.
 *
 * Cursor pagination uses `(created_at, id)` lexical ordering —
 * `created_at DESC` as the primary sort with `id` breaking ties for
 * stability across duplicate timestamps.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { defineTool } from './base';

// ─── Input schema ───────────────────────────────────────────────────

const STATUS_VALUES = [
  'new',
  'claimed',
  'released',
  'released_for_analysis',
  'ai_analyzed',
  'shredder_failed',
  'curation_in_progress',
  'review_requested',
  'approved',
  'pushed_to_pipeline',
  'dismissed',
  'rejected_review',
] as const;

const InputSchema = z.object({
  /** Filter by one or more statuses. Omit to include all statuses. */
  status: z.array(z.enum(STATUS_VALUES)).optional(),
  /**
   * Filter by claimed_by:
   *   'me'         — only rows claimed by ctx.actor.id
   *   'unclaimed'  — only rows where claimed_by IS NULL
   *   'any'        — no claim filter (default)
   */
  claimedBy: z.enum(['me', 'unclaimed', 'any']).default('any'),
  limit: z.number().int().min(1).max(100).default(25),
  /** Opaque cursor from a prior call's `nextCursor`. */
  cursor: z.string().optional(),
});

type Input = z.infer<typeof InputSchema>;

// ─── Output shape ───────────────────────────────────────────────────

interface TriageItem {
  solicitationId: string;
  opportunityId: string;
  status: string;
  namespace: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  curatedBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  // Joined from opportunities
  title: string;
  source: string;
  agency: string | null;
  office: string | null;
  programType: string | null;
  closeDate: string | null;
  postedDate: string | null;
}

interface Output {
  items: TriageItem[];
  nextCursor: string | null;
}

// ─── Cursor encoding ─────────────────────────────────────────────────
// Opaque base64 of `{createdAt}|{id}` so callers treat it as a blob.
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf-8').toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url')
      .toString('utf-8')
      .split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// ─── Tool definition ────────────────────────────────────────────────

export const solicitationListTriageTool = defineTool<Input, Output>({
  name: 'solicitation.list_triage',
  namespace: 'solicitation',
  description:
    'List curated solicitations in the admin triage queue. Filters by status and claim state. Paginates by (created_at, id) via an opaque cursor.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    // Decode cursor (null-safe)
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;

    // Condition params passed as explicit nulls when absent — single
    // template, no sub-fragments, trivially mockable.
    //
    //   status filter:   (sent_status IS NULL OR cs.status = ANY(...))
    //   claimed filter:  three-way via two flags
    //   cursor filter:   (curCreated IS NULL OR (cs.created_at, cs.id) < ...)
    const statusValues = input.status && input.status.length > 0 ? input.status : null;
    const filterMine = input.claimedBy === 'me';
    const filterUnclaimed = input.claimedBy === 'unclaimed';
    const actorId = filterMine ? ctx.actor.id : null;
    const curCreated = cursor?.createdAt ?? null;
    const curId = cursor?.id ?? null;

    const queryLimit = input.limit + 1;

    type Row = {
      solicitationId: string;
      opportunityId: string;
      status: string;
      namespace: string | null;
      claimedBy: string | null;
      claimedAt: Date | null;
      curatedBy: string | null;
      approvedBy: string | null;
      createdAt: Date;
      title: string;
      source: string;
      agency: string | null;
      office: string | null;
      programType: string | null;
      closeDate: Date | null;
      postedDate: Date | null;
    };
    const rows = await sql<Row[]>`
      SELECT
        cs.id AS solicitation_id,
        cs.opportunity_id,
        cs.status,
        cs.namespace,
        cs.claimed_by,
        cs.claimed_at,
        cs.curated_by,
        cs.approved_by,
        cs.created_at,
        o.title,
        o.source,
        o.agency,
        o.office,
        o.program_type,
        o.close_date,
        o.posted_date
      FROM curated_solicitations cs
      JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE
        (${statusValues}::text[] IS NULL OR cs.status = ANY(${statusValues}::text[]))
        AND (NOT ${filterMine} OR cs.claimed_by = ${actorId}::uuid)
        AND (NOT ${filterUnclaimed} OR cs.claimed_by IS NULL)
        AND (${curCreated}::timestamptz IS NULL
             OR (cs.created_at, cs.id) < (${curCreated}::timestamptz, ${curId}::uuid))
      ORDER BY cs.created_at DESC, cs.id DESC
      LIMIT ${queryLimit}
    `;

    const hasMore = rows.length > input.limit;
    const items = (hasMore ? rows.slice(0, input.limit) : rows).map((r) => ({
      solicitationId: r.solicitationId,
      opportunityId: r.opportunityId,
      status: r.status,
      namespace: r.namespace ?? null,
      claimedBy: r.claimedBy ?? null,
      claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
      curatedBy: r.curatedBy ?? null,
      approvedBy: r.approvedBy ?? null,
      createdAt: r.createdAt.toISOString(),
      title: r.title,
      source: r.source,
      agency: r.agency ?? null,
      office: r.office ?? null,
      programType: r.programType ?? null,
      closeDate: r.closeDate ? r.closeDate.toISOString() : null,
      postedDate: r.postedDate ? r.postedDate.toISOString() : null,
    }));

    const nextCursor = hasMore
      ? encodeCursor(
          rows[input.limit - 1].createdAt.toISOString(),
          rows[input.limit - 1].solicitationId,
        )
      : null;

    ctx.log?.info?.({
      msg: 'solicitation.list_triage returned rows',
      count: items.length,
      hasMore,
      filterStatus: statusValues,
      filterClaimedBy: input.claimedBy,
    });

    return { items, nextCursor };
  },
});
