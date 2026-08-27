'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { TimeAgo } from '@/components/ui/time-ago';

/**
 * The review on one thing — ask, then approve or reject with a reason.
 *
 * ── WHY REJECTION IS THE LOUD ONE ────────────────────────────────────────────────────────────
 * "Not yet accepted" and "rejected, because X" are different states, and only one tells the next
 * person what to do. So a rejection renders its reason in full, in the red register, above the
 * fold of the panel — while an approval is a quiet line. The asymmetry is the point: the state
 * somebody must act on should not look like the state nobody must.
 *
 * ── AND WHY THE REASON IS COLLECTED IN A TEXTAREA, NOT A `prompt()` ──────────────────────────
 * A native prompt is one line, unstyled, uncancellable on some mobile browsers, and impossible to
 * paste a paragraph into comfortably. The reason is the whole payload of a rejection; asking for
 * it in the worst input the platform has would guarantee one-word answers.
 *
 * Mobile-first, like everything else on this page: a `min-w-0` content column, actions that stack
 * below `sm` and sit inline above it, and identifiers that truncate with a `title`.
 */
export interface PanelReview {
  id: string;
  entityType: string;
  entityId: string;
  requestedBy: string;
  reviewerUserId: string | null;
  reviewerRole: string | null;
  reviewerEmail: string | null;
  note: string | null;
  dueOn: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  reason: string | null;
  decidedAt: string | null;
  createdAt: string | null;
}

const BADGE: Record<PanelReview['status'], string> = {
  pending: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  approved: 'bg-green-50 text-green-800 ring-green-600/20',
  rejected: 'bg-red-50 text-red-800 ring-red-600/30',
  withdrawn: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

export function ReviewPanel({
  entityType, entityId, label, reviews, members, basePath, canDecide,
}: {
  entityType: 'deliverable' | 'document' | 'milestone';
  entityId: string;
  label: string;
  reviews: PanelReview[];
  members: { id: string; email: string }[];
  basePath: string;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const mine = reviews.filter((r) => r.entityType === entityType && r.entityId === entityId);
  // Only the LATEST counts — a rejection a fresh request superseded is history, not a standing
  // objection. Same rule the server's acceptance gate applies.
  const latest = mine[0] ?? null;
  const open = latest?.status === 'pending' ? latest : null;

  async function ask() {
    if (!reviewer) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType, entityId, reviewerUserId: reviewer,
          note: note.trim() || null, dueOn: due || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not request the review', 'error'); return; }
      setAsking(false); setReviewer(''); setNote(''); setDue('');
      toast('Review requested', 'success');
      router.refresh();
    } catch {
      toast('Could not request the review', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: 'approved' | 'rejected' | 'withdrawn', why?: string) {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/reviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: why ?? null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not record the decision', 'error'); return; }
      setRejecting(null); setReason('');
      toast(decision === 'rejected' ? 'Rejected, with your reason' : `Review ${decision}`, 'success');
      router.refresh();
    } catch {
      toast('Could not record the decision', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 text-xs">
      {/* THE STANDING STATE, first. A rejection is what somebody has to act on, so it is what the
          panel leads with rather than something to find under a toggle. */}
      {latest && latest.status !== 'withdrawn' && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${BADGE[latest.status]}`}>
            review {latest.status}
          </span>
          {latest.reviewerEmail && (
            <span title={latest.reviewerEmail} className="max-w-[11rem] truncate text-gray-500 sm:max-w-none">
              {latest.status === 'pending' ? 'with ' : 'by '}{latest.reviewerEmail}
            </span>
          )}
          <span className="text-gray-400">
            <TimeAgo iso={(latest.decidedAt ?? latest.createdAt) ?? ''} />
          </span>
        </div>
      )}

      {latest?.status === 'rejected' && latest.reason && (
        <p className="mt-1 rounded border-l-2 border-red-600 bg-red-50 px-2 py-1 text-[12px] text-red-900">
          {latest.reason}
        </p>
      )}

      {/* Deciding. Open to the reviewer or a tenant_admin; the server refuses anyone else, and the
          button is hidden rather than left to fail, so the message is a backstop. */}
      {open && canDecide && (
        rejecting === open.id ? (
          <div className="mt-1.5 rounded border border-gray-200 bg-gray-50 p-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              aria-label={`Why ${label} is rejected`}
              placeholder="What is wrong with it? This is what tells whoever wrote it what to change."
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => void decide(open.id, 'rejected', reason.trim())}
                className="rounded bg-red-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                Reject with this reason
              </button>
              <button
                type="button"
                onClick={() => { setRejecting(null); setReason(''); }}
                className="text-[11px] text-gray-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(open.id, 'approved')}
              className="rounded border border-green-700 px-2 py-1 text-[11px] font-medium text-green-800 hover:bg-green-50 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(open.id)}
              className="rounded border border-red-700 px-2 py-1 text-[11px] font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
            >
              Reject…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(open.id, 'withdrawn')}
              className="text-[11px] text-gray-500 hover:underline disabled:opacity-50"
            >
              Withdraw
            </button>
          </div>
        )
      )}

      {/* Asking. Anyone on the project may, so long as nothing is already open on this thing. */}
      {!open && (
        asking ? (
          <div className="mt-1.5 rounded border border-gray-200 bg-gray-50 p-2">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
              <label className="text-[11px] text-gray-600">
                Reviewer
                <select
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  aria-label={`Who should review ${label}`}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                >
                  <option value="">Choose…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-gray-600">
                Wanted by
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  aria-label={`When the review of ${label} is wanted`}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                />
              </label>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              aria-label={`What to look at in ${label}`}
              placeholder="What should they look at?"
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !reviewer}
                onClick={() => void ask()}
                className="rounded bg-blue-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                Ask for a review
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="text-[11px] text-gray-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="mt-1 text-[11px] text-blue-700 hover:underline"
          >
            {latest ? 'Ask for another review' : 'Ask for a review'}
          </button>
        )
      )}
    </div>
  );
}
