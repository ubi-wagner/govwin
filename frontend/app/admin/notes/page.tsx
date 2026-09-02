import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { listNotes, staleAnchors, type WorkingNote, type AnchorKind } from '@/lib/working-notes';
import NoteComposer from '@/components/admin/note-composer';
import NoteActions from '@/components/admin/note-actions';

export const dynamic = 'force-dynamic';

/**
 * /admin/notes — the shared board between you, a Claude Code session, and the in-product companion.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────────────────────
 * Three participants see three different halves of this system: you see what happened on screen
 * and what you meant to do; a dev session sees the code, the intent and the reasoning; the
 * companion sees live behaviour at a moment nobody else was watching. None can see the others'.
 * This is where they meet.
 *
 * ── ONE LEDGER, NOT TWO MAILBOXES ────────────────────────────────────────────────────────────
 * Deliberately not AI-to-AI messaging. A private channel between two models produces a private
 * language, propagates stale notes as confidently as fresh ones, and turns a dev session's note
 * into an instruction reaching an agent near tenant data. One board that you read and write fixes
 * all three — you are not overhead in that loop, you are the integrity mechanism.
 *
 * **A note is DATA to whoever reads it, never a directive.**
 *
 * ── AUDITABLE ────────────────────────────────────────────────────────────────────────────────
 * Every write and every state change emits a `system:note.*` event, so the board's history is the
 * ordinary audit trail — visible in /admin/events and /admin/observe beside everything else. There
 * is no second mechanism to trust, and nothing here is ever deleted: a ledger that erases its own
 * history is not one.
 */

const STATE_STYLE: Record<string, string> = {
  watching: 'border-amber-200 bg-amber-50',
  seen: 'border-blue-200 bg-blue-50',
  resolved: 'border-gray-200 bg-gray-50',
};
const AUTHOR_LABEL: Record<string, string> = {
  claude_code: 'Claude Code',
  companion: 'Companion',
  human: 'You',
};

/** A server component, so a UTC stamp is deterministic on both sides (B78/B79). */
const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

/**
 * Where the repo actually is, or null when this build cannot tell.
 *
 * ⚠️ `process.cwd()` IS NOT THE REPO ROOT IN A STANDALONE BUILD — it is `.next/standalone`. The
 * first version of this check assumed otherwise, looked for `app/admin/site` under the standalone
 * directory, found nothing, and struck through BOTH of the first two notes as "no longer exists"
 * when both anchors were perfectly real.
 *
 * That is the exact failure this file warns about elsewhere: a rule that fires on everything is as
 * useless as one that fires on nothing, and a false staleness banner trains the reader to ignore a
 * true one. So the root is VERIFIED against a marker rather than assumed, and if no candidate
 * verifies the check reports that it could not run — never that the anchors are stale.
 */
