/**
 * Shared admin guard for API route handlers. Returns the acting admin's id/email
 * or a ready-to-return error response. Usage:
 *
 *   const a = await requireAdmin();
 *   if (!a.ok) return a.res;
 *   // a.userId, a.email are available
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

type AdminOk = { ok: true; userId: string; email?: string };
type AdminErr = { ok: false; res: NextResponse };

export async function requireAdmin(): Promise<AdminOk | AdminErr> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return { ok: false, res: NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  return { ok: true, userId, email: (session.user as { email?: string }).email };
}
