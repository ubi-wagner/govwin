/**
 * Expert-time calendar (Terms §7) — the "super simple" scheduling primitive.
 *
 * RFP-Pipeline admins post availability blocks (discrete bookable slots); tenants
 * book an open slot up to their ACCRUED balance (15 min/month, computed — no accrual
 * table). Google-Meet auto-creation is deferred; a booking just reserves the slot.
 *
 * SINGLE-LAYER RLS posture: the app runs as the RLS-bypassing owner, so every
 * tenant-scoped query here carries an EXPLICIT `tenant_id` predicate as the belt
 * (withTenant sets app.tenant_id for the future NOBYPASSRLS cutover — suspenders).
 */
import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';

/** Monthly expert-time accrual. Change here if the entitlement changes. */
export const EXPERT_TIME_MINUTES_PER_MONTH = 15;

export interface ExpertTimeBalance {
  minutesPerMonth: number;
  accrued: number;
  booked: number;
  remaining: number;
}
export interface OpenSlot {
  id: string;
  startAt: string;
  endAt: string;
  minutes: number;
  adminUserId: string;
  adminEmail: string | null;
}
export interface AdminBlock {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  minutes: number;
  tenantId: string | null;
  bookedByEmail: string | null;
}
export interface TenantBooking {
  id: string;
  blockId: string;
  startAt: string;
  endAt: string;
  minutes: number;
  status: string;
  note: string | null;
  adminEmail: string | null;
  createdAt: string;
}

export type BookResult =
  | { ok: true; booking: TenantBooking }
  | { ok: false; code: string; message: string; remaining?: number };

// Accrued minutes = 15 * (whole months since the tenant was created, +1 so the
// first month grants immediately). The per-month constant binds as a normal
// parameter; the age() math is literal SQL. Inlined in the two queries that need it.

/** A tenant's current expert-time balance (accrued − booked, floored at 0). */
export async function getExpertTimeBalance(tenantId: string): Promise<ExpertTimeBalance> {
  const [row] = await sql<Array<{ accrued: number; booked: number }>>`
    SELECT
      ${EXPERT_TIME_MINUTES_PER_MONTH} * (
        (EXTRACT(YEAR FROM age(now(), t.created_at)) * 12
         + EXTRACT(MONTH FROM age(now(), t.created_at)))::int + 1
      ) AS accrued,
      COALESCE((
        SELECT SUM(b.minutes)::int FROM expert_time_bookings b
        WHERE b.tenant_id = t.id AND b.status = 'booked'
      ), 0) AS booked
    FROM tenants t WHERE t.id = ${tenantId}::uuid`;
  const accrued = Number(row?.accrued ?? 0);
  const booked = Number(row?.booked ?? 0);
  return {
    minutesPerMonth: EXPERT_TIME_MINUTES_PER_MONTH,
    accrued,
    booked,
    remaining: Math.max(0, accrued - booked),
  };
}

/** Open, future slots any tenant can book (admin-global pool). */
export async function listOpenSlots(limit = 50): Promise<OpenSlot[]> {
  return sql<OpenSlot[]>`
    SELECT b.id,
      b.start_at AS "startAt", b.end_at AS "endAt",
      (EXTRACT(EPOCH FROM (b.end_at - b.start_at))::int / 60) AS minutes,
      b.admin_user_id AS "adminUserId", u.email AS "adminEmail"
    FROM expert_availability_blocks b
    LEFT JOIN users u ON u.id = b.admin_user_id
    WHERE b.status = 'open' AND b.start_at > now()
    ORDER BY b.start_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}`;
}

/** An admin creates one availability slot. Caller validates the window first. */
export async function createAvailabilityBlock(
  adminUserId: string, startAt: string, endAt: string,
): Promise<AdminBlock> {
  const [row] = await sql<Array<Omit<AdminBlock, 'tenantId' | 'bookedByEmail'>>>`
    INSERT INTO expert_availability_blocks (admin_user_id, start_at, end_at)
    VALUES (${adminUserId}::uuid, ${startAt}::timestamptz, ${endAt}::timestamptz)
    RETURNING id, start_at AS "startAt", end_at AS "endAt", status,
      (EXTRACT(EPOCH FROM (end_at - start_at))::int / 60) AS minutes`;
  return { ...row, tenantId: null, bookedByEmail: null };
}

/**
 * All non-cancelled blocks (admin oversight view), with who booked each.
 * NOTE (single-layer RLS): the booked-by join reads expert_time_bookings across
 * tenants — correct under today's owner connection; post-NOBYPASSRLS cutover this
 * admin view must run on a bypass/owner connection (see docs/DEPRECATION_CLEANUP).
 */
export async function listAdminAvailability(): Promise<AdminBlock[]> {
  return sql<AdminBlock[]>`
    SELECT b.id, b.start_at AS "startAt", b.end_at AS "endAt", b.status,
      (EXTRACT(EPOCH FROM (b.end_at - b.start_at))::int / 60) AS minutes,
      bk.tenant_id AS "tenantId", tu.email AS "bookedByEmail"
    FROM expert_availability_blocks b
    LEFT JOIN expert_time_bookings bk ON bk.block_id = b.id AND bk.status = 'booked'
    LEFT JOIN users tu ON tu.id = bk.booked_by_user_id
    WHERE b.status <> 'cancelled' AND b.end_at > now() - interval '1 day'
    ORDER BY b.start_at ASC`;
}

/** An admin cancels one of their OWN, still-open slots. Booked slots can't be
 *  cancelled here (that would strand a tenant) — the tenant cancels the booking. */
