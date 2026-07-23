'use client';

/**
 * Admin Expert-Time availability (Terms §7 calendar). Post bookable slots, see
 * who's booked what, cancel open ones. rfp_admin+ (API-gated).
 */
import { useCallback, useEffect, useState } from 'react';

interface AdminBlock {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  minutes: number;
  tenantId: string | null;
  bookedByEmail: string | null;
}

const DURATIONS = [15, 30, 45, 60];

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AdminExpertTimePage() {
  const [blocks, setBlocks] = useState<AdminBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/expert-time/availability');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load');
      setBlocks(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!start) { setError('Pick a start time'); return; }
    setSaving(true);
    setError(null);
    try {
      const startAt = new Date(start);
      const endAt = new Date(startAt.getTime() + minutes * 60_000);
      const res = await fetch('/api/admin/expert-time/availability', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startAt: startAt.toISOString(), endAt: endAt.toISOString() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Failed to add slot');
      setStart('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add slot');
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/expert-time/availability?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Failed to cancel');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel');
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Expert Time</h1>
      <p className="text-sm text-gray-500 mb-6">
        Post blocks of availability. Customers book against these up to their accrued balance
        (15 min/month). Google Meet links are coming later — for now, reach out to confirm the call.
      </p>

      <form onSubmit={addSlot} className="flex flex-wrap items-end gap-3 mb-6 p-4 border rounded-lg bg-white">
        <label className="flex flex-col text-sm">
          <span className="text-gray-600 mb-1">Start</span>
          <input
            type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-gray-600 mb-1">Duration</span>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="border rounded px-2 py-1">
            {DURATIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <button
          type="submit" disabled={saving}
          className="px-4 py-1.5 bg-navy-900 text-white rounded disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add slot'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : blocks.length === 0 ? (
        <p className="text-sm text-gray-500">No upcoming slots yet. Add one above.</p>
      ) : (
        <ul className="divide-y border rounded-lg bg-white">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{fmt(b.startAt)} · {b.minutes} min</div>
                <div className="text-xs text-gray-500">
                  {b.status === 'booked'
                    ? <span className="text-amber-700">Booked{b.bookedByEmail ? ` — ${b.bookedByEmail}` : ''}</span>
                    : <span className="text-green-700">Open</span>}
                </div>
              </div>
              {b.status === 'open' && (
                <button onClick={() => cancel(b.id)} className="text-xs text-red-600 hover:underline">
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
