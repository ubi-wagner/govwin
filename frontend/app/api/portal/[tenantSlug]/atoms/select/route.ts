/**
 * GET /api/portal/[tenantSlug]/atoms/select — the scored selector for a section mold.
 *   ?vol=key_personnel&kinds=bio,narrative&context=army,sbir,autonomy&limit=8
 *
 * Ranks the tenant's atoms for a section by tag overlap (pre-vector): scope by vol/kind,
 * boost by shared opportunity context (agency/program/phase/tech), tie-break by
 * outcome/usage/recency. Feeds the AI drafter's <library_atoms> and the admin picker.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { selectForSection, viewerFromRole } from '@/lib/atoms';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown; email?: string };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'partner_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    const url = new URL(request.url);
    const csv = (k: string) => (url.searchParams.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    // Sanitize limit: a non-numeric/negative value must not reach `LIMIT` as NaN (→ 500).
    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, Math.floor(rawLimit)) : undefined;
    const atoms = await selectForSection(tenantId, {
      vol: url.searchParams.get('vol') ?? null,
      kinds: csv('kinds'),
      context: csv('context'),
      limit,
    }, viewerFromRole(u.id, role));

    // Record the selection onto the section (meta.sourceAtomIds) so the atom return
    // at lock can set lineage to these source atoms. Best-effort. Gate the WRITE at
    // tenant_user (matches the POST twin) — an external partner_user can read ranked
    // candidates but must not stamp sourceAtomIds onto a section.
    const sectionId = url.searchParams.get('sectionId');
    if (sectionId && isValidUUID(sectionId) && atoms.length > 0 && hasRoleAtLeast(role, 'tenant_user')) {
      try {
        await withTenant(tenantId, async (tx) =>
          tx`UPDATE proposal_sections
             SET meta = coalesce(meta, '{}'::jsonb) || ${tx.json({ sourceAtomIds: atoms.map((a) => a.id) })}
             WHERE id = ${sectionId}::uuid
               AND proposal_id IN (SELECT id FROM proposals WHERE tenant_id = ${tenantId}::uuid)`,
        );
      } catch (e) {
        console.error('[portal/atoms/select] source-atom record failed (non-fatal)', e);
      }
    }
    return NextResponse.json({ data: { atoms } });
  } catch (err) {
    console.error('[portal/atoms/select] error', err);
    return NextResponse.json({ error: 'Select failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

/**
 * POST /api/portal/[tenantSlug]/atoms/select  { sectionId, atomIds }
 *
 * Record the EXACT atoms a user hand-picked to ground a section (the manual
 * counterpart to the GET's ranked auto-record), unioned with any already set, so
 * the atom return at lock sets derived_from lineage to precisely those atoms.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown; email?: string };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    let body: { sectionId?: string; atomIds?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const sectionId = body.sectionId;
    if (!sectionId || !isValidUUID(sectionId)) return NextResponse.json({ error: 'valid sectionId required', code: 'VALIDATION_ERROR' }, { status: 400 });
    const ids = Array.isArray(body.atomIds) ? body.atomIds.filter((x): x is string => typeof x === 'string' && isValidUUID(x)) : [];

    let found = false;
    let recorded = 0;
    await withTenant(tenantId, async (tx) => {
      const [row] = await tx<Array<{ ids: unknown }>>`
        SELECT coalesce(meta->'sourceAtomIds', '[]'::jsonb) AS ids FROM proposal_sections
        WHERE id = ${sectionId}::uuid AND proposal_id IN (SELECT id FROM proposals WHERE tenant_id = ${tenantId}::uuid)`;
      if (!row) return; // section missing or not in this tenant → 404 below
      found = true;
      // Only record atomIds that belong to THIS tenant's library, so a supplied id
      // can't create cross-tenant lineage / usage bumps when the section is locked.
      const owned = ids.length
        ? (await tx<Array<{ id: string }>>`SELECT id FROM library_atoms WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[]) AND vault_id IS NULL`).map((r: { id: string }) => r.id)
        : [];
      const existing = Array.isArray(row.ids) ? (row.ids as string[]) : [];
      const union = Array.from(new Set([...existing, ...owned]));
      await tx`UPDATE proposal_sections SET meta = coalesce(meta, '{}'::jsonb) || ${tx.json({ sourceAtomIds: union })}
               WHERE id = ${sectionId}::uuid AND proposal_id IN (SELECT id FROM proposals WHERE tenant_id = ${tenantId}::uuid)`;
      recorded = owned.length;
    });
    if (!found) return NextResponse.json({ error: 'Section not found', code: 'NOT_FOUND' }, { status: 404 });
    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'section.atoms_selected',
        actor: userActor(u.id!, u.email ?? undefined),
        tenantId,
        payload: { sectionId, recorded },
      });
    } catch (evtErr) {
      console.error('[atoms/select] section.atoms_selected emit failed (non-fatal)', evtErr);
    }
    return NextResponse.json({ data: { recorded } });
  } catch (err) {
    console.error('[portal/atoms/select] POST error', err);
    return NextResponse.json({ error: 'Record failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
