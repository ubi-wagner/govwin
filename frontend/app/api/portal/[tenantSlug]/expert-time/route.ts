/**
 * Tenant expert-time surface (Terms §7 calendar).
 *   GET    — { balance, openSlots, bookings } for this tenant
 *   POST   { blockId, note? } — book an open slot, up to the accrued balance
 *   DELETE ?id= — cancel one of this tenant's bookings (reopens a future slot)
 * tenant_user+ with verified access to the tenant (never by id alone).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import {
  getExpertTimeBalance, listOpenSlots, listTenantBookings, bookSlot, cancelBooking,
} from '@/lib/calendar';

async function gate(tenantSlug: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    const [balance, openSlots, bookings] = await Promise.all([
      getExpertTimeBalance(g.tenantId),
      listOpenSlots(),
      listTenantBookings(g.tenantId),
    ]);
    return NextResponse.json({ data: { balance, openSlots, bookings } });
  } catch (e) {
    console.error('[expert-time GET]', e);
    return NextResponse.json({ error: 'Failed to load expert time', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    let body: { blockId?: unknown; note?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const blockId = typeof body.blockId === 'string' ? body.blockId : '';
    const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;
    if (!blockId) return NextResponse.json({ error: 'blockId is required', code: 'BAD_REQUEST' }, { status: 400 });

    const result = await bookSlot({ tenantId: g.tenantId, userId: g.userId, blockId, note });
    if (!result.ok) {
      const status = result.code === 'INSUFFICIENT_BALANCE' ? 409 : result.code === 'SLOT_NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ error: result.message, code: result.code, remaining: result.remaining }, { status });
    }
    // Notify the admin cohort that their expert time was booked (best-effort).
    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'expert_time.booked',
        actor: userActor(g.userId, g.email ?? undefined),
        tenantId: g.tenantId,
        payload: {
          bookingId: result.booking.id, blockId, startAt: result.booking.startAt,
          minutes: result.booking.minutes,
        },
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ data: result.booking }, { status: 201 });
  } catch (e) {
    console.error('[expert-time POST]', e);
    return NextResponse.json({ error: 'Failed to book expert time', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id is required', code: 'BAD_REQUEST' }, { status: 400 });
    const res = await cancelBooking(g.tenantId, id);
    if (!res.ok) return NextResponse.json({ error: 'Booking not found', code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ data: { id, status: 'cancelled' } });
  } catch (e) {
    console.error('[expert-time DELETE]', e);
    return NextResponse.json({ error: 'Failed to cancel booking', code: 'DB_ERROR' }, { status: 500 });
  }
}
