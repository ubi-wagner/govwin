/**
 * The working-notes board — one ledger, three writers, and the one place they meet.
 *
 * Design + the argument for it: docs/ADMIN_COMPANION_DESIGN.md and migration 244.
 *
 * ── THE ONE RULE ─────────────────────────────────────────────────────────────────────────────
 * **A note is DATA to whoever reads it, never an instruction.** A note written by a Claude Code
 * session and read by the in-product companion would otherwise be a directive reaching an agent
 * that sits near tenant data — which is the injection surface inverted. The companion may quote a
 * note, weigh it, act on its own judgement; it must never treat one as a command. The human
 * standing on both sides of this board is what makes that safe, and is the reason the board is one
 * shared surface rather than two mailboxes.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────────────────────
 * Platform only, rfp_admin+, no tenant_id (mig 244 says why). Reads go through `sqlBypass` because
 * this is admin-plane and cross-tenant by nature.
 */
import { sqlBypass } from '@/lib/db';
import { emitEventSingle, userActor, systemActor } from '@/lib/events';

/** What a jsonb column can hold. `Record<string, unknown>` is NOT assignable to postgres.js's
 *  JSONValue, and widening it with a cast would hide a genuinely unserialisable value. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type NoteAuthor = 'claude_code' | 'companion' | 'human';
export type NoteState = 'watching' | 'seen' | 'resolved';
export type AnchorKind = 'route' | 'file' | 'entity' | 'general';

export interface WorkingNote {
  id: string;
  note: string;
  anchor: string | null;
  anchorKind: AnchorKind;
  author: NoteAuthor;
  authorEmail: string | null;
  state: NoteState;
  commitSha: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

/** The states a note moves through, in order — used by the UI to offer the next one. */
export const NEXT_STATE: Record<NoteState, NoteState | null> = {
  watching: 'seen',
  seen: 'resolved',
  resolved: null,
};

export interface WriteNote {
  note: string;
  anchor?: string | null;
  anchorKind?: AnchorKind;
  author: NoteAuthor;
  authorEmail?: string | null;
  commitSha?: string | null;
  metadata?: { [key: string]: Json };
  /** For the audit row — who is acting. A human write carries their id; a session write does not. */
  actorId?: string | null;
}

/**
 * Write a note. Returns its id, or null on failure.
 *
 * Never throws: a board is a convenience beside the work, and losing a note must not fail the
 * action that prompted it. The failure is logged rather than swallowed.
 */
export async function addNote(input: WriteNote): Promise<string | null> {
  const note = (input.note ?? '').trim();
  if (!note) return null;
  try {
    const [row] = await sqlBypass<{ id: string }[]>`
      INSERT INTO working_notes (note, anchor, anchor_kind, author, author_email, commit_sha, metadata)
      VALUES (${note}, ${input.anchor?.trim() || null}, ${input.anchorKind ?? (input.anchor ? 'route' : 'general')},
              ${input.author}, ${input.authorEmail ?? null}, ${input.commitSha ?? null},
              ${sqlBypass.json(input.metadata ?? {})})
      RETURNING id`;
    // The audit trail is the ORDINARY event stream, not a second mechanism — so a note's history
    // shows up in /admin/events and /admin/observe beside everything else that happened.
    await emitEventSingle({
      namespace: 'system',
      type: 'note.created',
      actor: input.actorId ? userActor(input.actorId, input.authorEmail ?? undefined) : systemActor(input.author as string),
      tenantId: null,
      payload: { noteId: row?.id, author: input.author, anchor: input.anchor ?? null, state: 'watching' },
    }).catch((e) => console.error('[working-notes] audit emit failed:', e));
    return row?.id ?? null;
  } catch (e) {
    console.error('[working-notes] addNote failed:', e);
    return null;
  }
}

/**
 * Move a note along its lifecycle. Compare-and-swap on the current state, so two people advancing
 * the same note concurrently cannot both win — the second gets `false` and re-reads.
 */
export async function setNoteState(
  id: string, from: NoteState, to: NoteState, actor: { id: string; email: string | null },
): Promise<boolean> {
  try {
    const rows = await sqlBypass<{ id: string }[]>`
      UPDATE working_notes
         SET state = ${to},
             resolved_by = ${to === 'resolved' ? (actor.email ?? actor.id) : null}
       WHERE id = ${id}::uuid AND state = ${from}
      RETURNING id`;
    if (!rows[0]) return false;
    await emitEventSingle({
      namespace: 'system',
      type: to === 'resolved' ? 'note.resolved' : 'note.advanced',
      actor: userActor(actor.id, actor.email ?? undefined),
      tenantId: null,
      payload: { noteId: id, from, to },
    }).catch((e) => console.error('[working-notes] audit emit failed:', e));
    return true;
  } catch (e) {
    console.error('[working-notes] setNoteState failed:', e);
    return false;
  }
}

/** The board: open notes first, newest within each state. Resolved ones are kept — an audited
 *  ledger that deletes its own history is not one. */
export async function listNotes(includeResolved = false, limit = 200): Promise<WorkingNote[]> {
  try {
    return await sqlBypass<WorkingNote[]>`
      SELECT id, note, anchor, anchor_kind, author, author_email, state, commit_sha, metadata,
             created_at, updated_at, resolved_at, resolved_by
        FROM working_notes
       WHERE ${includeResolved ? sqlBypass`TRUE` : sqlBypass`state <> 'resolved'`}
       ORDER BY CASE state WHEN 'watching' THEN 0 WHEN 'seen' THEN 1 ELSE 2 END,
                created_at DESC
       LIMIT ${limit}`;
  } catch (e) {
    console.error('[working-notes] listNotes failed:', e);
    return [];
  }
}

/** Notes about one thing — what a companion asks for when the admin opens a page. */
export async function notesFor(anchor: string): Promise<WorkingNote[]> {
  try {
    return await sqlBypass<WorkingNote[]>`
      SELECT id, note, anchor, anchor_kind, author, author_email, state, commit_sha, metadata,
             created_at, updated_at, resolved_at, resolved_by
        FROM working_notes
       WHERE anchor = ${anchor} AND state <> 'resolved'
       ORDER BY created_at DESC LIMIT 20`;
  } catch (e) {
    console.error('[working-notes] notesFor failed:', e);
    return [];
  }
}

/**
 * Which anchors no longer exist — the staleness check, and the reason anchors are structured.
 *
 * A note about a route that was renamed, or a file that moved, is worse than no note: it reads as
 * current and sends the reader somewhere that is not there. This is the same question
 * `audit-doc-currency` asks of documentation, asked of the board, and it is why an anchor carries
 * a KIND rather than being free text.
 *
 * Takes the resolver rather than doing filesystem work itself, so it stays usable from a server
 * component and testable without a disk.
 */
export function staleAnchors(
  notes: WorkingNote[],
  exists: (anchor: string, kind: AnchorKind) => boolean,
): WorkingNote[] {
  return notes.filter((n) => {
    if (!n.anchor || n.anchorKind === 'general' || n.anchorKind === 'entity') return false;
    return !exists(n.anchor, n.anchorKind);
  });
}
