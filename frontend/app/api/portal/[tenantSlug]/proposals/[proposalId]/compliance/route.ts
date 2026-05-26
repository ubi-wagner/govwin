import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { getObjectBuffer } from '@/lib/storage/s3-client';
import { customerProposalPath } from '@/lib/storage/paths';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/compliance
 *
 * Returns the frozen compliance.json snapshot from the proposal's S3 folder.
 * This snapshot is created during proposal provisioning.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Verify proposal belongs to tenant
    const [proposal] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Read compliance.json from S3
    const key = customerProposalPath(tenantSlug, proposalId, 'compliance.json');
    let compliance: unknown = null;

    try {
      const buffer = await getObjectBuffer(key);
      if (buffer) {
        compliance = JSON.parse(buffer.toString('utf-8'));
      }
    } catch (s3Err) {
      console.error('[api/portal/proposals/compliance] S3 read error:', s3Err);
    }

    if (!compliance) {
      // Fall back to DB compliance matrix if S3 snapshot doesn't exist
      try {
        const matrix = await sql<{
          id: string;
          requirementText: string;
          status: string;
          notes: string | null;
          sectionId: string | null;
        }[]>`
          SELECT id, requirement_text, status, notes, section_id
          FROM proposal_compliance_matrix
          WHERE proposal_id = ${proposalId}::uuid
          ORDER BY requirement_text ASC
        `;
        compliance = { items: matrix, source: 'database' };
      } catch (dbErr) {
        console.error('[api/portal/proposals/compliance] DB fallback error:', dbErr);
        compliance = { items: [], source: 'empty' };
      }
    }

    return NextResponse.json({ data: compliance });
  } catch (e) {
    console.error('[api/portal/proposals/compliance] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
