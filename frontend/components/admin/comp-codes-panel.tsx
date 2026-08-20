'use client';

/**
 * Issue and manage comp codes — the free-purchase path.
 *
 * A comp code IS the payment: whoever types it into the purchase modal gets a proposal portal and
 * starts the 72h curation clock, without a card. So this panel is built around the two questions an
 * issuer actually has — "what did I hand out and is it still live" and "kill that one" — and the
 * mint step shows the code ONCE in a form that is easy to copy and hard to mistype.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';

type CodeState = 'outstanding' | 'redeemed' | 'revoked' | 'expired' | 'exhausted';

interface Code {
  id: string;
  code: string;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  issuedTo: string | null;
  note: string | null;
  createdAt: string;
  firstRedeemedAt: string | null;
  revokedAt: string | null;
  redeemedByTenant: string | null;
  issuedByEmail: string | null;
  state: CodeState;
}

const STATE_STYLE: Record<CodeState, string> = {
  outstanding: 'bg-emerald-100 text-emerald-700',
  redeemed: 'bg-blue-100 text-blue-700',
  exhausted: 'bg-gray-100 text-gray-500',
  expired: 'bg-amber-100 text-amber-700',
  revoked: 'bg-red-100 text-red-700',
};

/** "Outstanding" is the only state that still buys anything — say so in one word. */
const STATE_LABEL: Record<CodeState, string> = {
  outstanding: 'Outstanding',
  redeemed: 'Redeemed',
  exhausted: 'Used up',
  expired: 'Expired',
  revoked: 'Revoked',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export function CompCodesPanel() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [issuedTo, setIssuedTo] = useState('');
  const [count, setCount] = useState('1');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [justIssued, setJustIssued] = useState<Code[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/promo-codes');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not load codes');
      const body = await res.json();
      setCodes(body.data?.codes ?? []);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mint() {
    setMinting(true);
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          count: Number(count) || 1,
          maxUses: 1,
          // Blank expiry means "never" — an explicit null, not a missing field, so the route can
          // tell it apart from "use the default".
          expiresInDays: expiresInDays.trim() === '' ? null : Number(expiresInDays),
          issuedTo: issuedTo.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not issue codes');
      setJustIssued(body.data?.codes ?? []);
      setIssuedTo('');
      toast(`Issued ${body.data?.codes?.length ?? 0} code(s)`, 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setMinting(false);
    }
  }

  async function revoke(id: string, code: string) {
    if (!confirm(`Revoke ${code}? Anyone holding it will no longer be able to redeem it.`)) return;
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: 'revoke' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not revoke');
      toast(`${code} revoked`, 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-gray-900">Comp codes</h2>
      <p className="mt-1 text-sm text-gray-500">
        A one-time code opens a proposal portal without a card. Hand one to a buyer; the first
        redemption burns it.
      </p>

      {/* ── mint ─────────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Issued to <span className="font-normal text-gray-400">(for your records)</span>
          <input
            value={issuedTo}
            onChange={(e) => setIssuedTo(e.target.value)}
            placeholder="Kate at Foundation"
            className="mt-1 w-56 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-600">
          How many
          <input
            value={count} onChange={(e) => setCount(e.target.value)}
            inputMode="numeric" className="mt-1 w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Expires in (days) <span className="font-normal text-gray-400">blank = never</span>
          <input
            value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)}
            inputMode="numeric" className="mt-1 w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => void mint()} disabled={minting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {minting ? 'Issuing…' : 'Issue codes'}
        </button>
      </div>

      {justIssued.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Just issued — copy these now</p>
          <ul className="mt-2 space-y-1 font-mono text-lg tracking-wider text-emerald-900">
            {justIssued.map((c) => <li key={c.id}>{c.code}</li>)}
          </ul>
        </div>
      )}

      {/* ── list ─────────────────────────────────────────────────────── */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 font-medium">Issued to</th>
              <th className="px-4 py-3 font-medium">Uses</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Redeemed by</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
            {!loading && codes.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No codes yet — issue one above.</td></tr>
            )}
            {codes.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-mono tracking-wide text-gray-900">{c.code}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[c.state]}`}>
                    {STATE_LABEL[c.state]}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{c.issuedTo ?? '—'}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">
                  {c.usedCount}{c.maxUses === null ? ' / ∞' : ` / ${c.maxUses}`}
                </td>
                <td className="px-4 py-3 text-gray-600">{fmt(c.expiresAt)}</td>
                <td className="px-4 py-3 text-gray-600">{c.redeemedByTenant ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  {c.state === 'outstanding' && (
                    <button
                      onClick={() => void revoke(c.id, c.code)}
                      className="text-xs font-medium text-red-600 hover:text-red-800"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
