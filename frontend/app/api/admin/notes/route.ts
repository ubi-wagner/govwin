/**
 * POST /api/admin/notes — add a note to the shared board.
 *
 * rfp_admin+ only. The board is platform scope with no RLS (mig 244), so this gate is the whole
 * protection — exactly as it is for `applications` and `contacts`.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { addNote, type AnchorKind } from '@/lib/working-notes';

/** Infer the kind from the shape, so nobody has to choose one: a leading slash is a route, a
 *  path with a dot is a file, anything else is general. Getting this right is what lets the board
 *  check its own anchors for staleness. */
function inferKind(anchor: string | null): AnchorKind {
  if (!anchor) return 'general';
  if (anchor.startsWith('/')) return 'route';
  if (/\.[a-z]{2,4}$/i.test(anchor) && anchor.includes('/')) return 'file';
  return 'entity';
}

export async function POST(request: Request) {
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

    let body: { note?: string; anchor?: string | null; disposition?: string };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) {
      return NextResponse.json({ error: 'note is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (note.length > 4000) {
      return NextResponse.json({ error: 'note is too long (max 4000)', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const anchor = typeof body.anchor === 'string' && body.anchor.trim() ? body.anchor.trim() : null;

    /**
     * An optional DISPOSITION, whitelisted.
     *
     * Notes written from an in-page guide arrive in three kinds and they want different answers:
     * `gap` — the guide is wrong or silent, and the fix is to edit the guide;
     * `defect` — the product is wrong;
     * `friction` — it works and should not be this hard.
     *
     * They are separated because during a first curation week most notes are `gap`, and a single
     * bucket labelled "bug" means the guide never gets fixed and the board stops being read. It
     * rides in `metadata` rather than a column: the board is human-read, this is a hint for
     * triage, and a new column would need a migration to say something the note text already
     * nearly says.
     *
     * Whitelisted, never passed through — an unknown value is dropped, not stored. Attribution
     * stays server-derived, as below.
     */
    const DISPOSITIONS = ['gap', 'defect', 'friction'] as const;
    const disposition = DISPOSITIONS.find((d) => d === body.disposition) ?? null;

    const id = await addNote({
      note, anchor, anchorKind: inferKind(anchor),
      ...(disposition ? { metadata: { disposition } } : {}),
      // A human write is always attributed to the signed-in user, never to a client-supplied
      // value — the board's whole value is that you can trust who said what.
      author: 'human', authorEmail: su.email ?? null, actorId: su.id ?? null,
    });
    if (!id) {
      return NextResponse.json({ error: 'Could not save the note', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { id } }, { status: 201 });
  } catch (err) {
    console.error('[api/admin/notes] error:', err);
    return NextResponse.json({ error: 'Failed to add the note', code: 'DB_ERROR' }, { status: 500 });
  }
}
