'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { useClientNow } from '@/components/ui/time-ago';

/**
 * Billing — the per-CLIN position, then the invoices.
 *
 * ── THE POSITION COMES FIRST, AND IT IS THREE NUMBERS ────────────────────────────────────────
 * Authorised · claimed · remaining. Not one "percent billed", for the same reason `rollup.ts`
 * refuses to blend its three measures: the useful signal is exactly the disagreement between them,
 * and an average destroys it while still looking like an answer.
 *
 * A CLIN with no funded amount reads **"not set"**, never `$0 remaining`. Zero is a measurement;
 * a missing ceiling is not one, and a reader cannot tell them apart once both render as a number.
 *
 * ── AND AN OUTSTANDING INVOICE SHOWS ITS AGE ─────────────────────────────────────────────────
 * "Submitted 12 June" makes a person do arithmetic. "62 days outstanding" is the thing they were
 * going to work out.
 *
 * ⚠️ The age is computed from `useClientNow()`, NEVER `Date.now()` during render. A clock read in
 * render makes the output a function of WHEN it rendered: the server writes one number, the client
 * hydrates a beat later and writes another, React throws #418, and hydration fails for the whole
 * subtree while the route still answers 200. Eight occurrences in this codebase.
 */
export interface LedgerLine {
  id: string;
  clinNumber: string | null;
  milestoneTitle: string | null;
  description: string;
  source: string;
  amount: string;
}

export interface LedgerInvoice {
  id: string;
  invoiceNumber: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: 'draft' | 'submitted' | 'paid' | 'void';
  submittedOn: string | null;
  paidOn: string | null;
  amountPaid: string;
  voidReason: string | null;
  total?: number;
  lines?: LedgerLine[];
}

export interface LedgerClin {
  clinId: string;
  clinNumber: string;
  fundedAmount: string | null;
  billed: number;
  paid: number;
  remaining: number | null;
}

export interface LedgerUnbilled {
  milestoneId: string;
  milestoneTitle: string;
  clinId: string | null;
  hours: string;
  cost: string;
  entries: number;
}

const usd = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === ''
    ? '—'
    : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 ring-gray-500/20',
  submitted: 'bg-amber-50 text-amber-900 ring-amber-600/30',
  paid: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30',
  void: 'bg-gray-50 text-gray-400 ring-gray-400/20',
};

