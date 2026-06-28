/**
 * GET  /api/admin/section-standards — list the section-standards taxonomy
 * POST /api/admin/section-standards — add a standard (RFP admin)
 *
 * The discrete, hierarchical set of standard section / sub-section headers
 * (Team→Bio, Technical→Overview, …) that new proposals tag against (C1).
 * Auth: rfp_admin or above (RFP admins curate the standards list).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

const KEY_RE = /^[a-z0-9]+(\.[a-z0-9_]+)*$/;

async function requireRfpAdmin(): Promise<
  | { ok: true; userId: string; email?: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id || !hasRoleAtLeast(role, 'rfp_admin')) {
    return { ok: false, res: NextResponse.json({ error: 'RFP admin access required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true, userId: u.id, email: u.email };
}

interface StandardRow {
  id: string;
  key: string;
  label: string;
  parentKey: string | null;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function GET() {
  const adm = await requireRfpAdmin();
  if (!adm.ok) return adm.res;

  try {
    const rows = await sql<StandardRow[]>`
      SELECT id, key, label, parent_key, category, sort_order, is_active
      FROM section_standards
      ORDER BY sort_order ASC, key ASC
    `;
    return NextResponse.json({ data: { standards: rows } });
  } catch (e) {
    console.error('[admin/section-standards] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load standards', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const adm = await requireRfpAdmin();
  if (!adm.ok) return adm.res;

  let body: { key?: unknown; label?: unknown; parentKey?: unknown; category?: unknown; sortOrder?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
  }

  const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: 'key must be a dotted slug (e.g. team.bio)', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  if (!label) {
    return NextResponse.json({ error: 'label is required', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  const parentKey = typeof body.parentKey === 'string' && body.parentKey.trim() ? body.parentKey.trim().toLowerCase() : null;
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
  const sortOrder = typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder) ? Math.trunc(body.sortOrder) : 0;

  try {
    const [row] = await sql<StandardRow[]>`
      INSERT INTO section_standards (key, label, parent_key, category, sort_order, created_by)
      VALUES (${key}, ${label}, ${parentKey}, ${category}, ${sortOrder}, ${adm.userId}::uuid)
      ON CONFLICT (key) DO NOTHING
      RETURNING id, key, label, parent_key, category, sort_order, is_active
    `;
    if (!row) {
      return NextResponse.json({ error: 'A standard with that key already exists', code: 'CONFLICT' }, { status: 409 });
    }
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'section_standard.created',
        actor: userActor(adm.userId, adm.email),
        tenantId: null,
        payload: { key, label, parentKey, category },
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ data: { standard: row } }, { status: 201 });
  } catch (e) {
    console.error('[admin/section-standards] POST failed:', e);
    return NextResponse.json({ error: 'Failed to create standard', code: 'DB_ERROR' }, { status: 500 });
  }
}
