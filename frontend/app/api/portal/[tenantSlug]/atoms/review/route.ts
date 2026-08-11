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
import { computeLibraryReview, type ReviewAtom } from '@/lib/atom-review';

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

    return NextResponse.json({ data: computeLibraryReview(atoms) });
  } catch (err) {
    console.error('[atoms/review] error', err);
    return NextResponse.json({ error: 'Failed to review the library', code: 'DB_ERROR' }, { status: 500 });
  }
}