/** Days since submission, or null. Takes `now` so it is never read during render. */
function ageOf(inv: LedgerInvoice, now: Date | null): number | null {
  if (inv.status !== 'submitted' || !inv.submittedOn || !now) return null;
  const from = String(inv.submittedOn).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const ms = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

export function InvoiceLedger({
  invoices, billing, unbilled, basePath, canBill,
}: {
  invoices: LedgerInvoice[];
  billing: LedgerClin[];
  unbilled: LedgerUnbilled[];
  basePath: string;
  canBill: boolean;
}) {
  const router = useRouter();
  // `useClientNow` returns epoch ms and is NULL until mounted, so the first paint is identical
  // on both sides and hydration cannot disagree. Everything below treats null as "no age yet".
  const nowMs = useClientNow();
  const now = nowMs === null ? null : new Date(nowMs);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [clinId, setClinId] = useState(billing[0]?.clinId ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [acting, setActing] = useState<{ id: string; kind: 'submit' | 'pay' | 'void' } | null>(null);
  const [when, setWhen] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [reason, setReason] = useState('');

  async function send(body: unknown, method: 'POST' | 'PATCH', okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/invoices`, {
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

  async function raise() {
    if (!invoiceNumber.trim() || !clinId || !description.trim() || !amount) return;
    const ok = await send({
      invoiceNumber: invoiceNumber.trim(),
      lines: [{ clinId, description: description.trim(), source: 'manual', amount: Number(amount) }],
    }, 'POST', 'Invoice drafted — nothing has been claimed yet');
    if (ok) { setAdding(false); setInvoiceNumber(''); setDescription(''); setAmount(''); }
  }

  async function act() {
    if (!acting) return;
    const body =
        acting.kind === 'submit' ? { action: 'submit', invoiceId: acting.id, submittedOn: when }
      : acting.kind === 'pay'    ? { action: 'pay', invoiceId: acting.id, paidOn: when, amount: Number(payAmount) }
      :                            { action: 'void', invoiceId: acting.id, reason };
    const msg =
        acting.kind === 'submit' ? 'Invoice submitted'
      : acting.kind === 'pay'    ? 'Payment recorded'
      :                            'Invoice voided';
    const ok = await send(body, 'PATCH', msg);
    if (ok) { setActing(null); setWhen(''); setPayAmount(''); setReason(''); }
  }

  const totalUnbilled = unbilled.reduce((a, u) => a + Number(u.cost ?? 0), 0);

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">Billing</h2>
          <p className="text-xs text-gray-500">
            What each line item authorised, what has been claimed against it, and what is left.
          </p>
        </div>
        {canBill && billing.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            {adding ? 'Cancel' : 'Raise an invoice'}
          </button>
        )}
      </header>

      {/* ── THE POSITION ─────────────────────────────────────────────────────────────────── */}
      {billing.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">No CLINs yet — nothing to bill against.</p>
      ) : (
        <div className="overflow-x-auto border-b border-gray-200">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">CLIN</th>
                <th className="px-4 py-2 text-right font-medium">Authorised</th>
                <th className="px-4 py-2 text-right font-medium">Claimed</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {billing.map((c) => (
                <tr key={c.clinId}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">{c.clinNumber}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">{usd(c.fundedAmount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-900">{usd(c.billed)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">{usd(c.paid)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {/* NOT MEASURED, never a confident $0. A CLIN with no funded amount has no
                        ceiling; rendering zero states a limit nobody set. */}
                    {c.remaining === null ? (
                      <span className="text-xs text-gray-400">funding not set</span>
                    ) : (
                      <span className={c.remaining < 0 ? 'font-medium text-red-700' : 'text-gray-900'}>
                        {usd(c.remaining)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── WHAT IS BILLABLE AND HAS NOT BEEN BILLED ─────────────────────────────────────── */}
      {unbilled.length > 0 && (
        <div className="border-b border-gray-200 bg-amber-50/40 px-4 py-2">
          <p className="text-xs text-amber-900">
            <span className="font-medium">{usd(totalUnbilled)}</span> of approved labour has not been
            invoiced — {unbilled.reduce((a, u) => a + u.entries, 0)} entries across{' '}
            {unbilled.length} milestone{unbilled.length === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {adding && canBill && (
        <div className="space-y-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="INV-0001"
              className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm sm:w-36"
            />
            <select
              value={clinId}
              onChange={(e) => setClinId(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-40"
            >
              {billing.map((c) => <option key={c.clinId} value={c.clinId}>CLIN {c.clinNumber}</option>)}
            </select>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this line bills"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              placeholder="Amount"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-32"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !invoiceNumber.trim() || !description.trim() || !amount}
              onClick={() => void raise()}
              className="rounded bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Save as draft
            </button>
            <span className="text-[11px] text-gray-500">Nothing is claimed until you submit it.</span>
          </div>
        </div>
      )}

      {/* ── THE INVOICES ─────────────────────────────────────────────────────────────────── */}
      {invoices.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {invoices.map((inv) => {
            const age = ageOf(inv, now);
            return (
              <li key={inv.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-sm text-gray-900">{inv.invoiceNumber}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${STATUS_CLASS[inv.status]}`}>
                    {inv.status}
                  </span>
                  <span className="tabular-nums text-sm text-gray-900">{usd(inv.total)}</span>
                  {Number(inv.amountPaid) > 0 && Number(inv.amountPaid) < (inv.total ?? 0) && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30">
                      {usd(inv.amountPaid)} received · {usd((inv.total ?? 0) - Number(inv.amountPaid))} outstanding
                    </span>
                  )}
                  {age !== null && (
                    <span className={`text-[11px] ${age > 45 ? 'font-medium text-red-700' : 'text-gray-500'}`}>
                      {age} day{age === 1 ? '' : 's'} outstanding
                    </span>
                  )}
                </div>

                {(inv.lines?.length ?? 0) > 0 && (
                  <ul className="space-y-0.5 border-l-2 border-gray-200 pl-3">
                    {inv.lines!.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="text-gray-500">CLIN {l.clinNumber ?? '—'}</span>
                        <span className="text-gray-900">{l.description}</span>
                        <span className="tabular-nums text-gray-700">{usd(l.amount)}</span>
                        <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">{l.source}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {inv.voidReason && <p className="text-xs text-gray-500">Voided: {inv.voidReason}</p>}

                {canBill && inv.status !== 'void' && inv.status !== 'paid' && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {acting?.id === inv.id ? (
                      <>
                        {acting.kind !== 'void' && (
                          <input
                            type="date"
                            value={when}
                            onChange={(e) => setWhen(e.target.value)}
                            className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                          />
                        )}
                        {acting.kind === 'pay' && (
                          <input
                            type="number"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            placeholder="Amount received"
                            className="w-32 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                          />
                        )}
                        {acting.kind === 'void' && (
                          <input
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Why is it being voided?"
                            className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-xs sm:w-64"
                          />
                        )}
                        <button
                          type="button"
                          disabled={busy || (acting.kind === 'void' ? !reason.trim() : !when)}
                          onClick={() => void act()}
                          className="rounded bg-gray-900 px-2 py-0.5 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button type="button" onClick={() => setActing(null)} className="text-xs text-gray-500 hover:text-gray-700">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {inv.status === 'draft' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setActing({ id: inv.id, kind: 'submit' });
                              setWhen(now ? now.toISOString().slice(0, 10) : '');
                            }}
                            className="rounded border border-gray-900 px-2 py-0.5 text-xs text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Submit…
                          </button>
                        )}
                        {inv.status === 'submitted' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setActing({ id: inv.id, kind: 'pay' });
                              setWhen(now ? now.toISOString().slice(0, 10) : '');
                              setPayAmount(String((inv.total ?? 0) - Number(inv.amountPaid)));
                            }}
                            className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            Record payment…
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setActing({ id: inv.id, kind: 'void' })}
                          className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
                        >
                          Void
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
