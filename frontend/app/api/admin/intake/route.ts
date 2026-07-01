/**
 * POST /api/admin/intake — stage a found/uploaded opportunity NOTICE into the RFP
 * review queue (the head of the RFP river; Scout-shaped). Creates a staged
 * opportunity (is_active=false) + curated_solicitation (status 'new') with intake_meta
 * (POC, source, downloadable?). rfp_admin+. Scout calls the same primitive later.
 *
 * Body: { title, agency, office?, solicitationNumber?, programType?, closeDate?,
 *         postedDate?, description?, namespace?, intakeMeta? }
 * Returns: { data: { opportunityId, solicitationId, status } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { stageIntake, type IntakeInput } from '@/lib/intake';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const user = session.user as { id?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    let body: IntakeInput;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body?.title || !body?.agency) {
      return NextResponse.json({ error: 'title and agency are required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const result = await stageIntake(body, user.id ?? null);
    if ('error' in result) return NextResponse.json({ error: result.error, code: 'DB_ERROR' }, { status: 500 });
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[admin/intake] error', err);
    return NextResponse.json({ error: 'Intake failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
