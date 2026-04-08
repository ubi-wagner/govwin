import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const currentPassword = (body as { currentPassword?: unknown })?.currentPassword;
  const newPassword = (body as { newPassword?: unknown })?.newPassword;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }
  if (newPassword.length < 12) {
    return NextResponse.json(
      { error: 'new password must be at least 12 characters' },
      { status: 400 },
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: 'new password must differ from current' },
      { status: 400 },
    );
  }

  try {
    const [row] = await sql<{ passwordHash: string | null }[]>`
      SELECT password_hash FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (!row || !row.passwordHash) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 });
    }
    const ok = await bcrypt.compare(currentPassword, row.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'current password incorrect' }, { status: 401 });
    }
    const newHash = await bcrypt.hash(newPassword, 12);
    await sql`
      UPDATE users
      SET password_hash = ${newHash}, temp_password = false, updated_at = now()
      WHERE id = ${userId}
    `;
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    console.error('[change-password] failed', String(e));
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
