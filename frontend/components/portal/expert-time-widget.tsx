'use client';

/**
 * Tenant Expert-Time widget (Terms §7). Shows the accrued balance, open slots to
 * book (up to the balance), and this tenant's upcoming bookings. All calls hit the
 * tenant API, which re-gates and enforces the balance/slot rules server-side.
 */
import { useCallback, useEffect, useState } from 'react';

interface Balance { minutesPerMonth: number; accrued: number; booked: number; remaining: number; }
interface OpenSlot { id: string; startAt: string; endAt: string; minutes: number; adminEmail: string | null; }
interface Booking { id: string; startAt: string; minutes: number; note: string | null; adminEmail: string | null; }

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

export function ExpertTimeWidget({ tenantSlug }: { tenantSlug: string }) {
  const base = `/api/portal/${encodeURIComponent(tenantSlug)}/expert-time`;
  const [balance, setBalance] = useState<Balance | null>(null);
  const [slots, setSlots] = useState<OpenSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(base);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load');
      setBalance(json.data.balance);
      setSlots(json.data.openSlots ?? []);
      setBookings(json.data.bookings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { load(); }, [load]);

  async function book(slot: OpenSlot) {
    setBusy(slot.id);
    setError(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockId: slot.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not book');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not book');
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`${base}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not cancel');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel');
    } finally {
      setBusy(null);
    }
  }

  const remaining = balance?.remaining ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Expert Time</h1>
      <p className="text-sm text-gray-500 mb-4">
        Book time with an RFP-Pipeline expert. It&apos;s advisory — final review of your proposal is
        always yours. You accrue {balance?.minutesPerMonth ?? 15} minutes each month.
      </p>

      <div className="mb-6 p-4 rounded-lg border bg-white flex items-center gap-6">
        <div>
          <div className="text-3xl font-bold text-navy-900">{remaining}<span className="text-base font-normal text-gray-500"> min</span></div>
          <div className="text-xs text-gray-500">remaining to book</div>
        </div>
        {balance && (
          <div className="text-xs text-gray-500">
            {balance.accrued} min accrued · {balance.booked} min booked
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <h2 className="text-sm font-semibold text-gray-700 mb-2">Upcoming bookings</h2>
      {bookings.length === 0 ? (
        <p className="text-sm text-gray-400 mb-6">No bookings yet.</p>
      ) : (
        <ul className="divide-y border rounded-lg bg-white mb-6">
          {bookings.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm">
                <div className="font-medium">{fmt(b.startAt)} · {b.minutes} min</div>
                {b.adminEmail && <div className="text-xs text-gray-500">with {b.adminEmail}</div>}
              </div>
              <button
                onClick={() => cancel(b.id)} disabled={busy === b.id}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                {busy === b.id ? '…' : 'Cancel'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-sm font-semibold text-gray-700 mb-2">Open slots</h2>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-400">No open slots right now. Check back soon.</p>
      ) : (
        <ul className="divide-y border rounded-lg bg-white">
          {slots.map((s) => {
            const affordable = s.minutes <= remaining;
            return (
              <li key={s.id} className="flex items-center justify-between px-4 py-3">
                <div className="text-sm">
                  <div className="font-medium">{fmt(s.startAt)} · {s.minutes} min</div>
                  {s.adminEmail && <div className="text-xs text-gray-500">with {s.adminEmail}</div>}
                </div>
                <button
                  onClick={() => book(s)} disabled={!affordable || busy === s.id}
                  title={affordable ? '' : 'Not enough remaining expert time for this slot'}
                  className="px-3 py-1 text-xs rounded bg-navy-900 text-white disabled:opacity-40"
                >
                  {busy === s.id ? 'Booking…' : affordable ? 'Book' : 'Too long'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
