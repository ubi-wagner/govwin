'use client';
import { useState } from 'react';

/**
 * Ask the companion to read the window.
 *
 * The `doing` field is optional and is the most useful thing on this page: the gap between what an
 * admin believes they just did and what the telemetry shows is exactly where the defects have
 * lived. It is sent as a CLAIM for the agent to check, never as a description it should accept.
 */
export default function CompanionButton({ minutes }: { minutes: number }) {
  const [doing, setDoing] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  async function ask() {
    setState('busy'); setMsg(null);
    try {
      const res = await fetch('/api/admin/observe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes, doing: doing.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setState('error'); setMsg(json.error ?? `HTTP ${res.status}`); return; }
      setState('sent');
      setMsg('Asked. The companion runs under the platform spend caps; its read appears in Agents.');
    } catch {
      setState('error'); setMsg('Network error — the request did not go.');
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={doing} onChange={(e) => setDoing(e.target.value)}
          placeholder="what you were just doing (optional, but it is the most useful thing here)"
          className="min-w-[22rem] flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button onClick={ask} disabled={state === 'busy'}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {state === 'busy' ? 'Asking…' : `Ask the companion (${minutes}m)`}
        </button>
      </div>
      {msg && <p className={`mt-2 text-xs ${state === 'error' ? 'text-rose-700' : 'text-gray-500'}`}>{msg}</p>}
      <p className="mt-2 text-xs text-gray-400">
        Advisory only — it reads, it never acts. It will not tell you things are fine: an empty
        window means nothing happened, not that nothing is wrong.
      </p>
    </div>
  );
}
