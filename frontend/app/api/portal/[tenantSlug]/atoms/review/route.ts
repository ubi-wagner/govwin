/**
 * GET /api/portal/[tenantSlug]/atoms/review
 *
 * The "Library Review" — a deterministic librarian that flags DUPLICATES + low-QUALITY atoms
 * so a tenant can de-bloat + quality-gate their library in one place. Computes over the
 * tenant's active atoms (see lib/atom-review.ts). Read-only; the one-click cleanup actions
 * reuse the existing (audited) archive route. Returns { data: LibraryReview }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { computeLibraryReview, parseLibrarianCatalog, type ReviewAtom, type LibrarianLayer } from '@/lib/atom-review';

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point

    // NOTE: lib/db.ts applies a global `postgres.toCamel` column transform, so rows come back
    // camelCased (created_at → createdAt, word_count → wordCount, the AS aliases likewise).
    // Read camelCase here — snake_case access silently yields undefined (a lurking bug tsc can't
    // catch through the manual `sql<typeof rows>` assertion).
    let rows: Array<{
      id: string; title: string | null; content: string | null; wordCount: number | null;
      status: string; grain: string; createdAt: Date | string | null; tagCount: number; confirmedTagCount: number;
    }>;
    try {
      rows = await sql<typeof rows>`
        SELECT a.id, a.title, a.content, a.word_count, a.status, a.grain, a.created_at,
               COUNT(t.atom_id)::int AS tag_count,
               COUNT(t.atom_id) FILTER (WHERE t.confirmed)::int AS confirmed_tag_count
        FROM library_atoms a
        LEFT JOIN atom_tags t ON t.atom_id = a.id
        WHERE a.tenant_id = ${tenantId}::uuid
          AND a.archived_at IS NULL
          AND a.vault_id IS NULL
        GROUP BY a.id
        ORDER BY a.created_at DESC
        LIMIT 800
      `;
    } catch (e) {
      console.error('[atoms/review] query failed', e);
      return NextResponse.json({ error: 'Failed to load the library', code: 'DB_ERROR' }, { status: 500 });
    }

    const toIso = (v: Date | string | null): string => {
      const d = v instanceof Date ? v : new Date(v ?? NaN);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    };
    const atoms: ReviewAtom[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content ?? '',
      wordCount: r.wordCount ?? 0,
      status: r.status,
      grain: r.grain,
      tagCount: r.tagCount ?? 0,
      confirmedTagCount: r.confirmedTagCount ?? 0,
      createdAt: toIso(r.createdAt),
    }));

    // Layer the pipeline librarian's richer AI catalog on top, if a result has been persisted.
    // The catalog JSON lands as a raw string in agent_task_results.output.result.text; we parse +
    // VALIDATE every atom_id against the real atoms above (in atom-review) before surfacing it.
    // Advisory + read-only here; non-fatal (the deterministic review stands on its own).
    let librarian: LibrarianLayer | null = null;
    try {
      const lrRows = await sql<Array<{ output: unknown; createdAt: Date | string | null }>>`
        SELECT r.output, r.created_at
        FROM agent_task_results r
        JOIN agent_task_queue q ON q.id = r.task_id
        WHERE q.tenant_id = ${tenantId}::uuid
          AND q.agent_role = 'librarian' AND q.task_type = 'catalog' AND q.status = 'completed'
        ORDER BY r.created_at DESC
        LIMIT 1
      `;
      const lr = lrRows[0];
      if (lr?.output) {
        const out = lr.output as { result?: { text?: unknown } };
        const rawText = typeof out?.result?.text === 'string' ? out.result.text : null;
        const validAtoms = new Map(rows.map((r) => [r.id, r.title] as [string, string | null]));
        librarian = parseLibrarianCatalog(rawText, validAtoms, toIso(lr.createdAt));
      }
    } catch (e) {
      console.error('[atoms/review] librarian layer failed (non-fatal)', e);
    }

    return NextResponse.json({ data: { ...computeLibraryReview(atoms), librarian } });
  } catch (err) {
    console.error('[atoms/review] error', err);
    return NextResponse.json({ error: 'Failed to review the library', code: 'DB_ERROR' }, { status: 500 });
  }
}
