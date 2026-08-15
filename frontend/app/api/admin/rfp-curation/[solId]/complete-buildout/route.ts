/**
 * POST /api/admin/rfp-curation/[solId]/complete-buildout
 *
 * Mark a master OPP fully built out (mig 182) and broadcast the completion to every tenant's mirror
 * card (PV-2, docs/PROVISIONING_WORKSPACE_DESIGN.md). rfp_admin/master_admin only.
 *
 * Owner decision — ADVISORY + confirm: if the build is below the readiness bar (compliance + >=1 volume
 * + >=1 required item) and the caller did NOT pass { confirm: true }, this returns 409 NOT_READY with the
 * readiness so the UI can prompt "complete anyway". With confirm (or when ready), it runs completeBuildOut.
 *
 * This is the STANDALONE completion (build once on the master, any time in advance — no portal). The
 * provisioning cockpit's "Complete & Release" (PV-3) calls the same completeBuildOut, then provisions the
 * purchaser's portal on top.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { completeBuildOut } from '@/lib/provisioning/complete';
import { getBuildReadiness } from '@/lib/provisioning/readiness';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ solId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const user = session.user as { id?: string; email?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { solId } = await params;
    if (!UUID_RE.test(solId)) return NextResponse.json({ error: 'Invalid solicitation ID', code: 'VALIDATION_ERROR' }, { status: 400 });

    let body: { confirm?: unknown } = {};
    try { body = await request.json(); } catch { /* body optional */ }

    // Advisory + confirm: below the bar and not confirmed → return the readiness so the UI can prompt.
    const readiness = await getBuildReadiness(solId);
    if (!readiness.ready && body.confirm !== true) {
      return NextResponse.json({ error: 'Build-out is below the readiness bar', code: 'NOT_READY', data: { readiness } }, { status: 409 });
    }

    const result = await completeBuildOut(solId, { id: user.id ?? '', email: user.email });
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[rfp-curation/complete-buildout] error', err);
    return NextResponse.json({ error: 'Failed to complete build-out', code: 'DB_ERROR' }, { status: 500 });
  }
}
