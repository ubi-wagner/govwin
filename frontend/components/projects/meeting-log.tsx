'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * The meeting log — and the action items that came out of each one.
 *
 * ── THE COUNT IS THE POINT OF THE ROW ────────────────────────────────────────────────────────
 * "CDR walkthrough · 3 of 5 agreed actions done" answers the question a log of meetings exists for.
 * A list of titles and dates does not, and would send somebody into each one to find out whether
 * anything came of it.
 *
 * ── RAISING ACTIONS IS ONE SUBMIT, NOT SIX ───────────────────────────────────────────────────
 * That is how a meeting ends: somebody reads back five things. Six separate saves is five chances
 * to be interrupted, leaving notes that claim five agreements beside a plan holding two — so the
 * form collects them all and the server takes them in one call, reporting anything it refused.
 *
 * Mobile-first, like the rest of the workspace.
 */
export interface LogMeeting {
  id: string;
  title: string;
  heldOn: string | null;
  attendees: string[];
  documentId: string | null;
  actionItems: number;
  actionItemsDone: number;
}

interface DraftItem { title: string; assigneeUserId: string; dueDate: string }

export function MeetingLog({
  meetings, members, basePath, tenantSlug, canRaise,
}: {
  meetings: LogMeeting[];
  members: { id: string; email: string }[];
  basePath: string;
  tenantSlug: string;
  canRaise: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [heldOn, setHeldOn] = useState('');
  const [attendees, setAttendees] = useState('');
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [items, setItems] = useState<DraftItem[]>([{ title: '', assigneeUserId: '', dueDate: '' }]);

  async function record() {
    if (!title.trim() || !heldOn) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), heldOn,
          // Comma-separated, because that is how somebody types a list of names.
          attendees: attendees.split(',').map((a) => a.trim()).filter(Boolean),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not record the meeting', 'error'); return; }
      setAdding(false); setTitle(''); setHeldOn(''); setAttendees('');
      toast('Meeting recorded — the notes are ready to write', 'success');
      router.refresh();
    } catch {
      toast('Could not record the meeting', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function raise(meetingId: string) {
    const payload = items.filter((i) => i.title.trim()).map((i) => ({
      title: i.title.trim(),
      assigneeUserId: i.assigneeUserId || null,
      dueDate: i.dueDate || null,
    }));
    if (!payload.length) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raise_actions', items: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not raise the action items', 'error'); return; }
      const refused: string[] = json?.data?.refused ?? [];
      const raised: string[] = json?.data?.taskIds ?? [];
      setActionsFor(null);
      setItems([{ title: '', assigneeUserId: '', dueDate: '' }]);
      // Both halves reported. Saying "5 raised" when one was refused is how the notes and the plan
      // start disagreeing about what was agreed.
      toast(refused.length
        ? `${raised.length} raised · ${refused.length} refused: ${refused[0]}`
        : `${raised.length} action item${raised.length === 1 ? '' : 's'} raised`,
      refused.length ? 'error' : 'success');
      router.refresh();
    } catch {
      toast('Could not raise the action items', 'error');
    } finally {
      setBusy(false);
    }
  }

  const setItem = (i: number, patch: Partial<DraftItem>) =>
    setItems((cur) => cur.map((it, n) => (n === i ? { ...it, ...patch } : it)));

  return (
    <div>
      {meetings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
          No meetings recorded. What was agreed in one is where most project work starts.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {meetings.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900">{m.title}</span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                    {m.heldOn && <span>{String(m.heldOn).slice(0, 10)}</span>}
                    {m.attendees.length > 0 && (
                      <span title={m.attendees.join(', ')} className="max-w-[13rem] truncate sm:max-w-none">
                        {m.attendees.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  {/* The question a log of meetings exists to answer. */}
                  {m.actionItems > 0 ? (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                      m.actionItemsDone === m.actionItems
                        ? 'bg-green-50 text-green-800 ring-green-600/20'
                        : 'bg-amber-50 text-amber-900 ring-amber-600/30'}`}
                    >
                      {m.actionItemsDone} of {m.actionItems} actions done
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-400">no actions raised</span>
                  )}
                  {m.documentId && (
                    <Link
                      href={`/portal/${tenantSlug}/documents/${m.documentId}`}
                      className="text-[11px] text-blue-700 hover:underline"
                    >
                      Notes
                    </Link>
                  )}
                  {canRaise && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setActionsFor(actionsFor === m.id ? null : m.id)}
                      className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Raise actions
                    </button>
                  )}
                </span>
              </div>

              {actionsFor === m.id && (
                <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2">
                  {items.map((it, i) => (
                    <div key={i} className="mb-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
                      <input
                        value={it.title}
                        onChange={(e) => setItem(i, { title: e.target.value })}
                        placeholder="What was agreed?"
                        aria-label={`Action item ${i + 1}`}
                        className="col-span-2 w-full rounded border border-gray-300 px-2 py-1 text-xs sm:flex-1"
                      />
                      <select
                        value={it.assigneeUserId}
                        onChange={(e) => setItem(i, { assigneeUserId: e.target.value })}
                        aria-label={`Who owns action item ${i + 1}`}
                        className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                      >
                        <option value="">Unassigned</option>
                        {members.map((mem) => <option key={mem.id} value={mem.id}>{mem.email}</option>)}
                      </select>
                      <input
                        type="date"
                        value={it.dueDate}
                        onChange={(e) => setItem(i, { dueDate: e.target.value })}
                        aria-label={`When action item ${i + 1} is due`}
                        className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setItems((c) => [...c, { title: '', assigneeUserId: '', dueDate: '' }])}
                      className="text-[11px] text-blue-700 hover:underline"
                    >
                      + another
                    </button>
                    <button
                      type="button"
                      disabled={busy || !items.some((i) => i.title.trim())}
                      onClick={() => void raise(m.id)}
                      className="rounded bg-blue-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      Raise them all
                    </button>
                    <button type="button" onClick={() => setActionsFor(null)} className="text-[11px] text-gray-500 hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What was the meeting?"
            aria-label="Meeting title"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
            <label className="text-[11px] text-gray-600">
              Held on
              <input
                type="date"
                value={heldOn}
                onChange={(e) => setHeldOn(e.target.value)}
                aria-label="When the meeting was held"
                className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
              />
            </label>
            <label className="col-span-2 flex-1 text-[11px] text-gray-600">
              Who was there
              <input
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="Comma separated — customer names welcome"
                aria-label="Attendees"
                className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !title.trim() || !heldOn}
              onClick={() => void record()}
              className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              Record it
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:underline">
              Cancel
            </button>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            The notes open as a document you can edit and export, like any other project artifact.
          </p>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 text-xs text-blue-700 hover:underline">
          + Record a meeting
        </button>
      )}
    </div>
  );
}
