'use client';

import { useState } from 'react';
import type { VisitorSession } from '@/lib/analytics-admin';
import { TimeAgo } from '@/components/ui/time-ago';

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}


function fmtDur(ms: number | null): string {
  if (ms == null || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function browserFromUA(ua: string | null): string {
  if (!ua) return 'Unknown browser';
  if (/edg/i.test(ua)) return 'Edge';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}

function SessionRow({ s }: { s: VisitorSession }) {
  const [open, setOpen] = useState(false);
  const acq = s.referrer
    ? new URL(s.referrer, 'https://x').hostname.replace(/^www\./, '') || s.referrer
    : 'direct';
  const loc = [s.city, s.region, s.country].filter(Boolean).join(', ');
  const net = s.isp || s.org;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-gray-800 truncate">
            <span className="font-mono">{s.firstPage || '/'}</span>
            <span className="text-gray-400"> · {s.pageCount ?? s.events.length} pages</span>
          </div>
          <div className="text-[11px] text-gray-400">
            {(s.deviceType || 'desktop')} · {browserFromUA(s.userAgent)}{loc ? ` · ${loc}` : ''} · {acq}
          </div>
        </div>
        <span className="text-[11px] text-gray-400 whitespace-nowrap"><TimeAgo iso={s.lastSeen} /></span>
      </button>
      {open && (
        <div className="px-3 pb-3 bg-gray-50/60">
          <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] mb-2">
            <dt className="text-gray-400">Visitor</dt>
            <dd className="col-span-2 font-mono text-gray-600 truncate" title="SHA-256 fingerprint (raw IP is never stored)">
              {s.ipHash ? `${s.ipHash.slice(0, 16)}…` : 'n/a'} <span className="text-gray-400">(hashed)</span>
            </dd>
            <dt className="text-gray-400">Device</dt>
            <dd className="col-span-2 text-gray-600 capitalize">{(s.deviceType || 'desktop')} · {browserFromUA(s.userAgent)}</dd>
            <dt className="text-gray-400">Location</dt>
            <dd className="col-span-2 text-gray-600">{loc || '—'}{s.timezone ? ` · ${s.timezone}` : ''}</dd>
            <dt className="text-gray-400">Network</dt>
            <dd className="col-span-2 text-gray-600 truncate" title={net ?? ''}>{net || '—'}{s.asn ? ` · ${s.asn}` : ''}</dd>
            <dt className="text-gray-400">Source</dt>
            <dd className="col-span-2 text-gray-600 truncate">{s.referrer || 'direct'}{s.events[0]?.utmSource ? ` · utm:${s.events[0].utmSource}` : ''}</dd>
            <dt className="text-gray-400">First seen</dt>
            <dd className="col-span-2 text-gray-600">{fmtTime(s.firstSeen)}</dd>
            <dt className="text-gray-400">Last seen</dt>
            <dd className="col-span-2 text-gray-600">{fmtTime(s.lastSeen)}</dd>
          </dl>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Path timeline</div>
          <ol className="border-l border-gray-200 ml-1">
            {s.events.length === 0 && <li className="pl-3 text-[11px] text-gray-400">No events recorded.</li>}
            {s.events.map((e, i) => (
              <li key={i} className="pl-3 py-1 relative">
                <span className="absolute -left-[3px] top-2 w-1.5 h-1.5 rounded-full bg-blue-400" />
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-mono text-gray-700 truncate">{e.path}</span>
                  <span className="text-gray-400 whitespace-nowrap">{fmtTime(e.at)} · {fmtDur(e.durationMs)}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Expandable list of recent visitor sessions — each opens to its full visit
 *  timeline + device / location / network (ISP·ASN) / source detail. */
export function RecentSessions({ sessions }: { sessions: VisitorSession[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg divide-y">
      {sessions.length === 0 && (
        <div className="p-4 text-sm text-gray-400 italic">No session detail yet.</div>
      )}
      {sessions.map((s) => (
        <SessionRow key={s.sessionId} s={s} />
      ))}
    </div>
  );
}
