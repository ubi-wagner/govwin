'use client';

/**
 * The claim controls on a ToDo row — "I'm on this", who else already is, and where to resume.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────
 * `tasks.status` allowed 'in_progress' for the life of the table and nothing ever wrote it, so a
 * ToDo was binary: nothing recorded that work had STARTED. The person coming back after an
 * interruption could not tell which of their open items they had already begun, two people could
 * start the same one unsignalled, and there was nowhere to come back TO — so the work restarted.
 *
 * That matters more now, not less: the session bounds (P1/P2) mean people ARE signed out mid-task.
 * A claim is the record that work started; `resumeHref` is what makes returning cheap.
 *
 * ── NO CLOCK DURING RENDER ───────────────────────────────────────────────────────────────────
 * "Claimed 12 minutes ago" would read `Date.now()` while rendering, making the output a function of
 * WHEN it rendered: the server writes one value, the client hydrates a beat later and writes
 * another, React throws #418 and hydration fails for the whole subtree while the route still
 * answers 200. Eight occurrences in this repo. `<TimeAgo>` is null until mounted, so the first
 * paint is deterministic on both sides.
 */
import { useState } from 'react';
import { TimeAgo } from '@/components/ui/time-ago';
import { toast } from '@/lib/toast';

export interface ClaimableTask {
  id: string;
  status: string;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
  resumeHref: string | null;
  /** Whether the VIEWER holds the claim — computed server-side; the client never decides this. */
  claimedByMe: boolean;
}

export function TaskClaim({
  task, apiBase, reload,
}: { task: ClaimableTask; apiBase: string; reload: () => void }) {
  const [busy, setBusy] = useState(false);

  async function act(method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/${task.id}/claim`, { method });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // The refusal NAMES the holder ("Dana is already working on this"), which is the whole
        // value of the feature. A generic failure toast here would make the button look broken
        // rather than telling the reader the one thing they needed to know.
        toast(body?.error || 'Could not update the claim', 'error');
        return;
      }
      toast(method === 'POST' ? 'Marked as yours' : 'Put back in the queue', 'success');
      reload();
    } catch {
      toast('Could not reach the server', 'error');
    } finally {
      setBusy(false);
    }
  }

  const held = task.status === 'in_progress' && !!task.claimedBy;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {held && (
        <span
          className={`rounded-full border px-2 py-0.5 font-medium ${
            task.claimedByMe
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}
        >
          {task.claimedByMe ? 'You started this' : `${task.claimedByName ?? 'Someone'} is on this`}
          {task.claimedAt ? <> · <TimeAgo iso={task.claimedAt} /></> : null}
        </span>
      )}

      {/* The resume link is shown whenever the task HAS one — not only to the claim holder. A
          ToDo that points somewhere should always say where; hiding it behind a claim would make
          the queue harder to use in exchange for nothing. */}
      {task.resumeHref && (
        <a
          href={task.resumeHref}
          className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 hover:bg-indigo-100"
        >
          {task.claimedByMe ? 'Pick up where you left off' : 'Open'}
        </a>
      )}

      {!held && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act('POST')}
          className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? '…' : "I'm on this"}
        </button>
      )}

      {held && task.claimedByMe && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act('DELETE')}
          className="rounded border border-gray-300 px-2 py-0.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? '…' : 'Put back'}
        </button>
      )}
    </div>
  );
}
