'use client';

import { useState } from 'react';
import type { SiteAnalytics, VisitorSession } from '@/lib/analytics-admin';

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-[11px] text-gray-400">{sub}</div>
    </div>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-gray-800 truncate">
            <span className="font-mono">{s.firstPage || '/'}</span>
            <span className="text-gray-400"> · {s.pageCount ?? s.events.length} pages</span>
          </div>
          <div className="text-[11px] text-gray-400 capitalize">
            {(s.deviceType || 'desktop')} · {browserFromUA(s.userAgent)} · {acq}
          </div>
        </div>
        <span className="text-[11px] text-gray-400 whitespace-nowrap">{relTime(s.lastSeen)}</span>
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

export default function AnalyticsDrawer({ data, sessions }: { data: SiteAnalytics; sessions: VisitorSession[] }) {
  const [open, setOpen] = useState(false);
  const maxViews = data.topPages.reduce((m, p) => Math.max(m, p.views), 0) || 1;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border hover:bg-gray-50"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Analytics
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
          <aside className="relative w-[28rem] max-w-full h-full bg-gray-50 shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between z-10">
              <div>
                <div className="font-semibold">Visitor analytics</div>
                <div className="text-xs text-gray-500">Public site traffic</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">
                Close
              </button>
            </div>

            <div className="p-5 space-y-5">
              {!data.ok && (
                <div className="text-sm text-gray-500 bg-white border rounded-lg p-4">
                  No analytics available yet. Traffic appears here once visitors hit the public site.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Page views" value={data.views7d} sub="last 7 days" />
                <Stat label="Page views" value={data.views30d} sub="last 30 days" />
                <Stat label="Sessions" value={data.sessions7d} sub="last 7 days" />
                <Stat label="Sessions" value={data.sessions30d} sub="last 30 days" />
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Top pages · last 30 days
                </div>
                <div className="rounded-lg border bg-white divide-y">
                  {data.topPages.length === 0 && (
                    <div className="p-3 text-sm text-gray-400">No page views yet.</div>
                  )}
                  {data.topPages.map((p) => (
                    <div key={p.path} className="p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-mono text-gray-700 truncate mr-2">{p.path}</span>
                        <span className="tabular-nums text-gray-900 font-medium">{p.views.toLocaleString()}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${Math.round((p.views / maxViews) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Recent sessions · expand for the visit timeline
                </div>
                <div className="rounded-lg border bg-white divide-y">
                  {sessions.length === 0 && (
                    <div className="p-3 text-sm text-gray-400">No session detail yet.</div>
                  )}
                  {sessions.map((s) => (
                    <SessionRow key={s.sessionId} s={s} />
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-gray-400">
                Sessions are de-duplicated by visitor session. The visitor fingerprint is a one-way
                SHA-256 hash — raw IP addresses are never stored. Time-on-page is captured when the
                visitor leaves a page.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
