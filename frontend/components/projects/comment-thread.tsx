'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { TimeAgo } from '@/components/ui/time-ago';

/**
 * The comment thread on one thing — the project, a milestone, a task, a deliverable.
 *
 * ── WHY IT RENDERS COLLAPSED ─────────────────────────────────────────────────────────────────
 * A project workspace already carries a plan, a checklist and a deliverable list. Threads expanded
 * by default would bury all three under conversation, so the anchor shows a count and opens on
 * click — and an UNRESOLVED count is styled differently from a resolved one, because "3 comments"
 * and "3 open questions" are not the same news.
 *
 * ── THE MENTION FEEDBACK IS THE POINT ────────────────────────────────────────────────────────
 * After posting, the server says who was actually notified and which `@tokens` matched nobody. It
 * is shown. The silent failure this feature otherwise has is an author typing a name, seeing the
 * comment appear, and believing they were heard — the reply never comes and nobody knows why.
 */
export interface ThreadComment {
  id: string;
  entityType: string;
  entityId: string | null;
  parentId: string | null;
  body: string;
  authorUserId: string;
  authorEmail: string | null;
  authorName: string | null;
  mentions: string[];
  resolvedAt: string | null;
  editedAt: string | null;
  createdAt: string | null;
}

/** Highlight `@address` so a mention reads as one rather than as an address someone pasted. */
function withMentions(text: string) {
  const parts = text.split(/(^|[\s(\[<])(@[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g);
  return parts.map((part, i) =>
    part.startsWith('@')
      // `break-all` on the chip only: a mention is one long unbreakable token, and a token wider
      // than the viewport is the classic way a body forces the page sideways.
      ? <span key={i} className="break-all rounded bg-blue-50 px-1 font-medium text-blue-800">{part}</span>
      : <span key={i}>{part}</span>);
}

export function CommentThread({
  entityType, entityId, comments, basePath, label,
}: {
  entityType: 'project' | 'milestone' | 'task' | 'deliverable';
  entityId: string | null;
  comments: ThreadComment[];
  basePath: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ notified: string[]; unmatched: string[] } | null>(null);

  const roots = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);
  const openCount = roots.filter((c) => !c.resolvedAt).length;

  async function post() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId, parentId: replyTo, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not post the comment', 'error'); return; }
      setDraft('');
      setReplyTo(null);
      setFeedback({ notified: json?.data?.notified ?? [], unmatched: json?.data?.unmatched ?? [] });
      router.refresh();
    } catch {
      toast('Could not post the comment', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setResolved(id: string, resolved: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: resolved ? 'resolve' : 'reopen' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not update the comment', 'error'); return; }
      toast(resolved ? 'Thread resolved' : 'Thread reopened', 'success');
      router.refresh();
    } catch {
      toast('Could not update the comment', 'error');
    } finally {
      setBusy(false);
    }
  }

  const who = (c: ThreadComment) => c.authorName || c.authorEmail || 'Someone';

  const line = (c: ThreadComment, isReply: boolean) => (
    <li key={c.id} className={isReply ? 'ml-5 border-l border-gray-200 pl-3' : ''}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span title={who(c)} className="max-w-[13rem] truncate text-xs font-medium text-gray-900 sm:max-w-none">
          {who(c)}
        </span>
        {/* Never `Date.now()` during render — a clock read makes output a function of WHEN it
            rendered, React throws #418 and hydration fails for the subtree at HTTP 200. */}
        <span className="text-[11px] text-gray-500"><TimeAgo iso={c.createdAt ?? ''} /></span>
        {c.editedAt && <span className="text-[11px] text-gray-400">edited</span>}
        {c.resolvedAt && !isReply && (
          <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-800 ring-1 ring-inset ring-green-600/20">
            resolved
          </span>
        )}
      </div>
      {/* data-user-content — a teammate's own words. The finish probe must not read them as
          our copy, and the marker doubles as the trust boundary this text sits on. */}
      <p data-user-content className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{withMentions(c.body)}</p>
      {!isReply && (
        <div className="mt-1 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => { setReplyTo(c.id); setOpen(true); }}
            className="text-[11px] text-blue-700 hover:underline disabled:opacity-50"
          >
            Reply
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void setResolved(c.id, !c.resolvedAt)}
            className="text-[11px] text-gray-500 hover:underline disabled:opacity-50"
          >
            {c.resolvedAt ? 'Reopen' : 'Resolve'}
          </button>
        </div>
      )}
    </li>
  );

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-xs text-gray-500 hover:text-gray-800 hover:underline"
      >
        {comments.length === 0
          ? `Comment${label ? ` on ${label}` : ''}`
          : openCount > 0
            // "3 open questions" and "3 comments" are different news, so they are not styled alike.
            ? `${openCount} open · ${comments.length} comment${comments.length === 1 ? '' : 's'}`
            : `${comments.length} comment${comments.length === 1 ? '' : 's'} · all resolved`}
      </button>

      {open && (
        <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
          {roots.length > 0 && (
            <ul className="space-y-3">
              {roots.map((c) => (
                <li key={c.id} className="list-none">
                  <ul className="space-y-2">
                    {line(c, false)}
                    {repliesOf(c.id).map((r) => line(r, true))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            {replyTo && (
              <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-600">
                <span>Replying in thread</span>
                <button type="button" onClick={() => setReplyTo(null)} className="text-blue-700 hover:underline">
                  cancel
                </button>
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              aria-label={`Comment${label ? ` on ${label}` : ''}`}
              placeholder="Say something. @email to notify someone on this project."
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            {/* Wrapping, and the feedback below the button rather than beside it: "Not on this
                project, so not notified: …" is a sentence, and at phone width a sentence sharing a
                line with a button is a sentence nobody reads. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                disabled={busy || !draft.trim()}
                onClick={() => void post()}
                className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {replyTo ? 'Reply' : 'Post'}
              </button>
              {feedback && feedback.notified.length > 0 && (
                <span className="text-[11px] text-gray-600">
                  Notified {feedback.notified.join(', ')}
                </span>
              )}
              {feedback && feedback.unmatched.length > 0 && (
                // The whole reason the server returns this. Silently dropping an unrecognised name
                // lets the author believe they were heard, and the reply never comes.
                <span className="text-[11px] text-amber-800">
                  Not on this project, so not notified: {feedback.unmatched.join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
