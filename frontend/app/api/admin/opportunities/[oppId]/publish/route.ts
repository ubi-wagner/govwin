/**
 * POST /api/admin/opportunities/[oppId]/publish
 *
 * Publish an opportunity card version to the forward-only bridge + fan it out to
 * every subscribed tenant (mig 094). Normally fired automatically on curation push
 * (approved → pushed_to_pipeline); this admin endpoint drives it directly for
 * updates/closes/reopens and for testing.
 *
 * Body: { eventType?: 'published'|'updated'|'closed'|'reopened'|'awarded' }
 * Returns: { data: { event: {version, ...}, tenantsApplied } }
 *
 * NOTE: this segment is named [oppId] to match the sibling
 * app/api/admin/opportunities/[oppId]/lifecycle route — Next.js requires a single
 * slug name per dynamic path position.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isValidUUID } from '@/lib/validation';
import type { Role } from '@/lib/rbac';
import { publishAndFanOut, type BridgeEventType } from '@/lib/opportunity-bridge';

const EVENTS: BridgeEventType[] = ['published', 'updated', 'closed', 'reopened', 'awarded'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ oppId: string }> },
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
    const { oppId } = await params;
    if (!isValidUUID(oppId)) {
      return NextResponse.json({ error: 'Invalid opportunity id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    let body: { eventType?: string } = {};
    try { body = await request.json(); } catch { /* default */ }
    const eventType: BridgeEventType = EVENTS.includes(body.eventType as BridgeEventType) ? (body.eventType as BridgeEventType) : 'updated';

    const result = await publishAndFanOut(oppId, eventType, user.id ?? null, new Date().toISOString());
    if (!result) {
      return NextResponse.json({ error: 'Opportunity not found or snapshot failed', code: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({
      data: { event: { id: result.event.id, version: result.event.version, eventType: result.event.eventType }, tenantsApplied: result.tenantsApplied },
    });
  } catch (err) {
    console.error('[admin/opportunities/publish] error', err);
    return NextResponse.json({ error: 'Publish failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
