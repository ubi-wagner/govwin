/**
 * POST /api/portal/[tenantSlug]/atoms/bulk — bulk-curate atoms in one transaction.
 *
 * Body { atomIds: string[], status?: 'draft'|'approved'|'archived', addTag?: { dimension, value } }
 *   - status:  set the same status on every listed atom (bulk approve / archive).
 *   - addTag:  confirm one taxonomy tag on every listed atom (bulk tag).
 * At least one of status/addTag is required. Only atoms that belong to the tenant
 * are touched (ids are filtered against library_atoms in-tenant first), so a
 * spoofed id list can never mutate another tenant's rows. tenant_user+.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, userActor } from '@/lib/events';

const MAX_IDS = 500;
const STATUSES = ['draft', 'approved', 'archived'] as const;
const TAG_DIMENSIONS = ['agency', 'program', 'phase', 'tech', 'dept', 'kind', 'vol'];

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;

    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    let body: { atomIds?: unknown; status?: unknown; addTag?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    // ── validate atomIds ──
    const rawIds = Array.isArray(body.atomIds) ? body.atomIds : [];
    const atomIds = [...new Set(rawIds.filter((x): x is string => typeof x === 'string' && isValidUUID(x)))];
    if (atomIds.length === 0) return NextResponse.json({ error: 'atomIds is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    if (atomIds.length > MAX_IDS) return NextResponse.json({ error: `Too many atoms (max ${MAX_IDS})`, code: 'VALIDATION_ERROR' }, { status: 400 });

    // ── validate the requested mutations ──
    const status = typeof body.status === 'string' && STATUSES.includes(body.status as (typeof STATUSES)[number]) ? body.status : null;
    let addTag: { dimension: string; value: string } | null = null;
    if (body.addTag && typeof body.addTag === 'object') {
      const t = body.addTag as { dimension?: unknown; value?: unknown };
      const dimension = typeof t.dimension === 'string' ? t.dimension.trim() : '';
      const value = typeof t.value === 'string' ? t.value.trim() : '';
      if (dimension && value) {
        if (!TAG_DIMENSIONS.includes(dimension)) return NextResponse.json({ error: `Unknown tag dimension (allowed: ${TAG_DIMENSIONS.join(', ')})`, code: 'VALIDATION_ERROR' }, { status: 400 });
        if (value.length > 120) return NextResponse.json({ error: 'Tag value too long', code: 'VALIDATION_ERROR' }, { status: 400 });
        addTag = { dimension, value };
      }
    }
    if (!status && !addTag) return NextResponse.json({ error: 'Provide status and/or addTag', code: 'VALIDATION_ERROR' }, { status: 400 });

    // ── apply in one tenant-scoped transaction; only in-tenant ids are touched ──
    const result = await withTenant(tenantId, async (tx) => {
      const valid = await tx<Array<{ id: string }>>`
        SELECT id FROM library_atoms WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${atomIds}::uuid[])`;
      const validIds = valid.map((r: { id: string }) => r.id);
      if (validIds.length === 0) return { statusUpdated: 0, tagged: 0 };

      let statusUpdated = 0;
      if (status) {
        const rows = await tx<Array<{ id: string }>>`
          UPDATE library_atoms SET status = ${status}
          WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${validIds}::uuid[])
          RETURNING id`;
        statusUpdated = rows.length;
      }

      let tagged = 0;
      if (addTag) {
        const rows = await tx<Array<{ atom_id: string }>>`
          INSERT INTO atom_tags (atom_id, dimension, value, is_other, tag_source, confirmed, confirmed_by, confirmed_at)
          SELECT unnest(${validIds}::uuid[]), ${addTag.dimension}, ${addTag.value}, false, 'admin', true, ${u.id}::uuid, now()
          ON CONFLICT (atom_id, dimension, value) DO UPDATE SET
            confirmed = true, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()
          RETURNING atom_id`;
        tagged = rows.length;
      }
      return { statusUpdated, tagged };
    });

    // Best-effort audit of the bulk curation action.
    await emitEventSingle({
      namespace: 'library',
      type: 'atoms.bulk_curated',
      actor: userActor(u.id, u.email),
      tenantId,
      payload: { count: atomIds.length, status, addTag, ...result },
    }).catch(() => {});

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[portal/atoms/bulk] POST error', err);
    return NextResponse.json({ error: 'Bulk update failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
