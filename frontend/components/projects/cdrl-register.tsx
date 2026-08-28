'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * The CDRL register — what the contract requires, and what has actually gone out.
 *
 * ── EACH ROW ANSWERS "AM I CURRENT ON THIS" ──────────────────────────────────────────────────
 * Not "here is a data item". A register that lists obligations without their delivery state is a
 * copy of the contract, which the reader already has. So every row carries **sent / instances**,
 * and every submission carries whether it MET its date.
 *
 * ── THE DISTRIBUTION MARKING IS SHOWN WITH ITS MEANING ───────────────────────────────────────
 * "B" alone tells a person nothing, and the whole point of the marking is that the reader knows who
 * may receive the document. A CDRL with no statement shows **nothing** — not "A" — because
 * defaulting to the permissive letter would put a public-release marking on something that may not
 * be publicly releasable.
 *
 * Mobile-first, like the rest of the workspace.
 */
export interface RegisterSubmission {
  deliverableId: string;
  title: string;
  requiredBy: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  transmittalRef: string | null;
  daysLate: number | null;
}

export interface RegisterCdrl {
  id: string;
  cdrlNumber: string;
  title: string;
  didNumber: string | null;
  subtitle: string | null;
  clinNumber?: string | null;
  frequency: string;
  approvalCode: string;
  distribution: string | null;
  distributionNote: string | null;
  firstDue: string | null;
  submissions?: RegisterSubmission[];
  instances?: number;
  sent?: number;
}

const DISTRIBUTION_MEANING: Record<string, string> = {
  A: 'Approved for public release; distribution unlimited',
  B: 'U.S. Government agencies only',
  C: 'U.S. Government agencies and their contractors',
  D: 'Department of Defense and DoD contractors only',
  E: 'DoD components only',
  F: 'As directed by the controlling DoD office',
};

const day = (v: string | null) => (v ? String(v).slice(0, 10) : '—');

