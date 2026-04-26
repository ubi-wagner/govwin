/**
 * library.search_atoms — search the customer's library for relevant
 * reusable content atoms.
 *
 * This is the read-side of the library feedback loop. When drafting a
 * proposal section, the system (or the Librarian agent) searches for
 * approved atoms that can be incorporated into the new draft. Atoms
 * from winning proposals sort first (outcome_score DESC).
 *
 * Filters: category, tags overlap, and ILIKE text search on content.
 * All queries are scoped to ctx.tenantId (never from input).
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { defineTool } from './base';
import { ToolAuthorizationError } from './errors';

// ─── Input schema ──────────────────────────────────────────────────

const InputSchema = z.object({
  tenantId: z.string().uuid(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

type Input = z.infer<typeof InputSchema>;

// ─── Output types ──────────────────────────────────────────────────

interface LibraryAtom {
  id: string;
  content: string;
  category: string;
  subcategory: string | null;
  tags: string[];
  confidence: number;
  outcomeScore: number | null;
  outcome: string | null;
  status: string;
  usageCount: number;
  sourceType: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Output {
  atoms: LibraryAtom[];
  total: number;
}

// ─── Tool definition ───────────────────────────────────────────────

export const librarySearchAtomsTool = defineTool<Input, Output>({
  name: 'library.search_atoms',
  namespace: 'library',
  description:
    'Search the customer library for relevant reusable content atoms. Filters by category, tags, and text query. Returns atoms ordered by outcome_score (winning atoms first).',
  inputSchema: InputSchema,
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new ToolAuthorizationError('tenant context required');

    const categoryFilter = input.category
      ? sql`AND category = ${input.category}`
      : sql``;

    const tagsFilter = input.tags && input.tags.length > 0
      ? sql`AND tags && ${input.tags}::text[]`
      : sql``;

    const queryFilter = input.query
      ? sql`AND content ILIKE ${'%' + input.query + '%'}`
      : sql``;

    const limitVal = input.limit;

    // Main query — approved atoms for this tenant, filtered, sorted
    // by outcome_score DESC (winning atoms first), then by usage_count
    // DESC (frequently used atoms next).
    const rows = await sql<Array<{
      id: string;
      content: string;
      category: string;
      subcategory: string | null;
      tags: string[];
      confidence: number;
      outcomeScore: number | null;
      outcome: string | null;
      status: string;
      usageCount: number;
      sourceType: string | null;
      createdAt: string;
      updatedAt: string;
    }>>`
      SELECT
        id,
        content,
        category,
        subcategory,
        tags,
        confidence,
        outcome_score,
        outcome,
        status,
        usage_count,
        source_type,
        created_at,
        updated_at
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid
        AND status = 'approved'
        ${categoryFilter}
        ${tagsFilter}
        ${queryFilter}
      ORDER BY outcome_score DESC NULLS LAST, usage_count DESC, created_at DESC
      LIMIT ${limitVal}
    `;

    // Count query (same filters, no limit)
    const countRows = await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count
      FROM library_units
      WHERE tenant_id = ${tenantId}::uuid
        AND status = 'approved'
        ${categoryFilter}
        ${tagsFilter}
        ${queryFilter}
    `;

    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const atoms: LibraryAtom[] = rows.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      subcategory: row.subcategory,
      tags: row.tags ?? [],
      confidence: row.confidence,
      outcomeScore: row.outcomeScore,
      outcome: row.outcome,
      status: row.status,
      usageCount: row.usageCount,
      sourceType: row.sourceType,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : String(row.createdAt),
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : String(row.updatedAt),
    }));

    return { atoms, total };
  },
});
