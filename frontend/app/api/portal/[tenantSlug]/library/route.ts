/**
 * GET  /api/portal/[tenantSlug]/library       — List library units (filtered, paginated)
 * POST /api/portal/[tenantSlug]/library       — Bulk operations (approve, archive, delete, set_category, add_tags)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd } from '@/lib/events';

/**
 * Mirror of proposal-harvest's slugify so a context filter can match the
 * slugified tag form the harvester wrote (`agency:department_of_the_air_force`)
 * as well as the raw meta value (`Department of the Air Force`).
 */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
}

/** Escaped ILIKE contains-argument. */
function likeArg(v: string): string {
  return '%' + v.replace(/[%_\\]/g, '\\$&') + '%';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  try {
  const { tenantSlug } = await params;

  // ---------- Auth ----------
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return NextResponse.json(
      { error: 'Invalid session', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return NextResponse.json(
      { error: 'Insufficient permissions', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  // ---------- Tenant lookup + access check ----------
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { error: 'Tenant not found', code: 'NOT_FOUND' },
      { status: 404 },
    );
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  // ---------- Parse query params ----------
  const url = new URL(request.url);

  // ---------- Facets mode: distinct filter vocabularies for the search UI ----------
  // Powers the dropdowns ("by Department", "by author", "by component", …) with the
  // tenant's REAL vocabulary, so search is discovery, not guesswork.
  if (url.searchParams.get('facets') === '1') {
    try {
      const [agencies, programs, components, sectionTypes, authors, tags] = await Promise.all([
        sql<{ value: string; count: number }[]>`
          SELECT meta->'context'->>'agency' AS value, count(*)::int AS count
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid AND meta->'context'->>'agency' IS NOT NULL AND meta->'context'->>'agency' <> ''
          GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 40`,
        sql<{ value: string; count: number }[]>`
          SELECT meta->'context'->>'programType' AS value, count(*)::int AS count
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid AND meta->'context'->>'programType' IS NOT NULL AND meta->'context'->>'programType' <> ''
          GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 40`,
        sql<{ value: string; count: number }[]>`
          SELECT meta->'context'->>'office' AS value, count(*)::int AS count
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid AND meta->'context'->>'office' IS NOT NULL AND meta->'context'->>'office' <> ''
          GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 40`,
        sql<{ value: string; count: number }[]>`
          SELECT COALESCE(meta->>'sectionType', subcategory) AS value, count(*)::int AS count
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid AND COALESCE(meta->>'sectionType', subcategory) IS NOT NULL AND COALESCE(meta->>'sectionType', subcategory) <> ''
          GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 60`,
        sql<{ value: string; count: number }[]>`
          SELECT meta->>'authorName' AS value, count(*)::int AS count
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid AND meta->>'authorName' IS NOT NULL AND meta->>'authorName' <> ''
          GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 40`,
        sql<{ value: string; count: number }[]>`
          SELECT t AS value, count(*)::int AS count
          FROM library_units lu, unnest(lu.tags) AS t
          WHERE lu.tenant_id = ${tenantId}::uuid
            AND t NOT LIKE '%:%'
            AND t NOT IN ('harvested','refined','proposal_final','section_accepted')
          GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 60`,
      ]);
      return NextResponse.json({ data: { facets: { agencies, programs, components, sectionTypes, authors, tags } } });
    } catch (dbErr) {
      console.error('[library/facets] DB query failed', dbErr);
      return NextResponse.json({ error: 'Failed to load facets', code: 'DB_ERROR' }, { status: 500 });
    }
  }

  // ---------- Lineage mode: the full parent→child→grandchild progeny tree ----------
  // Atoms are immutable; each use crystallizes a context-bound CHILD (parent_unit_id).
  // This walks the chain BOTH ways from a unit — ancestry up + descendants down — so
  // the tree of "how this content propagated and was re-added as progeny" is queryable.
  const lineageOf = url.searchParams.get('lineageOf');
  if (lineageOf) {
    if (!isValidUUID(lineageOf)) {
      return NextResponse.json({ error: 'Invalid lineageOf id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    try {
      const nodes = await sql`
        WITH RECURSIVE ancestors AS (
          SELECT lu.*, 0 AS depth, 'self'::text AS rel
          FROM library_units lu
          WHERE lu.id = ${lineageOf}::uuid AND lu.tenant_id = ${tenantId}::uuid
          UNION ALL
          SELECT p.*, a.depth - 1, 'ancestor'::text
          FROM library_units p
          JOIN ancestors a ON a.parent_unit_id = p.id
          WHERE p.tenant_id = ${tenantId}::uuid
        ),
        descendants AS (
          SELECT lu.id, lu.parent_unit_id, 1 AS depth
          FROM library_units lu
          WHERE lu.parent_unit_id = ${lineageOf}::uuid AND lu.tenant_id = ${tenantId}::uuid
          UNION ALL
          SELECT c.id, c.parent_unit_id, d.depth + 1
          FROM library_units c
          JOIN descendants d ON c.parent_unit_id = d.id
          WHERE c.tenant_id = ${tenantId}::uuid
        )
        SELECT a.id, a.parent_unit_id, a.content, a.category, a.subcategory, a.tags, a.meta,
               a.status, a.source_type, a.usage_count, a.outcome, a.outcome_score,
               a.original_proposal_id, a.created_at, a.depth, a.rel
        FROM ancestors a
        UNION ALL
        SELECT d2.id, d2.parent_unit_id, d2.content, d2.category, d2.subcategory, d2.tags, d2.meta,
               d2.status, d2.source_type, d2.usage_count, d2.outcome, d2.outcome_score,
               d2.original_proposal_id, d2.created_at, dd.depth, 'descendant'::text
        FROM descendants dd
        JOIN library_units d2 ON d2.id = dd.id
        ORDER BY depth ASC, created_at ASC
      `;
      return NextResponse.json({ data: { rootId: lineageOf, lineage: nodes } });
    } catch (dbErr) {
      console.error('[library/lineage] DB query failed', dbErr);
      return NextResponse.json({ error: 'Failed to load lineage', code: 'DB_ERROR' }, { status: 500 });
    }
  }

  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const tagsParam = url.searchParams.get('tags');       // ANY — overlap (tags && [...])
  const tagsAllParam = url.searchParams.get('tagsAll');  // ALL — contains (tags @> [...])
  const singleTag = url.searchParams.get('tag');
  const q = url.searchParams.get('q');

  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);
  const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  // Validate status if provided
  if (status && !['draft', 'approved', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: 'Invalid status. Must be one of: draft, approved, archived', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  // ---------- Build and execute query ----------
    // Build dynamic filter fragments. Every dimension ANDs together, so filters
    // compose ("Air Force" + SBIR + past-performance + author:Jane + tag:winning).
    const filters = [sql`lu.tenant_id = ${tenantId}::uuid`];

    if (category) {
      filters.push(sql`lu.category = ${category}`);
    }
    if (status) {
      filters.push(sql`lu.status = ${status}`);
    }

    // ── Tags — an atom accumulates MANY tags across its journey (upload → library →
    // proposal). Support ANY (overlap), ALL (must contain every one), and single. ──
    if (tagsParam) {
      const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) filters.push(sql`lu.tags && ${sql.array(tags)}`);
    }
    if (tagsAllParam) {
      const tags = tagsAllParam.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) filters.push(sql`lu.tags @> ${sql.array(tags)}`);
    }
    if (singleTag) {
      filters.push(sql`${singleTag} = ANY(lu.tags)`);
    }

    // ── Freeform keyword — content + heading + source filename. ──
    if (q) {
      const like = likeArg(q);
      filters.push(sql`(lu.content ILIKE ${like} OR lu.heading_text ILIKE ${like} OR lu.source_filename ILIKE ${like})`);
    }

    // ---------- Source type filter ----------
    const sourceFilter = url.searchParams.get('source');
    if (sourceFilter && ['upload', 'harvest', 'ai', 'manual'].includes(sourceFilter)) {
      filters.push(sql`lu.source_type = ${sourceFilter}`);
    }

    // ---------- Outcome filter ----------
    const outcomeFilter = url.searchParams.get('outcome');
    if (outcomeFilter && ['pending', 'awarded', 'rejected', 'withdrawn'].includes(outcomeFilter)) {
      filters.push(sql`lu.outcome = ${outcomeFilter}`);
    }
    if (url.searchParams.get('winning') === 'true') {
      filters.push(sql`lu.outcome = 'awarded'`);
    }

    // ── Context dimensions (Department / program / component / solicitation / type).
    // Each matches BOTH storage forms: the raw meta value (ILIKE) OR the slugified tag
    // the harvester wrote — so an atom is found however it was captured. ──
    const agency = url.searchParams.get('agency') ?? url.searchParams.get('department');
    if (agency) {
      filters.push(sql`(lu.meta->'context'->>'agency' ILIKE ${likeArg(agency)} OR lu.tags && ${sql.array(['agency:' + slugify(agency)])})`);
    }
    const program = url.searchParams.get('program');
    if (program) {
      filters.push(sql`(lu.meta->'context'->>'programType' ILIKE ${likeArg(program)} OR lu.tags && ${sql.array(['program:' + slugify(program)])})`);
    }
    const component = url.searchParams.get('component') ?? url.searchParams.get('office');
    if (component) {
      filters.push(sql`(lu.meta->'context'->>'office' ILIKE ${likeArg(component)} OR lu.tags && ${sql.array(['org:' + slugify(component)])})`);
    }
    const namespace = url.searchParams.get('namespace') ?? url.searchParams.get('solicitation');
    if (namespace) {
      filters.push(sql`(lu.meta->'context'->>'namespace' ILIKE ${likeArg(namespace)} OR lu.tags && ${sql.array(['sol:' + slugify(namespace)])})`);
    }
    const sectionType = url.searchParams.get('sectionType') ?? url.searchParams.get('type');
    if (sectionType) {
      filters.push(sql`(lu.meta->>'sectionType' ILIKE ${likeArg(sectionType)} OR lu.subcategory = ${sectionType} OR lu.tags && ${sql.array(['type:' + sectionType])})`);
    }
    const subcategory = url.searchParams.get('subcategory') ?? url.searchParams.get('standard');
    if (subcategory) {
      filters.push(sql`lu.subcategory = ${subcategory}`);
    }

    // ── Original author — persisted into meta at harvest/upload, or the collaborator
    // owner_user_id. Accepts a user id (exact) or a name fragment (ILIKE). ──
    const author = url.searchParams.get('author');
    if (author) {
      filters.push(sql`(lu.meta->>'authorUserId' = ${author} OR lu.meta->>'authorName' ILIKE ${likeArg(author)} OR lu.owner_user_id::text = ${author})`);
    }

    // ── Lineage / provenance — walk or filter the parent→child→grandchild tree. ──
    const proposalId = url.searchParams.get('proposalId');
    if (proposalId && isValidUUID(proposalId)) {
      filters.push(sql`lu.original_proposal_id = ${proposalId}::uuid`);
    }
    const parentUnitId = url.searchParams.get('parentUnitId');
    if (parentUnitId && isValidUUID(parentUnitId)) {
      filters.push(sql`lu.parent_unit_id = ${parentUnitId}::uuid`);
    }
    const refined = url.searchParams.get('refined');
    if (refined === 'true') filters.push(sql`lu.parent_unit_id IS NOT NULL`);
    else if (refined === 'false') filters.push(sql`lu.parent_unit_id IS NULL`);
    if (url.searchParams.get('seminal') === 'true') {
      filters.push(sql`lu.is_seminal = true`);
    }

    const filename = url.searchParams.get('filename');
    if (filename) {
      filters.push(sql`lu.source_filename ILIKE ${likeArg(filename)}`);
    }
    const minScoreRaw = url.searchParams.get('minScore');
    if (minScoreRaw != null && minScoreRaw !== '') {
      const minScore = parseFloat(minScoreRaw);
      if (!isNaN(minScore)) filters.push(sql`lu.outcome_score >= ${minScore}`);
    }

    const where = filters.reduce(
      (acc, fragment, i) => (i === 0 ? fragment : sql`${acc} AND ${fragment}`),
    );

    // ---------- Sort ----------
    const sortParam = url.searchParams.get('sort');
    const validSorts = ['outcome_score', 'created_at', 'updated_at', 'usage_count'];
    const sortColumn = sortParam && validSorts.includes(sortParam) ? sortParam : 'outcome_score';

    let total: number;
    let units: Record<string, unknown>[];
    try {
      const [countResult] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM library_units lu WHERE ${where}
      `;
      total = parseInt(countResult.count, 10);

      units = await sql`
        SELECT lu.*,
               p.title AS proposal_title,
               ou.name AS owner_name
        FROM library_units lu
        LEFT JOIN proposals p ON lu.original_proposal_id = p.id
        LEFT JOIN users ou ON ou.id = lu.owner_user_id
        WHERE ${where}
        ORDER BY
          ${sortColumn === 'usage_count' ? sql`lu.usage_count DESC NULLS LAST` :
            sortColumn === 'created_at' ? sql`lu.created_at DESC` :
            sortColumn === 'updated_at' ? sql`lu.updated_at DESC` :
            sql`lu.outcome_score DESC NULLS LAST`},
          lu.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
    } catch (dbErr) {
      console.error('[library/list] DB query failed', dbErr);
      return NextResponse.json(
        { error: 'Failed to query library units', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: { units, total } });
  } catch (err) {
    console.error('[library/list] error', err);
    return NextResponse.json(
      { error: 'Failed to fetch library units', code: 'STORAGE_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  try {
  const { tenantSlug } = await params;

  // ---------- Auth ----------
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return NextResponse.json(
      { error: 'Invalid session', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  // Bulk operations require tenant_admin or above
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    return NextResponse.json(
      { error: 'Insufficient permissions', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  // ---------- Tenant lookup + access check ----------
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { error: 'Tenant not found', code: 'NOT_FOUND' },
      { status: 404 },
    );
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  // ---------- Parse body ----------
  let body: {
    action?: string;
    unitIds?: string[];
    category?: string;
    tags?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const { action, unitIds, category: newCategory, tags: newTags } = body;

  // ---------- Validate ----------
  if (!action || !Array.isArray(unitIds) || unitIds.length === 0 || !unitIds.every((id) => typeof id === 'string' && isValidUUID(id))) {
    return NextResponse.json(
      { error: 'action (string) and unitIds (non-empty array) are required', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const validActions = ['approve', 'archive', 'delete', 'set_category', 'add_tags'];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(', ')}`, code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  if (action === 'set_category' && (!newCategory || typeof newCategory !== 'string')) {
    return NextResponse.json(
      { error: 'category (string) is required for set_category action', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  if (action === 'add_tags' && (!Array.isArray(newTags) || newTags.length === 0)) {
    return NextResponse.json(
      { error: 'tags (non-empty array) is required for add_tags action', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  // ── Start event for bulk library operation ──────────────────────
    const startId = await emitEventStart({
      namespace: 'library',
      type: `unit.${action === 'approve' ? 'approved' : action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : action === 'set_category' ? 'categorized' : 'tagged'}`,
      actor: { type: 'user', id: sessionUser.id },
      tenantId,
      payload: { action, unitCount: unitIds.length },
    });

  // ---------- Execute ----------
    let result: { count: number };

    try {
      switch (action) {
        case 'approve':
          result = await sql`
            UPDATE library_units
            SET status = 'approved', updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'archive':
          result = await sql`
            UPDATE library_units
            SET status = 'archived', updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'delete':
          result = await sql`
            DELETE FROM library_units
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'set_category':
          result = await sql`
            UPDATE library_units
            SET category = ${newCategory!}, updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        case 'add_tags':
          result = await sql`
            UPDATE library_units
            SET tags = tags || ${sql.array(newTags!)}, updated_at = now()
            WHERE id = ANY(${unitIds}::uuid[]) AND tenant_id = ${tenantId}::uuid
          `;
          break;

        default:
          return NextResponse.json(
            { error: 'Unhandled action', code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
      }
    } catch (e) {
      console.error('[library/bulk] query failed:', e);
      await emitEventEnd(startId, { error: { message: String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitEventEnd(startId, {
      result: { correlationId: randomUUID(), action, unitCount: unitIds.length, affected: result.count },
    });

    return NextResponse.json({ data: { updated: result.count } });
  } catch (err) {
    console.error('[library/bulk] error', err);
    return NextResponse.json(
      { error: 'Bulk operation failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