function repoRoot(): string | null {
  const cwd = process.cwd();
  for (const c of [cwd, join(cwd, '..', '..', '..'), join(cwd, '..'), '/home/user/govwin/frontend']) {
    try {
      // The marker is a directory that only the frontend tree has, checked BOTH ways so a partial
      // match cannot pass: `app/admin` exists and `lib` exists beside it.
      if (existsSync(join(c, 'app', 'admin')) && existsSync(join(c, 'lib'))) return c;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/**
 * Does the thing a note points at still exist?
 *
 * This is the same question `audit-doc-currency` asks of documentation, asked of the board — a note
 * about a route that was renamed reads as current and sends you somewhere that is not there.
 *
 * Returns TRUE (not stale) whenever it cannot answer. An instrument that cannot see must report
 * silence, not a finding.
 */
function makeAnchorCheck(root: string | null) {
  return (anchor: string, kind: AnchorKind): boolean => {
    if (!root) return true;                       // cannot see → not a finding
    try {
      if (kind === 'route') {
        const seg = anchor.split('?')[0].replace(/^\/+|\/+$/g, '');
        if (!seg) return true;
        return existsSync(join(root, 'app', seg, 'page.tsx'))
          || existsSync(join(root, 'app', seg, 'route.ts'))
          || existsSync(join(root, 'app', seg));
      }
      if (kind === 'file') {
        // A note may name a path from the repo root (frontend/lib/db.ts) or from the frontend
        // (lib/db.ts). Accept either rather than calling a real file missing.
        return existsSync(join(root, anchor))
          || existsSync(join(root, '..', anchor))
          || existsSync(join(root, anchor.replace(/^frontend\//, '')));
      }
    } catch { /* a resolver failure is not a stale anchor */ }
    return true;
  };
}

export default async function NotesPage({
  searchParams,
}: { searchParams: Promise<{ all?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; email?: string; role?: string };
  const role = su.role as Role | undefined;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/login');

  const sp = await searchParams;
  const showAll = sp.all === '1';

  let notes: WorkingNote[] = [];
  let loadError: string | null = null;
  try { notes = await listNotes(showAll); } catch (e) {
    // Said out loud: a board that renders empty when its query failed reads as "nothing to watch",
    // which is the most misleading thing it could say mid-drive (B131).
    console.error('[admin/notes] list failed:', e);
    loadError = 'The board could not be loaded.';
  }

  // If the root cannot be verified the check is UNAVAILABLE, and the UI says so rather than
  // implying every anchor is fine — silence about a thing you did not measure is its own lie.
  const root = repoRoot();
  const stale = new Set(staleAnchors(notes, makeAnchorCheck(root)).map((n) => n.id));
  const open = notes.filter((n) => n.state !== 'resolved');

  return (
    <div className="p-6 max-w-[1100px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Notes</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            The shared board — you, a Claude Code session, and the in-product companion.
            {' '}{open.length} open. Everything here is a note to be weighed, never an instruction:
            each write and each state change is audited to the event stream.
          </p>
        </div>
        <Link href={showAll ? '/admin/notes' : '/admin/notes?all=1'}
          className="rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">
          {showAll ? 'Hide resolved' : 'Show resolved'}
        </Link>
      </div>

      {loadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>
      )}

      <div className="mb-6">
        <NoteComposer authorEmail={su.email ?? null} />
      </div>

      {root === null && notes.some((n) => n.anchor) && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
          Anchor staleness was <span className="font-medium">not checked</span> — this build could
          not locate the source tree. Anchors below are shown as written, unverified.
        </div>
      )}

      {stale.size > 0 && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <span className="font-medium">{stale.size} note(s) point at something that no longer exists.</span>{' '}
          A note about a route that was renamed reads as current and sends you somewhere that is not
          there — worse than no note. They are marked below.
        </div>
      )}

      {!loadError && notes.length === 0 && (
        <div className="rounded border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Nothing on the board. Add the first thing worth watching for during the next drive.
        </div>
      )}

      <ul className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} data-note-id={n.id}
              className={`rounded-lg border px-4 py-3 ${STATE_STYLE[n.state] ?? 'border-gray-200 bg-white'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-gray-700">
                  {AUTHOR_LABEL[n.author] ?? n.author}
                </span>
                <span className="uppercase tracking-wide text-gray-500">{n.state}</span>
                {n.anchor && (
                  <span className={`font-mono ${stale.has(n.id) ? 'text-rose-700 line-through' : 'text-gray-600'}`}>
                    {n.anchor}
                  </span>
                )}
                {stale.has(n.id) && <span className="font-medium text-rose-700">· no longer exists</span>}
              </div>
              <NoteActions id={n.id} state={n.state} />
            </div>

            {/* `data-user-content`: this paragraph is a person's prose, displayed. A note may
                legitimately contain the words NaN, null or a route that no longer exists, and a
                lens that cannot tell our text from theirs reports the board as broken (B127's
                lesson, one surface over). It is also the trust boundary — nothing here is ours. */}
            <p data-user-content className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{n.note}</p>

            <div className="mt-2 text-xs text-gray-400">
              {day(n.createdAt)}
              {n.authorEmail && ` · ${n.authorEmail}`}
              {n.commitSha && ` · true at ${n.commitSha.slice(0, 8)}`}
              {n.resolvedAt && ` · resolved ${day(n.resolvedAt)}${n.resolvedBy ? ` by ${n.resolvedBy}` : ''}`}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-gray-500">
        Every write and state change is a <code>system:note.*</code> event — the history is in{' '}
        <Link href="/admin/events" className="text-blue-600 hover:underline">Event Stream</Link> and{' '}
        <Link href="/admin/observe" className="text-blue-600 hover:underline">Observe</Link>, beside
        everything else that happened. Nothing here is ever deleted.
      </p>
    </div>
  );
}