export async function cancelAvailabilityBlock(
  blockId: string, adminUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const rows = await sql<Array<{ id: string }>>`
    UPDATE expert_availability_blocks SET status = 'cancelled'
    WHERE id = ${blockId}::uuid AND admin_user_id = ${adminUserId}::uuid AND status = 'open'
    RETURNING id`;
  return rows.length > 0 ? { ok: true } : { ok: false, reason: 'not_open_or_not_owner' };
}

/** A tenant books an open slot, up to their accrued balance. Transactional:
 *  FOR UPDATE locks the slot, a CAS claims it, and the unique index is the final
 *  cross-tenant race backstop (23505 → SLOT_TAKEN). */
export async function bookSlot(params: {
  tenantId: string; userId: string; blockId: string; note?: string | null;
}): Promise<BookResult> {
  const { tenantId, userId, blockId, note } = params;
  try {
    return await withTenant<BookResult>(tenantId, async (tx) => {
      const [blk] = await tx`
        SELECT id, admin_user_id AS "adminUserId", start_at AS "startAt", end_at AS "endAt", status,
          (EXTRACT(EPOCH FROM (end_at - start_at))::int / 60) AS minutes
        FROM expert_availability_blocks WHERE id = ${blockId}::uuid FOR UPDATE`;
      if (!blk) return { ok: false, code: 'SLOT_NOT_FOUND', message: 'That time slot no longer exists.' };
      if (blk.status !== 'open') return { ok: false, code: 'SLOT_TAKEN', message: 'That time slot is no longer available.' };
      if (new Date(blk.startAt).getTime() <= Date.now()) return { ok: false, code: 'SLOT_PAST', message: 'That time slot has already started.' };

      const minutes = Number(blk.minutes);
      const [bal] = await tx`
        SELECT ${EXPERT_TIME_MINUTES_PER_MONTH} * (
                 (EXTRACT(YEAR FROM age(now(), t.created_at)) * 12
                  + EXTRACT(MONTH FROM age(now(), t.created_at)))::int + 1
               ) AS accrued,
          COALESCE((SELECT SUM(b.minutes)::int FROM expert_time_bookings b
                    WHERE b.tenant_id = ${tenantId}::uuid AND b.status = 'booked'), 0) AS booked
        FROM tenants t WHERE t.id = ${tenantId}::uuid`;
      const remaining = Math.max(0, Number(bal?.accrued ?? 0) - Number(bal?.booked ?? 0));
      if (minutes > remaining) {
        return {
          ok: false, code: 'INSUFFICIENT_BALANCE', remaining,
          message: `This slot needs ${minutes} min, but you have ${remaining} min of expert time remaining.`,
        };
      }

      // Claim the slot (compare-and-swap). 0 rows → someone booked it between the
      // FOR UPDATE and now (shouldn't happen under the lock, but explicit is safe).
      const claimed = await tx`
        UPDATE expert_availability_blocks SET status = 'booked'
        WHERE id = ${blockId}::uuid AND status = 'open' RETURNING id`;
      if (claimed.length === 0) return { ok: false, code: 'SLOT_TAKEN', message: 'That time slot was just taken.' };

      const [booking] = await tx`
        INSERT INTO expert_time_bookings
          (tenant_id, block_id, booked_by_user_id, admin_user_id, start_at, end_at, minutes, note)
        VALUES (${tenantId}::uuid, ${blockId}::uuid, ${userId}::uuid, ${blk.adminUserId}::uuid,
                ${blk.startAt}, ${blk.endAt}, ${minutes}, ${note ?? null})
        RETURNING id, block_id AS "blockId", start_at AS "startAt", end_at AS "endAt",
          minutes, status, note, created_at AS "createdAt"`;
      return { ok: true, booking: { ...booking, adminEmail: null } as TenantBooking };
    });
  } catch (e) {
    // Unique-violation on the partial index (uniq_etb_block_active) = a cross-tenant
    // race claimed the slot first. Surface it as SLOT_TAKEN, not a 500.
    if (e && typeof e === 'object' && (e as { code?: string }).code === '23505') {
      return { ok: false, code: 'SLOT_TAKEN', message: 'That time slot was just taken.' };
    }
    throw e;
  }
}

/** A tenant's active (booked, future-and-recent) bookings. */
export async function listTenantBookings(tenantId: string): Promise<TenantBooking[]> {
  return withTenant<TenantBooking[]>(tenantId, (tx) => tx`
    SELECT bk.id, bk.block_id AS "blockId", bk.start_at AS "startAt", bk.end_at AS "endAt",
      bk.minutes, bk.status, bk.note, u.email AS "adminEmail", bk.created_at AS "createdAt"
    FROM expert_time_bookings bk
    LEFT JOIN users u ON u.id = bk.admin_user_id
    WHERE bk.tenant_id = ${tenantId}::uuid AND bk.status = 'booked'
    ORDER BY bk.start_at ASC`);
}

/** A tenant cancels one of their bookings; a future slot is reopened for others. */
export async function cancelBooking(
  tenantId: string, bookingId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return withTenant(tenantId, async (tx) => {
    const [bk] = await tx`
      SELECT block_id AS "blockId" FROM expert_time_bookings
      WHERE id = ${bookingId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'booked' FOR UPDATE`;
    if (!bk) return { ok: false, reason: 'not_found' };
    await tx`
      UPDATE expert_time_bookings SET status = 'cancelled'
      WHERE id = ${bookingId}::uuid AND tenant_id = ${tenantId}::uuid`;
    // Reopen the slot only if it hasn't started, so another tenant can take it.
    await tx`
      UPDATE expert_availability_blocks SET status = 'open'
      WHERE id = ${bk.blockId}::uuid AND status = 'booked' AND start_at > now()`;
    return { ok: true };
  });
}
