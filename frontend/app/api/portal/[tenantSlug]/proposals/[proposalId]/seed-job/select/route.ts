import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { requestAgentTask } from '@/lib/agent-client';

export const dynamic = 'force-dynamic';

interface Params { params: Promise<{ tenantSlug: string; proposalId: string }> }

/**
 * POST — admin selects a source proposal to seed from.
 * Body: { seedJobId: string; sourceProposalId: string }
 * Enqueues library_seed_mapper and sets job status to 'mapping'.
 */
export async function POST(req: Request, { params }: Params) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

  const sessionUser = session.user as { id?: string; role?: unknown; tenantId?: string | null };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !['master_admin', 'rfp_admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: { seedJobId?: string; sourceProposalId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
  }
  const { seedJobId, sourceProposalId } = body;
  if (!seedJobId || !sourceProposalId) {
    return NextResponse.json({ error: 'seedJobId and sourceProposalId required', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const tenant = await getTenantBySlug(tenantSlug).catch(() => null);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
  const tenantId = tenant.id as string;

  try {
    // Verify the seed job belongs to this tenant+proposal
    const [job] = await sql<{ id: string }[]>`
      SELECT lsj.id
      FROM library_seed_jobs lsj
      JOIN proposals p ON p.id = lsj.proposal_id
      WHERE lsj.id          = ${seedJobId}::uuid
        AND lsj.proposal_id = ${proposalId}::uuid
        AND lsj.tenant_id   = ${tenantId}::uuid
        AND p.tenant_id     = ${tenantId}::uuid
        AND lsj.status      = 'awaiting_selection'
      LIMIT 1
    `;
    if (!job) {
      return NextResponse.json({ error: 'Seed job not found or not in awaiting_selection status', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Verify the source proposal belongs to this tenant
    const [srcProposal] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM proposals
      WHERE id = ${sourceProposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `;
    if (!srcProposal) {
      return NextResponse.json({ error: 'Source proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Advance the job and enqueue the mapper
    await sql`
      UPDATE library_seed_jobs
      SET source_proposal_id = ${sourceProposalId}::uuid,
          status             = 'mapping',
          updated_at         = now()
      WHERE id = ${seedJobId}::uuid
    `;

    await requestAgentTask({
      tenantId,
      agentRole: 'library_seed_mapper',
      taskType: 'seed_map',
      input: {
        proposal_id: proposalId,
        tenant_id: tenantId,
        seed_job_id: seedJobId,
        source_proposal_id: sourceProposalId,
      },
      proposalId,
    });

    return NextResponse.json({ data: { status: 'mapping', sourceProposalTitle: srcProposal.title } });
  } catch (e) {
    console.error('[seed-job/select/POST]', e);
    return NextResponse.json({ error: 'Server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