export function CdrlRegister({
  items, clins, basePath, canManage,
}: {
  items: RegisterCdrl[];
  clins: { id: string; clinNumber: string }[];
  basePath: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cdrlNumber, setCdrlNumber] = useState('');
  const [title, setTitle] = useState('');
  const [didNumber, setDidNumber] = useState('');
  const [clinId, setClinId] = useState('');
  const [frequency, setFrequency] = useState('one_time');
  const [approvalCode, setApprovalCode] = useState('I');
  const [distribution, setDistribution] = useState('');
  const [firstDue, setFirstDue] = useState('');
  // Recording a delivery is per-submission, so the open form is keyed by the deliverable it belongs
  // to. One shared date field would type into every row at once.
  const [sending, setSending] = useState<string | null>(null);
  const [sentOn, setSentOn] = useState('');
  const [ref, setRef] = useState('');

  async function send(body: unknown, method: 'POST' | 'PATCH', okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/cdrl`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not do that', 'error'); return false; }
      toast(okMsg, 'success');
      router.refresh();
      return true;
    } catch {
      toast('Could not do that', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    if (!cdrlNumber.trim() || !title.trim()) return;
    const ok = await send({
      cdrlNumber: cdrlNumber.trim(), title: title.trim(),
      didNumber: didNumber.trim() || null, clinId: clinId || null,
      frequency, approvalCode, distribution: distribution || null,
      firstDue: firstDue || null,
    }, 'POST', 'CDRL item registered');
    if (ok) { setAdding(false); setCdrlNumber(''); setTitle(''); setDidNumber(''); setFirstDue(''); }
  }

  async function recordDelivery(deliverableId: string) {
    const ok = await send({
      action: 'submitted', deliverableId, submittedAt: sentOn, transmittalRef: ref.trim() || null,
    }, 'PATCH', 'Delivery recorded');
    if (ok) { setSending(null); setSentOn(''); setRef(''); }
  }

  const needsFirstDue = ['monthly', 'quarterly', 'semiannual', 'annual'].includes(frequency);

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">Data requirements (CDRL)</h2>
          <p className="text-xs text-gray-500">
            What the contract requires, and what has actually reached the customer.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            {adding ? 'Cancel' : 'Register an item'}
          </button>
        )}
      </header>

      {adding && canManage && (
        <div className="space-y-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={cdrlNumber}
              onChange={(e) => setCdrlNumber(e.target.value)}
              placeholder="A001"
              className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm sm:w-24"
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What the contract requires"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              value={didNumber}
              onChange={(e) => setDidNumber(e.target.value)}
              placeholder="DI-MGMT-81334D"
              className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs sm:w-44"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={clinId} onChange={(e) => setClinId(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-36">
              <option value="">CLIN…</option>
              {clins.map((c) => <option key={c.id} value={c.id}>{c.clinNumber}</option>)}
            </select>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-44">
              {['one_time', 'monthly', 'quarterly', 'semiannual', 'annual', 'as_required', 'with_each_milestone']
                .map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={approvalCode} onChange={(e) => setApprovalCode(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-52">
              <option value="I">I — information only</option>
              <option value="A">A — government approval required</option>
            </select>
            <select value={distribution} onChange={(e) => setDistribution(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
              {/* NOT pre-selected. An unmarked item is the honest rendering of "the contract did
                  not say", and defaulting to A would claim public releasability. */}
              <option value="">Distribution statement — not stated</option>
              {Object.entries(DISTRIBUTION_MEANING).map(([k, v]) => (
                <option key={k} value={k}>{k} — {v}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[11px] text-gray-600">
              First due
              <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)}
                className="ml-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
            </label>
            {needsFirstDue && !firstDue && (
              <span className="text-[11px] text-amber-800">
                A recurring item needs a first due date, or nothing that asks &ldquo;what is due&rdquo; will find it.
              </span>
            )}
            <button
              type="button"
              disabled={busy || !cdrlNumber.trim() || !title.trim() || (needsFirstDue && !firstDue)}
              onClick={() => void register()}
              className="rounded bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Register
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          No data requirements registered. A CDRL is what the contract obliges you to deliver, and
          when.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((it) => (
            <li key={it.id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-sm font-medium text-gray-900">{it.cdrlNumber}</span>
                <span className="text-sm text-gray-900">{it.title}</span>
                {it.clinNumber && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                    CLIN {it.clinNumber}
                  </span>
                )}
                <span className="text-[11px] text-gray-500">{it.frequency.replace(/_/g, ' ')}</span>
                {it.approvalCode === 'A' && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30">
                    approval required
                  </span>
                )}
                {/* AM I CURRENT ON THIS — the question the register exists to answer. */}
                {(it.instances ?? 0) > 0 && (
                  <span className={`text-[11px] tabular-nums ${
                    (it.sent ?? 0) < (it.instances ?? 0) ? 'font-medium text-amber-800' : 'text-gray-500'
                  }`}>
                    {it.sent} of {it.instances} sent
                  </span>
                )}
              </div>

              {it.didNumber && <p className="font-mono text-[11px] text-gray-500">{it.didNumber}</p>}

              {/* The marking, WITH its meaning. Absent when the contract stated none. */}
              {it.distribution && (
                <p className="text-[11px] text-gray-600">
                  <span className="font-medium">Distribution {it.distribution}</span>
                  {' — '}{DISTRIBUTION_MEANING[it.distribution] ?? ''}
                  {it.distributionNote ? ` · ${it.distributionNote}` : ''}
                </p>
              )}

              {(it.submissions?.length ?? 0) > 0 && (
                <ul className="space-y-0.5 border-l-2 border-gray-200 pl-3">
                  {it.submissions!.map((s) => (
                    <li key={s.deliverableId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-gray-900">{s.title}</span>
                      <span className="text-gray-500">due {day(s.requiredBy)}</span>
                      {s.submittedAt ? (
                        <>
                          <span className="text-gray-700">sent {day(s.submittedAt)}</span>
                          {s.daysLate !== null && s.daysLate !== 0 && (
                            <span className={s.daysLate > 0 ? 'text-red-700' : 'text-emerald-700'}>
                              {s.daysLate > 0 ? `${s.daysLate} late` : `${-s.daysLate} early`}
                            </span>
                          )}
                          {s.transmittalRef && <span className="text-gray-400">{s.transmittalRef}</span>}
                        </>
                      ) : canManage && sending === s.deliverableId ? (
                        <>
                          <input type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)}
                            className="rounded border border-gray-300 px-1 py-0.5 text-[11px]" />
                          <input value={ref} onChange={(e) => setRef(e.target.value)}
                            placeholder="Transmittal ref"
                            className="w-32 rounded border border-gray-300 px-1 py-0.5 text-[11px]" />
                          <button type="button" disabled={busy || !sentOn}
                            onClick={() => void recordDelivery(s.deliverableId)}
                            className="rounded bg-gray-900 px-1.5 py-0.5 text-[11px] text-white disabled:opacity-50">
                            Confirm
                          </button>
                          <button type="button" onClick={() => setSending(null)}
                            className="text-[11px] text-gray-500">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className="text-amber-800">not sent</span>
                          {canManage && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setSending(s.deliverableId);
                                setSentOn(new Date().toISOString().slice(0, 10));
                              }}
                              className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              title={s.acceptedAt ? 'Record the delivery' : 'Accept it internally first'}
                            >
                              Record delivery…
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
