'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * This project's reminders — the third level of the automation policy.
 *
 * ── IT SAYS WHICH LEVEL DECIDED ──────────────────────────────────────────────────────────────
 * "Every 7, 2 and 0 days" is only half an answer. A person changing a setting needs to know
 * whether they are looking at the platform default, their tenant's policy, or an override somebody
 * put on this project — because the three behave differently when the tenant's setting changes.
 *
 * ── AND "INHERIT" IS A REAL STATE, NOT A VALUE ───────────────────────────────────────────────
 * Clearing an override is a different act from typing the tenant's current numbers into the box.
 * The second looks identical today and stops tracking the moment the tenant changes theirs, so
 * "Use the tenant setting" is its own button rather than an empty field.
 */
export interface PolicyTrigger {
  trigger: string;
  label: string;
  help: string;
  deliveryStatus: 'active' | 'preview';
  enabled: boolean;
  nudgeDays: number[];
  channel: 'email' | 'todo' | 'both';
  source: { tenantPolicy: boolean; projectOverride: boolean };
}

const CHANNEL_LABEL: Record<string, string> = {
  both: 'ToDo and email',
  todo: 'ToDo only',
  email: 'ToDo and email',
};

export function NotificationPolicy({
  triggers, basePath, canEdit,
}: {
  triggers: PolicyTrigger[];
  basePath: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [days, setDays] = useState('');
  const [channel, setChannel] = useState('both');

  async function save(trigger: string, patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/notifications`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger, ...patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not save that', 'error'); return; }
      toast('Saved', 'success');
      setEditing(null);
      router.refresh();
    } catch {
      toast('Could not save that', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-900">Reminders on this project</h2>
        <p className="text-xs text-gray-500">
          These start from your organisation&rsquo;s settings. Change one here and it applies to this
          project only.
        </p>
      </header>

      <ul className="divide-y divide-gray-100">
        {triggers.map((t) => (
          <li key={t.trigger} className="space-y-1.5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm text-gray-900">{t.label}</span>
              {/* WHICH LEVEL DECIDED — the half a bare number leaves out. */}
              <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                t.source.projectOverride
                  ? 'bg-indigo-50 text-indigo-800 ring-indigo-600/30'
                  : t.source.tenantPolicy
                    ? 'bg-gray-100 text-gray-700 ring-gray-500/20'
                    : 'bg-gray-50 text-gray-500 ring-gray-400/20'
              }`}>
                {t.source.projectOverride ? 'set on this project'
                  : t.source.tenantPolicy ? 'from your organisation'
                  : 'platform default'}
              </span>
              {!t.enabled && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">off</span>
              )}
              {/* The dial must never lie about whether it delivers. */}
              {t.deliveryStatus === 'preview' && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30">
                  not delivering yet
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600">{t.help}</p>

            {editing === t.trigger && canEdit ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <label className="text-[11px] text-gray-600">
                  Remind
                  <input
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="7, 2, 0"
                    className="ml-1 w-24 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                  />
                  <span className="ml-1">days before</span>
                </label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                >
                  <option value="both">ToDo and email</option>
                  <option value="todo">ToDo only</option>
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(t.trigger, {
                    nudgeDays: days.split(',').map((d) => Number(d.trim())).filter((d) => Number.isFinite(d)),
                    channel,
                  })}
                  className="rounded bg-gray-900 px-2 py-0.5 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  Save
                </button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:text-gray-700">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-gray-700">
                <span className="tabular-nums">
                  {t.nudgeDays.length === 0
                    ? 'no reminders'
                    : `${t.nudgeDays.join(', ')} day${t.nudgeDays.length === 1 && t.nudgeDays[0] === 1 ? '' : 's'} before`}
                </span>
                <span className="text-gray-500">{CHANNEL_LABEL[t.channel] ?? t.channel}</span>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(t.trigger);
                        setDays(t.nudgeDays.join(', '));
                        setChannel(t.channel);
                      }}
                      className="text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void save(t.trigger, { enabled: !t.enabled })}
                      className="text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
                    >
                      {t.enabled ? 'Turn off here' : 'Turn back on'}
                    </button>
                    {/* Its own control, because clearing is NOT the same as retyping the inherited
                        value: the second stops tracking when the organisation's setting moves. */}
                    {t.source.projectOverride && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void save(t.trigger, { enabled: null, nudgeDays: null, channel: null })}
                        className="text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
                      >
                        Use the organisation setting
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
