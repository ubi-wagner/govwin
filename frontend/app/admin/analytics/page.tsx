'use client'

import { useState, useEffect } from 'react'

interface Totals {
  totalVisitors: number
  conversions: number
  totalPageViews: number
  totalInteractions: number
}

interface DailyRow { day: string; visitors: number; conversions: number }
interface PageRow { path: string; views: number; uniqueVisitors: number; avgTimeMs: number; avgScrollPct: number }
interface InteractionRow { target: string; eventType: string; count: number; uniqueVisitors: number }
interface SourceRow { source: string; medium: string; visitors: number; conversions: number }
interface DeviceRow { deviceType: string; count: number }
interface VisitorRow {
  visitorId: string; ipAddress: string | null; country: string | null; city: string | null
  deviceType: string | null; browser: string | null; utmSource: string | null; utmMedium: string | null
  referer: string | null; pageViewCount: number; interactionCount: number
  firstSeenAt: string; lastSeenAt: string; waitlistId: number | null
  waitlistEmail: string | null; waitlistName: string | null; waitlistCompany: string | null
}

interface JourneyEvent { type: 'pageview' | 'interaction'; path: string; detail: string; time: string }

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totals, setTotals] = useState<Totals>({ totalVisitors: 0, conversions: 0, totalPageViews: 0, totalInteractions: 0 })
  const [dailyVisitors, setDailyVisitors] = useState<DailyRow[]>([])
  const [topPages, setTopPages] = useState<PageRow[]>([])
  const [topInteractions, setTopInteractions] = useState<InteractionRow[]>([])
  const [sources, setSources] = useState<SourceRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [recentVisitors, setRecentVisitors] = useState<VisitorRow[]>([])
  const [journeyVisitor, setJourneyVisitor] = useState<string | null>(null)
  const [journey, setJourney] = useState<JourneyEvent[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)

  useEffect(() => { fetchData() }, [days]) // eslint-disable-line

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/analytics?days=${days}`)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      const d = json.data
      setTotals(d.totals)
      setDailyVisitors(d.dailyVisitors ?? [])
      setTopPages(d.topPages ?? [])
      setTopInteractions(d.topInteractions ?? [])
      setSources(d.sources ?? [])
      setDevices(d.devices ?? [])
      setRecentVisitors(d.recentVisitors ?? [])
    } catch {
      setError('Failed to load analytics.')
    } finally {
      setLoading(false)
    }
  }

  async function loadJourney(visitorId: string) {
    setJourneyVisitor(visitorId)
    setJourneyLoading(true)
    try {
      const res = await fetch(`/api/admin/analytics/visitor?id=${encodeURIComponent(visitorId)}`)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      const d = json.data
      const events: JourneyEvent[] = []
      for (const pv of d.pageViews ?? []) {
        events.push({
          type: 'pageview',
          path: pv.path,
          detail: `Viewed "${pv.pageTitle ?? pv.path}"${pv.scrollDepthPct ? ` (${pv.scrollDepthPct}% scroll)` : ''}${pv.timeOnPageMs ? ` — ${Math.round(pv.timeOnPageMs / 1000)}s` : ''}`,
          time: pv.createdAt,
        })
      }
      for (const ia of d.interactions ?? []) {
        events.push({
          type: 'interaction',
          path: ia.path,
          detail: `${ia.eventType}: ${ia.targetLabel ?? ia.target}`,
          time: ia.createdAt,
        })
      }
      events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      setJourney(events)
    } catch {
      setJourney([])
    } finally {
      setJourneyLoading(false)
    }
  }

  function fmt(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  function fmtFull(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  function fmtTime(ms: number) {
    if (ms < 1000) return '<1s'
    const s = Math.round(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const convRate = totals.totalVisitors > 0 ? ((totals.conversions / totals.totalVisitors) * 100).toFixed(1) : '0'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-sm text-red-600 font-medium">{error}</p>
        <button onClick={fetchData} className="btn-primary mt-4 px-6 py-2 text-sm">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Site Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">Visitor tracking, page performance, and conversion funnels</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                days === d ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Visitors" value={totals.totalVisitors} />
        <StatCard label="Page Views" value={totals.totalPageViews} />
        <StatCard label="Interactions" value={totals.totalInteractions} />
        <StatCard label="Conversions" value={totals.conversions} />
        <StatCard label="Conv. Rate" value={`${convRate}%`} />
      </div>

      {/* Daily chart (simple bar representation) */}
      {dailyVisitors.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Daily Visitors</h2>
          <div className="flex items-end gap-1 h-24">
            {dailyVisitors.map((d, i) => {
              const max = Math.max(...dailyVisitors.map(x => x.visitors), 1)
              const pct = (d.visitors / max) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${fmt(d.day)}: ${d.visitors} visitors, ${d.conversions} conversions`}>
                  <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                    <div
                      className={`w-full rounded-t ${d.conversions > 0 ? 'bg-emerald-500' : 'bg-brand-400'}`}
                      style={{ height: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  {i % Math.ceil(dailyVisitors.length / 7) === 0 && (
                    <span className="text-[9px] text-gray-400">{fmt(d.day)}</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-400" /> Visitors</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> With conversion</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Pages */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Top Pages</h2>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50/50">
              <th className="px-4 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Page</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Views</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Uniq</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Avg Time</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Scroll</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {topPages.map((p, i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-medium text-gray-900">{p.path}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{p.views}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{p.uniqueVisitors}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtTime(p.avgTimeMs)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{p.avgScrollPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top Interactions */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Top Interactions</h2>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50/50">
              <th className="px-4 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Target</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Type</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Count</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Uniq</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {topInteractions.map((ia, i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-medium text-gray-900">{ia.target.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${ia.eventType === 'click' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{ia.eventType}</span></td>
                  <td className="px-3 py-2 text-right text-gray-600">{ia.count}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{ia.uniqueVisitors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Traffic Sources */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Traffic Sources</h2>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50/50">
              <th className="px-4 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Source</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Medium</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Visitors</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Conv</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {sources.map((s, i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-medium text-gray-900">{s.source}</td>
                  <td className="px-3 py-2 text-gray-600">{s.medium}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{s.visitors}</td>
                  <td className="px-3 py-2 text-right">{s.conversions > 0 ? <span className="text-emerald-600 font-bold">{s.conversions}</span> : <span className="text-gray-400">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Devices */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Devices</h2>
          <div className="space-y-3">
            {devices.map((d, i) => {
              const total = devices.reduce((acc, x) => acc + x.count, 0) || 1
              const pct = Math.round((d.count / total) * 100)
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700 capitalize">{d.deviceType}</span>
                    <span className="text-gray-500">{d.count} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent Visitors */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Recent Visitors</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50/50">
              <th className="px-4 py-2 text-left font-bold uppercase tracking-wider text-gray-500">First Seen</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-gray-500">IP</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Location</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Device</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Source</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Pages</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-gray-500">Actions</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-gray-500">Converted</th>
              <th className="px-3 py-2 w-8"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {recentVisitors.map(v => (
                <tr key={v.visitorId} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">{fmtFull(v.firstSeenAt)}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{v.ipAddress ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{[v.city, v.country].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 capitalize">{v.deviceType ?? '—'} / {v.browser ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{v.utmSource ?? 'direct'}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{v.pageViewCount}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{v.interactionCount}</td>
                  <td className="px-3 py-2">
                    {v.waitlistId ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        {v.waitlistName ?? v.waitlistEmail ?? 'Yes'}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => loadJourney(v.visitorId)}
                      className="text-brand-600 hover:text-brand-700 font-semibold"
                      title="View journey"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Journey overlay */}
      {journeyVisitor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setJourneyVisitor(null)}>
          <div className="relative mx-4 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setJourneyVisitor(null)} className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Visitor Journey</h3>
            <p className="text-xs text-gray-500 mb-6 font-mono">{journeyVisitor}</p>
            {journeyLoading ? (
              <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" /></div>
            ) : journey.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">No journey data recorded.</p>
            ) : (
              <div className="relative pl-6 border-l-2 border-gray-200 space-y-4">
                {journey.map((ev, i) => (
                  <div key={i} className="relative">
                    <div className={`absolute -left-[25px] h-3 w-3 rounded-full border-2 border-white ${ev.type === 'pageview' ? 'bg-brand-500' : 'bg-amber-500'}`} />
                    <div className="text-xs">
                      <span className="text-gray-400">{fmtFull(ev.time)}</span>
                      <span className="mx-2 text-gray-300">|</span>
                      <span className="font-medium text-gray-600">{ev.path}</span>
                    </div>
                    <p className="text-sm text-gray-900 mt-0.5">{ev.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-gray-900">{value}</p>
    </div>
  )
}
