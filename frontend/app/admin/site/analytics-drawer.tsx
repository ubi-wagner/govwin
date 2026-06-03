'use client';

import { useState } from 'react';
import type { SiteAnalytics } from '@/lib/analytics-admin';

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-[11px] text-gray-400">{sub}</div>
    </div>
  );
}

export default function AnalyticsDrawer({ data }: { data: SiteAnalytics }) {
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
          <aside className="relative w-[26rem] max-w-full h-full bg-gray-50 shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between">
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

              <p className="text-[11px] text-gray-400">
                Sessions are de-duplicated by visitor session. IPs are stored hashed (SHA-256), never raw.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
