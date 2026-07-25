import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

interface Params { params: Promise<{ tenantSlug: string; proposalId: string }> }

/**
 * POST — save admin per-section atom decisions (reuse / regen / skip overrides).
 * Body: { seedJobId: string; decisions: Record<sectionId, Record<atomId, 'reuse'|'regen'|'skip'>> }
 */
export async function POST(req: Request, { params }: Params) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

  const sessionUser = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !['master_admin', 'rfp_admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: { seedJobId?: string; decisions?: Record<string, Record<string, string>> };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
  }
  const { seedJobId, decisions } = body;
  if (!seedJobId || !decisions) {
    return NextResponse.json({ error: 'seedJobId and decisions required', code: 'BAD_REQUEST' }, { status: 400 });
  }

  // Validate decision values
  const VALID = new Set(['reuse', 'regen', 'skip']);
  for (const [, atomMap] of Object.entries(decisions)) {
    for (const [, action] of Object.entries(atomMap)) {
      if (!VALID.has(action)) {
        return NextResponse.json({ error: `Invalid action "${action}"`, code: 'BAD_REQUEST' }, { status: 400 });
      }
    }
  }

  const tenant = await getTenantBySlug(tenantSlug).catch(() => null);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
  const tenantId = tenant.id as string;

  enterTenant(tenantId);

  try {
    const [job] = await sql<{ id: string }[]>`
      SELECT lsj.id
      FROM library_seed_jobs lsj
      JOIN proposals p ON p.id = lsj.proposal_id
      WHERE lsj.id          = ${seedJobId}::uuid
        AND lsj.proposal_id = ${proposalId}::uuid
        AND lsj.tenant_id   = ${tenantId}::uuid
        AND lsj.status      = 'awaiting_review'
      LIMIT 1
    `;
    if (!job) {
      return NextResponse.json({ error: 'Job not found or not in awaiting_review status', code: 'NOT_FOUND' }, { status: 404 });
    }

    await sql`
      UPDATE library_seed_jobs
      SET section_decisions = ${sql.json(decisions as Parameters<typeof sql.json>[0])},
          updated_at        = now()
      WHERE id = ${seedJobId}::uuid
    `;

    return NextResponse.json({ data: { saved: true } });
  } catch (e) {
    console.error('[seed-job/decide/POST]', e);
    return NextResponse.json({ error: 'Server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
