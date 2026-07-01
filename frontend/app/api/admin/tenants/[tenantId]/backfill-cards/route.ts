/**
 * POST /api/admin/tenants/[tenantId]/backfill-cards
 *
 * Replay the whole bridge (latest version of every opportunity, open + closed) into
 * a tenant's pipeline (mig 094) — the new-customer backfill so a freshly-approved
 * tenant lands with the full local pipeline immediately. Idempotent.
 *
 * Returns: { data: { applied } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isValidUUID } from '@/lib/validation';
import type { Role } from '@/lib/rbac';
import { backfillTenant } from '@/lib/opportunity-bridge';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { tenantId } = await params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const applied = await backfillTenant(tenantId);
    return NextResponse.json({ data: { applied } });
  } catch (err) {
    console.error('[admin/tenants/backfill-cards] error', err);
    return NextResponse.json({ error: 'Backfill failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
