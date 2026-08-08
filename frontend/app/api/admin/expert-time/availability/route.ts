/**
 * RFP-Pipeline admin expert-time availability (Terms §7 calendar).
 *   GET    — list non-cancelled upcoming slots (+ who booked each)
 *   POST   { startAt, endAt } — post one availability slot
 *   DELETE ?id= — cancel one of your own OPEN slots
 * rfp_admin+ only (requireAdmin). Availability is an admin-global pool.
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  listAdminAvailability, createAvailabilityBlock, cancelAvailabilityBlock,
} from '@/lib/calendar';
import { emitEventSingle, userActor } from '@/lib/events';

const MAX_SLOT_MINUTES = 480; // an 8h ceiling guards against fat-finger windows

export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  try {
    const blocks = await listAdminAvailability();
    return NextResponse.json({ data: blocks });
  } catch (e) {
    console.error('[expert-time/availability GET]', e);
    return NextResponse.json({ error: 'Failed to load availability', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  try {
    let body: { startAt?: unknown; endAt?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const startAt = typeof body.startAt === 'string' ? body.startAt : '';
    const endAt = typeof body.endAt === 'string' ? body.endAt : '';
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (!startAt || !endAt || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'startAt and endAt must be valid ISO timestamps', code: 'BAD_REQUEST' }, { status: 400 });
    }
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: 'endAt must be after startAt', code: 'BAD_REQUEST' }, { status: 400 });
    }
    if (start.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'startAt must be in the future', code: 'BAD_REQUEST' }, { status: 400 });
    }
    if ((end.getTime() - start.getTime()) / 60000 > MAX_SLOT_MINUTES) {
      return NextResponse.json({ error: `A slot cannot exceed ${MAX_SLOT_MINUTES} minutes`, code: 'BAD_REQUEST' }, { status: 400 });
    }
    const block = await createAvailabilityBlock(a.userId, start.toISOString(), end.toISOString());
    // Audit: an admin opened a bookable expert-time slot (admin-global pool → tenantId null).
    // Best-effort post-write — the slot is committed, so an audit-emit throw must not 500 it.
    try {
      await emitEventSingle({
        namespace: 'finder', type: 'expert_time.availability_opened',
        actor: userActor(a.userId, a.email), tenantId: null,
        payload: { blockId: (block as { id?: string })?.id ?? null, startAt: start.toISOString(), endAt: end.toISOString() },
      });
    } catch (evErr) { console.error('[expert-time/availability POST] audit emit failed', evErr); }
    return NextResponse.json({ data: block }, { status: 201 });
  } catch (e) {
    console.error('[expert-time/availability POST]', e);
    return NextResponse.json({ error: 'Failed to create slot', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  try {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id is required', code: 'BAD_REQUEST' }, { status: 400 });
    const res = await cancelAvailabilityBlock(id, a.userId);
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Slot is not open or not yours to cancel', code: 'CONFLICT' }, { status: 409 },
      );
    }
    // Audit: an admin cancelled one of their open expert-time slots (best-effort post-write).
    try {
      await emitEventSingle({
        namespace: 'finder', type: 'expert_time.availability_cancelled',
        actor: userActor(a.userId, a.email), tenantId: null,
        payload: { blockId: id },
      });
    } catch (evErr) { console.error('[expert-time/availability DELETE] audit emit failed', evErr); }
    return NextResponse.json({ data: { id, status: 'cancelled' } });
  } catch (e) {
    console.error('[expert-time/availability DELETE]', e);
    return NextResponse.json({ error: 'Failed to cancel slot', code: 'DB_ERROR' }, { status: 500 });
  }
}
