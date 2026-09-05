/**
 * PATCH /api/admin/notes/[noteId] — move a note along `watching → seen → resolved`.
 *
 * The transition is compare-and-swap on the CURRENT state, so two people advancing the same note
 * concurrently cannot both win: the second gets a 409 and re-reads rather than silently
 * overwriting. Nothing is ever deleted — a ledger that erases its own history is not one.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { setNoteState, type NoteState } from '@/lib/working-notes';

const STATES: NoteState[] = ['watching', 'seen', 'resolved'];
const isState = (v: unknown): v is NoteState => typeof v === 'string' && STATES.includes(v as NoteState);

export async function PATCH(request: Request, { params }: { params: Promise<{ noteId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Not signed in', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: string };
    const role = su.role as Role | undefined;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { noteId } = await params;
    let body: { from?: unknown; to?: unknown };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }
    if (!isState(body.from) || !isState(body.to)) {
      return NextResponse.json({ error: 'from and to must be watching, seen or resolved', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const moved = await setNoteState(noteId, body.from, body.to, { id: su.id ?? '', email: su.email ?? null });
    if (!moved) {
      // Not found, or somebody else moved it first. Both mean "re-read before acting".
      return NextResponse.json(
        { error: 'That note is no longer in the state you saw — someone moved it first.', code: 'STALE_STATE' },
        { status: 409 },
      );
    }
    return NextResponse.json({ data: { id: noteId, state: body.to } });
  } catch (err) {
    console.error('[api/admin/notes PATCH] error:', err);
    return NextResponse.json({ error: 'Failed to update the note', code: 'DB_ERROR' }, { status: 500 });
  }
}
